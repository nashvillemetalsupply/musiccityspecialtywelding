import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { sendIfClaimed } from "../lib/deferred-sms.mjs"
import { getDeferredSmsSendAt, isCentralQuietHours } from "../lib/sms-quiet-hours.mjs"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n")

test("quiet-hours boundary follows Central wall time on both DST transition days", () => {
  const cases = [
    { label: "spring-forward day", before: "2026-03-09T01:59:00.000Z", at: "2026-03-09T02:00:00.000Z", sendAt: "2026-03-09T13:00:00.000Z" },
    { label: "fall-back day", before: "2026-11-02T02:59:00.000Z", at: "2026-11-02T03:00:00.000Z", sendAt: "2026-11-02T14:00:00.000Z" },
  ]
  for (const scenario of cases) {
    assert.equal(isCentralQuietHours(new Date(scenario.before)), false, `${scenario.label}: 20:59 is allowed`)
    assert.equal(getDeferredSmsSendAt(new Date(scenario.before)), null)
    assert.equal(isCentralQuietHours(new Date(scenario.at)), true, `${scenario.label}: 21:00 is quiet`)
    assert.equal(getDeferredSmsSendAt(new Date(scenario.at)).toISOString(), scenario.sendAt)
  }
})

test("pre-open texts defer to 8 a.m. Central and daytime texts send immediately", () => {
  assert.equal(getDeferredSmsSendAt(new Date("2026-06-15T12:59:00.000Z")).toISOString(), "2026-06-15T13:00:00.000Z")
  assert.equal(getDeferredSmsSendAt(new Date("2026-06-15T13:00:00.000Z")), null)
  assert.equal(getDeferredSmsSendAt(new Date("2026-06-16T01:59:00.000Z")), null)
  assert.equal(getDeferredSmsSendAt(new Date("2026-06-16T02:00:00.000Z")).toISOString(), "2026-06-16T13:00:00.000Z")
})

test("two concurrent deferred claims hand a row to the provider only once", async () => {
  let status = "queued"
  let handoffs = 0
  const claim = async () => {
    if (status !== "queued") return null
    status = "sending"
    return { id: 42 }
  }
  const send = async () => { handoffs += 1 }
  const results = await Promise.all([
    sendIfClaimed(claim, send),
    sendIfClaimed(claim, send),
  ])
  assert.deepEqual(results.sort(), [false, true])
  assert.equal(handoffs, 1, "the losing conditional claim does not call Twilio")
})

test("deferred sends persist first and use one conditional queued-to-sending claim", () => {
  const messages = read("lib/messages.ts")
  const source = messages.slice(messages.indexOf("export async function sendSmsPersisted"), messages.indexOf("/** Never guesses"))
  assert.ok(source.indexOf("INSERT INTO messages") < source.indexOf("sendClaimedSms(claimed[0])"), "intent is saved before the provider handoff helper")
  assert.match(source, /getDeferredSmsSendAt\(/)
  assert.match(messages, /UPDATE messages SET status = 'sending'[\s\S]{0,260}WHERE id = \$\{messageId\}::bigint AND status = 'persisted'/)
  assert.match(messages, /UPDATE messages SET status = 'sending'[\s\S]{0,300}WHERE id = \$\{candidate\.id\}::bigint AND direction = 'out' AND status = 'queued'[\s\S]{0,120}send_after <= now\(\)[\s\S]{0,80}RETURNING/)
  assert.match(messages, /sendIfClaimed\(/)
})

test("due deferred texts run from the existing authorized reminders cron in the Central morning window", () => {
  const route = read("app/api/ops/reminders/route.ts")
  const vercel = JSON.parse(read("vercel.json"))
  assert.match(route, /isAuthorizedCron/)
  assert.match(route, /sendDeferredSms\(/)
  const reminders = vercel.crons.find((cron) => cron.path === "/api/ops/reminders")
  assert.equal(reminders.schedule, "0 14 * * *")
})

test("only owner replies may bypass quiet hours and the result exposes a visible warning", () => {
  const actions = read("app/ops/leads/[id]/message-actions.ts")
  const reply = read("app/ops/leads/[id]/spike-reply.tsx")
  assert.match(actions, /ownerInitiated: operator\.role === "owner"/)
  assert.match(actions, /quietHoursExempt[\s\S]{0,150}Warning:/)
  assert.match(reply, /state\.quietHoursExempt/)
  assert.match(reply, /is-warning/)
})

test("quiet-hour persistence fields are additive and idempotent migration statements", () => {
  const migration = read("scripts/migrate.mjs")
  assert.match(migration, /ALTER TABLE messages ADD COLUMN IF NOT EXISTS send_after TIMESTAMPTZ/)
  assert.match(migration, /ALTER TABLE messages ADD COLUMN IF NOT EXISTS quiet_hours_exempt BOOLEAN NOT NULL DEFAULT false/)
})
