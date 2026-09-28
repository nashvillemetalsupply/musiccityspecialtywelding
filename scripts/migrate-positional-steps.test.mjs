import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL("./migrate.mjs", import.meta.url), "utf8")

function statementBodies(source) {
  const start = source.indexOf("const statements = [")
  const end = source.indexOf("\n]", start)
  assert.ok(start >= 0 && end > start, "migration statements array exists")
  return [...source.slice(start, end).matchAll(/^  `([\s\S]*?)`(?=,?\r?$)/gm)]
    .map((match) => match[1].replace(/\r\n/g, "\n"))
}

test("legacy migration steps preserve main's prefix and append the recorded S09/S10 steps", () => {
  const mainMigration = execFileSync("git", ["show", "main:scripts/migrate.mjs"], { encoding: "utf8" })
  const originalSteps = statementBodies(mainMigration)
  const currentSteps = statementBodies(migration)
  const appendedSteps = [
    "ALTER TABLE ops_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()",
    "ALTER TABLE claims ADD COLUMN IF NOT EXISTS superseded_by BIGINT REFERENCES claims(id)",
    "UPDATE glass_links SET expires_at = created_at + interval '180 days' WHERE expires_at IS NULL",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS send_after TIMESTAMPTZ",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS quiet_hours_exempt BOOLEAN NOT NULL DEFAULT false",
    "CREATE INDEX IF NOT EXISTS messages_deferred_sms_due_idx ON messages(send_after, id) WHERE direction = 'out' AND status = 'queued' AND send_after IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS leads_next_follow_up_idx\n    ON leads(next_follow_up_at) WHERE next_follow_up_at IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS leads_won_at_idx ON leads(won_at)",
    "CREATE INDEX IF NOT EXISTS rate_limits_ts_idx ON rate_limits(ts)",
    "CREATE INDEX IF NOT EXISTS leads_scheduled_at_idx ON leads(scheduled_at)",
    "CREATE INDEX IF NOT EXISTS events_occurred_at_idx ON events(occurred_at)",
    "CREATE INDEX IF NOT EXISTS commitments_person_open_idx\n    ON commitments(person_id, due_at) WHERE status = 'open'",
    "CREATE INDEX IF NOT EXISTS calls_to_phone_idx ON calls(to_phone)",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE claims ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE commitments ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE calls ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false",
    "CREATE OR REPLACE FUNCTION mcsw_is_test_row(\n    p_lead_id BIGINT,\n    p_person_id BIGINT,\n    p_source_event_id BIGINT,\n    p_call_sid TEXT,\n    p_detail JSONB,\n    p_text TEXT\n  ) RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$\n    SELECT COALESCE(lead.is_test, false)\n      OR COALESCE(person.is_test, false)\n      OR COALESCE(lead_person.is_test, false)\n      OR COALESCE(source_event_lead.is_test, false)\n      OR COALESCE(source_event_person.is_test, false)\n      OR COALESCE(source_event_lead_person.is_test, false)\n      OR lower(COALESCE(p_detail->>'isTest', 'false')) = 'true'\n      OR lower(COALESCE(source_event.detail->>'isTest', 'false')) = 'true'\n      OR EXISTS (\n        SELECT 1 FROM call_intake_drafts draft\n        WHERE draft.call_sid = p_call_sid AND draft.is_test = true\n      )\n      OR concat_ws(' ', p_text, p_detail::text,\n        lead.first_name, lead.last_name, lead.service, lead.message, lead.notes,\n        person.display_name, person.company, person.phones::text, person.emails::text,\n        lead_person.display_name, lead_person.company,\n        lead_person.phones::text, lead_person.emails::text,\n        source_event.body, source_event.crew_body, source_event.detail::text,\n        source_event_lead.first_name, source_event_lead.last_name,\n        source_event_lead.service, source_event_lead.message, source_event_lead.notes,\n        source_event_person.display_name, source_event_person.company,\n        source_event_person.phones::text, source_event_person.emails::text,\n        source_event_lead_person.display_name, source_event_lead_person.company,\n        source_event_lead_person.phones::text, source_event_lead_person.emails::text\n      ) ILIKE '%[INTERNAL TEST]%'\n    FROM (VALUES (1)) seed(n)\n    LEFT JOIN leads lead ON lead.id = p_lead_id\n    LEFT JOIN people person ON person.id = p_person_id\n    LEFT JOIN people lead_person ON lead_person.id = lead.person_id\n    LEFT JOIN events source_event ON source_event.id = p_source_event_id\n    LEFT JOIN leads source_event_lead ON source_event_lead.id = source_event.lead_id\n    LEFT JOIN people source_event_person ON source_event_person.id = source_event.person_id\n    LEFT JOIN people source_event_lead_person ON source_event_lead_person.id = source_event_lead.person_id\n  $$",
    "UPDATE events e SET is_test = true\n    WHERE e.is_test = false\n      AND mcsw_is_test_row(e.lead_id, e.person_id, NULL::bigint, NULL::text,\n        e.detail, concat_ws(' ', e.body, e.crew_body, e.detail::text)) = true",
    "UPDATE claims c SET is_test = true\n    WHERE c.is_test = false\n      AND mcsw_is_test_row(\n        CASE WHEN c.subject_type = 'lead' THEN c.subject_id END,\n        CASE WHEN c.subject_type = 'person' THEN c.subject_id END,\n        c.source_event_id, NULL::text, NULL::jsonb, c.value::text\n      ) = true",
    "UPDATE commitments c SET is_test = true\n    WHERE c.is_test = false\n      AND mcsw_is_test_row(c.lead_id, c.person_id, c.source_event_id, NULL::text,\n        NULL::jsonb, concat_ws(' ', c.summary, c.crew_summary)) = true",
    "UPDATE calls c SET is_test = true\n    WHERE c.is_test = false\n      AND mcsw_is_test_row(c.lead_id, c.person_id, NULL::bigint, c.twilio_sid,\n        c.detail, COALESCE(c.detail->>'callerName', '')) = true",
    "UPDATE messages m SET is_test = true\n    WHERE m.is_test = false\n      AND mcsw_is_test_row(m.lead_id, m.person_id, NULL::bigint, NULL::text,\n        NULL::jsonb, m.body) = true",
    "UPDATE notifications n SET is_test = true\n    WHERE n.is_test = false\n      AND mcsw_is_test_row(NULL::bigint, NULL::bigint, n.source_event_id, NULL::text,\n        NULL::jsonb, concat_ws(' ', n.title, n.body)) = true",
  ]

  assert.ok(originalSteps.length > 0, "main contains the recorded legacy statements")
  const mismatchAt = originalSteps.findIndex((step, index) => currentSteps[index] !== step)
  assert.equal(
    mismatchAt,
    -1,
    `pre-existing positional step ${mismatchAt + 1} differs from main (${JSON.stringify(originalSteps[mismatchAt]?.slice(0, 120))} vs ${JSON.stringify(currentSteps[mismatchAt]?.slice(0, 120))})`,
  )
  assert.deepEqual(currentSteps.slice(-appendedSteps.length), appendedSteps, "all new schema changes are idempotent final array steps")
})
