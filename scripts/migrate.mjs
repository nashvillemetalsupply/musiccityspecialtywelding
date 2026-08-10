// Idempotent schema migration for the custom lead CRM.
// Usage: node scripts/migrate.mjs  (reads DATABASE_URL from env or .env.local)
import { readFileSync, existsSync } from "node:fs"
import { neon } from "@neondatabase/serverless"

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL_UNPOOLED?.trim()) return process.env.DATABASE_URL_UNPOOLED.trim()
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim()
  if (existsSync(".env.local")) {
    const envFile = readFileSync(".env.local", "utf8")
    const directMatch = envFile.match(/^DATABASE_URL_UNPOOLED="?([^"\r\n]+)/m)
    if (directMatch) return directMatch[1]
    const pooledMatch = envFile.match(/^DATABASE_URL="?([^"\r\n]+)/m)
    if (pooledMatch) return pooledMatch[1]
  }
  throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL not found in env or .env.local")
}

const sql = neon(resolveDatabaseUrl())

const statements = [
  `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
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
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS invoice_number TEXT NOT NULL DEFAULT ''`,
  `CREATE TABLE IF NOT EXISTS invoice_identities (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    normalized_number TEXT NOT NULL,
    invoice_number TEXT NOT NULL,
    lead_id BIGINT NOT NULL REFERENCES leads(id),
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    released_at TIMESTAMPTZ,
    superseded_by BIGINT REFERENCES invoice_identities(id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS invoice_identities_active_number_idx
    ON invoice_identities(normalized_number) WHERE released_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS invoice_identities_lead_idx ON invoice_identities(lead_id)`,
  `INSERT INTO invoice_identities (normalized_number, invoice_number, lead_id)
    SELECT lower(btrim(invoice_number)), min(invoice_number), min(id)
    FROM leads
    WHERE invoice_number <> ''
    GROUP BY lower(btrim(invoice_number))
    HAVING count(*) = 1
    ON CONFLICT (normalized_number) WHERE released_at IS NULL DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS person_identity_conflicts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    is_test BOOLEAN NOT NULL DEFAULT false,
    person_ids BIGINT[] NOT NULL DEFAULT '{}',
    lead_id BIGINT REFERENCES leads(id),
    status TEXT NOT NULL DEFAULT 'open',
    resolution TEXT NOT NULL DEFAULT '',
    resolved_at TIMESTAMPTZ,
    resolved_by BIGINT
  )`,
  `ALTER TABLE person_identity_conflicts ADD COLUMN IF NOT EXISTS lead_id BIGINT REFERENCES leads(id)`,
  `ALTER TABLE person_identity_conflicts ADD COLUMN IF NOT EXISTS resolution TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE person_identity_conflicts ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`,
  `ALTER TABLE person_identity_conflicts ADD COLUMN IF NOT EXISTS resolved_by BIGINT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS person_identity_conflicts_open_idx
    ON person_identity_conflicts(phone, email, is_test) WHERE status = 'open'`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS invoiced_at TIMESTAMPTZ`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS invoice_due_at TIMESTAMPTZ`,
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
  `CREATE TABLE IF NOT EXISTS operators (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'crew',
    cell_phone TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT true,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS operators_active_idx ON operators(active)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS operators_active_phone_unique_idx ON operators(cell_phone) WHERE active = true AND cell_phone <> ''`,
  `ALTER TABLE operators ADD COLUMN IF NOT EXISTS signature_name TEXT NOT NULL DEFAULT ''`,
  `UPDATE operators SET signature_name = 'Philip'::text
    WHERE role = 'owner' AND signature_name = '' AND lower(name) IN ('philippe', 'philip')`,
  `ALTER TABLE ops_tokens ADD COLUMN IF NOT EXISTS operator_id BIGINT REFERENCES operators(id)`,
  `ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS operator_id BIGINT REFERENCES operators(id)`,
  `CREATE TABLE IF NOT EXISTS people (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    display_name TEXT NOT NULL DEFAULT '',
    company TEXT NOT NULL DEFAULT '',
    phones TEXT[] NOT NULL DEFAULT '{}',
    emails TEXT[] NOT NULL DEFAULT '{}',
    merged_into BIGINT REFERENCES people(id),
    status TEXT NOT NULL DEFAULT 'active',
    is_test BOOLEAN NOT NULL DEFAULT false
  )`,
  `CREATE INDEX IF NOT EXISTS people_phones_idx ON people USING GIN(phones)`,
  `CREATE INDEX IF NOT EXISTS people_emails_idx ON people USING GIN(emails)`,
  `CREATE TABLE IF NOT EXISTS person_identities (
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    is_test BOOLEAN NOT NULL DEFAULT false,
    person_id BIGINT NOT NULL REFERENCES people(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, value, is_test)
  )`,
  `CREATE INDEX IF NOT EXISTS person_identities_person_idx ON person_identities(person_id)`,
  `INSERT INTO person_identities (kind, value, is_test, person_id)
    SELECT 'phone', phone, p.is_test, p.id FROM people p CROSS JOIN LATERAL unnest(p.phones) phone
    WHERE p.merged_into IS NULL AND phone <> ''
    ON CONFLICT (kind, value, is_test) DO NOTHING`,
  `INSERT INTO person_identities (kind, value, is_test, person_id)
    SELECT 'email', email, p.is_test, p.id FROM people p CROSS JOIN LATERAL unnest(p.emails) email
    WHERE p.merged_into IS NULL AND email <> ''
    ON CONFLICT (kind, value, is_test) DO NOTHING`,
  `CREATE INDEX IF NOT EXISTS people_company_trgm_idx ON people USING GIN(company gin_trgm_ops)`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS person_id BIGINT REFERENCES people(id)`,
  `UPDATE leads SET photos = COALESCE((
      SELECT jsonb_agg(
        CASE WHEN COALESCE(photo->>'contentType', '') LIKE 'image/%'
          AND COALESCE(photo->>'pathname', '') LIKE 'leads/%'
          THEN photo || jsonb_build_object('sensitivity', 'photo') ELSE photo END
      ) FROM jsonb_array_elements(COALESCE(leads.photos, '[]'::jsonb)) photo
    ), '[]'::jsonb)
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(leads.photos, '[]'::jsonb)) photo
      WHERE COALESCE(photo->>'contentType', '') LIKE 'image/%'
        AND COALESCE(photo->>'pathname', '') LIKE 'leads/%'
        AND COALESCE(photo->>'sensitivity', '') = ''
    )`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS paid_amount_cents BIGINT`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS invoice_total_cents BIGINT`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS invoice_pay_url TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_operator_id BIGINT REFERENCES operators(id)`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS glass_caption_draft TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS glass_caption_approved_at TIMESTAMPTZ`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS work_started_at TIMESTAMPTZ`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS handed_off_at TIMESTAMPTZ`,
  `CREATE INDEX IF NOT EXISTS leads_active_board_idx
    ON leads(handed_off_at, completed_at, updated_at DESC)
    WHERE status NOT IN ('lost','spam')`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone_is_placeholder BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS crew_message TEXT`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS crew_notes TEXT`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS intake_key TEXT NOT NULL DEFAULT ''`,
  `CREATE UNIQUE INDEX IF NOT EXISTS leads_intake_key_idx ON leads(intake_key) WHERE intake_key <> ''`,
  `ALTER TABLE people ADD COLUMN IF NOT EXISTS is_regular BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE people ADD COLUMN IF NOT EXISTS account_key TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE people ADD COLUMN IF NOT EXISTS company_key TEXT NOT NULL DEFAULT ''`,
  `UPDATE people SET company_key = regexp_replace(
      regexp_replace(lower(company), '\\m(incorporated|corporation|company|limited|inc|corp|llc|ltd|co)\\M', '', 'g'),
      '[^a-z0-9]', '', 'g'
    ) WHERE company_key = '' AND company <> ''`,
  `CREATE INDEX IF NOT EXISTS people_company_key_idx ON people(company_key) WHERE company_key <> ''`,
  `UPDATE people p SET account_key = 'domain:' || (
      SELECT lower(split_part(email, '@', 2))
      FROM unnest(p.emails) email
      WHERE position('@' in email) > 1
        AND lower(split_part(email, '@', 2)) <> ALL(ARRAY[
          'gmail.com','googlemail.com','icloud.com','me.com','outlook.com','hotmail.com',
          'live.com','msn.com','yahoo.com','aol.com','proton.me','protonmail.com'
        ]::text[])
      ORDER BY email LIMIT 1
    )
    WHERE EXISTS (
      SELECT 1 FROM unnest(p.emails) email
      WHERE position('@' in email) > 1
        AND lower(split_part(email, '@', 2)) <> ALL(ARRAY[
          'gmail.com','googlemail.com','icloud.com','me.com','outlook.com','hotmail.com',
          'live.com','msn.com','yahoo.com','aol.com','proton.me','protonmail.com'
        ]::text[])
    )`,
  `CREATE INDEX IF NOT EXISTS people_account_key_idx ON people(account_key)`,
  `UPDATE people company_only SET account_key = (
      SELECT p2.account_key FROM people p2
      WHERE p2.company_key = company_only.company_key
        AND p2.company_key <> '' AND p2.account_key LIKE 'domain:%'
        AND p2.merged_into IS NULL
      ORDER BY p2.id LIMIT 1
    )
    WHERE company_only.company_key <> ''
      AND company_only.account_key LIKE 'company:%'
      AND EXISTS (
        SELECT 1 FROM people p2
        WHERE p2.company_key = company_only.company_key
          AND p2.account_key LIKE 'domain:%' AND p2.merged_into IS NULL
      )`,
  `ALTER TABLE operators ADD COLUMN IF NOT EXISTS glass_clean_approvals INT NOT NULL DEFAULT 0`,
  `ALTER TABLE operators ADD COLUMN IF NOT EXISTS glass_auto_post BOOLEAN NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS glass_photo_approvals (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads(id),
    pathname TEXT NOT NULL,
    caption_hash TEXT NOT NULL,
    approved_by BIGINT NOT NULL REFERENCES operators(id),
    approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (lead_id, pathname, caption_hash)
  )`,
  `CREATE INDEX IF NOT EXISTS leads_person_idx ON leads(person_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind TEXT NOT NULL,
    actor_type TEXT NOT NULL DEFAULT 'system',
    actor_id TEXT NOT NULL DEFAULT '',
    lead_id BIGINT REFERENCES leads(id),
    person_id BIGINT REFERENCES people(id),
    external_id TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    detail JSONB,
    processed_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS events_lead_idx ON events(lead_id, occurred_at)`,
  `CREATE INDEX IF NOT EXISTS events_person_idx ON events(person_id, occurred_at)`,
  `CREATE INDEX IF NOT EXISTS events_kind_idx ON events(kind, occurred_at DESC)`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS brief_audio_status TEXT NOT NULL DEFAULT 'none'`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS brief_audio_attempts INT NOT NULL DEFAULT 0`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS brief_audio_updated_at TIMESTAMPTZ`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS brief_audio_error TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS extraction_result JSONB`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS extraction_status TEXT NOT NULL DEFAULT 'pending'`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS extraction_attempts INT NOT NULL DEFAULT 0`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS extraction_last_error TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS extraction_next_attempt_at TIMESTAMPTZ`,
  `CREATE UNIQUE INDEX IF NOT EXISTS events_external_idx ON events(kind, external_id) WHERE external_id <> ''`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', body)) STORED`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS crew_body TEXT`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS crew_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', COALESCE(crew_body, ''))) STORED`,
  `CREATE INDEX IF NOT EXISTS events_tsv_idx ON events USING GIN(tsv)`,
  `CREATE INDEX IF NOT EXISTS events_crew_tsv_idx ON events USING GIN(crew_tsv)`,
  `CREATE INDEX IF NOT EXISTS events_body_trgm_idx ON events USING GIN(body gin_trgm_ops)`,
  `CREATE TABLE IF NOT EXISTS claims (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    subject_type TEXT NOT NULL,
    subject_id BIGINT NOT NULL,
    predicate TEXT NOT NULL,
    value JSONB NOT NULL,
    confidence REAL NOT NULL,
    source_event_id BIGINT NOT NULL REFERENCES events(id),
    extracted_by TEXT NOT NULL,
    superseded_by BIGINT REFERENCES claims(id)
  )`,
  `CREATE INDEX IF NOT EXISTS claims_subject_idx ON claims(subject_type, subject_id) WHERE superseded_by IS NULL`,
  `ALTER TABLE claims ADD COLUMN IF NOT EXISTS item_key TEXT NOT NULL DEFAULT ''`,
  `CREATE UNIQUE INDEX IF NOT EXISTS claims_source_item_idx ON claims(source_event_id, item_key) WHERE item_key <> ''`,
  `CREATE TABLE IF NOT EXISTS commitments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lead_id BIGINT REFERENCES leads(id),
    person_id BIGINT REFERENCES people(id),
    direction TEXT NOT NULL,
    operator_id BIGINT REFERENCES operators(id),
    summary TEXT NOT NULL,
    due_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'open',
    status_changed_at TIMESTAMPTZ,
    status_source_event_id BIGINT REFERENCES events(id),
    source_event_id BIGINT NOT NULL REFERENCES events(id),
    confidence REAL NOT NULL,
    confirmed_by BIGINT REFERENCES operators(id),
    visible_on_glass BOOLEAN NOT NULL DEFAULT false
  )`,
  `CREATE INDEX IF NOT EXISTS commitments_open_idx ON commitments(status, due_at) WHERE status = 'open'`,
  `CREATE INDEX IF NOT EXISTS commitments_lead_idx ON commitments(lead_id, created_at DESC)`,
  `ALTER TABLE commitments ADD COLUMN IF NOT EXISTS crew_summary TEXT`,
  `ALTER TABLE commitments ADD COLUMN IF NOT EXISTS item_key TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE commitments ADD COLUMN IF NOT EXISTS glass_primary BOOLEAN NOT NULL DEFAULT false`,
  `CREATE UNIQUE INDEX IF NOT EXISTS commitments_one_public_promise_idx ON commitments(lead_id) WHERE glass_primary = true AND status = 'open'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS commitments_source_item_idx ON commitments(source_event_id, item_key) WHERE item_key <> ''`,
  `CREATE TABLE IF NOT EXISTS commitment_history (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    commitment_id BIGINT NOT NULL REFERENCES commitments(id),
    lead_id BIGINT REFERENCES leads(id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    previous_due_at TIMESTAMPTZ,
    new_due_at TIMESTAMPTZ,
    reason TEXT NOT NULL DEFAULT '',
    source_event_id BIGINT NOT NULL REFERENCES events(id),
    changed_by BIGINT REFERENCES operators(id)
  )`,
  `CREATE INDEX IF NOT EXISTS commitment_history_commitment_idx ON commitment_history(commitment_id, changed_at DESC)`,
  `CREATE TABLE IF NOT EXISTS commitment_reschedules (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    commitment_id BIGINT NOT NULL REFERENCES commitments(id),
    lead_id BIGINT NOT NULL REFERENCES leads(id),
    previous_due_at TIMESTAMPTZ,
    proposed_due_at TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    source_event_id BIGINT NOT NULL REFERENCES events(id),
    message_id BIGINT,
    created_by BIGINT NOT NULL REFERENCES operators(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS commitment_reschedules_status_idx ON commitment_reschedules(status, created_at)`,
  `ALTER TABLE commitment_reschedules ADD COLUMN IF NOT EXISTS idempotency_key TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE commitment_reschedules ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0`,
  `ALTER TABLE commitment_reschedules ADD COLUMN IF NOT EXISTS sending_started_at TIMESTAMPTZ`,
  `CREATE UNIQUE INDEX IF NOT EXISTS commitment_reschedules_idempotency_idx ON commitment_reschedules(idempotency_key) WHERE idempotency_key <> ''`,
  `CREATE TABLE IF NOT EXISTS calls (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    twilio_sid TEXT UNIQUE NOT NULL,
    direction TEXT NOT NULL,
    from_phone TEXT NOT NULL,
    to_phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_sec INT,
    recording_sid TEXT NOT NULL DEFAULT '',
    recording_url TEXT NOT NULL DEFAULT '',
    transcript TEXT NOT NULL DEFAULT '',
    transcript_status TEXT NOT NULL DEFAULT 'none',
    lead_id BIGINT REFERENCES leads(id),
    person_id BIGINT REFERENCES people(id),
    detail JSONB
  )`,
  `CREATE INDEX IF NOT EXISTS calls_lead_idx ON calls(lead_id, started_at DESC)`,
  `ALTER TABLE calls ADD COLUMN IF NOT EXISTS crew_transcript TEXT`,
  `ALTER TABLE calls ADD COLUMN IF NOT EXISTS operator_id BIGINT REFERENCES operators(id)`,
  `ALTER TABLE calls ADD COLUMN IF NOT EXISTS idempotency_key TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE calls ADD COLUMN IF NOT EXISTS starting_started_at TIMESTAMPTZ`,
  `CREATE UNIQUE INDEX IF NOT EXISTS calls_idempotency_idx ON calls(idempotency_key) WHERE idempotency_key <> ''`,
  `CREATE TABLE IF NOT EXISTS call_intake_drafts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id TEXT UNIQUE NOT NULL,
    call_sid TEXT UNIQUE NOT NULL REFERENCES calls(twilio_sid),
    person_id BIGINT REFERENCES people(id),
    lead_id BIGINT REFERENCES leads(id),
    caller_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    need TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    is_test BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    save_started_at TIMESTAMPTZ,
    saved_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ,
    last_error TEXT NOT NULL DEFAULT '',
    CONSTRAINT call_intake_drafts_status_check CHECK (status IN ('pending','saving','saved','dismissed','failed','unknown'))
  )`,
  `CREATE INDEX IF NOT EXISTS call_intake_drafts_queue_idx ON call_intake_drafts(status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS call_intake_drafts_person_idx ON call_intake_drafts(person_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS messages (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    twilio_sid TEXT UNIQUE NOT NULL,
    direction TEXT NOT NULL,
    from_phone TEXT NOT NULL,
    to_phone TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    media JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT '',
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lead_id BIGINT REFERENCES leads(id),
    person_id BIGINT REFERENCES people(id),
    operator_id BIGINT REFERENCES operators(id)
  )`,
  `CREATE INDEX IF NOT EXISTS messages_lead_idx ON messages(lead_id, sent_at DESC)`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS crew_body TEXT`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS reschedule_id BIGINT REFERENCES commitment_reschedules(id)`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS idempotency_key TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS sending_started_at TIMESTAMPTZ`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS reconciliation_notified_at TIMESTAMPTZ`,
  `CREATE UNIQUE INDEX IF NOT EXISTS messages_idempotency_idx ON messages(idempotency_key) WHERE idempotency_key <> ''`,
  `CREATE TABLE IF NOT EXISTS glass_links (
    token_hash TEXT PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by BIGINT REFERENCES operators(id),
    revoked_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    last_viewed_at TIMESTAMPTZ,
    view_count INT NOT NULL DEFAULT 0,
    show_quote BOOLEAN NOT NULL DEFAULT true
  )`,
  `ALTER TABLE glass_links ADD COLUMN IF NOT EXISTS send_status TEXT NOT NULL DEFAULT 'pending'`,
  `ALTER TABLE glass_links ADD COLUMN IF NOT EXISTS send_attempts INT NOT NULL DEFAULT 0`,
  `ALTER TABLE glass_links ADD COLUMN IF NOT EXISTS token_nonce TEXT NOT NULL DEFAULT ''`,
  `CREATE INDEX IF NOT EXISTS glass_links_lead_idx ON glass_links(lead_id, created_at DESC)`,
  `ALTER TABLE glass_links ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ`,
  `ALTER TABLE glass_links ADD COLUMN IF NOT EXISTS send_claimed_at TIMESTAMPTZ`,
  `ALTER TABLE glass_links ADD COLUMN IF NOT EXISTS review_shown_at TIMESTAMPTZ`,
  `CREATE TABLE IF NOT EXISTS glass_daily_views (
    token_hash TEXT NOT NULL REFERENCES glass_links(token_hash),
    view_date DATE NOT NULL,
    view_count INT NOT NULL DEFAULT 0,
    last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (token_hash, view_date)
  )`,
  `CREATE TABLE IF NOT EXISTS glass_caption_revisions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads(id),
    source_event_id BIGINT NOT NULL REFERENCES events(id),
    caption TEXT NOT NULL,
    caption_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at TIMESTAMPTZ,
    approved_by BIGINT REFERENCES operators(id),
    UNIQUE (source_event_id, caption_hash)
  )`,
  `CREATE INDEX IF NOT EXISTS glass_caption_revisions_lead_idx ON glass_caption_revisions(lead_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    operator_id BIGINT REFERENCES operators(id),
    priority TEXT NOT NULL,
    stock TEXT NOT NULL DEFAULT 'white',
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    sent_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    coalesced BOOLEAN NOT NULL DEFAULT false,
    source_event_id BIGINT REFERENCES events(id)
  )`,
  `CREATE TABLE IF NOT EXISTS handset_slips (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operator_id BIGINT NOT NULL REFERENCES operators(id),
    operator_role TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    receipt_ids BIGINT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS handset_slips_operator_idx ON handset_slips(operator_id, operator_role, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS notifications_operator_idx ON notifications(operator_id, created_at DESC)`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS owner_only BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_kind TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_detail JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS budget_exempt BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_status TEXT NOT NULL DEFAULT 'open'`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_claimed_at TIMESTAMPTZ`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_claimed_by BIGINT REFERENCES operators(id)`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS interrupt_reserved_at TIMESTAMPTZ`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_error TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'filed'`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delivery_attempts INT NOT NULL DEFAULT 0`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delivery_last_attempt_at TIMESTAMPTZ`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delivery_next_attempt_at TIMESTAMPTZ`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delivery_error TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS quiet_hours_exempt BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sms_fallback BOOLEAN NOT NULL DEFAULT false`,
  `CREATE INDEX IF NOT EXISTS notifications_delivery_retry_idx ON notifications(delivery_status, delivery_next_attempt_at) WHERE sent_at IS NULL AND priority = 'interrupt'`,
  `UPDATE notifications SET budget_exempt = true
    WHERE budget_exempt = false AND (
      title = 'Morning. The radio is ready.' OR
      title = 'New text at the shop' OR
      title LIKE 'New lead:%' OR
      title LIKE 'New email from %'
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS notifications_operator_dedupe_idx ON notifications(operator_id, dedupe_key) WHERE dedupe_key <> ''`,
  `UPDATE notifications SET owner_only = true WHERE owner_only = false AND stock = 'green'`,
  `CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS gmail_ingest_failures (
    message_id TEXT PRIMARY KEY,
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    dead_lettered_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS external_threads (
    provider TEXT NOT NULL,
    external_thread_id TEXT NOT NULL,
    lead_id BIGINT NOT NULL REFERENCES leads(id),
    person_id BIGINT REFERENCES people(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, external_thread_id)
  )`,
  `CREATE INDEX IF NOT EXISTS external_threads_lead_idx ON external_threads(lead_id)`,
  `CREATE TABLE IF NOT EXISTS inbound_conversation_claims (
    identity_key TEXT PRIMARY KEY,
    person_id BIGINT NOT NULL REFERENCES people(id),
    lead_id BIGINT REFERENCES leads(id),
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS ingest_attachments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider TEXT NOT NULL,
    external_message_id TEXT NOT NULL,
    attachment_key TEXT NOT NULL,
    lead_id BIGINT NOT NULL REFERENCES leads(id),
    person_id BIGINT REFERENCES people(id),
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    source_url TEXT NOT NULL DEFAULT '',
    source_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    blob_path TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, external_message_id, attachment_key)
  )`,
  `CREATE INDEX IF NOT EXISTS ingest_attachments_retry_idx ON ingest_attachments(status, updated_at)`,
  `ALTER TABLE ingest_attachments ADD COLUMN IF NOT EXISTS sensitivity TEXT NOT NULL DEFAULT 'unclassified'`,
  `ALTER TABLE ingest_attachments ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ`,
  `ALTER TABLE ingest_attachments ADD COLUMN IF NOT EXISTS projected_at TIMESTAMPTZ`,
  `ALTER TABLE ingest_attachments ADD COLUMN IF NOT EXISTS blob_size BIGINT`,
  `CREATE TABLE IF NOT EXISTS voice_transcription_intents (
    id TEXT PRIMARY KEY,
    operator_id BIGINT NOT NULL REFERENCES operators(id),
    content_type TEXT NOT NULL DEFAULT 'audio/webm',
    blob_path TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'persisted',
    attempts INT NOT NULL DEFAULT 0,
    transcript TEXT NOT NULL DEFAULT '',
    last_error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS voice_transcription_retry_idx ON voice_transcription_intents(status, updated_at)`,
  `ALTER TABLE voice_transcription_intents ADD COLUMN IF NOT EXISTS recovery_key TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE voice_transcription_intents ADD COLUMN IF NOT EXISTS lead_id BIGINT REFERENCES leads(id)`,
  `ALTER TABLE calls ADD COLUMN IF NOT EXISTS transcript_attempts INT NOT NULL DEFAULT 0`,
  `ALTER TABLE calls ADD COLUMN IF NOT EXISTS transcript_submitted_at TIMESTAMPTZ`,
  `ALTER TABLE calls ADD COLUMN IF NOT EXISTS transcript_error TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE calls ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
  `CREATE TABLE IF NOT EXISTS shop_documents (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind TEXT UNIQUE NOT NULL,
    pathname TEXT NOT NULL,
    filename TEXT NOT NULL,
    expires_at TIMESTAMPTZ,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    uploaded_by BIGINT REFERENCES operators(id),
    status TEXT NOT NULL DEFAULT 'ready',
    error TEXT NOT NULL DEFAULT ''
  )`,
  `ALTER TABLE shop_documents ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready'`,
  `ALTER TABLE shop_documents ADD COLUMN IF NOT EXISTS error TEXT NOT NULL DEFAULT ''`,
  `CREATE TABLE IF NOT EXISTS shop_document_attempts (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    filename TEXT NOT NULL,
    expires_at TIMESTAMPTZ,
    uploaded_by BIGINT REFERENCES operators(id),
    blob_path TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS messaging_consents (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    phone_e164 TEXT NOT NULL,
    lead_id BIGINT REFERENCES leads(id),
    person_id BIGINT REFERENCES people(id),
    operator_id BIGINT REFERENCES operators(id),
    source TEXT NOT NULL,
    effect TEXT NOT NULL,
    external_id TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT messaging_consents_effect_check CHECK (effect IN ('granted','revoked','recorded'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS messaging_consents_external_idx ON messaging_consents(external_id)`,
  `CREATE INDEX IF NOT EXISTS messaging_consents_phone_state_idx ON messaging_consents(phone_e164, occurred_at DESC, id DESC)`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messaging_consents_source_check') THEN
      ALTER TABLE messaging_consents ADD CONSTRAINT messaging_consents_source_check
        CHECK (source IN ('web','inbound-message','verbal-operator','START','STOP','HELP'));
    END IF;
  END $$`,
  `CREATE OR REPLACE FUNCTION reject_messaging_consent_mutation()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'messaging_consents is append-only';
    END;
    $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'messaging_consents_append_only') THEN
      CREATE TRIGGER messaging_consents_append_only
      BEFORE UPDATE OR DELETE ON messaging_consents
      FOR EACH ROW EXECUTE FUNCTION reject_messaging_consent_mutation();
    END IF;
  END $$`,
  `CREATE TABLE IF NOT EXISTS glass_uploads (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL REFERENCES glass_links(token_hash),
    lead_id BIGINT NOT NULL REFERENCES leads(id),
    person_id BIGINT REFERENCES people(id),
    batch_id TEXT NOT NULL,
    pathname TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT NOT NULL DEFAULT '',
    blob_url TEXT NOT NULL DEFAULT '',
    etag TEXT NOT NULL DEFAULT '',
    callback_completed_at TIMESTAMPTZ,
    projected_at TIMESTAMPTZ,
    expired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT glass_uploads_status_check CHECK (status IN ('pending','uploading','uploaded','projecting','stored','failed','unknown')),
    CONSTRAINT glass_uploads_size_check CHECK (size_bytes > 0 AND size_bytes <= 20971520)
  )`,
  `ALTER TABLE glass_uploads ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ`,
  `CREATE UNIQUE INDEX IF NOT EXISTS glass_uploads_path_idx ON glass_uploads(pathname)`,
  `CREATE INDEX IF NOT EXISTS glass_uploads_link_day_idx ON glass_uploads(token_hash, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS glass_uploads_batch_idx ON glass_uploads(token_hash, batch_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS glass_uploads_recovery_idx ON glass_uploads(status, updated_at) WHERE status IN ('uploading','uploaded','projecting','unknown')`,
  `CREATE INDEX IF NOT EXISTS glass_uploads_pending_expiry_idx ON glass_uploads(created_at, id) WHERE status = 'pending' AND expired_at IS NULL`,
]

for (const statement of statements) {
  await sql.query(statement)
}

const ownerEmail = (
  process.env.OPS_LOGIN_EMAIL?.trim() ||
  process.env.QUOTE_TO_EMAIL?.trim() ||
  "sales@musiccityspecialtywelding.com"
).toLowerCase()

await sql`
  INSERT INTO operators (email, name, role)
  VALUES (${ownerEmail}::text, 'Philippe'::text, 'owner'::text)
  ON CONFLICT (email) DO UPDATE SET role = 'owner'
  WHERE operators.role <> 'owner'`

await sql`
  UPDATE ops_tokens SET operator_id = operators.id
  FROM operators
  WHERE ops_tokens.operator_id IS NULL
    AND lower(ops_tokens.email) = lower(operators.email)`

await sql`
  UPDATE push_subscriptions SET operator_id = owner.id
  FROM (
    SELECT id FROM operators WHERE role = 'owner' AND active = true
    ORDER BY created_at ASC LIMIT 1
  ) owner
  WHERE push_subscriptions.operator_id IS NULL`

const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' ORDER BY table_name`
console.log("Migration complete. Tables:", tables.map((t) => t.table_name).join(", "))
