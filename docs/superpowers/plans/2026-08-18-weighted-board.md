# Weighted Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Order the `/ops` board by a deterministic weight that sees every live signal, how late each one is, the money on the job, and the customer's history — instead of stage buckets tie-broken by age.

**Architecture:** Weights are defined once in `lib/shop-brain-invariants.mjs` and interpolated into the existing `listBoardJobs` query as parameters. The `candidates` CTE gains a per-row weight; the `needs` CTE stops collapsing with `DISTINCT ON` and aggregates instead, so every signal survives while `board_reason` stays byte-identical. The new ordering ships behind `/ops?board=v2` and runs beside today's board until a dated cutover.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Neon serverless Postgres (`@neondatabase/serverless` tagged templates), `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-18-weighted-board-design.md`

## Global Constraints

- **No schema change.** `scripts/migrate.mjs` is not touched. Nothing runs against the shared Neon database. Every input already exists on `leads`, `events`, and `commitments`.
- **Additive only.** No column, type, or export is renamed or removed. `board_reason` and `board_stage` keep their exact current values and semantics — today's board must keep working unchanged through the whole parallel-run window.
- **Cast every SQL parameter** (`::int`, `::bigint`, `::numeric`, `::boolean`, `::text`). Untyped params in `CASE` or boolean contexts throw `42P18`.
- **Weights are defined exactly once**, in `BOARD_WEIGHTS`. SQL receives them as parameters and never restates a number.
- **No LLM anywhere in this path.** Scoring is deterministic SQL and pure JS.
- **`is_test` / `[INTERNAL TEST]` filtering is untouched** and applies before scoring.
- **Test convention:** `scripts/*.test.mjs`, run under `node --test`, registered in the `test:shop-brain` npm script.

## File Structure

| File | Responsibility |
|---|---|
| `lib/shop-brain-invariants.mjs` (modify) | `BOARD_WEIGHTS`, `signalWeight`, `scoreBoardJob`, `isBoardJobHot`. Pure, no imports, no I/O — matches how the rest of this file already works. |
| `lib/shop-brain-invariants.d.mts` (modify) | Type declarations for the four new exports. |
| `scripts/board-weight.test.mjs` (create) | Scoring arithmetic, caps, SQL/JS parity, `board_reason` regression. |
| `lib/ops-data.ts` (modify, ~lines 140–295) | `candidates` weight columns, `needs` aggregate, `board` score columns, `order` option, `BoardSignal` + `BoardJobRow` types. |
| `app/ops/page.tsx` (modify, ~line 194) | Read `?board=v2` server-side, pass `order`, choose the component. |
| `app/ops/weighted-job-index.tsx` (create) | v2 board. Renders the signal stack. Styling is deliberately minimal — the visual treatment is a separate thread. |
| `package.json` (modify) | Add the new test file to `test:shop-brain`. |

---

### Task 1: Weight constants and the pure scorer

**Files:**
- Modify: `lib/shop-brain-invariants.mjs`
- Modify: `lib/shop-brain-invariants.d.mts`
- Create: `scripts/board-weight.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `BOARD_WEIGHTS` — frozen config object
  - `signalWeight(kind: string, hoursLate: number, weights?): number`
  - `scoreBoardJob({ signals, valueCents, priorJobs }, weights?): number` — returns a rounded integer
  - `isBoardJobHot(score: number, weights?): boolean`

- [ ] **Step 1: Write the failing test**

Create `scripts/board-weight.test.mjs`:

```js
import test from "node:test"
import assert from "node:assert/strict"
import {
  BOARD_WEIGHTS, signalWeight, scoreBoardJob, isBoardJobHot,
} from "../lib/shop-brain-invariants.mjs"

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/board-weight.test.mjs`
Expected: FAIL — `SyntaxError: The requested module does not provide an export named 'BOARD_WEIGHTS'`

- [ ] **Step 3: Write the implementation**

Append to `lib/shop-brain-invariants.mjs`:

```js
// Board weighting. These numbers are the single definition — lib/ops-data.ts
// interpolates them into SQL as parameters rather than restating them, so the
// query and scoreBoardJob() can never disagree about what a promise is worth.
export const BOARD_WEIGHTS = Object.freeze({
  signal: Object.freeze({
    waiting:  50,   // unanswered inbound: sms.in / email.in / call.missed / glass.uploaded
    noreply:  60,   // first_response_at IS NULL — speed to lead
    promise:  45,   // commitments.due_at < now()
    followup: 20,   // leads.next_follow_up_at <= now()
    bounced:  25,   // email_delivery_status = 'failed'
  }),
  latenessCapMultiple: 3,
  latenessHalfLifeHours: 24,
  valueDivisorCents: 20000,
  valueCapPoints: 30,
  repeatPointsPerPriorJob: 10,
  repeatCapPoints: 30,
  hotThreshold: 100,
})

