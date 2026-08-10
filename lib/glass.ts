import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto"
import { getSql } from "@/lib/db"

export type GlassJob = {
  token_hash: string
  lead_id: number
  expires_at: string | null
  show_quote: boolean
  first_name: string
  last_name: string
  service: string
  status: string
  completed_at: string | null
  scheduled_at: string | null
  work_started_at: string | null
  quoted_at: string | null
  estimate_value_cents: number | null
  revenue_cents: number | null
  invoice_total_cents: number | null
  invoice_number: string
  invoice_due_at: string | null
  invoice_pay_url: string
  paid_at: string | null
  photos: Array<{ pathname: string; contentType: string; size: number; name: string; shared?: boolean; caption?: string }>
  glass_caption_draft: string
  assigned_name: string
  is_test: boolean
  review_shown_at: string | null
}

export function hashGlassToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

function tokenFromNonce(nonce: string) {
  const secret = process.env.GLASS_TOKEN_SECRET?.trim()
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) throw new Error("GLASS_TOKEN_SECRET must contain at least 32 bytes before Customer Pages can be issued.")
  return createHmac("sha256", secret).update(`mcsw-glass:${nonce}`).digest("hex")
}

export async function createGlassLink(leadId: number, operatorId: number) {
  const nonce = randomBytes(32).toString("hex")
  const token = tokenFromNonce(nonce)
  const hash = hashGlassToken(token)
  const sql = getSql()
  const rows = (await sql`
    WITH target AS (
      SELECT id, completed_at FROM leads WHERE id = ${leadId}::bigint
    ), active AS MATERIALIZED (
      SELECT token_hash FROM glass_links
      WHERE lead_id = (SELECT id FROM target) AND revoked_at IS NULL
      ORDER BY token_hash
    ), held AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtext(token_hash)) FROM active
    ), revoked AS (
      UPDATE glass_links g SET revoked_at = now()
      FROM (SELECT count(*) FROM held) lock_guard
      WHERE g.lead_id = (SELECT id FROM target) AND g.revoked_at IS NULL
      RETURNING token_hash
    )
    INSERT INTO glass_links (token_hash, lead_id, created_by, expires_at, token_nonce)
    SELECT ${hash}::text, t.id, ${operatorId}::bigint,
      CASE WHEN t.completed_at IS NOT NULL THEN t.completed_at + interval '90 days' ELSE NULL END
      , ${nonce}::text
    FROM target t
    RETURNING token_hash`) as { token_hash: string }[]
  if (!rows[0]) throw new Error("Work order not found.")
  return token
}

// The bearer itself is never stored. The database keeps a random nonce plus
// its hash, and the server secret reconstructs the same 256-bit token.
export async function getActiveGlassLinkState(leadId: number) {
  const sql = getSql()
  const active = (await sql`
    SELECT token_hash, token_nonce FROM glass_links
    WHERE lead_id = ${leadId}::bigint AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY created_at DESC LIMIT 1`) as { token_hash: string; token_nonce: string }[]
  if (active[0]) {
    if (!active[0].token_nonce) return { token: null, needsReplacement: true }
    const token = tokenFromNonce(active[0].token_nonce)
    if (hashGlassToken(token) !== active[0].token_hash) throw new Error("The active Customer Page could not be verified.")
    return { token, needsReplacement: false }
  }
  return { token: null, needsReplacement: false }
}

// Quote retries reuse the active bearer so provider timeouts cannot create
// multiple customer links or send different URLs for one quote.
export async function createOrReuseQuoteGlassLink(leadId: number, operatorId: number) {
  const active = await getActiveGlassLinkState(leadId)
  if (active.token) return active.token
  return createGlassLink(leadId, operatorId)
}

export async function rotateGlassLink(leadId: number, operatorId: number) {
  const nonce = randomBytes(32).toString("hex")
  const token = tokenFromNonce(nonce)
  const hash = hashGlassToken(token)
  const externalId = `glass-rotate:${leadId}:${randomUUID()}`
  const sql = getSql()
  const rows = (await sql`
    WITH target AS (
      SELECT id, person_id, completed_at FROM leads WHERE id = ${leadId}::bigint
    ), active AS MATERIALIZED (
      SELECT token_hash FROM glass_links
      WHERE lead_id = (SELECT id FROM target) AND revoked_at IS NULL
      ORDER BY token_hash
    ), held AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtext(token_hash)) FROM active
    ), receipt AS (
      INSERT INTO events (kind, actor_type, actor_id, lead_id, person_id, external_id, body, crew_body, detail)
      SELECT 'glass.rotated'::text, 'operator'::text, ${String(operatorId)}::text,
        t.id, t.person_id, ${externalId}::text,
        'Customer Page link replaced'::text, 'Customer Page link replaced'::text,
        ${JSON.stringify({ newTokenHash: hash })}::jsonb
      FROM target t CROSS JOIN (SELECT count(*) FROM held) lock_guard
      RETURNING id
    ), revoked AS (
      UPDATE glass_links SET revoked_at = now()
      WHERE lead_id = (SELECT id FROM target) AND revoked_at IS NULL
        AND EXISTS (SELECT 1 FROM receipt)
      RETURNING token_hash
    )
    INSERT INTO glass_links (token_hash, lead_id, created_by, expires_at, token_nonce)
    SELECT ${hash}::text, t.id, ${operatorId}::bigint,
      CASE WHEN t.completed_at IS NOT NULL THEN t.completed_at + interval '90 days' ELSE NULL END,
      ${nonce}::text
    FROM target t CROSS JOIN receipt
    RETURNING token_hash`) as { token_hash: string }[]
  if (!rows[0]) throw new Error("Work order not found.")
  return token
}

