import { Resend, type CreateEmailOptions } from "resend";
import { put } from "@vercel/blob";
import { after } from "next/server";
import { dbConfigured, getSql } from "@/lib/db";
import { brandedEmail, escapeHtml } from "@/lib/email-templates";
import { recordEvent } from "@/lib/events";
import { notifyAll } from "@/lib/notify";
import { getShopPhone } from "@/lib/shop-contact";
import {
  attachLeadPhotos,
  createLead,
  isRateLimitedDurable,
  markLeadDelivery,
} from "@/lib/leads";
import { processEvent } from "@/lib/extract";
import { getMessagingConsentState } from "@/lib/messaging-consent";
import {
  normalizeUsPhone,
  QUOTE_CONSENT_DISCLOSURE_VERSION,
  TEXT_CONSENT_REVOKED_WARNING,
  TEXT_CONSENT_UNVERIFIED_WARNING,
  webTextConsentResolution,
} from "@/lib/shop-brain-invariants.mjs";

export const runtime = "nodejs"; // important for email libs

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);
const MAX_PHOTO_COUNT = 5;
const MAX_FILE_SIZE = 3 * 1024 * 1024;
const MAX_TOTAL_SIZE = 4 * 1024 * 1024;
const MAX_REQUEST_SIZE = 6 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 6;

type RateLimitEntry = { count: number; resetAt: number };
const rateLimitStore = new Map<string, RateLimitEntry>();

// Fast per-instance layer; the durable cross-instance layer lives in Postgres.
function isRateLimitedLocal(ip: string) {
  if (!ip || ip === "unknown") return false;

  const now = Date.now();
  const existing = rateLimitStore.get(ip);

  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  existing.count += 1;
  return existing.count > RATE_LIMIT_MAX_REQUESTS;
}

