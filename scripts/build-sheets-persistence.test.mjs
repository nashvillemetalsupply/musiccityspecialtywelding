import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"
import { neonConfig, Pool } from "@neondatabase/serverless"
import WebSocket from "ws"
import { persistLockedBuildSheet, persistObservedBuildFacts } from "../lib/build-sheets-persistence.mjs"

neonConfig.webSocketConstructor = WebSocket

function databaseUrl() {
  if (process.env.DATABASE_URL_UNPOOLED?.trim()) return process.env.DATABASE_URL_UNPOOLED.trim()
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim()
  if (!existsSync(".env.local")) return ""
  const source = readFileSync(".env.local", "utf8")
  return source.match(/^DATABASE_URL_UNPOOLED="?([^"\r\n]+)/m)?.[1]
    ?? source.match(/^DATABASE_URL="?([^"\r\n]+)/m)?.[1]
    ?? ""
}

function clientSql(client) {
  return async (strings, ...values) => {
    let text = ""
    for (let index = 0; index < strings.length; index += 1) {
      text += strings[index]
      if (index < values.length) text += `$${index + 1}`
    }
    return (await client.query(text, values)).rows
  }
}

test("real persistence converges ingest retries and lock receipts without sequence gaps", { timeout: 60_000 }, async (t) => {
  const url = databaseUrl()
  if (!url) return t.skip("DATABASE_URL is not configured")
  const pool = new Pool({ connectionString: url })
  const client = await pool.connect()
  const sql = clientSql(client)
  try {
    await client.query("BEGIN")
    const owner = (await client.query("SELECT id FROM operators WHERE role = 'owner' AND active = true ORDER BY created_at LIMIT 1")).rows[0]
    assert.ok(owner?.id, "an active owner fixture is required")
    const publicId = `build-persistence-${randomUUID()}`
    const lead = (await client.query(
      `INSERT INTO leads (public_id, first_name, phone, service, source, is_test)
       VALUES ($1, '[INTERNAL TEST] Persistence', '+16155550198', 'Gate fabrication', 'build-persistence-test', true)
       RETURNING id`,
      [publicId],
    )).rows[0]
    const source = (await client.query(
      `INSERT INTO events (kind, actor_type, lead_id, external_id, body, detail)
       VALUES ('call.transcript', 'customer', $1, $2, 'Gate is 48 inches wide', '{"isTest":true}'::jsonb)
       RETURNING id`,
      [lead.id, `build-persistence-${randomUUID()}`],
    )).rows[0]
    const group = `event-${source.id}-width`
    const facts = [
      {
        itemKey: `persistence-opening-${source.id}`,
        fact: { factKey: "opening.clear_width", subject: "opening", property: "clear_width", value: 48, unit: "in", reference: "between posts", original: "48 inches wide", speaker: "customer", certainty: "interpreted", critical: true, interpretationGroup: group },
      },
      {
        itemKey: `persistence-finished-${source.id}`,
        fact: { factKey: "gate_leaf.finished_width", subject: "gate_leaf", property: "finished_width", value: 48, unit: "in", reference: "outside edge to outside edge", original: "48 inches wide", speaker: "customer", certainty: "interpreted", critical: true, interpretationGroup: group },
      },
    ]

    const firstIngest = await persistObservedBuildFacts({ sql, leadId: Number(lead.id), callSid: `TEST-${source.id}`, sourceEventId: Number(source.id), facts })
    const retryIngest = await persistObservedBuildFacts({ sql, leadId: Number(lead.id), callSid: `TEST-${source.id}`, sourceEventId: Number(source.id), facts })
    assert.deepEqual(retryIngest, firstIngest)
    assert.equal(Number((await client.query("SELECT count(*) AS count FROM claims WHERE subject_type = 'lead' AND subject_id = $1 AND predicate = 'build_fact'", [lead.id])).rows[0].count), 2)
    assert.equal(Number((await client.query("SELECT count(*) AS count FROM build_fact_decisions WHERE lead_id = $1 AND state = 'proposed'", [lead.id])).rows[0].count), 2)
    assert.equal(Number((await client.query("SELECT count(*) AS count FROM build_claim_conflicts WHERE lead_id = $1", [lead.id])).rows[0].count), 1)

    const candidate = { jobId: Number(lead.id), number: 1, idempotencyKey: "lock-a", lockedAt: "2026-08-12T18:00:00.000Z", facts: [], fabrication: { ready: false, blockers: ["test"] } }
    await assert.rejects(
      persistLockedBuildSheet({ sql, leadId: Number(lead.id), operatorId: 0, lockKey: "lock-a", candidate }),
      /still being filed/i,
    )
    assert.equal(Number((await client.query("SELECT count(*) AS count FROM build_sheet_sequences WHERE lead_id = $1", [lead.id])).rows[0].count), 0)
    const firstLock = await persistLockedBuildSheet({ sql, leadId: Number(lead.id), operatorId: Number(owner.id), lockKey: "lock-a", candidate })
    const retryLock = await persistLockedBuildSheet({ sql, leadId: Number(lead.id), operatorId: Number(owner.id), lockKey: "lock-a", candidate })
    assert.equal(Number(retryLock.sheet.id), Number(firstLock.sheet.id))
    assert.equal(Number(retryLock.sheet.sequence), 1)
    const nextLock = await persistLockedBuildSheet({ sql, leadId: Number(lead.id), operatorId: Number(owner.id), lockKey: "lock-b", candidate: { ...candidate, idempotencyKey: "lock-b" } })
    assert.equal(Number(nextLock.sheet.sequence), 2)
    assert.equal(Number((await client.query("SELECT next_sequence FROM build_sheet_sequences WHERE lead_id = $1", [lead.id])).rows[0].next_sequence), 3)
  } finally {
    await client.query("ROLLBACK")
    client.release()
    await pool.end()
  }
})