export async function revokeGlassLinks(leadId: number, operatorId: number) {
  const sql = getSql()
  const externalId = `glass-revoke:${leadId}:${randomUUID()}`
  const rows = (await sql`
    WITH active AS MATERIALIZED (
      SELECT token_hash FROM glass_links
      WHERE lead_id = ${leadId}::bigint AND revoked_at IS NULL
      ORDER BY token_hash
    ), held AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtext(token_hash)) FROM active
    ), receipt AS (
      INSERT INTO events (kind, actor_type, actor_id, lead_id, person_id, external_id, body, crew_body)
      SELECT 'glass.revoked'::text, 'operator'::text, ${String(operatorId)}::text,
        l.id, l.person_id, ${externalId}::text,
        'Customer Page closed'::text, 'Customer Page closed'::text
      FROM leads l CROSS JOIN (SELECT count(*) FROM held) lock_guard
      WHERE l.id = ${leadId}::bigint AND EXISTS (SELECT 1 FROM active)
      RETURNING id
    )
    UPDATE glass_links SET revoked_at = now()
    WHERE lead_id = ${leadId}::bigint AND revoked_at IS NULL
      AND EXISTS (SELECT 1 FROM receipt)
    RETURNING token_hash`) as { token_hash: string }[]
  return rows.length
}

export async function getGlassJob(token: string): Promise<GlassJob | null> {
  if (!/^[a-f0-9]{64}$/i.test(token)) return null
  const sql = getSql()
  const rows = (await sql`
    SELECT g.token_hash, g.lead_id, g.expires_at, g.show_quote, g.review_shown_at,
      l.first_name, l.last_name, l.service, l.status, l.completed_at,
      l.scheduled_at, l.work_started_at, l.quoted_at,
      l.estimate_value_cents, l.revenue_cents, l.invoice_total_cents, l.invoice_number,
      l.invoice_due_at, l.invoice_pay_url, l.paid_at, l.photos, l.glass_caption_draft,
      COALESCE(o.name, '') AS assigned_name, l.is_test
    FROM glass_links g
    JOIN leads l ON l.id = g.lead_id
    LEFT JOIN operators o ON o.id = l.assigned_operator_id
    WHERE g.token_hash = ${hashGlassToken(token)}::text
      AND g.revoked_at IS NULL
    LIMIT 1`) as GlassJob[]
  const job = rows[0]
  if (!job) return null
  const expired = job.expires_at && new Date(job.expires_at).getTime() <= Date.now()
  if (expired) return { ...job, status: "closed" }
  return job
}

export async function noteGlassView(job: GlassJob) {
  const sql = getSql()
  const rows = (await sql`
    WITH total AS (
      UPDATE glass_links SET view_count = view_count + 1, last_viewed_at = now()
      WHERE token_hash = ${job.token_hash}::text AND revoked_at IS NULL
      RETURNING view_count, last_viewed_at
    ), daily AS (
      INSERT INTO glass_daily_views (token_hash, view_date, view_count)
      SELECT ${job.token_hash}::text, timezone('America/Chicago', now())::date, 1 FROM total
      ON CONFLICT (token_hash, view_date) DO UPDATE SET
        view_count = glass_daily_views.view_count + 1, last_viewed_at = now()
      RETURNING view_count AS daily_view_count
    )
    SELECT total.view_count, total.last_viewed_at, daily.daily_view_count FROM total CROSS JOIN daily`) as { view_count: number; last_viewed_at: string; daily_view_count: number }[]
  return rows[0] ?? null
}

export async function claimGlassReviewClick(job: GlassJob) {
  const sql = getSql()
  const rows = (await sql`
    UPDATE glass_links SET review_shown_at = now()
    WHERE token_hash = ${job.token_hash}::text AND review_shown_at IS NULL
      AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
    RETURNING review_shown_at`) as { review_shown_at: string }[]
  return Boolean(rows[0])
}

export async function listGlassPromises(leadId: number) {
  const sql = getSql()
  return (await sql`
    SELECT c.id, c.summary, c.due_at, c.status,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'previous_due_at', h.previous_due_at,
          'new_due_at', h.new_due_at,
          'reason', h.reason,
          'changed_at', h.changed_at
        ) ORDER BY h.changed_at ASC)
        FROM commitment_history h WHERE h.commitment_id = c.id
      ), '[]'::jsonb) AS history
    FROM commitments c
    WHERE c.lead_id = ${leadId}::bigint AND c.visible_on_glass = true
      AND c.glass_primary = true AND c.status = 'open'
    ORDER BY c.due_at ASC NULLS LAST LIMIT 1`) as {
      id: number
      summary: string
      due_at: string | null
      status: string
      history: { previous_due_at: string | null; new_due_at: string | null; reason: string; changed_at: string }[]
    }[]
}
