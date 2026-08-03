import { neon } from "@neondatabase/serverless"

type Sql = ReturnType<typeof neon>

let _sql: Sql | null = null

export function dbConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim())
}

// Lazy so `next build` succeeds before env vars exist.
export function getSql(): Sql {
  if (!_sql) {
    const url = process.env.DATABASE_URL?.trim()
    if (!url) throw new Error("DATABASE_URL is not configured.")
    _sql = neon(url)
  }
  return _sql
}
