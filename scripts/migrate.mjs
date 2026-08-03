// Idempotent schema migration for the custom lead CRM.
// Usage: node scripts/migrate.mjs  (reads DATABASE_URL from env or .env.local)
import { readFileSync, existsSync } from "node:fs"
import { neon } from "@neondatabase/serverless"

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim()
  if (existsSync(".env.local")) {
    const match = readFileSync(".env.local", "utf8").match(/^DATABASE_URL="?([^"\r\n]+)/m)
    if (match) return match[1]
  }
  throw new Error("DATABASE_URL not found in env or .env.local")
}

const sql = neon(resolveDatabaseUrl())

const statements = [
  `CREATE TABLE IF NOT EXISTS leads (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    service TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    preferred_contact TEXT NOT NULL DEFAULT '',
    photo_count INT NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'unknown',
    gclid TEXT NOT NULL DEFAULT '',
    utm_source TEXT NOT NULL DEFAULT '',
    utm_medium TEXT NOT NULL DEFAULT '',
    utm_campaign TEXT NOT NULL DEFAULT '',
    utm_term TEXT NOT NULL DEFAULT '',
    utm_content TEXT NOT NULL DEFAULT '',
    landing_page TEXT NOT NULL DEFAULT '',
    referrer TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    is_test BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'new',
    status_reason TEXT NOT NULL DEFAULT '',
    first_response_at TIMESTAMPTZ,
    first_response_channel TEXT NOT NULL DEFAULT '',
    estimate_value_cents BIGINT,
    quoted_at TIMESTAMPTZ,
    won_at TIMESTAMPTZ,
    lost_at TIMESTAMPTZ,
    revenue_cents BIGINT,
    completed_at TIMESTAMPTZ,
    review_requested_at TIMESTAMPTZ,
    review_received BOOLEAN NOT NULL DEFAULT false,
    notes TEXT NOT NULL DEFAULT '',
    email_delivery_status TEXT NOT NULL DEFAULT 'pending',
    email_delivery_error TEXT NOT NULL DEFAULT '',
    email_delivered_at TIMESTAMPTZ
  )`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMPTZ`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_notified_at TIMESTAMPTZ`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `CREATE INDEX IF NOT EXISTS leads_status_idx ON leads(status)`,
  `CREATE INDEX IF NOT EXISTS leads_created_idx ON leads(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS leads_delivery_idx ON leads(email_delivery_status)`,
  `CREATE TABLE IF NOT EXISTS lead_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor TEXT NOT NULL DEFAULT 'system',
    type TEXT NOT NULL,
    detail JSONB
  )`,
  `CREATE INDEX IF NOT EXISTS lead_events_lead_idx ON lead_events(lead_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS rate_limits_key_ts_idx ON rate_limits(key, ts)`,
  `CREATE TABLE IF NOT EXISTS ops_tokens (
    token_hash TEXT PRIMARY KEY,
    purpose TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS automation_runs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job TEXT NOT NULL,
    ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ok BOOLEAN NOT NULL,
    detail JSONB
  )`,
  `CREATE INDEX IF NOT EXISTS automation_runs_job_idx ON automation_runs(job, ran_at DESC)`,
]

for (const statement of statements) {
  await sql.query(statement)
}

const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' ORDER BY table_name`
console.log("Migration complete. Tables:", tables.map((t) => t.table_name).join(", "))
