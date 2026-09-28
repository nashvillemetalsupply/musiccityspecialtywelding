import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { createOpsPulseGetHandler, readOpsPulse } from "../lib/ops-pulse.ts"
import {
  OPS_PULSE_ACTIVE_INTERVAL_MS,
  OPS_PULSE_IDLE_INTERVAL_MS,
  OPS_PULSE_REFRESH_MAX_INTERVAL_MS,
  startOpsPulsePolling,
} from "../lib/ops-pulse-polling.ts"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n")

function createFakeSql(rows) {
  const calls = []
  const sql = async (strings, ...values) => {
    const call = { text: strings.reduce((out, part, index) => out + part + (index < values.length ? `$${index + 1}` : ""), ""), values }
    calls.push(call)
    return typeof rows === "function" ? rows(calls.length - 1, call) : rows
  }
  return { sql, calls }
}

function pulseRow(overrides = {}) {
  return {
    event_id: "23",
    events_signature: "events-a",
    calls_updated_at: "2026-09-27T17:59:00.000Z",
    calls_signature: "calls-a",
    call_sketches_updated_at: "2026-09-27T17:58:00.000Z",
    call_sketches_signature: "sketch-a",
    call_transcript_signature: "transcript-a",
    call_drafts_signature: "draft-a",
    unread_notifications: 2,
    notifications_signature: "notifications-a",
    ...overrides,
  }
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

  const { sql, calls } = createFakeSql([pulseRow({ event_id: "9123456789012345678", calls_updated_at: new Date("2026-09-27T18:00:00Z") })])
  const crew = createOpsPulseGetHandler({ getOperator: async () => ({ id: 14, role: "crew" }), getSql: () => sql })
  const response = await crew()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.deepEqual(await response.json(), {
    eventId: "9123456789012345678",
    eventsSignature: "events-a",
    callsUpdatedAt: "2026-09-27T18:00:00.000Z",
    callsSignature: "calls-a",
    callSketchesUpdatedAt: "2026-09-27T17:58:00.000Z",
    callSketchesSignature: "sketch-a",
    callTranscriptSignature: "transcript-a",
    callDraftsSignature: "draft-a",
    unreadNotifications: 2,
    notificationsSignature: "notifications-a",
  })
  assert.equal(calls.length, 1)
  assert.ok(calls[0].values.includes(14))
  assert.match(calls[0].text, /SELECT id::text FROM latest_visible_events[\s\S]*AS calls_updated_at/)
  assert.match(calls[0].text, /ORDER BY e\.id DESC\s+LIMIT 20/)
  assert.match(calls[0].text, /ORDER BY c\.updated_at DESC NULLS LAST, c\.id DESC LIMIT 1/)
  assert.match(calls[0].text, /lower\(e\.kind\) <> ALL\(\$\d+::text\[\]\)/)
  assert.match(calls[0].text, /lower\(e\.kind\) !~ \$\d+::text/)
  assert.match(calls[0].text, /lower\(COALESCE\(e\.detail->>'sensitivity', ''\)\) <> ALL/)
  assert.match(calls[0].text, /l\.is_test/)
  assert.match(calls[0].text, /c\.detail->>'isTest'/)
  assert.match(calls[0].text, /jsonb_build_array\(id, status, duration_sec, updated_at\)/)
  assert.match(calls[0].text, /ORDER BY c\.id DESC\s+LIMIT 20/)
  assert.match(calls[0].text, /jsonb_build_array\(call_sid, status, observed_through_sequence, updated_at\)/)
  assert.match(calls[0].text, /FROM call_live_transcript_items/)
  assert.match(calls[0].text, /jsonb_build_array\(call_sid, status, summary, updated_at\)/)
  assert.match(calls[0].text, /n\.owner_only = false/)
  assert.match(calls[0].text, /jsonb_build_array\(id, kind, body, crew_body, detail, occurred_at, processed_at, extraction_status\)/)
})

test("owner pulse can observe owner-only and internal-test changes without returning other data", async () => {
  const { sql, calls } = createFakeSql([pulseRow()])
  const pulse = await readOpsPulse(sql, "owner", 1)
  assert.deepEqual(pulse, {
    eventId: "23",
    eventsSignature: "events-a",
    callsUpdatedAt: "2026-09-27T17:59:00.000Z",
    callsSignature: "calls-a",
    callSketchesUpdatedAt: "2026-09-27T17:58:00.000Z",
    callSketchesSignature: "sketch-a",
    callTranscriptSignature: "transcript-a",
    callDraftsSignature: "draft-a",
    unreadNotifications: 2,
    notificationsSignature: "notifications-a",
  })
  assert.equal(calls.length, 1)
  assert.ok(calls[0].values.includes("owner"))
  assert.deepEqual(Object.keys(pulse).sort(), [
    "callDraftsSignature", "callSketchesSignature", "callSketchesUpdatedAt", "callTranscriptSignature",
    "callsSignature", "callsUpdatedAt", "eventId", "eventsSignature", "notificationsSignature", "unreadNotifications",
  ])
})

test("pulse changes when a live call sketch upsert advances its visible sequence", async () => {
  const snapshots = [
    pulseRow({ call_sketches_signature: "same-sketch-status-sequence-4", call_sketches_updated_at: "2026-09-27T17:58:00.000Z" }),
    pulseRow({ call_sketches_signature: "same-sketch-status-sequence-5", call_sketches_updated_at: "2026-09-27T17:58:10.000Z" }),
  ]
  const { sql, calls } = createFakeSql(() => [snapshots.shift()])
  const before = await readOpsPulse(sql, "crew", 7)
  const after = await readOpsPulse(sql, "crew", 7)
  assert.equal(before.eventId, after.eventId)
  assert.notEqual(before.callSketchesSignature, after.callSketchesSignature)
  assert.notEqual(before.callSketchesUpdatedAt, after.callSketchesUpdatedAt)
  assert.equal(calls.length, 2)
  assert.match(calls[0].text, /observed_through_sequence/)
  assert.match(calls[0].text, /call_sketches s[\s\S]*ORDER BY s\.updated_at DESC NULLS LAST, s\.call_sid DESC\s+LIMIT 20/)
})

