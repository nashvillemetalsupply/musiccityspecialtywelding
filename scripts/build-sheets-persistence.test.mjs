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

test("simultaneous lock receipts converge across two database connections", { timeout: 60_000 }, async (t) => {
  const url = databaseUrl()
  if (!url) return t.skip("DATABASE_URL is not configured")
  const pool = new Pool({ connectionString: url })
  const setup = await pool.connect()
  const firstClient = await pool.connect()
  const secondClient = await pool.connect()
  const schema = `build_lock_test_${randomUUID().replaceAll("-", "")}`
  const searchPath = `SET search_path TO "${schema}"`
  try {
    await setup.query(`CREATE SCHEMA "${schema}"`)
    await setup.query(searchPath)
    await setup.query(`
      CREATE TABLE operators (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        role TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true
      );
      CREATE TABLE leads (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        is_test BOOLEAN NOT NULL DEFAULT true CHECK (is_test = true)
      );
      CREATE TABLE build_sheet_sequences (
        lead_id BIGINT PRIMARY KEY REFERENCES leads(id),
        next_sequence INTEGER NOT NULL,
        is_test BOOLEAN NOT NULL DEFAULT true CHECK (is_test = true)
      );
      CREATE TABLE build_sheets (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        lead_id BIGINT NOT NULL REFERENCES leads(id),
        sequence INTEGER NOT NULL,
        snapshot JSONB NOT NULL,
        locked_by BIGINT NOT NULL REFERENCES operators(id),
        locked_at TIMESTAMPTZ NOT NULL,
        is_test BOOLEAN NOT NULL DEFAULT true CHECK (is_test = true),
        UNIQUE (lead_id, sequence)
      );
      CREATE TABLE build_lock_receipts (
        lead_id BIGINT NOT NULL REFERENCES leads(id),
        lock_key TEXT NOT NULL,
        build_sheet_id BIGINT,
        is_test BOOLEAN NOT NULL DEFAULT true CHECK (is_test = true),
        PRIMARY KEY (lead_id, lock_key),
        CONSTRAINT build_lock_receipts_build_sheet_id_fkey
          FOREIGN KEY (build_sheet_id) REFERENCES build_sheets(id)
          DEFERRABLE INITIALLY DEFERRED
      )`)
    const owner = (await setup.query("INSERT INTO operators (role) VALUES ('owner') RETURNING id")).rows[0]
    const lead = (await setup.query("INSERT INTO leads DEFAULT VALUES RETURNING id")).rows[0]
    await firstClient.query(searchPath)
    await secondClient.query(searchPath)
    const candidate = { jobId: Number(lead.id), number: 1, idempotencyKey: "same-tap", lockedAt: "2026-08-12T18:00:00.000Z", facts: [], fabrication: { ready: false, blockers: ["test"] } }
    const lockInput = { leadId: Number(lead.id), operatorId: Number(owner.id), lockKey: "same-tap", candidate }
    const [first, second] = await Promise.all([
      persistLockedBuildSheet({ ...lockInput, sql: clientSql(firstClient) }),
      persistLockedBuildSheet({ ...lockInput, sql: clientSql(secondClient) }),
    ])

    assert.equal(Number(first.sheet.id), Number(second.sheet.id))
    assert.equal(Number(first.sheet.sequence), 1)
    assert.equal(Number(second.sheet.sequence), 1)
    assert.equal(Number((await setup.query("SELECT count(*) AS count FROM build_sheets")).rows[0].count), 1)
    assert.equal(Number((await setup.query("SELECT count(*) AS count FROM build_lock_receipts")).rows[0].count), 1)
    assert.equal(Number((await setup.query("SELECT next_sequence FROM build_sheet_sequences WHERE lead_id = $1", [lead.id])).rows[0].next_sequence), 2)

    const next = await persistLockedBuildSheet({ sql: clientSql(firstClient), leadId: Number(lead.id), operatorId: Number(owner.id), lockKey: "next-tap", candidate: { ...candidate, idempotencyKey: "next-tap" } })
    assert.equal(Number(next.sheet.sequence), 2)
    assert.equal(Number((await setup.query("SELECT next_sequence FROM build_sheet_sequences WHERE lead_id = $1", [lead.id])).rows[0].next_sequence), 3)
  } finally {
    firstClient.release()
    secondClient.release()
    await setup.query("SET search_path TO public")
    await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    setup.release()
    await pool.end()
  }
})