export function signalWeight(kind, hoursLate, weights = BOARD_WEIGHTS) {
  const base = weights.signal[kind]
  if (!base) return 0
  const late = Math.max(0, Number(hoursLate) || 0)
  const multiple = Math.min(
    weights.latenessCapMultiple,
    1 + late / weights.latenessHalfLifeHours,
  )
  return base * multiple
}

export function scoreBoardJob(job, weights = BOARD_WEIGHTS) {
  const signals = Array.isArray(job?.signals) ? job.signals : []
  let total = 0
  for (const signal of signals) {
    total += signalWeight(signal?.kind, signal?.hoursLate, weights)
  }
  const cents = Math.max(0, Number(job?.valueCents) || 0)
  total += Math.min(weights.valueCapPoints, cents / weights.valueDivisorCents)
  const prior = Math.max(0, Number(job?.priorJobs) || 0)
  total += Math.min(weights.repeatCapPoints, prior * weights.repeatPointsPerPriorJob)
  return Math.round(total)
}

export function isBoardJobHot(score, weights = BOARD_WEIGHTS) {
  return Number(score) >= weights.hotThreshold
}
```

Append to `lib/shop-brain-invariants.d.mts`:

```ts
export type BoardSignalKind = "waiting" | "noreply" | "promise" | "followup" | "bounced"

export type BoardWeights = {
  signal: Record<BoardSignalKind, number>
  latenessCapMultiple: number
  latenessHalfLifeHours: number
  valueDivisorCents: number
  valueCapPoints: number
  repeatPointsPerPriorJob: number
  repeatCapPoints: number
  hotThreshold: number
}

export const BOARD_WEIGHTS: Readonly<BoardWeights>

export function signalWeight(kind: string, hoursLate: number, weights?: BoardWeights): number

export function scoreBoardJob(
  job: { signals?: { kind: string; hoursLate: number }[]; valueCents?: number; priorJobs?: number },
  weights?: BoardWeights,
): number

export function isBoardJobHot(score: number, weights?: BoardWeights): boolean
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/board-weight.test.mjs`
Expected: PASS, 8 tests.

Note: the frozen-object test relies on ES module strict mode, where assigning to a frozen property throws `TypeError`. `.mjs` files are always strict, so this holds.

- [ ] **Step 5: Register the test**

In `package.json`, add `scripts/board-weight.test.mjs` to the end of the `test:shop-brain` file list.

Run: `npm run test:shop-brain`
Expected: the whole suite passes, including the new file.

- [ ] **Step 6: Commit**

```bash
git add lib/shop-brain-invariants.mjs lib/shop-brain-invariants.d.mts scripts/board-weight.test.mjs package.json
git commit -m "feat(board): weight constants and pure scorer"
```

---

### Task 2: Keep every signal and score in SQL

**Files:**
- Modify: `lib/ops-data.ts` — types at lines 18–27, `listBoardJobs` at lines 140–295
- Modify: `scripts/board-weight.test.mjs` — add the parity and regression tests

**Interfaces:**
- Consumes: `BOARD_WEIGHTS`, `scoreBoardJob` from Task 1.
- Produces:
  - `export type BoardSignal = { kind: BoardSignalKind; reason: string; hoursLate: number; weight: number }`
  - `BoardJobRow` gains `board_signals: BoardSignal[]`, `board_score: number`, `board_hot: boolean`
  - `listBoardJobs(options & { order?: "stage" | "weight" }, role)` — `order` defaults to `"stage"`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/board-weight.test.mjs`:

