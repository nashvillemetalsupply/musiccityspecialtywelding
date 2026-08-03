import { cookies } from "next/headers"
import { get } from "@vercel/blob"
import { OPS_SESSION_COOKIE, validateSessionToken } from "@/lib/ops-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Streams a private lead photo to a signed-in operator.
export async function GET(req: Request) {
  const cookieStore = await cookies()
  const operator = await validateSessionToken(cookieStore.get(OPS_SESSION_COOKIE)?.value)
  if (!operator) return new Response("Not signed in.", { status: 401 })

  const pathname = new URL(req.url).searchParams.get("path") ?? ""
  if (!pathname.startsWith("leads/") || pathname.includes("..")) {
    return new Response("Invalid path.", { status: 400 })
  }

  try {
    const result = await get(pathname, { access: "private" })
    if (!result || result.statusCode !== 200 || !result.stream) {
      return new Response("Not found.", { status: 404 })
    }
    return new Response(result.stream, {
      status: 200,
      headers: {
        "Content-Type": result.blob.contentType || "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (error) {
    console.error("Photo fetch error:", error)
    return new Response("Not found.", { status: 404 })
  }
}
