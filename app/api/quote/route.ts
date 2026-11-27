import { createHash } from "node:crypto";
import { Resend } from "resend";
import { get, put } from "@vercel/blob";
import { after } from "next/server";
import { dbConfigured, getSql } from "@/lib/db";
import { brandedEmail, escapeHtml } from "@/lib/email-templates";
import { recordEvent } from "@/lib/events";
import { emailReceiptUnavailable, readFrozenQuotePhotoCount, sendDurableQuoteEmail, type DurableEmailState, type FrozenQuoteEmail } from "@/lib/quote-email";
import { notifyAll } from "@/lib/notify";
import { getShopPhone } from "@/lib/shop-contact";
import { isAuthorizedCron } from "@/lib/ops-auth";
import { imageTypeMatches, isQuoteHoneypotFilled, validatePublicQuote } from "@/lib/public-quote.ts";
import {
  attachLeadPhotos,
  createLead,
  isRateLimitedDurable,
  LeadIntakePhoneConflict,
  markLeadPhotoIntent,
  markLeadDelivery,
  reserveLeadPhotoIntents,
} from "@/lib/leads";
import { processEvent } from "@/lib/extract";
import { recordLeadEvent } from "@/lib/leads";
import { prepareQuoteDraft } from "@/lib/follow-up-cadence.ts";
import { getMessagingConsentState } from "@/lib/messaging-consent";
import { sendSmsPersisted } from "@/lib/messages";
import { isReservedShopPhone } from "@/lib/people";
import { twilioSmsConfigured } from "@/lib/twilio";
import {
  normalizeUsPhone,
  QUOTE_CONSENT_DISCLOSURE_VERSION,
  TEXT_CONSENT_REVOKED_WARNING,
  TEXT_CONSENT_UNVERIFIED_WARNING,
  webTextConsentResolution,
} from "@/lib/shop-brain-invariants.ts";

export const runtime = "nodejs"; // important for email libs

const MAX_PHOTO_COUNT = 5;
const MAX_FILE_SIZE = 3 * 1024 * 1024;
const MAX_TOTAL_SIZE = 4 * 1024 * 1024;
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

function sanitize(s: unknown, max = 2000) {
  if (typeof s !== "string") return "";
  return s.trim().slice(0, max);
}

function safePhotoName(file: File, photoIndex: number) {
  return file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || `photo-${photoIndex}`;
}

type QuotePhotoIntent = {
  photo_index: number;
  target_path: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  status: string;
  stored_pathname: string;
};

function quotePhotoPath(publicId: string, index: number, name: string, hash?: string) {
  return `leads/${publicId}/${index}-${hash ? `${hash}-` : ""}${name}`;
}

