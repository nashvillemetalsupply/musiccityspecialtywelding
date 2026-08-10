import { createHash } from "node:crypto"
import { getSql } from "@/lib/db"

export function rateLimitFingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32)
}

// Security-sensitive limiter: record the attempt before checking the count and
// fail closed if the shared database cannot prove the request is allowed.
export async function consumeStrictRateLimit(key: string, windowMs: number, maxAttempts: number) {
  try {
    const sql = getSql()
    const windowStart = new Date(Date.now() - windowMs).toISOString()
    await sql`INSERT INTO rate_limits (key) VALUES (${key.slice(0, 240)}::text)`
    const rows = (await sql`
      SELECT count(*)::int AS count FROM rate_limits
      WHERE key = ${key.slice(0, 240)}::text
        AND ts >= ${windowStart}::timestamptz`) as { count: number }[]
    return Number(rows[0]?.count ?? maxAttempts + 1) > maxAttempts
  } catch (error) {
    console.error("Strict rate-limit check failed:", error)
    return true
  }
}
