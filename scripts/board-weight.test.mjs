import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  BOARD_WEIGHTS, signalWeight, scoreBoardJob, isBoardJobHot,
} from "../lib/shop-brain-invariants.mjs"
import {
  aggregateNeedFromCandidates,
  boardSignalsFromCandidates,
  orderBoardFixtures,
  sqlScoreParity,
} from "../lib/ops-data-testkit.mjs"

// Mirrors the five UNION ALL branches of the candidates CTE. If the SQL below
// changes, this fixture changes with it and the parity test fails loudly.
const CANDIDATES = [
  { lead_id: 1, kind: "waiting", reason: "Customer email waiting", hours_late: 6, priority: 0, waiting_since: "2026-08-19T00:00:00.000Z" },
  { lead_id: 1, kind: "promise", reason: "Promise overdue", hours_late: 72, priority: 1, waiting_since: "2026-08-16T00:00:00.000Z" },
  { lead_id: 2, kind: "followup", reason: "Follow-up due", hours_late: 48, priority: 2, waiting_since: "2026-08-17T00:00:00.000Z" },
]
const OPS_DATA_SOURCE = readFileSync(new URL("../lib/ops-data.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")

test("a signal one hour late counts just over its base", () => {
  const w = signalWeight("waiting", 1)
  assert.ok(w > 50 && w < 53, `expected just over 50, got ${w}`)
})

test("lateness caps at three times base", () => {
  assert.equal(signalWeight("promise", 40 * 24), 45 * 3)
  assert.equal(signalWeight("promise", 400 * 24), 45 * 3)
})

test("a signal that is not yet due counts its base once, never less", () => {
  assert.equal(signalWeight("followup", 0), 20)
  assert.equal(signalWeight("followup", -50), 20)
})

test("an unknown signal kind scores nothing rather than throwing", () => {
  assert.equal(signalWeight("wat", 10), 0)
})

test("value and repeat both cap", () => {
  assert.equal(scoreBoardJob({ valueCents: 200000000, priorJobs: 0 }), 30)
  assert.equal(scoreBoardJob({ valueCents: 0, priorJobs: 40 }), 30)
})

test("a job with nothing outstanding scores zero and is not hot", () => {
  const score = scoreBoardJob({ signals: [], valueCents: 0, priorJobs: 0 })
  assert.equal(score, 0)
  assert.equal(isBoardJobHot(score), false)
})

test("the Real Floors case outranks the quiet handrail", () => {
  const realFloors = scoreBoardJob({
    signals: [
      { kind: "promise", hoursLate: 72 },
      { kind: "waiting", hoursLate: 6 },
    ],
    valueCents: 448500,
    priorJobs: 7,
  })
  const handrail = scoreBoardJob({
    signals: [{ kind: "followup", hoursLate: 48 }],
    valueCents: 64000,
    priorJobs: 1,
  })
  assert.ok(realFloors > handrail, `${realFloors} should beat ${handrail}`)
  assert.equal(isBoardJobHot(realFloors), true)
  assert.equal(isBoardJobHot(handrail), false)
})

test("weights are frozen so nothing can drift them at runtime", () => {
  assert.throws(() => { BOARD_WEIGHTS.hotThreshold = 1 }, TypeError)
})

test("the aggregate keeps every signal, heaviest first", () => {
  const signals = boardSignalsFromCandidates(CANDIDATES.filter((candidate) => candidate.lead_id === 1))
  assert.equal(signals.length, 2)
  assert.equal(signals[0].kind, "promise")
  assert.equal(signals[1].kind, "waiting")
})

test("board_reason and board_since still match DISTINCT ON", () => {
  const rows = CANDIDATES.filter((candidate) => candidate.lead_id === 1)
  const legacy = rows.slice().sort((a, b) =>
    a.priority - b.priority || a.waiting_since.localeCompare(b.waiting_since)
  )[0]
  const aggregate = aggregateNeedFromCandidates(rows)
  assert.equal(aggregate.reason, legacy.reason)
  assert.equal(aggregate.waitingSince, legacy.waiting_since)
  assert.ok(OPS_DATA_SOURCE.includes(`CASE
          WHEN l.completed_at IS NOT NULL THEN 'ready'
          WHEN n.lead_id IS NOT NULL THEN 'attention'
          WHEN l.work_started_at IS NOT NULL OR l.status = 'won' THEN 'shop'
          ELSE 'waiting'
        END AS board_stage`))
  assert.ok(OPS_DATA_SOURCE.includes(`CASE
          WHEN l.completed_at IS NOT NULL AND l.review_received THEN 'Review received'
          WHEN l.completed_at IS NOT NULL AND l.review_requested_at IS NOT NULL THEN 'Review requested'
          WHEN l.completed_at IS NOT NULL THEN 'Ready for customer'
          WHEN n.lead_id IS NOT NULL THEN n.reason
          WHEN l.work_started_at IS NOT NULL THEN 'Work underway'
          WHEN l.status = 'won' THEN 'Booked'
          WHEN l.status = 'quoted' THEN 'Quote sent'
          WHEN l.status = 'qualified' THEN 'Pricing next'
          WHEN l.status = 'contacted' THEN 'Customer contacted'
          ELSE 'Waiting'
        END AS board_reason`))
})

test("stage order remains the default and keeps every legacy ordering key", () => {
  assert.match(OPS_DATA_SOURCE, /const order: BoardJobOrder = options\.order === "weight" \? "weight" : options\.order === "oldest" \? "oldest" : options\.order === "newest" \? "newest" : "stage"/)
  assert.match(OPS_DATA_SOURCE, /CASE WHEN \$\{order\}::text = 'stage' THEN\s+CASE f\.board_stage WHEN 'attention' THEN 0 WHEN 'shop' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END/)
  assert.match(OPS_DATA_SOURCE, /CASE WHEN \$\{order\}::text = 'stage' AND f\.board_stage = 'attention' THEN f\.board_since END ASC NULLS LAST,\s+CASE WHEN \$\{order\}::text = 'stage' THEN f\.updated_at END DESC NULLS LAST,\s+f\.id DESC/)
})

test("oldest order is global longest-waiting-first before pagination", () => {
  assert.match(OPS_DATA_SOURCE, /CASE WHEN \$\{order\}::text = 'oldest' THEN f\.board_since END ASC NULLS LAST/)
  const jobs = [
    { id: 10, boardStage: "ready", boardSince: "2026-08-18", updatedAt: "2026-08-19", signals: [], valueCents: 0, priorJobs: 0 },
    { id: 12, boardStage: "waiting", boardSince: "2026-08-10", updatedAt: "2026-08-11", signals: [], valueCents: 0, priorJobs: 0 },
    { id: 11, boardStage: "attention", boardSince: "2026-08-10", updatedAt: "2026-08-12", signals: [], valueCents: 0, priorJobs: 0 },
    { id: 13, boardStage: "shop", boardSince: null, updatedAt: "2026-08-09", signals: [], valueCents: 0, priorJobs: 0 },
  ]
  assert.deepEqual(orderBoardFixtures(jobs, "oldest"), [12, 11, 10, 13])
})

test("newest order is created_at DESC before pagination, and is what the board asks for", () => {
  assert.match(OPS_DATA_SOURCE, /CASE WHEN \$\{order\}::text = 'newest' THEN f\.created_at END DESC NULLS LAST/)
  const PAGE_SOURCE = readFileSync(new URL("../app/board/page.tsx", import.meta.url), "utf8")
  assert.match(PAGE_SOURCE, /listBoardJobs\(\{ stage, signal, order: "newest", query, includeTests, page: requestedPage \}, role\)/)
  const jobs = [
    { id: 10, boardStage: "ready", boardSince: "2026-08-18", createdAt: "2026-08-01", updatedAt: "2026-08-19", signals: [], valueCents: 0, priorJobs: 0 },
    { id: 12, boardStage: "waiting", boardSince: "2026-08-10", createdAt: "2026-08-03", updatedAt: "2026-08-11", signals: [], valueCents: 0, priorJobs: 0 },
    { id: 11, boardStage: "attention", boardSince: "2026-08-10", createdAt: "2026-08-03", updatedAt: "2026-08-12", signals: [], valueCents: 0, priorJobs: 0 },
    { id: 13, boardStage: "shop", boardSince: null, createdAt: null, updatedAt: "2026-08-09", signals: [], valueCents: 0, priorJobs: 0 },
  ]
  assert.deepEqual(orderBoardFixtures(jobs, "newest"), [12, 11, 10, 13])
})

test("the tracker leads the board: first card in main, and there is no pane", () => {
  const BOARD_SOURCE = readFileSync(new URL("../app/board/board.tsx", import.meta.url), "utf8")
  const main = BOARD_SOURCE.indexOf('<main className="main">')
  const tracker = BOARD_SOURCE.indexOf('<div className="track-top">')
  const call = BOARD_SOURCE.indexOf('<div className="call-top">')
  const figures = BOARD_SOURCE.indexOf('<section className="card figures">')
  // Figures lead as a thin strip (owner, 2026-09-03), then the calls slot,
  // then the tracker, then the live call sketch.
  const slot = BOARD_SOURCE.indexOf("{calls}")
  assert.ok(main > -1 && main < figures && figures < slot && slot < tracker && tracker < call,
    `expected main < figures < calls slot < tracker < call, got ${[main, figures, slot, tracker, call]}`)
  assert.doesNotMatch(BOARD_SOURCE, /<aside className="pane">/)
  assert.doesNotMatch(BOARD_SOURCE, /<h4>The week<\/h4>/)
  assert.doesNotMatch(BOARD_SOURCE, /<h3 className="t-sub">Today<\/h3>/)
  assert.doesNotMatch(BOARD_SOURCE, /need you/)
  assert.doesNotMatch(BOARD_SOURCE, /<h3 className="t-sub">Promises<\/h3>/)
  assert.doesNotMatch(BOARD_SOURCE, /<h4>Needs you<\/h4>/)
  assert.match(BOARD_SOURCE, /Newest first/)
  const CSS = readFileSync(new URL("../app/board/board.css", import.meta.url), "utf8")
  assert.doesNotMatch(CSS, /\.main>\.card:has\(\.track-top\)\{order:/)
  assert.match(CSS, /grid-template-columns:56px minmax\(0,1fr\);/)
  assert.doesNotMatch(CSS, /\.pane\{/)
  assert.match(CSS, /\.tabs\{display:flex;flex-wrap:wrap;/)
})

test("ten jobs keep exact legacy order and get exact weighted order", () => {
  const jobs = [
    { id: 101, boardStage: "attention", boardSince: "2026-08-10", updatedAt: "2026-08-18", signals: [{ kind: "waiting", hoursLate: 24 }], valueCents: 0, priorJobs: 0 },
    { id: 102, boardStage: "attention", boardSince: "2026-08-11", updatedAt: "2026-08-19", signals: [{ kind: "noreply", hoursLate: 10 }], valueCents: 0, priorJobs: 0 },
    { id: 103, boardStage: "attention", boardSince: "2026-08-12", updatedAt: "2026-08-17", signals: [{ kind: "followup", hoursLate: 48 }], valueCents: 64000, priorJobs: 1 },
    { id: 104, boardStage: "attention", boardSince: "2026-08-18", updatedAt: "2026-08-16", signals: [{ kind: "promise", hoursLate: 72 }, { kind: "waiting", hoursLate: 6 }], valueCents: 448500, priorJobs: 7 },
    { id: 201, boardStage: "shop", boardSince: "2026-08-15", updatedAt: "2026-08-18", signals: [], valueCents: 1000000, priorJobs: 0 },
    { id: 202, boardStage: "shop", boardSince: "2026-08-14", updatedAt: "2026-08-19", signals: [], valueCents: 190000, priorJobs: 2 },
    { id: 301, boardStage: "waiting", boardSince: "2026-08-16", updatedAt: "2026-08-18", signals: [{ kind: "bounced", hoursLate: 0 }], valueCents: 0, priorJobs: 0 },
    { id: 302, boardStage: "waiting", boardSince: "2026-08-17", updatedAt: "2026-08-19", signals: [], valueCents: 100000, priorJobs: 1 },
    { id: 401, boardStage: "ready", boardSince: "2026-08-19", updatedAt: "2026-08-18", signals: [], valueCents: 0, priorJobs: 0 },
    { id: 402, boardStage: "ready", boardSince: "2026-08-18", updatedAt: "2026-08-19", signals: [], valueCents: 0, priorJobs: 0 },
  ]
  assert.deepEqual(orderBoardFixtures(jobs, "stage"), [101, 102, 103, 104, 202, 201, 302, 301, 402, 401])
  assert.deepEqual(orderBoardFixtures(jobs, "weight"), [104, 101, 102, 103, 202, 201, 301, 302, 402, 401])
})

test("SQL arithmetic and scoreBoardJob agree on every fixture", () => {
  for (const job of [
    { signals: [{ kind: "promise", hoursLate: 72 }, { kind: "waiting", hoursLate: 6 }], valueCents: 448500, priorJobs: 7 },
    { signals: [{ kind: "noreply", hoursLate: 2.5 }], valueCents: 0, priorJobs: 0 },
    { signals: [], valueCents: 190000, priorJobs: 2 },
    { signals: [], valueCents: -1000, priorJobs: 0 },
  ]) {
    assert.equal(sqlScoreParity(job), scoreBoardJob(job), JSON.stringify(job))
  }
})
