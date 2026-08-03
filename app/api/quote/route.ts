import { Resend } from "resend";
import { put } from "@vercel/blob";
import { dbConfigured } from "@/lib/db";
import { sendPushToAll } from "@/lib/push";
import {
  attachLeadPhotos,
  createLead,
  isRateLimitedDurable,
  markLeadDelivery,
} from "@/lib/leads";

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

export async function POST(req: Request) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
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
        { ok: false, error: "Too many quote attempts. Please wait a few minutes or call (615) 810-4910." },
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

    // Durable cross-instance throttle. Never blocks a lead on DB failure.
    if (dbConfigured() && ip !== "unknown") {
      const limited = await isRateLimitedDurable(
        `quote:${ip}`,
        RATE_LIMIT_WINDOW_MS,
        RATE_LIMIT_MAX_REQUESTS
      );
      if (limited) {
        return Response.json(
          { ok: false, error: "Too many quote attempts. Please wait a few minutes or call (615) 810-4910." },
          { status: 429, headers: { "Retry-After": "600" } }
        );
      }
    }

    // Persist the lead FIRST so it survives any email-provider failure.
    let leadId: number | null = null;
    let leadPublicId = "";
    if (dbConfigured()) {
      try {
        const lead = await createLead({
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
        });
        leadId = lead.id;
        leadPublicId = lead.publicId;
      } catch (dbError) {
        // Email delivery below still protects the lead.
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
          });
          stored.push({
            pathname: blob.pathname,
            contentType: file.type,
            size: file.size,
            name: safeName,
          });
        }
        await attachLeadPhotos(leadId, stored);
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
    let emailErrorMessage = "";
    if (apiKey && to && from) {
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
        leadPublicId ? `Lead ID: ${leadPublicId}` : `Lead ID: (not persisted)`,
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

      try {
        const { error } = await resend.emails.send({
          from,
          to,
          subject,
          text,
          replyTo: email ? email : undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
        });
        if (error) {
          emailErrorMessage = error.message || "Resend rejected the message.";
          console.error("Quote delivery error:", error);
        } else {
          emailSent = true;
        }
      } catch (sendError) {
        emailErrorMessage =
          sendError instanceof Error ? sendError.message : "Email send threw.";
        console.error("Quote delivery exception:", sendError);
      }
    } else {
      emailErrorMessage = "Email service not configured.";
    }

    if (leadId !== null) {
      try {
        await markLeadDelivery(leadId, emailSent ? "sent" : "failed", emailErrorMessage || undefined);
      } catch (deliveryLogError) {
        console.error("Delivery status update error:", deliveryLogError);
      }
      if (!isTest) {
        // Second alert channel: instant phone push, independent of the email provider.
        await sendPushToAll({
          title: `New lead: ${firstName}`,
          body: `${serviceNeeded} · ${phone}${emailSent ? "" : " · EMAIL FAILED — dashboard only"}`,
          url: `/ops/leads/${leadId}`,
        });
      }
    }

    // The request succeeds when the lead is captured by at least one channel.
    if (emailSent || leadId !== null) {
      return Response.json({ ok: true }, { status: 200 });
    }

    return Response.json(
      { ok: false, error: "We couldn't submit your request. Please call (615) 810-4910 or try again." },
      { status: 500 }
    );
  } catch (err) {
    console.error("Quote API error:", err);
    return Response.json(
      { ok: false, error: "We couldn't submit your request. Please call (615) 810-4910 or try again." },
      { status: 500 }
    );
  }
}
