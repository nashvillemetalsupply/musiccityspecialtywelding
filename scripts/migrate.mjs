// Idempotent schema migration for the custom lead CRM.
// Usage: node scripts/migrate.mjs  (reads DATABASE_URL from env or .env.local)
import { readFileSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
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
  `CREATE TABLE IF NOT EXISTS lead_photo_intents (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads(id),
    intake_key TEXT NOT NULL,
    photo_index INT NOT NULL,
    target_path TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','stored','attached','failed')),
    stored_pathname TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (lead_id, intake_key, photo_index)
  )`,
  `CREATE INDEX IF NOT EXISTS lead_photo_intents_backlog_idx
    ON lead_photo_intents(status, updated_at) WHERE status <> 'attached'`,
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
  `CREATE TABLE IF NOT EXISTS automation_leases (
    key TEXT PRIMARY KEY,
    holder TEXT NOT NULL DEFAULT '',
    lease_expires_at TIMESTAMPTZ NOT NULL DEFAULT to_timestamp(0),
    last_finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
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
  // Existing unknown roles already fail every strict owner check. Preserve that
  // effective privilege by normalizing them to crew before enforcing the domain.
  `UPDATE operators SET role = 'crew'::text WHERE role NOT IN ('owner','crew')`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'operators_role_check' AND conrelid = 'operators'::regclass
    ) THEN
      ALTER TABLE operators ADD CONSTRAINT operators_role_check
        CHECK (role IN ('owner','crew'));
    END IF;
  END $$`,
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
  `CREATE OR REPLACE FUNCTION protect_event_journal_truth()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.occurred_at IS DISTINCT FROM OLD.occurred_at THEN RAISE EXCEPTION 'events.occurred_at is immutable'; END IF;
      IF NEW.recorded_at IS DISTINCT FROM OLD.recorded_at THEN RAISE EXCEPTION 'events.recorded_at is immutable'; END IF;
      IF NEW.kind IS DISTINCT FROM OLD.kind THEN RAISE EXCEPTION 'events.kind is immutable'; END IF;
      IF NEW.actor_type IS DISTINCT FROM OLD.actor_type THEN RAISE EXCEPTION 'events.actor_type is immutable'; END IF;
      IF NEW.actor_id IS DISTINCT FROM OLD.actor_id THEN RAISE EXCEPTION 'events.actor_id is immutable'; END IF;
      IF NEW.external_id IS DISTINCT FROM OLD.external_id THEN RAISE EXCEPTION 'events.external_id is immutable'; END IF;
      IF NEW.body IS DISTINCT FROM OLD.body THEN RAISE EXCEPTION 'events.body is immutable'; END IF;
      IF OLD.lead_id IS NOT NULL AND NEW.lead_id IS DISTINCT FROM OLD.lead_id THEN
        RAISE EXCEPTION 'events.lead_id cannot be relinked';
      END IF;
      IF OLD.person_id IS NOT NULL AND NEW.person_id IS DISTINCT FROM OLD.person_id THEN
        RAISE EXCEPTION 'events.person_id cannot be relinked';
      END IF;
      IF OLD.crew_body IS NOT NULL AND NEW.crew_body IS DISTINCT FROM OLD.crew_body THEN
        RAISE EXCEPTION 'events.crew_body cannot be rewritten';
      END IF;
      IF OLD.detail IS NOT NULL AND NOT (COALESCE(NEW.detail, '{}'::jsonb) @> OLD.detail) THEN
        RAISE EXCEPTION 'events.detail enrichment cannot replace existing truth';
      END IF;
      RETURN NEW;
    END
    $$`,
  `DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'events_truth_immutable' AND tgrelid = 'events'::regclass
      ) THEN
        CREATE TRIGGER events_truth_immutable
          BEFORE UPDATE ON events
          FOR EACH ROW EXECUTE FUNCTION protect_event_journal_truth();
      END IF;
    END
    $$`,
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
  `CREATE TABLE IF NOT EXISTS call_live_transcript_items (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    call_sid TEXT NOT NULL REFERENCES calls(twilio_sid) ON DELETE CASCADE,
    transcription_sid TEXT NOT NULL,
    sequence_id INT NOT NULL,
    track TEXT NOT NULL,
    is_final BOOLEAN NOT NULL DEFAULT false,
    transcript TEXT NOT NULL DEFAULT '',
    stability DOUBLE PRECISION,
    confidence DOUBLE PRECISION,
    provider_timestamp TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT call_live_transcript_track_check CHECK (track IN ('inbound_track','outbound_track')),
    UNIQUE (transcription_sid, sequence_id, track)
  )`,
  `CREATE INDEX IF NOT EXISTS call_live_transcript_call_idx ON call_live_transcript_items(call_sid, sequence_id, track)`,
  `CREATE TABLE IF NOT EXISTS call_sketches (
    call_sid TEXT PRIMARY KEY REFERENCES calls(twilio_sid) ON DELETE CASCADE,
    transcription_sid TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'waiting',
    observed_spec JSONB NOT NULL DEFAULT '{}'::jsonb,
    observed_through_sequence INT NOT NULL DEFAULT 0,
    confirmed_spec JSONB,
    revision INT NOT NULL DEFAULT 0,
    confirmed_by BIGINT REFERENCES operators(id),
    confirmed_at TIMESTAMPTZ,
    last_event_at TIMESTAMPTZ,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT call_sketches_status_check CHECK (status IN ('waiting','listening','review','confirmed','stopped','error'))
  )`,
  `ALTER TABLE call_sketches ADD COLUMN IF NOT EXISTS observed_through_sequence INT NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS call_sketches_status_idx ON call_sketches(status, updated_at DESC)`,
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
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sms_only BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS provider_message_sid TEXT`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS provider_status TEXT`,
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
  `CREATE TABLE IF NOT EXISTS build_sketch_job_links (
    lead_id BIGINT PRIMARY KEY REFERENCES leads(id),
    call_sid TEXT NOT NULL UNIQUE REFERENCES calls(twilio_sid),
    is_test BOOLEAN NOT NULL DEFAULT true CHECK (is_test = true),
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS build_claim_conflicts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads(id),
    conflict_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    claim_ids BIGINT[] NOT NULL,
    source_event_id BIGINT NOT NULL REFERENCES events(id),
    is_test BOOLEAN NOT NULL DEFAULT true CHECK (is_test = true),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (lead_id, conflict_key)
  )`,
  `CREATE TABLE IF NOT EXISTS build_fact_decisions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads(id),
    claim_id BIGINT NOT NULL REFERENCES claims(id),
    state TEXT NOT NULL,
    actor_id BIGINT NOT NULL REFERENCES operators(id),
    proposer_type TEXT NOT NULL DEFAULT 'operator',
    purpose TEXT NOT NULL DEFAULT 'build-sheet',
    source_event_id BIGINT NOT NULL REFERENCES events(id),
    decision_key TEXT NOT NULL,
    is_test BOOLEAN NOT NULL DEFAULT true CHECK (is_test = true),
    decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT build_fact_decisions_state_check CHECK (state IN ('proposed','shop-confirmed','working-number','rejected','superseded')),
    CONSTRAINT build_fact_decisions_proposer_check CHECK (proposer_type IN ('operator','system','customer')),
    UNIQUE (lead_id, decision_key)
  )`,
  `ALTER TABLE build_fact_decisions ADD COLUMN IF NOT EXISTS proposer_type TEXT NOT NULL DEFAULT 'operator'`,
  `DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'build_fact_decisions_proposer_check'
        AND conrelid = 'build_fact_decisions'::regclass
    ) THEN
      ALTER TABLE build_fact_decisions
        ADD CONSTRAINT build_fact_decisions_proposer_check
        CHECK (proposer_type IN ('operator','system','customer'));
    END IF;
  END $$`,
  `CREATE INDEX IF NOT EXISTS build_fact_decisions_claim_idx ON build_fact_decisions(lead_id, claim_id, decided_at DESC, id DESC)`,
  `CREATE TABLE IF NOT EXISTS build_sheet_sequences (
    lead_id BIGINT PRIMARY KEY REFERENCES leads(id),
    next_sequence INT NOT NULL DEFAULT 1,
    is_test BOOLEAN NOT NULL DEFAULT true CHECK (is_test = true),
    CONSTRAINT build_sheet_sequences_positive_check CHECK (next_sequence > 0)
  )`,
  `CREATE TABLE IF NOT EXISTS build_sheets (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads(id),
    sequence INT NOT NULL,
    snapshot JSONB NOT NULL,
    locked_by BIGINT NOT NULL REFERENCES operators(id),
    locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_test BOOLEAN NOT NULL DEFAULT true CHECK (is_test = true),
    UNIQUE (lead_id, sequence)
  )`,
  `CREATE TABLE IF NOT EXISTS build_lock_receipts (
    lead_id BIGINT NOT NULL REFERENCES leads(id),
    lock_key TEXT NOT NULL,
    build_sheet_id BIGINT,
    is_test BOOLEAN NOT NULL DEFAULT true CHECK (is_test = true),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT build_lock_receipts_build_sheet_id_fkey
      FOREIGN KEY (build_sheet_id) REFERENCES build_sheets(id)
      DEFERRABLE INITIALLY DEFERRED,
    PRIMARY KEY (lead_id, lock_key)
  )`,
  `DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'build_lock_receipts_build_sheet_id_fkey'
        AND conrelid = 'build_lock_receipts'::regclass
        AND NOT condeferrable
    ) THEN
      ALTER TABLE build_lock_receipts
        DROP CONSTRAINT build_lock_receipts_build_sheet_id_fkey;
      ALTER TABLE build_lock_receipts
        ADD CONSTRAINT build_lock_receipts_build_sheet_id_fkey
        FOREIGN KEY (build_sheet_id) REFERENCES build_sheets(id)
        DEFERRABLE INITIALLY DEFERRED;
    END IF;
  END $$`,
  `CREATE TABLE IF NOT EXISTS build_paperwork (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads(id),
    build_sheet_id BIGINT NOT NULL REFERENCES build_sheets(id),
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    dependency_fingerprint JSONB NOT NULL DEFAULT '[]'::jsonb,
    valid_for_source BOOLEAN NOT NULL DEFAULT true,
    current_status TEXT NOT NULL DEFAULT 'current',
    current_reason TEXT NOT NULL DEFAULT '',
    issue_state TEXT NOT NULL DEFAULT 'current',
    is_test BOOLEAN NOT NULL DEFAULT true CHECK (is_test = true),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT build_paperwork_status_check CHECK (current_status IN ('current','old-numbers','needs-update')),
    CONSTRAINT build_paperwork_issue_check CHECK (issue_state IN ('current','blocked')),
    UNIQUE (build_sheet_id, kind)
  )`,
  `CREATE INDEX IF NOT EXISTS build_paperwork_lead_idx ON build_paperwork(lead_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS build_customer_responses (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads(id),
    build_sheet_id BIGINT NOT NULL REFERENCES build_sheets(id),
    claim_id BIGINT NOT NULL REFERENCES claims(id),
    response_state TEXT NOT NULL,
    proposed_claim_id BIGINT REFERENCES claims(id),
    source_event_id BIGINT NOT NULL REFERENCES events(id),
    token_hash TEXT NOT NULL,
    response_key TEXT NOT NULL,
    is_test BOOLEAN NOT NULL DEFAULT true CHECK (is_test = true),
    responded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT build_customer_responses_state_check CHECK (response_state IN ('accepted','corrected')),
    UNIQUE (lead_id, response_key)
  )`,
  `CREATE INDEX IF NOT EXISTS build_customer_responses_sheet_idx
    ON build_customer_responses(build_sheet_id, claim_id, responded_at DESC, id DESC)`,
  `CREATE TABLE IF NOT EXISTS build_paperwork_issues (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads(id),
    paperwork_id BIGINT NOT NULL REFERENCES build_paperwork(id),
    build_sheet_id BIGINT NOT NULL REFERENCES build_sheets(id),
    issue_key TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    issued_by BIGINT NOT NULL REFERENCES operators(id),
    is_test BOOLEAN NOT NULL DEFAULT true CHECK (is_test = true),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (paperwork_id, issue_key)
  )`,
  `CREATE INDEX IF NOT EXISTS build_paperwork_issues_lead_idx
    ON build_paperwork_issues(lead_id, issued_at DESC)`,
  `CREATE TABLE IF NOT EXISTS job_closeouts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads(id),
    completion_event_id BIGINT NOT NULL UNIQUE REFERENCES events(id),
    completion_state TEXT NOT NULL,
    fit_state TEXT NOT NULL,
    extra_trips INT NOT NULL DEFAULT 0,
    rework_state TEXT NOT NULL,
    as_built_differences TEXT NOT NULL DEFAULT '',
    remaining_work TEXT NOT NULL DEFAULT '',
    source_words TEXT NOT NULL DEFAULT '',
    reviewed_by BIGINT NOT NULL REFERENCES operators(id),
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_test BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT job_closeouts_completion_check CHECK (completion_state = 'complete'),
    CONSTRAINT job_closeouts_fit_check CHECK (fit_state IN ('fit','adjusted','not-checked')),
    CONSTRAINT job_closeouts_rework_check CHECK (rework_state IN ('yes','no')),
    CONSTRAINT job_closeouts_extra_trips_check CHECK (extra_trips >= 0)
  )`,
  `CREATE INDEX IF NOT EXISTS job_closeouts_lead_idx ON job_closeouts(lead_id, reviewed_at DESC)`,
  `CREATE TABLE IF NOT EXISTS job_closeout_updates (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads(id),
    source_event_id BIGINT NOT NULL UNIQUE REFERENCES events(id),
    completion_state TEXT NOT NULL DEFAULT 'partial' CHECK (completion_state = 'partial'),
    fit_state TEXT NOT NULL,
    extra_trips INT NOT NULL DEFAULT 0 CHECK (extra_trips >= 0),
    rework_state TEXT NOT NULL,
    as_built_differences TEXT NOT NULL DEFAULT '',
    remaining_work TEXT NOT NULL,
    source_words TEXT NOT NULL,
    reviewed_by BIGINT NOT NULL REFERENCES operators(id),
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_test BOOLEAN NOT NULL DEFAULT true CHECK (is_test = true),
    CONSTRAINT job_closeout_updates_fit_check CHECK (fit_state IN ('fit','adjusted','not-checked')),
    CONSTRAINT job_closeout_updates_rework_check CHECK (rework_state IN ('yes','no'))
  )`,
  `CREATE INDEX IF NOT EXISTS job_closeout_updates_lead_idx ON job_closeout_updates(lead_id, reviewed_at DESC)`,
  // What is in the price. One row per line of the board panel's breakdown:
  // label, the grey qualifier beside it, and the money. The quoted price stays
  // on leads.estimate_value_cents -- these lines explain that number, they do
  // not replace it, so a job whose lines do not add up says so out loud rather
  // than quietly recomputing the quote.
  `CREATE TABLE IF NOT EXISTS job_line_items (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lead_id BIGINT NOT NULL REFERENCES leads(id),
    position INT NOT NULL DEFAULT 0,
    label TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    amount_cents BIGINT NOT NULL DEFAULT 0,
    entered_by BIGINT REFERENCES operators(id),
    is_test BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT job_line_items_label_check CHECK (label <> ''),
    CONSTRAINT job_line_items_position_check CHECK (position >= 0)
  )`,
  `CREATE INDEX IF NOT EXISTS job_line_items_lead_idx ON job_line_items(lead_id, position)`,
  `CREATE OR REPLACE FUNCTION reject_build_sheet_mutation()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'locked Build Sheets are immutable';
    END;
    $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'build_sheets_immutable') THEN
      CREATE TRIGGER build_sheets_immutable
      BEFORE UPDATE OR DELETE ON build_sheets
      FOR EACH ROW EXECUTE FUNCTION reject_build_sheet_mutation();
    END IF;
  END $$`,
  // The owner's voice, kept as a corpus rather than a summary. Every line he
  // has said or written that the shop already stores lands here once, keyed by
  // where it came from, so the profile can be rebuilt from scratch whenever the
  // derivation changes and the corpus keeps growing under it. `source_ref`
  // holds the call SID or message SID the line came from, which is also how a
  // future audio clone finds the recording of him saying it.
  `CREATE TABLE IF NOT EXISTS voice_samples (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    speaker_key TEXT NOT NULL DEFAULT 'owner',
    source_kind TEXT NOT NULL,
    source_ref TEXT NOT NULL DEFAULT '',
    sequence_id INT NOT NULL DEFAULT 0,
    text TEXT NOT NULL,
    spoken_at TIMESTAMPTZ,
    is_test BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT voice_samples_source_check CHECK (source_kind IN ('call','sms','email','note','manual')),
    UNIQUE (speaker_key, source_kind, source_ref, sequence_id)
  )`,
  `CREATE INDEX IF NOT EXISTS voice_samples_speaker_idx ON voice_samples(speaker_key, is_test, spoken_at DESC)`,
  `CREATE TABLE IF NOT EXISTS voice_profiles (
    speaker_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    profile JSONB NOT NULL DEFAULT '{}'::jsonb,
    sample_count INT NOT NULL DEFAULT 0,
    source_count INT NOT NULL DEFAULT 0,
    built_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `COMMENT ON TABLE lead_events IS 'Frozen 2026-08-21. The journal is events; this table is retained history only. Do not write.'`,
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

// Backfill: legacy notifications deep-linked to the retired /ops?view=updates
// surface. Point them at /board/updates, keeping any remaining query params and
// the hash. Idempotent — the WHERE matches only the stale prefix, so a re-run
// touches nothing.
const staleUpdateUrls = await sql`
  SELECT id, url FROM notifications WHERE url LIKE '/ops?view=updates%'`
for (const row of staleUpdateUrls) {
  const next = row.url
    .replace(/^\/ops\?view=updates/, "/board/updates")
    .replace(/^\/board\/updates&/, "/board/updates?")
  if (next !== row.url) {
    await sql`UPDATE notifications SET url = ${next}::text WHERE id = ${row.id}::bigint`
  }
}

// Deterministic, silent Build Sheets kill-test fixture. All writes are new-table
// rows or explicitly test-partitioned rows in the existing event/claim substrate.
const buildFixturePublicId = "internal-build-sheets-fixture"
const buildFixtureCallSid = "BUILD-SHEETS-FIXTURE-CALL"
const buildFixtureTranscript = "I need a steel gate 48 inches wide, 42 inches tall, built from 2 inch square tube, with two rails, hinges left and latch right."
const buildFixtureObservedSpec = {
  version: 1,
  kind: { value: "gate", truth: "stated", evidence: "steel gate", track: "inbound_track", sequenceId: 1 },
  width: { value: 48, truth: "uncertain", evidence: "48 inches wide", track: "inbound_track", sequenceId: 1 },
  height: { value: 42, truth: "stated", evidence: "42 inches tall", track: "inbound_track", sequenceId: 1 },
  stockSize: { value: 2, truth: "stated", evidence: "2 inch square tube", track: "inbound_track", sequenceId: 1 },
  railCount: { value: 2, truth: "stated", evidence: "two rails", track: "inbound_track", sequenceId: 1 },
  hingeSide: { value: "left", truth: "stated", evidence: "hinges left", track: "inbound_track", sequenceId: 1 },
  latchSide: { value: "right", truth: "stated", evidence: "latch right", track: "inbound_track", sequenceId: 1 },
  swing: { value: null, truth: "unknown", evidence: "", track: "", sequenceId: null },
  material: { value: "steel", truth: "stated", evidence: "steel gate", track: "inbound_track", sequenceId: 1 },
  nextQuestion: "Is 48 inches the opening or the finished gate?",
  readyForReview: true,
}

await sql`
  INSERT INTO leads (
    public_id, first_name, last_name, phone, email, service, message,
    preferred_contact, source, is_test, status, email_delivery_status
  ) VALUES (
    ${buildFixturePublicId}::text, '[INTERNAL TEST] Gate Build'::text, ''::text,
    '+16155550199'::text, ''::text, 'Gate fabrication'::text,
    'Build Sheets kill-test fixture. Never contact.'::text, ''::text,
    'internal-build-fixture'::text, true, 'qualified'::text, 'test'::text
  )
  ON CONFLICT (public_id) DO NOTHING`

await sql`
  INSERT INTO calls (
    twilio_sid, direction, from_phone, to_phone, status, transcript,
    transcript_status, lead_id, detail
  )
  SELECT ${buildFixtureCallSid}::text, 'inbound'::text, '+16155550199'::text,
    '+16155550100'::text, 'completed'::text, ${buildFixtureTranscript}::text,
    'complete'::text, l.id,
    ${JSON.stringify({ isTest: true, fixture: "build-sheets" })}::jsonb
  FROM leads l
  WHERE l.public_id = ${buildFixturePublicId}::text AND l.is_test = true
  ON CONFLICT (twilio_sid) DO NOTHING`

await sql`
  INSERT INTO call_intake_drafts (
    public_id, call_sid, lead_id, caller_name, phone, need,
    status, is_test, saved_at
  )
  SELECT 'internal-build-sheets-draft'::text, c.twilio_sid, l.id,
    '[INTERNAL TEST] Gate Build'::text, '+16155550199'::text,
    '48 inch steel gate'::text, 'saved'::text, true, now()
  FROM leads l JOIN calls c ON c.lead_id = l.id
  WHERE l.public_id = ${buildFixturePublicId}::text AND l.is_test = true
    AND c.twilio_sid = ${buildFixtureCallSid}::text
  ON CONFLICT (public_id) DO NOTHING`

await sql`
  INSERT INTO call_sketches (
    call_sid, transcription_sid, status, observed_spec,
    observed_through_sequence, revision, last_event_at
  )
  SELECT c.twilio_sid, 'BUILD-SHEETS-FIXTURE-TRANSCRIPTION'::text,
    'review'::text, ${JSON.stringify(buildFixtureObservedSpec)}::jsonb,
    1::int, 1::int, now()
  FROM calls c JOIN leads l ON l.id = c.lead_id
  WHERE c.twilio_sid = ${buildFixtureCallSid}::text AND l.is_test = true
  ON CONFLICT (call_sid) DO NOTHING`

await sql`
  INSERT INTO build_sketch_job_links (lead_id, call_sid, is_test)
  SELECT l.id, c.twilio_sid, true
  FROM leads l JOIN calls c ON c.lead_id = l.id
  WHERE l.public_id = ${buildFixturePublicId}::text AND l.is_test = true
    AND c.twilio_sid = ${buildFixtureCallSid}::text
  ON CONFLICT (lead_id) DO NOTHING`

await sql`
  INSERT INTO events (
    occurred_at, kind, actor_type, actor_id, lead_id, external_id,
    body, crew_body, detail
  )
  SELECT now(), 'call.transcript'::text, 'customer'::text, ''::text,
    l.id, 'build-sheets-fixture-transcript'::text,
    ${buildFixtureTranscript}::text, NULL::text,
    ${JSON.stringify({ callSid: buildFixtureCallSid, isTest: true, sensitivity: "owner" })}::jsonb
  FROM leads l
  WHERE l.public_id = ${buildFixturePublicId}::text AND l.is_test = true
  ON CONFLICT (kind, external_id) WHERE external_id <> '' DO NOTHING`

const buildFixtureRows = await sql`
  SELECT l.id AS lead_id, e.id AS event_id
  FROM leads l JOIN events e ON e.lead_id = l.id
  WHERE l.public_id = ${buildFixturePublicId}::text AND l.is_test = true
    AND e.kind = 'call.transcript' AND e.external_id = 'build-sheets-fixture-transcript'
  LIMIT 1`
const buildFixture = buildFixtureRows[0]

if (buildFixture) {
  const leadId = Number(buildFixture.lead_id)
  const sourceEventId = Number(buildFixture.event_id)
  const interpretationGroup = `event-${sourceEventId}-width`
  const buildFacts = [
    { factKey: "opening.clear_width", subject: "opening", property: "clear_width", value: 48, unit: "in", reference: "between posts", original: "48 inches wide", speaker: "customer", certainty: "interpreted", critical: true, interpretationGroup },
    { factKey: "gate_leaf.finished_width", subject: "gate_leaf", property: "finished_width", value: 48, unit: "in", reference: "outside edge to outside edge", original: "48 inches wide", speaker: "customer", certainty: "interpreted", critical: true, interpretationGroup },
    { factKey: "gate_leaf.finished_height", subject: "gate_leaf", property: "finished_height", value: 42, unit: "in", reference: "bottom edge to top edge", original: "42 inches tall", speaker: "customer", certainty: "stated", critical: true },
    { factKey: "frame.stock_size", subject: "frame", property: "stock_size", value: 2, unit: "in", reference: "outside stock size", original: "2 inch square tube", speaker: "customer", certainty: "stated", critical: true },
    { factKey: "frame.rail_count", subject: "frame", property: "rail_count", value: 2, unit: "count", reference: "inside frame", original: "two rails", speaker: "customer", certainty: "stated", critical: true },
    { factKey: "gate.hinge_side", subject: "gate", property: "hinge_side", value: "left", unit: "", reference: "viewed from customer side", original: "hinges left", speaker: "customer", certainty: "stated", critical: true },
    { factKey: "gate.latch_side", subject: "gate", property: "latch_side", value: "right", unit: "", reference: "viewed from customer side", original: "latch right", speaker: "customer", certainty: "stated", critical: true },
    { factKey: "frame.material", subject: "frame", property: "material", value: "steel", unit: "", reference: "", original: "steel gate", speaker: "customer", certainty: "stated", critical: false },
  ]
  for (const fact of buildFacts) {
    const itemKey = createHash("sha256")
      .update(`call-sketch:${buildFixtureCallSid}:${fact.factKey}:${fact.interpretationGroup ?? "direct"}`)
      .digest("hex")
    await sql`
      INSERT INTO claims (
        subject_type, subject_id, predicate, value, confidence,
        source_event_id, extracted_by, item_key
      )
      SELECT 'lead'::text, l.id, 'build_fact'::text,
        ${JSON.stringify(fact)}::jsonb,
        ${fact.certainty === "interpreted" ? 0.85 : 0.9}::real,
        ${sourceEventId}::bigint, 'build-sheets-fixture'::text, ${itemKey}::text
      FROM leads l
      WHERE l.id = ${leadId}::bigint AND l.is_test = true
      ON CONFLICT (source_event_id, item_key) WHERE item_key <> '' DO NOTHING`
  }

  await sql`
    INSERT INTO build_fact_decisions (
      lead_id, claim_id, state, actor_id, proposer_type, purpose,
      source_event_id, decision_key, is_test, decided_at
    )
    SELECT l.id, c.id, 'proposed'::text, owner.id, 'system'::text,
      'build-sheet'::text, ${sourceEventId}::bigint,
      ('fixture-proposed:' || c.id::text)::text, true, e.occurred_at
    FROM leads l
    JOIN claims c ON c.subject_type = 'lead' AND c.subject_id = l.id
    JOIN events e ON e.id = ${sourceEventId}::bigint AND e.lead_id = l.id
    JOIN LATERAL (
      SELECT id FROM operators WHERE role = 'owner' AND active = true
      ORDER BY created_at ASC LIMIT 1
    ) owner ON true
    WHERE l.id = ${leadId}::bigint AND l.is_test = true
      AND c.predicate = 'build_fact' AND c.source_event_id = ${sourceEventId}::bigint
    ON CONFLICT (lead_id, decision_key) DO NOTHING`

  await sql`
    INSERT INTO build_claim_conflicts (
      lead_id, conflict_key, kind, claim_ids, source_event_id, is_test
    )
    SELECT l.id, ${interpretationGroup}::text, 'unresolved-reference'::text,
      array_agg(c.id ORDER BY c.id)::bigint[], ${sourceEventId}::bigint, true
    FROM leads l JOIN claims c ON c.subject_type = 'lead' AND c.subject_id = l.id
    WHERE l.id = ${leadId}::bigint AND l.is_test = true
      AND c.source_event_id = ${sourceEventId}::bigint
      AND c.predicate = 'build_fact'
      AND c.value->>'interpretationGroup' = ${interpretationGroup}::text
    GROUP BY l.id
    HAVING count(*) = 2
    ON CONFLICT (lead_id, conflict_key) DO NOTHING`

  await sql`
    INSERT INTO events (
      occurred_at, kind, actor_type, actor_id, lead_id, external_id,
      body, crew_body, detail
    )
    SELECT now(), 'build.fixture-confirmed'::text, 'system'::text, ''::text,
      l.id, 'build-sheets-fixture-confirmed'::text,
      'Known fixture facts confirmed for the owner kill test.'::text,
      NULL::text, ${JSON.stringify({ isTest: true, sensitivity: "owner" })}::jsonb
    FROM leads l
    WHERE l.id = ${leadId}::bigint AND l.is_test = true
    ON CONFLICT (kind, external_id) WHERE external_id <> '' DO NOTHING`

  const fixtureDecisionFacts = [
    "gate_leaf.finished_height",
    "frame.stock_size",
    "frame.rail_count",
    "gate.hinge_side",
    "gate.latch_side",
    "frame.material",
  ]
  for (const factKey of fixtureDecisionFacts) {
    await sql`
      INSERT INTO build_fact_decisions (
        lead_id, claim_id, state, actor_id, proposer_type, purpose, source_event_id,
        decision_key, is_test, decided_at
      )
      SELECT l.id, c.id, 'shop-confirmed'::text, o.id,
        'operator'::text, 'build-sheet'::text, decision_event.id,
        ${`fixture-confirmed:${factKey}`}::text, true, now()
      FROM leads l
      JOIN claims c ON c.subject_type = 'lead' AND c.subject_id = l.id
      JOIN events decision_event ON decision_event.lead_id = l.id
        AND decision_event.kind = 'build.fixture-confirmed'
        AND decision_event.external_id = 'build-sheets-fixture-confirmed'
      JOIN LATERAL (
        SELECT id FROM operators WHERE role = 'owner' AND active = true
        ORDER BY created_at ASC LIMIT 1
      ) o ON true
      WHERE l.id = ${leadId}::bigint AND l.is_test = true
        AND c.predicate = 'build_fact' AND c.source_event_id = ${sourceEventId}::bigint
        AND c.value->>'factKey' = ${factKey}::text
      ON CONFLICT (lead_id, decision_key) DO NOTHING`
  }
  console.log(`Build Sheets fixture: /ops/leads/${leadId}/builds`)
}

// One promise, one row. Extraction is handed the open commitments as context
// and restates them, so the same promise arrived again under the next event's
// id -- a call and the customer's follow-up text put the same two promises on
// the board twice. `addCommitment` now checks for the restatement before it
// inserts, but that read is not atomic with the insert and extractions for one
// job genuinely overlap, so the database holds the rule.
//
// Order matters: the duplicates already on the books are retired first, or the
// index cannot be built. Oldest row of each group is the promise; the rest are
// restatements of it and go to 'superseded', which every board counter
// excludes. Both statements are safe to run again -- the second time there is
// nothing left to retire and the index already exists.
await sql`
  UPDATE commitments c SET status = 'superseded', status_changed_at = now()
  WHERE c.status = 'open'
    AND (c.lead_id IS NOT NULL OR c.person_id IS NOT NULL)
    AND EXISTS (
      SELECT 1 FROM commitments keeper
      WHERE keeper.status = 'open'
        AND keeper.id < c.id
        AND keeper.lead_id IS NOT DISTINCT FROM c.lead_id
        AND keeper.person_id IS NOT DISTINCT FROM c.person_id
        AND keeper.direction = c.direction
        AND btrim(lower(keeper.summary)) = btrim(lower(c.summary))
        AND keeper.due_at IS NOT DISTINCT FROM c.due_at
    )`
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS commitments_open_promise_unique
    ON commitments (
      COALESCE(lead_id, -1), COALESCE(person_id, -1), direction,
      btrim(lower(summary)), COALESCE(due_at, '-infinity'::timestamptz)
    )
    WHERE status = 'open' AND (lead_id IS NOT NULL OR person_id IS NOT NULL)`

const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' ORDER BY table_name`
console.log("Migration complete. Tables:", tables.map((t) => t.table_name).join(", "))