```js
import { boardSignalsFromCandidates, sqlScoreParity } from "../lib/ops-data-testkit.mjs"

// Mirrors the five UNION ALL branches of the candidates CTE. If the SQL below
// changes, this fixture changes with it and the parity test fails loudly.
const CANDIDATES = [
  { lead_id: 1, kind: "waiting",  reason: "Customer email waiting", hours_late: 6,  priority: 0 },
  { lead_id: 1, kind: "promise",  reason: "Promise overdue",        hours_late: 72, priority: 1 },
  { lead_id: 2, kind: "followup", reason: "Follow-up due",          hours_late: 48, priority: 2 },
]

test("the aggregate keeps every signal, heaviest first", () => {
  const signals = boardSignalsFromCandidates(CANDIDATES.filter((c) => c.lead_id === 1))
  assert.equal(signals.length, 2)
  assert.equal(signals[0].kind, "promise")   // 45 x 3 = 135 beats 50 x 1.25
  assert.equal(signals[1].kind, "waiting")
})

test("board_reason still picks what DISTINCT ON would have picked", () => {
  // DISTINCT ON ordered by (priority, waiting_since ASC) — lowest priority wins.
  const rows = CANDIDATES.filter((c) => c.lead_id === 1)
  const legacy = rows.slice().sort((a, b) => a.priority - b.priority)[0].reason
  assert.equal(legacy, "Customer email waiting")
})

test("SQL arithmetic and scoreBoardJob agree on every fixture", () => {
  for (const job of [
    { signals: [{ kind: "promise", hoursLate: 72 }, { kind: "waiting", hoursLate: 6 }], valueCents: 448500, priorJobs: 7 },
    { signals: [{ kind: "noreply", hoursLate: 2.5 }], valueCents: 0, priorJobs: 0 },
    { signals: [], valueCents: 190000, priorJobs: 2 },
  ]) {
    assert.equal(sqlScoreParity(job), scoreBoardJob(job), JSON.stringify(job))
  }
})
```

Create `lib/ops-data-testkit.mjs` — a pure mirror of the SQL arithmetic, so the
parity test proves the query and the scorer agree without needing a database:

```js
import { BOARD_WEIGHTS, signalWeight } from "./shop-brain-invariants.mjs"

// Mirrors: jsonb_agg(... ORDER BY weight DESC) in the needs CTE.
export function boardSignalsFromCandidates(rows, weights = BOARD_WEIGHTS) {
  return rows
    .map((r) => ({
      kind: r.kind,
      reason: r.reason,
      hoursLate: r.hours_late,
      weight: signalWeight(r.kind, r.hours_late, weights),
    }))
    .sort((a, b) => b.weight - a.weight)
}

// Mirrors: round(signal_weight + value_points + repeat_points)::int in board.
export function sqlScoreParity(job, weights = BOARD_WEIGHTS) {
  const signalWeightTotal = (job.signals ?? [])
    .reduce((n, s) => n + signalWeight(s.kind, s.hoursLate, weights), 0)
  const valuePoints = Math.min(weights.valueCapPoints, (job.valueCents ?? 0) / weights.valueDivisorCents)
  const repeatPoints = Math.min(weights.repeatCapPoints, (job.priorJobs ?? 0) * weights.repeatPointsPerPriorJob)
  return Math.round(signalWeightTotal + valuePoints + repeatPoints)
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/board-weight.test.mjs`
Expected: FAIL — `Cannot find module '../lib/ops-data-testkit.mjs'`

- [ ] **Step 3: Add the testkit, then run again**

Create the file as written in Step 1.

Run: `node --test scripts/board-weight.test.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 4: Add the types to `lib/ops-data.ts`**

```ts
import { BOARD_WEIGHTS } from "@/lib/shop-brain-invariants.mjs"
import type { BoardSignalKind } from "@/lib/shop-brain-invariants.mjs"

export type BoardSignal = {
  kind: BoardSignalKind
  reason: string
  hoursLate: number
  weight: number
}

