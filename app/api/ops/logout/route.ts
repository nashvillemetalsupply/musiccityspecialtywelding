import { cookies } from "next/headers"
import { destroySession, OPS_SESSION_COOKIE } from "@/lib/ops-auth"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const token = cookieStore.get(OPS_SESSION_COOKIE)?.value
  await destroySession(token).catch(() => undefined)

  const headers = new Headers()
  headers.append(
    "Set-Cookie",
    `${OPS_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  )
  headers.set("Location", new URL("/ops", new URL(req.url).origin).toString())
  return new Response(null, { status: 303, headers })
}