function isValidEmail(email?: string) {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitize(s: unknown, max = 2000) {
  if (typeof s !== "string") return "";
  return s.trim().slice(0, max);
}

type DurableEmailState = "accepted" | "failed" | "unknown";
type DurableEmailResult = {
  state: DurableEmailState;
  error: string;
  receiptEventId: number | null;
};

async function resumeEventId(kind: string, externalId: string) {
  const rows = (await getSql()`
    SELECT id FROM events
    WHERE kind = ${kind}::text AND external_id = ${externalId}::text
    LIMIT 1`) as { id: number }[];
  return Number(rows[0]?.id) || null;
}

async function sendDurableQuoteEmail(input: {
  resend: Resend;
  leadId: number | null;
  personId: number | null;
  intent: string;
  audience: "shop" | "customer";
  payload: CreateEmailOptions;
}): Promise<DurableEmailResult> {
  let sourceEventId: number | null = null;
  if (input.leadId !== null) {
    sourceEventId = await recordEvent({
      kind: "email.out",
      actorType: "system",
      leadId: input.leadId,
      personId: input.personId,
      externalId: input.intent,
      body: `Quote ${input.audience === "shop" ? "shop alert" : "customer receipt"} queued.`,
      crewBody: `Quote ${input.audience === "shop" ? "shop alert" : "customer receipt"} queued.`,
      detail: {
        audience: input.audience,
        subject: input.payload.subject,
        deliveryStatus: "pending",
      },
    });
    if (!sourceEventId) sourceEventId = await resumeEventId("email.out", input.intent);
    if (sourceEventId) {
      const receipts = (await getSql()`
        SELECT kind FROM events
        WHERE kind = ANY(ARRAY['email.accepted','email.delivered']::text[])
          AND detail->>'sourceEventId' = ${String(sourceEventId)}::text
        ORDER BY id DESC LIMIT 1`) as { kind: string }[];
      if (receipts[0]) return { state: "accepted", error: "", receiptEventId: sourceEventId };
    }
  }

  try {
    const { data, error } = await input.resend.emails.send(input.payload, {
      idempotencyKey: input.intent,
    });
    if (error || !data?.id) {
      const message = error?.message || "Email provider did not accept the message.";
      if (sourceEventId && input.leadId !== null) {
        let failureEventId = await recordEvent({
          kind: "email.failed",
          actorType: "system",
          leadId: input.leadId,
          personId: input.personId,
          externalId: `request-failed:${input.intent}`,
          body: message,
          crewBody: "Email provider rejected the message.",
          detail: { sourceEventId, audience: input.audience },
        });
        if (!failureEventId) failureEventId = await resumeEventId("email.failed", `request-failed:${input.intent}`);
        return { state: "failed", error: message, receiptEventId: failureEventId || sourceEventId };
      }
      return { state: "failed", error: message, receiptEventId: sourceEventId };
    }
    let acceptanceEventId: number | null = null;
    if (sourceEventId && input.leadId !== null) {
      acceptanceEventId = await recordEvent({
        kind: "email.accepted",
        actorType: "system",
        leadId: input.leadId,
        personId: input.personId,
        externalId: data.id,
        body: "Email accepted by the delivery provider.",
        crewBody: "Email accepted by the delivery provider.",
        detail: {
          sourceEventId,
          providerEmailId: data.id,
          audience: input.audience,
        },
      });
      if (!acceptanceEventId) acceptanceEventId = await resumeEventId("email.accepted", data.id);
    }
    return { state: "accepted", error: "", receiptEventId: acceptanceEventId || sourceEventId };
  } catch (error) {
    // A transport exception is ambiguous: Resend may have accepted the email
    // before the response was lost. The same idempotency key makes a retry
    // safe, so keep the durable intent resumable instead of recording a lie.
    const message = error instanceof Error ? error.message : "Email provider response was lost.";
    if (sourceEventId && input.leadId !== null) {
      let unknownEventId = await recordEvent({
        kind: "email.unknown",
        actorType: "system",
        leadId: input.leadId,
        personId: input.personId,
        externalId: `request-unknown:${input.intent}`,
        body: message,
        crewBody: "Email provider response was not confirmed.",
        detail: { sourceEventId, audience: input.audience },
      });
      if (!unknownEventId) unknownEventId = await resumeEventId("email.unknown", `request-unknown:${input.intent}`);
      return { state: "unknown", error: message, receiptEventId: unknownEventId || sourceEventId };
    }
    return { state: "unknown", error: message, receiptEventId: sourceEventId };
  }
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const shopPhone = getShopPhone();
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    const userAgent = sanitize(req.headers.get("user-agent"), 400);

    const contentLength = Number(req.headers.get("content-length") || "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_SIZE) {
      return Response.json(
        { ok: false, error: "This request is too large. Please attach fewer or smaller photos." },
        { status: 413 }
      );
    }

    if (isRateLimitedLocal(ip)) {
      return Response.json(
        { ok: false, error: `Too many quote attempts. Please wait a few minutes or call ${shopPhone.display}.` },
        { status: 429, headers: { "Retry-After": "600" } }
      );
    }

    const formData = await req.formData();

    // Honeypot field: hidden input named "company" on the form.
    const honeypot = sanitize(formData.get("company"));
    if (honeypot) {
      // Pretend success to bots; do not persist or send email.
      return Response.json({ ok: true }, { status: 200 });
    }

    const firstName = sanitize(formData.get("firstName"));
    const lastName = sanitize(formData.get("lastName"));
    const email = sanitize(formData.get("email"));
    const phone = sanitize(formData.get("phone"));
    const serviceNeeded = sanitize(formData.get("service"));
    const projectDetails = sanitize(formData.get("message"));
    const preferredContact = sanitize(formData.get("preferredContact"));
    const textConsent = sanitize(formData.get("textConsent")) === "yes";
    const intakeKey = sanitize(formData.get("intakeKey"), 80);

    // Attribution (hidden fields populated client-side).
    const gclid = sanitize(formData.get("gclid"), 200);
    const utmSource = sanitize(formData.get("utm_source"), 120);
    const utmMedium = sanitize(formData.get("utm_medium"), 120);
    const utmCampaign = sanitize(formData.get("utm_campaign"), 200);
    const utmTerm = sanitize(formData.get("utm_term"), 200);
    const utmContent = sanitize(formData.get("utm_content"), 200);
    const landingPage = sanitize(formData.get("landing_page"), 500);
    const referrer = sanitize(formData.get("page_referrer"), 500);

    // Internal verification submissions carry this marker so they can be
    // filtered and cleaned up without touching real customer records.
    const isTest = projectDetails.includes("[INTERNAL TEST]");

    const photoFiles: File[] = [];
    const photos = formData.getAll("photos");
    let totalSize = 0;
    for (const photo of photos) {
      if (photo instanceof File) {
        if (!ALLOWED_IMAGE_TYPES.has(photo.type)) {
          return Response.json(
            { ok: false, error: "Please attach supported image files only." },
            { status: 400 }
          );
        }
        if (photoFiles.length >= MAX_PHOTO_COUNT) {
          return Response.json(
            { ok: false, error: `You can attach up to ${MAX_PHOTO_COUNT} photos.` },
            { status: 400 }
          );
        }
        if (photo.size > MAX_FILE_SIZE) {
          return Response.json(
            { ok: false, error: `File "${photo.name}" is too large. Maximum size is 3MB per file.` },
            { status: 400 }
          );
        }
        totalSize += photo.size;
        if (totalSize > MAX_TOTAL_SIZE) {
          return Response.json(
            { ok: false, error: "Attached photos must total 4MB or less." },
            { status: 400 }
          );
        }
        photoFiles.push(photo);
      }
    }

    if (!firstName || !phone || !serviceNeeded) {
      return Response.json(
        { ok: false, error: "Missing required fields." },
        { status: 400 }
      );
    }

    if (email && !isValidEmail(email)) {
      return Response.json({ ok: false, error: "Invalid email." }, { status: 400 });
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(intakeKey)) {
      return Response.json(
        { ok: false, error: "This form expired before it could be sent. Refresh the page and try again." },
        { status: 400 }
      );
    }

    const consentPhone = textConsent && !isTest ? normalizeUsPhone(phone) : "";
    if (textConsent && !isTest && !consentPhone) {
      return Response.json(
        { ok: false, error: "Enter a valid US mobile number to receive text updates." },
        { status: 400 }
      );
    }
    if (textConsent && !isTest && !dbConfigured()) {
      return Response.json(
        { ok: false, error: "We couldn't safely save text permission. Uncheck text updates or call the shop." },
        { status: 503 }
      );
    }

    // A prior STOP still governs this number even if the customer re-checks the
    // box on the web form. Resolve the durable consent state once so a web
    // checkbox can never silently override a text STOP. Grant permission is
    // tracked separately from any conflict: a lookup failure denies the grant
    // (webTextConsent is omitted) without fabricating a STOP conflict.
    let webTextGrant = true;
    let consentConflict = false;
    let consentWarning = "";
    if (textConsent && !isTest && consentPhone) {
      try {
        const resolution = webTextConsentResolution(
          await getMessagingConsentState(consentPhone)
        );
        webTextGrant = resolution.grant;
        consentConflict = resolution.consentConflict;
        if (consentConflict) consentWarning = TEXT_CONSENT_REVOKED_WARNING;
      } catch (consentLookupError) {
        // Consent lookup must never block intake. On a transient storage
        // failure the lead still saves, but webTextConsent is omitted and the
        // customer is told to opt in by text instead.
        webTextGrant = false;
        consentConflict = false;
        consentWarning = TEXT_CONSENT_UNVERIFIED_WARNING;
        console.error("Text-consent lookup error:", consentLookupError);
      }
    }

    // Durable cross-instance throttle. Never blocks a lead on DB failure.
    if (dbConfigured() && ip !== "unknown") {
      const limited = await isRateLimitedDurable(
        `quote:${ip}`,
        RATE_LIMIT_WINDOW_MS,
        RATE_LIMIT_MAX_REQUESTS
      );
      if (limited) {
        return Response.json(
          { ok: false, error: `Too many quote attempts. Please wait a few minutes or call ${shopPhone.display}.` },
          { status: 429, headers: { "Retry-After": "600" } }
        );
      }
    }

    // Persist the lead FIRST so it survives any email-provider failure.
    let leadId: number | null = null;
    let leadPublicId = "";
    let leadPersonId: number | null = null;
    if (dbConfigured()) {
      try {
        const lead = await createLead(
          {
            firstName,
            lastName,
            phone,
            email,
            service: serviceNeeded,
            message: projectDetails,
            preferredContact,
            photoCount: photoFiles.length,
            gclid,
            utmSource,
            utmMedium,
            utmCampaign,
            utmTerm,
            utmContent,
            landingPage,
            referrer,
            ip,
            userAgent,
            isTest,
          },
          {
            intakeKey: `website:${intakeKey}`,
            ...(textConsent && !isTest && webTextGrant
              ? {
                webTextConsent: {
                  phoneE164: consentPhone,
                  provenance: {
                    checked: true,
                    disclosureVersion: QUOTE_CONSENT_DISCLOSURE_VERSION,
                    ip,
                    userAgent,
                    landingPage,
                    referrer,
                  },
                },
              }
              : {}),
          }
        );
        leadId = lead.id;
        leadPublicId = lead.publicId;
        const leadRows = (await getSql()`
          SELECT person_id, first_name, last_name, phone, email, service, message,
            preferred_contact, photo_count
          FROM leads WHERE id = ${lead.id}::bigint LIMIT 1`) as {
          person_id: number | null;
          first_name: string;
          last_name: string;
          phone: string;
          email: string;
          service: string;
          message: string;
          preferred_contact: string;
          photo_count: number;
        }[];
        if (lead.reused) {
          const saved = leadRows[0];
          const sameSubmission = Boolean(saved)
            && saved.first_name === firstName
            && saved.last_name === lastName
            && normalizeUsPhone(saved.phone) === normalizeUsPhone(phone)
            && saved.email.trim().toLowerCase() === email.trim().toLowerCase()
            && saved.service === serviceNeeded
            && saved.message === projectDetails
            && saved.preferred_contact === preferredContact
            && Number(saved.photo_count) === photoFiles.length;
          if (!sameSubmission) {
            return Response.json(
              { ok: false, error: "The earlier version of this request was already saved. Refresh the page to start a changed request, or call the shop." },
              { status: 409 },
            );
          }
        }
        leadPersonId = leadRows[0]?.person_id ?? null;
        if (lead.eventId) after(() => processEvent(lead.eventId!).catch((error) => console.error("Quote intake extraction failed:", error)));
      } catch (dbError) {
        if (textConsent && !isTest) {
          console.error("Lead and text-consent persistence error:", dbError);
          return Response.json(
            { ok: false, error: "We couldn't confirm the saved text permission. Try again, uncheck text updates, or call the shop." },
            { status: 503 }
          );
        }
        // Email delivery below still protects a lead that did not request SMS.
        console.error("Lead persistence error:", dbError);
      }
    }

    // Persist photos to private Blob storage so they survive an email failure.
    if (leadId !== null && photoFiles.length > 0 && process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const stored = [];
        for (const [index, file] of photoFiles.entries()) {
          const safeName =
            file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || `photo-${index + 1}`;
          const blob = await put(`leads/${leadPublicId}/${index + 1}-${safeName}`, file, {
            access: "private",
            contentType: file.type,
            addRandomSuffix: false,
            allowOverwrite: true,
          });
          stored.push({
            pathname: blob.pathname,
            contentType: file.type,
            size: file.size,
            name: safeName,
          });
        }
        await attachLeadPhotos(leadId, stored, { externalId: `quote-photos:${intakeKey}` });
      } catch (blobError) {
        // Photos still ride along on the notification email.
        console.error("Photo persistence error:", blobError);
      }
    }

    const now = new Date().toISOString();
    const to = process.env.QUOTE_TO_EMAIL;
    const from = process.env.QUOTE_FROM_EMAIL;
    const subjectPrefix = process.env.QUOTE_EMAIL_SUBJECT_PREFIX || "New Quote Request";

    let emailSent = false;
    let ownerEmailState: DurableEmailState = "failed";
    let emailErrorMessage = "";
    if (!isTest && apiKey && to && from) {
      const resend = new Resend(apiKey);
      const subject = `${subjectPrefix}: ${firstName}${lastName ? " " + lastName : ""} - ${serviceNeeded}`;

      const text = [
        `New quote request received`,
        ``,
        `Name: ${firstName} ${lastName}`.trim(),
        `Phone: ${phone}`,
        email ? `Email: ${email}` : `Email: (not provided)`,
        `Service Needed: ${serviceNeeded}`,
        preferredContact ? `Preferred Contact: ${preferredContact}` : `Preferred Contact: (not provided)`,
        ``,
        `Project Details:`,
        projectDetails || "(none provided)",
        ``,
        photoFiles.length > 0 ? `${photoFiles.length} photo(s) attached.` : "No photos attached.",
        ``,
        `Meta:`,
        leadId !== null ? `Job #${leadId}` : `Job number: (not persisted)`,
        `Source: ${gclid ? "google-ads" : utmSource || referrer || "direct"}`,
        `IP: ${ip}`,
        `Time: ${now}`,
        leadPublicId
          ? `Manage: https://musiccityspecialtywelding.com/ops`
          : ``,
      ].join("\n");

      const attachments = await Promise.all(
        photoFiles.map(async (file) => {
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          return {
            filename: file.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "photo",
            content: buffer,
          };
        })
      );

      const ownerHtml = brandedEmail({
        preheader: `${firstName} · ${serviceNeeded} · ${phone}`,
        headline: "New job in the door",
        bodyHtml: [
          `<strong>${escapeHtml(firstName)} ${escapeHtml(lastName)}</strong>`.trim(),
          `Phone: <a href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ""))}">${escapeHtml(phone)}</a>`,
          email ? `Email: ${escapeHtml(email)}` : `Email: (not provided)`,
          `Job: <strong>${escapeHtml(serviceNeeded)}</strong>`,
          projectDetails ? `<br />“${escapeHtml(projectDetails)}”` : "",
          photoFiles.length > 0 ? `<br />${photoFiles.length} photo(s) attached.` : "",
          leadId !== null ? `<br />Job #${leadId} is on the board.` : "",
        ]
          .filter(Boolean)
          .join("<br />"),
        ctaLabel: "Open the board",
        ctaUrl: "https://musiccityspecialtywelding.com/ops",
        footnote: `Source: ${escapeHtml(gclid ? "google-ads" : utmSource || referrer || "direct")} · ${now}`,
      });

      const ownerResult = await sendDurableQuoteEmail({
        resend,
        leadId,
        personId: leadPersonId,
        intent: `quote-owner:${intakeKey}`,
        audience: "shop",
        payload: {
          from,
          to,
          subject,
          text,
          html: ownerHtml,
          replyTo: email ? email : undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
      });
      ownerEmailState = ownerResult.state;
      emailSent = ownerResult.state === "accepted";
      emailErrorMessage = ownerResult.error;
      if (ownerResult.state !== "accepted") console.error("Quote delivery was not confirmed:", ownerResult.error);

      // Customer confirmation — same brand, never blocks the lead, and only
      // when the job actually landed on at least one durable channel.
      if (email && !isTest && (emailSent || leadId !== null)) {
        const customerResult = await sendDurableQuoteEmail({
          resend,
          leadId,
          personId: leadPersonId,
          intent: `quote-customer:${intakeKey}`,
          audience: "customer",
          payload: {
            from,
            to: email,
            subject: "We got your job — Music City Specialty Welding",
            text: [
              `Hey ${firstName},`,
              ``,
              `Your ${serviceNeeded} request just hit our board. A real person from the shop will call you at ${phone}.`,
              ``,
              `If it can't wait, call us right now — we're open 24 hours: ${shopPhone.display}.`,
              ``,
              `Music City Specialty Welding`,
              `533 W Baddour Pkwy, Lebanon, TN 37087`,
            ].join("\n"),
            html: brandedEmail({
              preheader: "Your job hit the board. We'll call you.",
              headline: `Got it, ${escapeHtml(firstName)}.`,
              bodyHtml: [
                `Your <strong>${escapeHtml(serviceNeeded)}</strong> request just hit the board at the shop.`,
                `A real person will call you at <strong>${escapeHtml(phone)}</strong> — not a bot, not a call center.`,
                `If it can't wait, don't wait on us — call <strong>${escapeHtml(shopPhone.display)}</strong>. We're open 24 hours.`,
              ].join("<br /><br />"),
              ctaLabel: "Call the shop — open 24 hours",
              ctaUrl: getShopPhone().href,
            }),
          },
        });
        if (customerResult.state !== "accepted") {
          console.error("Customer confirmation was not confirmed:", customerResult.error);
          if (leadId !== null) {
            await notifyAll({
              priority: "digest",
              stock: "red",
              title: customerResult.state === "failed"
                ? "Customer confirmation did not send"
                : "Check customer confirmation delivery",
              body: customerResult.error,
              crewBody: "The customer confirmation needs an owner delivery check.",
              url: `/ops/leads/${leadId}#spike`,
              sourceEventId: customerResult.receiptEventId,
              ownerOnly: true,
              dedupeKey: `quote-customer-delivery:${intakeKey}:${customerResult.state}`,
            });
          }
        }
      }
    } else if (isTest) {
      emailErrorMessage = "INTERNAL TEST delivery suppressed."
    } else {
      emailErrorMessage = "Email service not configured.";
    }

    if (leadId !== null) {
      if (!isTest) {
        try {
          if (ownerEmailState === "accepted") {
            await markLeadDelivery(leadId, "accepted");
          } else if (ownerEmailState === "failed") {
            await markLeadDelivery(leadId, "failed", emailErrorMessage || undefined);
          }
        } catch (deliveryLogError) {
          console.error("Delivery status update error:", deliveryLogError);
        }
      }
      if (!isTest) {
        // Second alert channel: instant phone push, independent of the email provider.
        await notifyAll({
          priority: "interrupt",
          stock: ownerEmailState === "accepted" ? "white" : "red",
          title: `New lead: ${firstName}`,
          body: `${serviceNeeded} · ${phone}${ownerEmailState === "failed" ? " · OWNER EMAIL FAILED — dashboard only" : ownerEmailState === "unknown" ? " · OWNER EMAIL UNCONFIRMED — dashboard saved" : ""}`,
          crewBody: `${serviceNeeded} · ${phone}`,
          url: `/ops/leads/${leadId}`,
          capExempt: true,
          quietHoursExempt: true,
          smsFallback: true,
          dedupeKey: `quote-intake:${intakeKey}:new-lead`,
        });
      }
    }

    // The request succeeds when the lead is captured by at least one channel.
    if (emailSent || leadId !== null) {
      return Response.json(
        consentWarning
          ? {
            ok: true,
            // A conflict is only real for a prior STOP; a lookup failure
            // denies the grant but must not claim a STOP occurred.
            ...(consentConflict ? { consentConflict: true } : {}),
            warning: consentWarning,
          }
          : { ok: true },
        { status: 200 }
      );
    }

    return Response.json(
      { ok: false, error: `We couldn't submit your request. Please call ${shopPhone.display} or try again.` },
      { status: 500 }
    );
  } catch (err) {
    console.error("Quote API error:", err);
    return Response.json(
      { ok: false, error: `We couldn't submit your request. Please call ${getShopPhone().display} or try again.` },
      { status: 500 }
    );
  }
}
