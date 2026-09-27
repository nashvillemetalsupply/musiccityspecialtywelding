import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { createOpsPulseGetHandler, readOpsPulse } from "../lib/ops-pulse.mjs"
import {
  OPS_PULSE_ACTIVE_INTERVAL_MS,
  OPS_PULSE_IDLE_INTERVAL_MS,
  startOpsPulsePolling,
} from "../lib/ops-pulse-polling.mjs"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n")

function createFakeSql(rows) {
  const calls = []
  const sql = async (strings, ...values) => {
    calls.push({ text: strings.reduce((out, part, index) => out + part + (index < values.length ? `$${index + 1}` : ""), ""), values })
    return rows
  }
  return { sql, calls }
}

function eventTarget(initial = {}) {
  const listeners = new Map()
  return {
    ...initial,
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(listener)
    },
    removeEventListener(name, listener) {
      listeners.get(name)?.delete(listener)
    },
    dispatch(name) {
      for (const listener of listeners.get(name) ?? []) listener({ type: name })
    },
  }
}

function fakeClock() {
  let now = 0
  let nextId = 1
  const tasks = new Map()
  const timers = {
    setTimeout(callback, delay) {
      const id = nextId++
      tasks.set(id, { at: now + delay, callback })
      return id
    },
    clearTimeout(id) {
      tasks.delete(id)
    },
  }
  async function flush() {
    for (let index = 0; index < 12; index++) await Promise.resolve()
  }
  return {
    timers,
    now: () => now,
    async advance(milliseconds) {
      const target = now + milliseconds
      while (true) {
        const next = [...tasks.entries()].filter(([, task]) => task.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        const [id, task] = next
        tasks.delete(id)
        now = task.at
        task.callback()
        await flush()
      }
      now = target
      await flush()
    },
    get pendingDelays() {
      return [...tasks.values()].map((task) => task.at - now)
    },
    flush,
  }
}

test("pulse endpoint requires an owner or crew session before running one aggregate-only SQL read", async () => {
  let sqlCalls = 0
  const anonymous = createOpsPulseGetHandler({ getOperator: async () => null, getSql: () => async () => { sqlCalls++; return [] } })
  const unauthorized = await anonymous()
  assert.equal(unauthorized.status, 401)
  assert.equal(sqlCalls, 0)

  const invalidRole = createOpsPulseGetHandler({ getOperator: async () => ({ role: "guest" }), getSql: () => async () => { sqlCalls++; return [] } })
  assert.equal((await invalidRole()).status, 401)
  assert.equal(sqlCalls, 0)

  const { sql, calls } = createFakeSql([{ event_id: "9123456789012345678", calls_updated_at: new Date("2026-09-27T18:00:00Z") }])
  const crew = createOpsPulseGetHandler({ getOperator: async () => ({ role: "crew" }), getSql: () => sql })
  const response = await crew()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.deepEqual(await response.json(), { eventId: "9123456789012345678", callsUpdatedAt: "2026-09-27T18:00:00.000Z" })
  assert.equal(calls.length, 1)
  assert.match(calls[0].text, /SELECT e\.id::text[\s\S]*SELECT c\.updated_at/)
  assert.match(calls[0].text, /ORDER BY e\.id DESC LIMIT 1/)
  assert.match(calls[0].text, /ORDER BY c\.updated_at DESC NULLS LAST, c\.id DESC LIMIT 1/)
  assert.match(calls[0].text, /lower\(e\.kind\) <> ALL\(\$\d+::text\[\]\)/)
  assert.match(calls[0].text, /lower\(e\.kind\) !~ \$\d+::text/)
  assert.match(calls[0].text, /lower\(COALESCE\(e\.detail->>'sensitivity', ''\)\) <> ALL/)
  assert.match(calls[0].text, /l\.is_test/)
  assert.match(calls[0].text, /c\.detail->>'isTest'/)
})

test("owner pulse can observe owner-only and internal-test changes without returning other data", async () => {
  const { sql, calls } = createFakeSql([{ event_id: "23", calls_updated_at: "2026-09-27T17:59:00.000Z" }])
  const pulse = await readOpsPulse(sql, "owner")
  assert.deepEqual(pulse, { eventId: "23", callsUpdatedAt: "2026-09-27T17:59:00.000Z" })
  assert.equal(calls.length, 1)
  assert.doesNotMatch(calls[0].text, /JOIN|is_test|OWNER_ONLY/)
  assert.deepEqual(Object.keys(pulse).sort(), ["callsUpdatedAt", "eventId"])
})

test("board polls with fake time/fetch, refreshes only on pulse changes, and backs off when hidden", async () => {
  const clock = fakeClock()
  const doc = eventTarget({ visibilityState: "visible", hasFocus: () => true })
  const win = eventTarget()
  const responses = [
    { eventId: "1", callsUpdatedAt: null },
    { eventId: "1", callsUpdatedAt: null },
    { eventId: "2", callsUpdatedAt: null },
    { eventId: "3", callsUpdatedAt: null },
    { eventId: "3", callsUpdatedAt: null },
  ]
  const fetches = []
  let refreshes = 0
  const poller = startOpsPulsePolling({
    documentRef: doc,
    windowRef: win,
    timers: clock.timers,
    now: clock.now,
    fetchPulse: async (url, options) => {
      fetches.push({ url, options })
      const pulse = responses.shift() ?? { eventId: "3", callsUpdatedAt: null }
      return { ok: true, json: async () => pulse }
    },
    onChange: () => { refreshes++ },
  })
  await clock.flush()
  assert.equal(fetches.length, 1)
  assert.equal(refreshes, 0)
  assert.deepEqual(fetches[0], { url: "/api/ops/pulse", options: { cache: "no-store" } })
  assert.deepEqual(clock.pendingDelays, [OPS_PULSE_ACTIVE_INTERVAL_MS])

  await clock.advance(OPS_PULSE_ACTIVE_INTERVAL_MS - 1)
  assert.equal(fetches.length, 1)
  await clock.advance(1)
  assert.equal(fetches.length, 2)
  assert.equal(refreshes, 0)
  await clock.advance(OPS_PULSE_ACTIVE_INTERVAL_MS)
  assert.equal(fetches.length, 3)
  assert.equal(refreshes, 1)

  doc.visibilityState = "hidden"
  doc.dispatch("visibilitychange")
  await clock.flush()
  assert.equal(fetches.length, 4)
  assert.equal(refreshes, 1)
  assert.deepEqual(clock.pendingDelays, [OPS_PULSE_IDLE_INTERVAL_MS])
  await clock.advance(OPS_PULSE_IDLE_INTERVAL_MS - 1)
  assert.equal(fetches.length, 4)
  await clock.advance(1)
  assert.equal(fetches.length, 5)
  assert.equal(refreshes, 1)

  doc.visibilityState = "visible"
  doc.dispatch("visibilitychange")
  await clock.flush()
  assert.equal(refreshes, 2)
  poller.stop()
  assert.equal(clock.pendingDelays.length, 0)
})

test("foreground focused polling remains ten seconds even without recent pointer activity", async () => {
  const clock = fakeClock()
  const doc = eventTarget({ visibilityState: "visible", hasFocus: () => true })
  const win = eventTarget()
  const poller = startOpsPulsePolling({
    documentRef: doc,
    windowRef: win,
    timers: clock.timers,
    now: clock.now,
    fetchPulse: async () => ({ ok: true, json: async () => ({ eventId: "1", callsUpdatedAt: null }) }),
  })
  await clock.advance(OPS_PULSE_ACTIVE_INTERVAL_MS)
  await clock.advance(OPS_PULSE_ACTIVE_INTERVAL_MS)
  assert.deepEqual(clock.pendingDelays, [OPS_PULSE_ACTIVE_INTERVAL_MS])
  poller.stop()
})

test("visible board and operations shells share pulse polling, and job metadata shares the cached lead load", () => {
  const board = source("app/board/board.tsx")
  const opsLive = source("app/ops/ops-live.tsx")
  const job = source("app/ops/leads/[id]/page.tsx")
  assert.match(board, /startOpsPulsePolling\(/)
  assert.doesNotMatch(board, /setInterval\(tick, onTheLine/)
  assert.match(opsLive, /startOpsPulsePolling\(/)
  assert.match(opsLive, /serviceWorkerMessage[\s\S]*checkNow\(\)/)
  assert.match(job, /import \{ cache \} from "react"/)
  assert.match(job, /const getCachedLead = cache\(/)
  assert.equal((job.match(/getCachedLead\(leadId, operator\.role\)/g) ?? []).length, 2)
  assert.match(job, /generateMetadata[\s\S]*getCachedLead\(leadId, operator\.role\)/)
})