export type BoardJobOrder = "stage" | "weight"
```

Extend `BoardJobRow` (line 19) with three additive fields:

```ts
export type BoardJobRow = LeadRow & {
  board_stage: Exclude<JobBoardStage, "board">
  board_reason: string
  board_since: string
  board_signals: BoardSignal[]
  board_score: number
  board_hot: boolean
}
```

- [ ] **Step 5: Give every candidate a kind, an age, and a weight**

In `listBoardJobs`, bind the weights above the query:

```ts
const order: BoardJobOrder = options.order === "weight" ? "weight" : "stage"
const w = BOARD_WEIGHTS
const cap = w.latenessCapMultiple
const half = w.latenessHalfLifeHours
```

Each of the five `candidates` branches gains three columns. Pattern, shown for
the two that matter most — apply the same shape to `followup`, `noreply` and
`bounced`:

```sql
-- unanswered inbound
SELECT c.lead_id,
  CASE ( ... existing kind lookup, unchanged ... ) END AS reason,
  c.inbound_at AS waiting_since,
  0 AS priority,
  'waiting'::text AS kind,
  GREATEST(0, EXTRACT(EPOCH FROM (now() - c.inbound_at)) / 3600.0) AS hours_late,
  ${w.signal.waiting}::numeric * LEAST(
    ${cap}::numeric,
    1 + GREATEST(0, EXTRACT(EPOCH FROM (now() - c.inbound_at)) / 3600.0) / ${half}::numeric
  ) AS weight
FROM comms c
WHERE c.inbound_at <= now() - interval '30 minutes'
  AND (c.outbound_at IS NULL OR c.outbound_at < c.inbound_at)

UNION ALL

-- promise overdue
SELECT c.lead_id, 'Promise overdue'::text, c.due_at, 1,
  'promise'::text,
  GREATEST(0, EXTRACT(EPOCH FROM (now() - c.due_at)) / 3600.0),
  ${w.signal.promise}::numeric * LEAST(
    ${cap}::numeric,
    1 + GREATEST(0, EXTRACT(EPOCH FROM (now() - c.due_at)) / 3600.0) / ${half}::numeric
  )
FROM commitments c WHERE c.status = 'open' AND c.due_at < now()
```

`GREATEST(0, ...)` is the SQL half of the "not yet due counts its base once"
rule that Task 1 tested — a future `due_at` must not produce a negative.

- [ ] **Step 6: Replace `DISTINCT ON` with an aggregate**

```sql
, needs AS (
  SELECT lead_id,
    jsonb_agg(jsonb_build_object(
      'kind', kind, 'reason', reason,
      'hoursLate', round(hours_late::numeric, 2), 'weight', round(weight::numeric, 2)
    ) ORDER BY weight DESC, priority ASC) AS signals,
    sum(weight) AS signal_weight,
    min(waiting_since) AS waiting_since,
    (array_agg(reason ORDER BY priority ASC, waiting_since ASC))[1] AS reason
  FROM candidates
  GROUP BY lead_id
)
```

The `array_agg(... ORDER BY priority, waiting_since ASC)[1]` reproduces exactly
what `DISTINCT ON (lead_id) ... ORDER BY lead_id, priority, waiting_since ASC`
selected. `board_reason` therefore does not change and today's board is
unaffected.

- [ ] **Step 7: Score the board rows**

In the `board` CTE, alongside `board_stage` / `board_reason` / `board_since`:

```sql
COALESCE(n.signals, '[]'::jsonb) AS board_signals,
round(
  COALESCE(n.signal_weight, 0)
  + LEAST(${w.valueCapPoints}::numeric,
      COALESCE(l.invoice_total_cents, l.estimate_value_cents, 0)::numeric / ${w.valueDivisorCents}::numeric)
  + LEAST(${w.repeatCapPoints}::numeric,
      COALESCE(pc.prior_jobs, 0)::numeric * ${w.repeatPointsPerPriorJob}::numeric)
)::int AS board_score
```

`pc` is a new `LEFT JOIN` supplying the repeat count:

```sql
LEFT JOIN (
  SELECT person_id, GREATEST(0, count(*) - 1)::int AS prior_jobs
  FROM leads WHERE person_id IS NOT NULL GROUP BY person_id
) pc ON pc.person_id = l.person_id
```

Then derive `board_hot` in the outer select: `(board_score >= ${w.hotThreshold}::int) AS board_hot`.

- [ ] **Step 8: Add the ordering mode**

In `paged`, keep today's branch as the default and add the weight branch:

```sql
ORDER BY
  CASE WHEN ${order}::text = 'weight' THEN 0 ELSE
    CASE f.board_stage WHEN 'attention' THEN 0 WHEN 'shop' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END
  END,
  CASE WHEN ${order}::text = 'weight' THEN -f.board_score END ASC NULLS LAST,
  CASE WHEN ${order}::text = 'stage' AND f.board_stage = 'attention' THEN f.board_since END ASC NULLS LAST,
  f.updated_at DESC,
  f.id DESC
