import { Resend } from "resend";

export const runtime = "nodejs"; // important for email libs

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
    
    // Get uploaded photos
    const photoFiles: File[] = [];
    const photos = formData.getAll("photos");
    for (const photo of photos) {
      if (photo instanceof File && photo.type.startsWith("image/")) {
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

    // Basic rate limit (in-memory is not perfect on serverless, but helps)
    // If you want stronger rate limiting later, we can add Upstash Redis.
    // For now: lightweight friction-free.
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

    const subject = `${subjectPrefix}: ${firstName}${lastName ? " " + lastName : ""} — ${serviceNeeded}`;

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
          filename: file.name,
          content: buffer,
        };
      })
    );

    await resend.emails.send({
      from,
      to,
      subject,
      text,
      replyTo: email ? email : undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    return Response.json(
      { ok: false, error: "Server error." },
      { status: 500 }
    );
  }
}