function photoHash(bytes: ArrayBuffer) {
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

async function matchQuotePhotos(
  publicId: string,
  intents: QuotePhotoIntent[],
  files: File[],
  hashes: Map<File, string>,
) {
  const unmatched = [...files];
  const matches = new Map<number, File>();
  const candidates = intents.map((intent) => {
    const matchesMetadata = (file: File) =>
      intent.filename === safePhotoName(file, intent.photo_index)
      && intent.content_type === file.type && Number(intent.size_bytes) === file.size;
    const legacy = intent.target_path === quotePhotoPath(publicId, intent.photo_index, intent.filename);
    return { intent, matchesMetadata, legacy, storedHash: "" };
  });
  if (candidates.some(({ matchesMetadata }) => !files.some(matchesMetadata))) return null;

  for (const candidate of candidates) {
    if (!candidate.legacy) continue;
    const { intent } = candidate;
    // An old upload can exist at its deterministic path before its SQL receipt.
    const pathname = intent.stored_pathname || intent.target_path;
    const blob = await get(pathname, { access: "private" });
    if (!blob && !intent.stored_pathname) continue;
    if (!blob || blob.statusCode !== 200 || blob.blob.size !== Number(intent.size_bytes)) {
      throw new Error("Saved photo could not be verified.");
    }
    candidate.storedHash = photoHash(await new Response(blob.stream).arrayBuffer());
    if (intent.status !== "attached") {
      intent.status = "stored";
      intent.stored_pathname = pathname;
    }
  }
  // Match known contents first so an old intent without bytes cannot claim them.
  candidates.sort((a, b) => Number(a.legacy && !a.storedHash) - Number(b.legacy && !b.storedHash));
  for (const { intent, matchesMetadata, legacy, storedHash } of candidates) {
    const index = unmatched.findIndex((file) => {
      if (!matchesMetadata(file)) return false;
      const hash = hashes.get(file);
      return legacy
        ? !storedHash || hash === storedHash
        : intent.target_path === quotePhotoPath(publicId, intent.photo_index, intent.filename, hash);
    });
    if (index < 0) return null;
    matches.set(intent.photo_index, unmatched.splice(index, 1)[0]);
  }
  return [...intents.map((intent) => matches.get(intent.photo_index)!), ...unmatched];
}

function changedQuoteResponse(retryOriginalPhotos = false) {
  return Response.json(
    { ok: false, retryOriginalPhotos, error: retryOriginalPhotos
      ? "Your request was already saved. Reselect the original photos and try again, or call the shop."
      : "The earlier version of this request was already saved. Refresh the page to start a changed request, or call the shop." },
    { status: 409 },
  );
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

    if (isRateLimitedLocal(ip)) {
      return Response.json(
        { ok: false, error: `Too many quote attempts. Please wait a few minutes or call ${shopPhone.display}.` },
        { status: 429, headers: { "Retry-After": "600" } }
      );
    }

    const formData = await req.formData();

    // The opaque trap name does not overlap browser autofill field semantics.
    if (isQuoteHoneypotFilled(formData)) {
      // Pretend success to bots; do not persist or send email.
      return Response.json({ ok: true, accepted: true, suppressed: true }, { status: 200 });
    }

    const firstName = sanitize(formData.get("firstName"), 81);
    const lastName = sanitize(formData.get("lastName"), 81);
    const email = sanitize(formData.get("email"), 255);
    const phone = sanitize(formData.get("phone"), 41);
    const serviceNeeded = sanitize(formData.get("service"), 121);
    const projectDetails = sanitize(formData.get("message"), 4001);
    const preferredContact = sanitize(formData.get("preferredContact"), 40);
    const textConsent = sanitize(formData.get("textConsent")) === "yes";
    const intakeKey = sanitize(formData.get("intakeKey"), 80);

    // Attribution (hidden fields populated client-side).
    const rawUtmSource = sanitize(formData.get("utm_source"), 120);
    const rawUtmMedium = sanitize(formData.get("utm_medium"), 120);
    const internalVerificationAttribution = rawUtmSource.toLowerCase() === "internal-verify"
      || rawUtmMedium.toLowerCase() === "e2e";
    const gclid = internalVerificationAttribution ? "" : sanitize(formData.get("gclid"), 200);
    const utmSource = internalVerificationAttribution ? "" : rawUtmSource;
    const utmMedium = internalVerificationAttribution ? "" : rawUtmMedium;
    const utmCampaign = internalVerificationAttribution ? "" : sanitize(formData.get("utm_campaign"), 200);
    const utmTerm = internalVerificationAttribution ? "" : sanitize(formData.get("utm_term"), 200);
    const utmContent = internalVerificationAttribution ? "" : sanitize(formData.get("utm_content"), 200);
    const landingPage = internalVerificationAttribution ? "" : sanitize(formData.get("landing_page"), 500);
    const referrer = internalVerificationAttribution ? "" : sanitize(formData.get("page_referrer"), 500);

    // A public customer can type the marker as ordinary job text. Only an
    // authenticated verification request may enter the isolated test partition.
    let isTest = isAuthorizedCron(req) && projectDetails.includes("[INTERNAL TEST]");

    const photoFiles: File[] = [];
    const photos = formData.getAll("photos");
    let totalSize = 0;
    for (const photo of photos) {
      if (photo instanceof File) {
        const signature = new Uint8Array(await photo.slice(0, 32).arrayBuffer());
        if (!imageTypeMatches(signature, photo.type)) {
          return Response.json(
            { ok: false, accepted: false, error: "One attachment was not a valid JPG, PNG, WebP, GIF, HEIC, or HEIF photo." },
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

    const quoteValidationError = validatePublicQuote({
      firstName,
      lastName,
      email,
      phone,
      service: serviceNeeded,
      message: projectDetails,
    });
    if (quoteValidationError) {
      return Response.json(
        { ok: false, accepted: false, error: quoteValidationError },
        { status: 400 }
      );
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

    const photoHashes = new Map(await Promise.all(photoFiles.map(async (file) =>
      [file, photoHash(await file.arrayBuffer())] as const
    )));
    const photoFingerprints = [...photoHashes.values()].sort();

    // Persist the lead FIRST so it survives any email-provider failure.
    let leadId: number | null = null;
    let leadSnapshot: Awaited<ReturnType<typeof createLead>>["intakeSnapshot"] | null = null;
    let leadPublicId = "";
    let leadPersonId: number | null = null;
    let wasNewLead = false;
    let savedPhotos: QuotePhotoIntent[] = [];
    let savedOnlyPhotoCount: number | null = null;
    let photosResumable = true;
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
            quoteIntake: true,
            quotePhotoFingerprints: photoFingerprints,
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
        const saved = lead.existingSnapshot;
        if (saved) {
          const sameSubmission = saved.first_name === firstName
            && saved.last_name === lastName
            && saved.email.trim().toLowerCase() === email.trim().toLowerCase()
            && saved.service === serviceNeeded
            && saved.message === projectDetails
            && saved.preferred_contact === preferredContact;
          if (!sameSubmission) return changedQuoteResponse();
          try {
            // The attachment total can change later when a customer texts photos.
            const originalPhotoCount = saved.quote_form_photo_count ?? await readFrozenQuotePhotoCount(`quote-owner:${intakeKey}`);
            const savedFingerprints = saved.quote_photos?.fingerprints;
            const fingerprintsMatch = !savedFingerprints || (savedFingerprints.length === photoFingerprints.length
              && savedFingerprints.every((hash, index) => hash === photoFingerprints[index]));
            if (originalPhotoCount !== null && (originalPhotoCount !== photoFiles.length || !fingerprintsMatch)) {
              return changedQuoteResponse(true);
            }
            savedPhotos = (await getSql()`
              SELECT photo_index, target_path, filename, content_type, size_bytes, status, stored_pathname
              FROM lead_photo_intents
              WHERE lead_id = ${lead.id}::bigint AND intake_key = ${intakeKey}::text
              ORDER BY photo_index
            `) as QuotePhotoIntent[];
            if (savedPhotos.some((photo, index) => photo.photo_index !== index + 1)) {
              throw new Error("Saved quote photo reservations are incomplete.");
            }
            const ordered = fingerprintsMatch ? await matchQuotePhotos(lead.publicId, savedPhotos, photoFiles, photoHashes) : null;
            if (ordered) {
              photoFiles.splice(0, photoFiles.length, ...ordered);
            } else if (originalPhotoCount !== null) {
              return changedQuoteResponse(true);
            } else {
              // An old retry can resume the lead without replacing reserved bytes.
              savedOnlyPhotoCount = savedPhotos.length;
              photosResumable = savedPhotos.every((photo) => photo.status === "attached" && photo.stored_pathname)
                && (savedFingerprints?.length ?? savedOnlyPhotoCount) === savedOnlyPhotoCount;
            }
          } catch (photoError) {
            photosResumable = false;
            console.error("Saved photo intent lookup failed:", photoError);
          }
        }
        // A retry can arrive without the authorization that marked the saved lead as a test.
        isTest = lead.isTest !== false;
        leadId = lead.id;
        leadSnapshot = lead.intakeSnapshot;
        leadPublicId = lead.publicId;
        leadPersonId = lead.personId;
        wasNewLead = !lead.reused;
        if (lead.eventId) after(() => processEvent(lead.eventId!).catch((error) => console.error("Quote intake extraction failed:", error)));
      } catch (dbError) {
        if (dbError instanceof LeadIntakePhoneConflict) return changedQuoteResponse();
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

    // No provider side effect may happen without a durable lead and email
    // intent to resume. During a storage outage, fail clearly to the call CTA.
    if (leadId === null) {
      return Response.json(
        { ok: false, accepted: false, error: `We couldn't safely save your request. Please call ${shopPhone.display} or try again.` },
        { status: 503, headers: { "Retry-After": "15" } }
      );
    }

    const outboundEnabled = process.env.VERCEL_ENV === "production"
      && (leadSnapshot?.quote_photos?.environment ?? "production") === "production";
    if (leadId !== null && wasNewLead && outboundEnabled && textConsent && !isTest && consentPhone && webTextGrant && !consentConflict && twilioSmsConfigured() && !isReservedShopPhone(consentPhone)) {
      after(async () => {
        try {
          await sendSmsPersisted({
            to: consentPhone,
            body: "Got your request. We'll call or email you back. Send a photo and the size if you can. - Music City Specialty Welding",
            leadId,
            personId: leadPersonId,
            idempotencyKey: `form:${leadId}:ack`,
          });
        } catch (error) {
          console.error("Quote acknowledgement text failed:", error);
        }
      });
    }

    if (leadId !== null && !isTest) {
      const draftLeadId = leadId;
      after(() => prepareQuoteDraft(getSql(), recordLeadEvent, draftLeadId).catch((error) => console.warn("Quote draft failed:", error)));
    }

    // The browser owns the only recoverable bytes until every submitted photo
    // is durably stored and linked. A partial failure must never clear them.
    let photosDurable = photoFiles.length === 0;
    if (!photosResumable) {
      photosDurable = false;
    } else if (savedOnlyPhotoCount !== null) {
      photosDurable = true;
    } else if (leadId !== null && photoFiles.length > 0) {
      const photoPlans = photoFiles.map((file, index) => {
        const photoIndex = index + 1;
        const safeName = safePhotoName(file, photoIndex);
        const intent = savedPhotos.find((photo) => photo.photo_index === photoIndex);
        return {
          file,
          photoIndex,
          safeName,
          targetPath: intent?.target_path ?? quotePhotoPath(leadPublicId, photoIndex, safeName, photoHashes.get(file)),
          intent,
        };
      }).filter((photo) => photo.intent?.status !== "attached" || !photo.intent.stored_pathname);
      try {
        await reserveLeadPhotoIntents(leadId, intakeKey, photoPlans.map((photo) => ({
          photoIndex: photo.photoIndex,
          targetPath: photo.targetPath,
          filename: photo.safeName,
          contentType: photo.file.type,
          size: photo.file.size,
        })));
        const stored: Array<{ pathname: string; contentType: string; size: number; name: string; photoIndex: number }> = [];
        for (const photo of photoPlans) {
          try {
            let pathname = photo.intent?.status === "stored" ? photo.intent.stored_pathname : "";
            if (!pathname) {
              if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Private photo storage is not configured.");
              const blob = await put(photo.targetPath, photo.file, {
                access: "private",
                contentType: photo.file.type,
                addRandomSuffix: false,
                allowOverwrite: true,
              });
              pathname = blob.pathname;
              await markLeadPhotoIntent(leadId, intakeKey, photo.photoIndex, "stored", { storedPathname: pathname });
            }
            stored.push({
              pathname,
              contentType: photo.file.type,
              size: photo.file.size,
              name: photo.safeName,
              photoIndex: photo.photoIndex,
            });
          } catch (blobError) {
            const message = blobError instanceof Error ? blobError.message : "Private photo storage failed.";
            await markLeadPhotoIntent(leadId, intakeKey, photo.photoIndex, "failed", { error: message }).catch(() => undefined);
            console.error("Photo persistence error:", blobError);
          }
        }
        if (stored.length > 0) {
          const attachedIndices = stored.map((photo) => photo.photoIndex).join("-");
          await attachLeadPhotos(leadId, stored, { externalId: `quote-photos:${intakeKey}:${attachedIndices}` });
          await Promise.all(stored.map((photo) =>
            markLeadPhotoIntent(leadId!, intakeKey, photo.photoIndex, "attached", { storedPathname: photo.pathname })
          ));
        }
        photosDurable = stored.length === photoPlans.length;
      } catch (blobError) {
        // No private provider write starts unless all storage intents are durable.
        photosDurable = false;
        console.error("Photo intent persistence error:", blobError);
      }
    }

    const to = process.env.QUOTE_TO_EMAIL;
    const from = process.env.QUOTE_FROM_EMAIL;
    const subjectPrefix = process.env.QUOTE_EMAIL_SUBJECT_PREFIX || "New Quote Request";

    let emailSent = false;
    let ownerEmailState: DurableEmailState = "failed";
    let customerEmailPending = false;
    let emailErrorMessage = "";
    // Older production recovery workers cannot distinguish deployment origins.
    // Preview intake therefore leaves no frozen email intent for them to recover.
    if (outboundEnabled && !isTest && apiKey && to && from && leadSnapshot) {
      const resend = new Resend(apiKey);
      const { first_name: firstName, last_name: lastName, email, phone, service: serviceNeeded,
        message: projectDetails, preferred_contact: preferredContact, gclid, utm_source: utmSource, referrer } = leadSnapshot;
      const savedCreatedAt = leadSnapshot.created_at;
      const ownerResult = await sendDurableQuoteEmail({
        resend,
        leadId,
        personId: leadPersonId,
        intent: `quote-owner:${intakeKey}`,
        audience: "shop",
        photosDurable,
        buildPayload: async () => {
          if (!photosDurable) throw new Error("Quote photo verification needs a retry.");
          const expectedPhotoCount = savedOnlyPhotoCount ?? photoFiles.length;
          const photos = expectedPhotoCount ? (await getSql()`
            SELECT stored_pathname AS pathname, filename, size_bytes::int AS size
            FROM lead_photo_intents
            WHERE lead_id = ${leadId}::bigint AND intake_key = ${intakeKey}::text AND status = 'attached'
            ORDER BY photo_index`) as NonNullable<FrozenQuoteEmail["photos"]> : [];
          if (photos.length !== expectedPhotoCount) throw new Error("Saved quote photos are incomplete.");
          const photoCount = photos.length;
          const createdAt = new Date(savedCreatedAt).toISOString();
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
            photoCount > 0 ? `${photoCount} photo(s) attached.` : "No photos attached.",
            ``,
            `Meta:`,
            leadId !== null ? `Job #${leadId}` : `Job number: (not persisted)`,
            `Source: ${gclid ? "google-ads" : utmSource || referrer || "direct"}`,
            `Time: ${createdAt}`,
            leadPublicId
              ? `Manage: https://musiccityspecialtywelding.com/ops`
              : ``,
          ].join("\n");

          const dialablePhone = normalizeUsPhone(phone)
          const ownerHtml = brandedEmail({
            preheader: `${firstName} · ${serviceNeeded} · ${phone}`,
            headline: "New job in the door",
            bodyHtml: [
              `<strong>${escapeHtml(firstName)} ${escapeHtml(lastName)}</strong>`.trim(),
              `Phone: ${dialablePhone ? `<a href="tel:${dialablePhone}">${escapeHtml(phone)}</a>` : escapeHtml(phone)}`,
              email ? `Email: ${escapeHtml(email)}` : `Email: (not provided)`,
              `Job: <strong>${escapeHtml(serviceNeeded)}</strong>`,
              projectDetails ? `<br />“${escapeHtml(projectDetails)}”` : "",
              photoCount > 0 ? `<br />${photoCount} photo(s) attached.` : "",
              leadId !== null ? `<br />Job #${leadId} is on the board.` : "",
            ]
              .filter(Boolean)
              .join("<br />"),
            ctaLabel: "Open the board",
            ctaUrl: "https://musiccityspecialtywelding.com/ops",
            footnote: `Source: ${gclid ? "google-ads" : utmSource || referrer || "direct"} · ${createdAt}`,
          });

          return {
            photos,
            message: {
              from,
              to,
              subject,
              text,
              html: ownerHtml,
              replyTo: email ? email : undefined,
            },
          };
        },
      }).catch(emailReceiptUnavailable);
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
          buildPayload: () => ({ message: {
            from,
            to: email,
            subject: "We got your job — Music City Specialty Welding",
            text: [
              `Hey ${firstName},`,
              ``,
              `Your ${serviceNeeded} request just hit our board. A real person from the shop will call you at ${phone}.`,
              ``,
              `If it can't wait, call ${shopPhone.display}.`,
              ``,
              `Music City Specialty Welding`,
              `533 W Baddour Pkwy, Lebanon, TN 37087`,
            ].join("\n"),
            html: brandedEmail({
              preheader: "Your job hit the board. We'll call you.",
              headline: `Got it, ${firstName}.`,
              bodyHtml: [
                `Your <strong>${escapeHtml(serviceNeeded)}</strong> request just hit the board at the shop.`,
                `A real person will call you at <strong>${escapeHtml(phone)}</strong> — not a bot, not a call center.`,
                `If it can't wait, call <strong>${escapeHtml(shopPhone.display)}</strong>.`,
              ].join("<br /><br />"),
              ctaLabel: "Call the shop",
              ctaUrl: getShopPhone().href,
            }),
          } }),
        }).catch(emailReceiptUnavailable);
        customerEmailPending = customerResult.state === "pending";
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
            }).catch((error) => console.error("Customer-delivery notification failed:", error));
          }
        }
      }
    } else if (isTest) {
      emailErrorMessage = "INTERNAL TEST delivery suppressed."
    } else if (outboundEnabled) {
      emailErrorMessage = "Email service not configured.";
    }

    if (outboundEnabled && leadId !== null) {
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
          body: `${serviceNeeded} · ${phone}${ownerEmailState === "failed" ? " · OWNER EMAIL FAILED — dashboard only" : ownerEmailState !== "accepted" ? " · OWNER EMAIL UNCONFIRMED — dashboard saved" : ""}`,
          crewBody: `${serviceNeeded} · ${phone}`,
          url: `/ops/leads/${leadId}`,
          capExempt: true,
          quietHoursExempt: true,
          smsFallback: true,
          dedupeKey: `quote-intake:${intakeKey}:new-lead`,
        }).catch((error) => console.error("New-lead notification failed:", error));
      }
    }

    if (!photosDurable || ownerEmailState === "pending" || customerEmailPending) {
      return Response.json(
        {
          ok: false,
          accepted: false,
          partial: true,
          leadSaved: !isTest,
          error: photosDurable
            ? `We saved your request and email delivery is pending. Keep this page open and try again, or call ${shopPhone.display}.`
            : `We saved your contact details, but your photos were not safely stored. Keep this page open and try again, or call ${shopPhone.display}.`,
        },
        { status: 503, headers: { "Retry-After": "15" } }
      );
    }

    // The request succeeds when the lead is captured by at least one channel.
    if (emailSent || leadId !== null) {
      return Response.json(
        consentWarning
          ? {
            ok: true,
            accepted: true,
            leadSaved: !isTest,
            // A conflict is only real for a prior STOP; a lookup failure
            // denies the grant but must not claim a STOP occurred.
            ...(consentConflict ? { consentConflict: true } : {}),
            warning: consentWarning,
          }
          : { ok: true, accepted: true, leadSaved: !isTest },
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