```

Negating the score keeps a single `ASC` direction, which is what lets both modes
share one `ORDER BY`.

- [ ] **Step 9: Verify nothing regressed**

```bash
npm run typecheck
npm run lint
npm run test:shop-brain
```

Expected: all pass. Then load `/ops` on a dev server and confirm the board looks
and orders **exactly** as before — `order` defaults to `"stage"`, so any visible
change here is a bug in Step 6 or Step 8.

- [ ] **Step 10: Commit**

```bash
git add lib/ops-data.ts lib/ops-data-testkit.mjs scripts/board-weight.test.mjs
git commit -m "feat(board): keep every signal and score jobs in the board query"
```

---

### Task 3: Ship it behind `?board=v2`

**Files:**
- Modify: `app/ops/page.tsx:194`
- Create: `app/ops/weighted-job-index.tsx`

**Interfaces:**
- Consumes: `BoardJobRow.board_signals`, `.board_score`, `.board_hot`, and `listBoardJobs({ order })` from Task 2.
- Produces: nothing downstream.

- [ ] **Step 1: Read the switch server-side**

In `app/ops/page.tsx`, alongside the existing `searchParams` handling:

```tsx
const weightedBoard = searchParams?.board === "v2"
```

and pass it through:

```tsx
listBoardJobs(
  { stage: stageFilter, includeTests, query: searchQuery, page, pageSize: 5,
    order: weightedBoard ? "weight" : "stage" },
  operator.role,
),
```

This sits inside the existing `requireOperator()`-gated page. There is no
client-side switcher and no ungated render path — that is what got the previous
prototype harness deleted.

- [ ] **Step 2: Write the v2 component**

Create `app/ops/weighted-job-index.tsx`. It reuses `ActiveJobIndex`'s props and
differs in one way: it renders the whole signal stack instead of one string.

```tsx
import Link from "next/link"
import type { BoardJobRow } from "@/lib/ops-data"

function SignalStack({ signals }: { signals: BoardJobRow["board_signals"] }) {
  if (signals.length === 0) return null
  return <ul className="jobs-signal-stack">
    {signals.map((signal, i) => <li key={`${signal.kind}-${i}`}>
      <strong>{signal.reason}</strong>
      <span>{formatLate(signal.hoursLate)}</span>
    </li>)}
  </ul>
}

function formatLate(hours: number) {
  if (hours <= 0) return "due now"
  if (hours < 1) return `${Math.round(hours * 60)} min`
  if (hours < 24) return `${Math.round(hours * 10) / 10} hrs`
  return `${Math.round((hours / 24) * 10) / 10} days`
}
```

Styling is deliberately minimal and reuses existing `jobs-*` classes. **The
visual treatment is a separate, live thread — do not invent one here.**

- [ ] **Step 3: Verify both boards**

Run the dev server. Check:
- `/ops` — unchanged from today, byte for byte in ordering and copy.
- `/ops?board=v2` — same jobs, ordered by score, every signal visible.
- `/ops?board=anythingelse` — falls back to today's board.
- Signed out, both URLs redirect to sign-in.

- [ ] **Step 4: Commit**

```bash
git add app/ops/page.tsx app/ops/weighted-job-index.tsx
git commit -m "feat(board): weighted board behind ?board=v2"
```

---

## After the plan

> Session split: [`2026-08-18-weighted-board-SESSION-PLAN.md`](2026-08-18-weighted-board-SESSION-PLAN.md) — four sessions, W1 to W4.

Both boards run on live data for **1–2 weeks** with today's board as the
default. The owner then picks a cutover date; on that date `order: "weight"`
becomes the default and the stage-ordering branch of Step 8 is deleted in the
same commit.

Two things must be settled before Task 1 merges:

1. **The weight numbers**, from the prototype's sliders.
2. **Open question 2 in the spec** — a crew member cannot see money but is
   currently given a money-aware ordering. Owner's call.
