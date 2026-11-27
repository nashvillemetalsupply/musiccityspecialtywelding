import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { createInProcessTtlCache } from "../lib/in-process-cache.ts"

const HEALTH = readFileSync(new URL("../app/api/health/route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")

test("quote intake health stays red until both rollout columns exist", async () => {
  const rolloutColumns = ["quote_form_photo_count", "environment"]
  const columns = new Set(rolloutColumns)
  const sql = async (strings) => {
    const text = strings.join(" ? ")
    if (text.includes("has_table_privilege")) return [{ ready: true }]
    assert.match(text, /^\s*EXPLAIN \(FORMAT JSON\)/)
    assert.match(text, /INSERT INTO leads \([^)]*quote_form_photo_count\)/)
    assert.match(text, /INSERT INTO quote_intakes \([^)]*environment\)/)
    for (const column of rolloutColumns) {
      if (!columns.has(column)) throw Object.assign(new Error("column does not exist"), { code: "42703" })
    }
    return []
  }
  const output = ts.transpileModule(HEALTH, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  vm.runInNewContext(output, {
    exports, Response, process: { env: {
      RESEND_API_KEY: "fixture", QUOTE_FROM_EMAIL: "from@example.test", QUOTE_TO_EMAIL: "to@example.test",
    } },
    require: (specifier) => ({
      "@/lib/db": { dbConfigured: () => true, getSql: () => sql },
      "@/lib/ops-auth": { isAuthorizedCron: () => false },
      "@/lib/in-process-cache.ts": { createInProcessTtlCache },
    })[specifier] ?? {},
  })
  for (const column of rolloutColumns) {
    columns.delete(column)
    const result = await exports.GET(new Request("https://example.test/api/health"))
    assert.equal(result.status, 503)
    assert.equal((await result.json()).leadsAccepted, false)
    columns.add(column)
  }
  const result = await exports.GET(new Request("https://example.test/api/health"))
  assert.equal(result.status, 200)
  assert.equal((await result.json()).leadsAccepted, true)
})

test("health snapshot is shared for five minutes and collapses concurrent fake SQL reads", async () => {
  let now = 1_000
  let queryCount = 0
  const fakeSql = async () => {
    queryCount++
    await Promise.resolve()
    return [{ connected: true, lead_count: queryCount }]
  }
  const readFakeSnapshot = async () => (await fakeSql`SELECT count(*)::int AS lead_count`)[0]
  const getCached = createInProcessTtlCache(readFakeSnapshot, 5 * 60_000, () => now)

  const [first, overlapping] = await Promise.all([getCached(), getCached()])
  assert.deepEqual(first, { connected: true, lead_count: 1 })
  assert.equal(overlapping, first)
  assert.equal(queryCount, 1)

  now += 5 * 60_000 - 1
  assert.equal(await getCached(), first)
  assert.equal(queryCount, 1)
  now++
  assert.deepEqual(await getCached(), { connected: true, lead_count: 2 })
  assert.equal(queryCount, 2)
})

test("health aggregates use bounded time windows and row limits, preserving the S02 delivery-error gate", () => {
  for (const alias of [
    "lead_count",
    "recent_inbound_call_count",
    "failed_deliveries",
    "call_transcript_backlog",
    "call_transcript_exhausted",
    "voice_transcript_backlog",
    "upload_recovery_backlog",
    "quote_photo_backlog",
    "consent_record_count",
    "call_sketch_error_count",
    "recent_client_errors",
    "recent_test_client_errors",
    // notification_delivery_dead left this query in O17: the dead count now
    // comes from listDeadNotificationRows + summarizeDeadNotifications, which
    // keep the same 1-year window and 10000-row cap.
    "notification_delivery_unknown",
    "message_delivery_unknown",
    "call_delivery_unknown",
  ]) {
    assert.match(HEALTH, new RegExp(`\\) AS ${alias}(?:,|\\s|\\x60)`), `${alias} stays in the health payload`)
  }

  assert.match(HEALTH, /created_at >= now\(\) - interval '1 year'[\s\S]*ORDER BY created_at DESC LIMIT 10000/)
  assert.match(HEALTH, /updated_at >= now\(\) - interval '1 year'[\s\S]*ORDER BY updated_at (?:ASC|DESC) LIMIT 10000/)
  assert.match(HEALTH, /created_at > now\(\) - interval '24 hours'[\s\S]*ORDER BY created_at DESC LIMIT 10000/)
  assert.match(HEALTH, /SELECT call_sid FROM call_sketches[\s\S]*ORDER BY updated_at DESC LIMIT 10000/)
  assert.match(HEALTH, /m\.sent_at >= now\(\) - interval '1 year'[\s\S]*ORDER BY m\.sent_at DESC LIMIT 10000/)
  assert.match(HEALTH, /WHERE job = 'daily-digest' AND ran_at >= now\(\) - interval '1 year'[\s\S]*ORDER BY ran_at DESC LIMIT 1/)
  assert.match(HEALTH, /WHERE job IN \('gmail-ingest', 'morning-brief'\)[\s\S]*ran_at >= now\(\) - interval '1 year'[\s\S]*ORDER BY job, ran_at DESC LIMIT 2/)
  assert.match(HEALTH, /const getCachedDatabase = createInProcessTtlCache\(checkDatabase, 5 \* 60_000\)/)
  assert.match(HEALTH, /getCachedDatabase\(\),/)
  assert.match(HEALTH, /recentDeliveryErrorsHealthy = database\.recentDeliveryErrors\.length === 0/)
  assert.match(HEALTH, /recentDeliveryErrorsHealthy &&/)
})
