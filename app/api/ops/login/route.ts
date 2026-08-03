import { Resend } from "resend"
import { dbConfigured } from "@/lib/db"
import { isRateLimitedDurable } from "@/lib/leads"
import { createLoginToken, getOwnerEmail, safeEmailMatch } from "@/lib/ops-auth"

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

    const token = await createLoginToken(ownerEmail)
    const origin = new URL(req.url).origin
    const link = `${origin}/api/ops/verify?token=${token}`

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
    })
    if (error) {
      console.error("Ops login email error:", error)
      return Response.json({ ok: false, error: "Could not send the sign-in email." }, { status: 502 })
    }

    return genericResponse()
  } catch (err) {
    console.error("Ops login error:", err)
    return Response.json({ ok: false, error: "Sign-in failed." }, { status: 500 })
  }
}