test("pulse changes when call status changes without changing calls.updated_at", async () => {
  const snapshots = [
    pulseRow({ calls_signature: "call-81-ringing-17-seconds" }),
    pulseRow({ calls_signature: "call-81-completed-17-seconds" }),
  ]
  const { sql, calls } = createFakeSql(() => [snapshots.shift()])
  const before = await readOpsPulse(sql, "crew", 7)
  const after = await readOpsPulse(sql, "crew", 7)
  assert.equal(before.callsUpdatedAt, after.callsUpdatedAt)
  assert.notEqual(before.callsSignature, after.callsSignature)
  assert.equal(calls.length, 2)
  assert.match(calls[0].text, /jsonb_build_array\(id, status, duration_sec, updated_at\)/)
  assert.match(calls[0].text, /ORDER BY c\.id DESC\s+LIMIT 20/)
})

test("crew pulse excludes test calls and owner-only notifications before hashing them", async () => {
  const { sql, calls } = createFakeSql([pulseRow()])
  const pulse = await readOpsPulse(sql, "crew", 7)
  assert.match(calls[0].text, /COALESCE\(l\.is_test, false\) = false/)
  assert.match(calls[0].text, /COALESCE\(p\.is_test, false\) = false/)
  assert.match(calls[0].text, /COALESCE\(d\.is_test, false\) = false/)
  assert.match(calls[0].text, /n\.owner_only = false/)
  assert.match(calls[0].text, /lower\(COALESCE\(e\.kind, ''\)\) <> ALL\(\$\d+::text\[\]\)/)
  assert.ok(calls[0].values.some(Array.isArray))
  assert.match(calls[0].text, /%\[INTERNAL TEST\]%/)
  assert.equal(JSON.stringify(pulse).includes("owner-only"), false)
  assert.equal(JSON.stringify(pulse).includes("[INTERNAL TEST]"), false)
})

test("board polls with fake time/fetch, refreshes on pulse changes, and stops polling when hidden", async () => {
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
  assert.equal(fetches.length, 3)
  assert.equal(refreshes, 1)
  assert.deepEqual(clock.pendingDelays, [])
  await clock.advance(60 * 60_000)
  assert.equal(fetches.length, 3)

  doc.visibilityState = "visible"
  doc.dispatch("visibilitychange")
  await clock.flush()
  assert.equal(fetches.length, 4)
  assert.equal(refreshes, 2)
  assert.deepEqual(clock.pendingDelays, [OPS_PULSE_ACTIVE_INTERVAL_MS])
  poller.stop()
  assert.equal(clock.pendingDelays.length, 0)
})

test("a tab hidden for an hour makes no pulse request, then checks immediately when visible", async () => {
  const clock = fakeClock()
  const doc = eventTarget({ visibilityState: "hidden", hasFocus: () => true })
  const win = eventTarget()
  const fetches = []
  const poller = startOpsPulsePolling({
    documentRef: doc,
    windowRef: win,
    timers: clock.timers,
    now: clock.now,
    fetchPulse: async (url, options) => {
      fetches.push({ url, options })
      return { ok: true, json: async () => pulseRow() }
    },
  })
  await clock.flush()
  poller.checkNow()
  await clock.advance(60 * 60_000)
  assert.equal(fetches.length, 0)
  assert.deepEqual(clock.pendingDelays, [])

  doc.visibilityState = "visible"
  doc.dispatch("visibilitychange")
  await clock.flush()
  assert.equal(fetches.length, 1)
  assert.deepEqual(fetches[0], { url: "/api/ops/pulse", options: { cache: "no-store" } })
  assert.deepEqual(clock.pendingDelays, [OPS_PULSE_ACTIVE_INTERVAL_MS])
  poller.stop()
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

test("visible unfocused polling keeps the five-minute idle schedule", async () => {
  const clock = fakeClock()
  const doc = eventTarget({ visibilityState: "visible", hasFocus: () => false })
  const win = eventTarget()
  const poller = startOpsPulsePolling({
    documentRef: doc,
    windowRef: win,
    timers: clock.timers,
    now: clock.now,
    idleActivityWindowMs: 0,
    fetchPulse: async () => ({ ok: true, json: async () => pulseRow() }),
  })
  await clock.flush()
  assert.deepEqual(clock.pendingDelays, [OPS_PULSE_IDLE_INTERVAL_MS])
  poller.stop()
})

test("active foreground refreshes at least every five minutes when every pulse is unchanged", async () => {
  const clock = fakeClock()
  const doc = eventTarget({ visibilityState: "visible", hasFocus: () => true })
  const win = eventTarget()
  let refreshes = 0
  const poller = startOpsPulsePolling({
    documentRef: doc,
    windowRef: win,
    timers: clock.timers,
    now: clock.now,
    fetchPulse: async () => ({ ok: true, json: async () => pulseRow() }),
    onChange: () => { refreshes++ },
  })
  await clock.advance(OPS_PULSE_REFRESH_MAX_INTERVAL_MS - OPS_PULSE_ACTIVE_INTERVAL_MS)
  assert.equal(refreshes, 0)
  await clock.advance(OPS_PULSE_ACTIVE_INTERVAL_MS)
  assert.equal(refreshes, 1)
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
