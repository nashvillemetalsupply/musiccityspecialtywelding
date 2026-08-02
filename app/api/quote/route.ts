import { Resend } from "resend";

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

function isRateLimited(ip: string) {
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

function sanitize(s: unknown) {
  if (typeof s !== "string") return "";
  return s.trim().slice(0, 2000);
}

export async function POST(req: Request) {
  try {
    // Initialize Resend inside the function to avoid build-time errors
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return Response.json(
        { ok: false, error: "Email service not configured." },
        { status: 500 }
      );
    }
    const resend = new Resend(apiKey);

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    const contentLength = Number(req.headers.get("content-length") || "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_SIZE) {
      return Response.json(
        { ok: false, error: "This request is too large. Please attach fewer or smaller photos." },
        { status: 413 }
      );
    }

    // Best-effort per-instance protection. A shared store is still needed for a
    // durable limit across all serverless instances.
    if (isRateLimited(ip)) {
      return Response.json(
        { ok: false, error: "Too many quote attempts. Please wait a few minutes or call (615) 810-4910." },
        { status: 429, headers: { "Retry-After": "600" } }
      );
    }

    // Handle FormData (for file uploads)
    const formData = await req.formData();

    // Honeypot field: add <input name="company" ... hidden> to your form
    const honeypot = sanitize(formData.get("company") as string);
    if (honeypot) {
      // Pretend success to bots; do not send email.
      return Response.json({ ok: true }, { status: 200 });
    }

    const firstName = sanitize(formData.get("firstName") as string);
    const lastName = sanitize(formData.get("lastName") as string);
    const email = sanitize(formData.get("email") as string);
    const phone = sanitize(formData.get("phone") as string);
    const serviceNeeded = sanitize(formData.get("service") as string);
    const projectDetails = sanitize(formData.get("message") as string);
    const preferredContact = sanitize(formData.get("preferredContact") as string);
    
    // Get uploaded photos with size validation
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

    // Minimal required fields
    if (!firstName || !phone || !serviceNeeded) {
      return Response.json(
        { ok: false, error: "Missing required fields." },
        { status: 400 }
      );
    }

    // Optional email validation (only if provided)
    if (email && !isValidEmail(email)) {
      return Response.json({ ok: false, error: "Invalid email." }, { status: 400 });
    }

    const now = new Date().toISOString();

    const to = process.env.QUOTE_TO_EMAIL;
    const from = process.env.QUOTE_FROM_EMAIL;
    const subjectPrefix = process.env.QUOTE_EMAIL_SUBJECT_PREFIX || "New Quote Request";

    if (!to || !from) {
      return Response.json(
        { ok: false, error: "Email configuration missing." },
        { status: 500 }
      );
    }

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
      `IP: ${ip}`,
      `Time: ${now}`,
    ].join("\n");

    // Prepare email attachments
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

    const { error } = await resend.emails.send({
      from,
      to,
      subject,
      text,
      replyTo: email ? email : undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    if (error) {
      console.error("Quote delivery error:", error);
      throw new Error("Quote email delivery failed.");
    }

    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("Quote API error:", err);
    return Response.json(
      { ok: false, error: "We couldn't submit your request. Please call (615) 810-4910 or try again." },
      { status: 500 }
    );
  }
}

