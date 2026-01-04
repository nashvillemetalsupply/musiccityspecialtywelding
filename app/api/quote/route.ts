import { Resend } from "resend";

export const runtime = "nodejs"; // important for email libs

const resend = new Resend(process.env.RESEND_API_KEY);

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
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    const body = await req.json();

    // Honeypot field: add <input name="company" ... hidden> to your form
    const honeypot = sanitize(body.company);
    if (honeypot) {
      // Pretend success to bots; do not send email.
      return Response.json({ ok: true }, { status: 200 });
    }

    const firstName = sanitize(body.firstName);
    const lastName = sanitize(body.lastName);
    const email = sanitize(body.email);
    const phone = sanitize(body.phone);
    const serviceNeeded = sanitize(body.service);
    const projectDetails = sanitize(body.message);
    const preferredContact = sanitize(body.preferredContact);

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

    const to = process.env.QUOTE_TO_EMAIL!;
    const from = process.env.QUOTE_FROM_EMAIL!;
    const subjectPrefix = process.env.QUOTE_EMAIL_SUBJECT_PREFIX || "New Quote Request";

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
      `Meta:`,
      `IP: ${ip}`,
      `Time: ${now}`,
    ].join("\n");

    await resend.emails.send({
      from,
      to,
      subject,
      text,
      replyTo: email ? email : undefined,
    });

    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    return Response.json(
      { ok: false, error: "Server error." },
      { status: 500 }
    );
  }
}

