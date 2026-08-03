import { Resend } from "resend"
import { dbConfigured } from "@/lib/db"
import { isRateLimitedDurable } from "@/lib/leads"
import { brandedEmail } from "@/lib/email-templates"
import { CANONICAL_ORIGIN, createLoginToken, getOwnerEmail, safeEmailMatch } from "@/lib/ops-auth"

export const runtime = "nodejs"

function genericResponse() {
  return Response.json(
    { ok: true, message: "If that address runs this shop, a sign-in link is on its way." },
    { status: 200 }
  )
}

export async function POST(req: Request) {
  try {
    if (!dbConfigured()) {
      return Response.json({ ok: false, error: "Operations store not configured." }, { status: 503 })
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown"
    if (await isRateLimitedDurable(`ops-login:${ip}`, 15 * 60 * 1000, 5)) {
      return Response.json(
        { ok: false, error: "Too many sign-in attempts. Wait a few minutes." },
        { status: 429 }
      )
    }

    const body = (await req.json().catch(() => null)) as { email?: string } | null
    const requestedEmail = (body?.email ?? "").trim()
    const ownerEmail = getOwnerEmail()
    const apiKey = process.env.RESEND_API_KEY
    const from = process.env.QUOTE_FROM_EMAIL

    if (!ownerEmail || !apiKey || !from) {
      return Response.json({ ok: false, error: "Sign-in email is not configured." }, { status: 503 })
    }

    // Do not reveal whether an address is the operator address.
    if (!requestedEmail || !safeEmailMatch(requestedEmail, ownerEmail)) {
      return genericResponse()
    }

    // Always the canonical origin — never the request Host — so a spoofed or
    // alternate host can never receive a valid one-time token.
    const token = await createLoginToken(ownerEmail)
    const link = `${CANONICAL_ORIGIN}/api/ops/verify?token=${token}`

    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from,
      to: ownerEmail,
      subject: "Your Music City Specialty Welding operations sign-in link",
      text: [
        "Use this link to open the operations dashboard. It works once and expires in 15 minutes.",
        "",
        link,
        "",
        "If you did not request this, ignore this email.",
      ].join("\n"),
      html: brandedEmail({
        preheader: "One-time sign-in link for the shop board.",
        headline: "Open the board",
        bodyHtml:
          "This link signs you into the shop's lead board on this device. It works <strong>once</strong> and expires in <strong>15 minutes</strong>.<br /><br />If you didn't ask for it, ignore this email.",
        ctaLabel: "Sign in to operations",
        ctaUrl: link,
      }),
    })
    if (error) {
      // Stay indistinguishable from the non-operator path; the failure is
      // visible in server logs and the owner can retry.
      console.error("Ops login email error:", error)
    }

    return genericResponse()
  } catch (err) {
    console.error("Ops login error:", err)
    return Response.json({ ok: false, error: "Sign-in failed." }, { status: 500 })
  }
}
