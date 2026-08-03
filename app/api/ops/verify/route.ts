import { redeemLoginToken, OPS_SESSION_COOKIE } from "@/lib/ops-auth"

export const runtime = "nodejs"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams.get("token") ?? ""

  const sessionToken = await redeemLoginToken(token).catch((err) => {
    console.error("Ops verify error:", err)
    return null
  })

  if (!sessionToken) {
    return Response.redirect(new URL("/ops?error=link", url.origin), 303)
  }

  const response = Response.redirect(new URL("/ops", url.origin), 303)
  const headers = new Headers(response.headers)
  headers.append(
    "Set-Cookie",
    `${OPS_SESSION_COOKIE}=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
  )
  return new Response(null, { status: 303, headers })
}
