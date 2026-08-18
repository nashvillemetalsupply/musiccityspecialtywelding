# Weighted board — design

**Date:** 2026-08-18
**Status:** approved in principle by the owner; visual treatment deliberately deferred
**Scope:** how `/ops` orders and explains the job board. Backend only.

---

## 1. The problem

The board is not unranked. `lib/ops-data.ts` already runs a five-way rule set
inside the `candidates` CTE — unanswered inbound (0), promise overdue (1),
follow-up due (2), never responded (3), failed delivery (4) — and picks a stage
bucket for every job. That machinery is sound and stays.

Three specific defects sit on top of it.

**1. `DISTINCT ON` discards every reason but one.**

```sql
-- lib/ops-data.ts, needs CTE
SELECT DISTINCT ON (lead_id) lead_id, reason, waiting_since
FROM candidates
ORDER BY lead_id, priority, waiting_since ASC
```

A job with a customer email waiting six hours *and* a promise three days overdue
renders exactly one string: `Customer text waiting`. The second fact is computed
and thrown away on the same line that computes it.

**2. Stage buckets outrank magnitude.**

```sql
-- paged CTE
ORDER BY
  CASE f.board_stage WHEN 'attention' THEN 0 WHEN 'shop' THEN 1 ... END,
  CASE WHEN f.board_stage = 'attention' THEN f.board_since END ASC NULLS LAST,
```

Inside `attention` the only tiebreak is age. A $4,485 job for a seven-time
commercial customer, three days past a promised date, sorts *below* a $640
residential quote that has simply been quiet longer.

**3. Nothing weighs money, repeat business, or how overdue a thing is.**

Lateness is a boolean — `due_at < now()`. One minute late and three weeks late
rank identically. `estimate_value_cents` and `invoice_total_cents` are on the
row and unused for ordering. `SHOP-BRAIN-PLAN.md` records that repeat commercial
customers are the revenue core; the board cannot see that either.

## 2. Non-goals

- **No visual redesign.** The board's appearance is a separate, live thread.
  This spec changes what the query returns, not how it renders. `board_reason`
  keeps working exactly as it does today so nothing breaks while that runs.
- **No LLM.** Priority is deterministic SQL. A wrong priority on a jobs board is
  invisible — the job simply sits lower and nobody notices. That is the exact
  failure mode `CLAUDE.md` says never to delegate to a model.
- **No manual reordering.** Dragging rows is typing, and the crew are gloves-on.
- **No schema change.** See §4.

## 3. Design

### 3.1 Weights live in one place

New export block in `lib/shop-brain-invariants.mjs`:

```js
export const BOARD_WEIGHTS = {
  signal: {
    waiting:   50,   // unanswered inbound: sms.in / email.in / call.missed / glass.uploaded
    noreply:   60,   // first_response_at IS NULL — speed-to-lead, the money metric
    promise:   45,   // commitments.due_at < now()
    followup:  20,   // leads.next_follow_up_at <= now()
    bounced:   25,   // email_delivery_status = 'failed'
  },
  latenessCapMultiple: 3,      // a signal never counts more than 3x its base
  latenessHalfLifeHours: 24,   // multiplier = 1 + hoursLate / 24, capped
  valueDivisorCents: 20000,    // $200 per point
  valueCapPoints: 30,
  repeatPointsPerPriorJob: 10,
  repeatCapPoints: 30,
  hotThreshold: 100,
}
```

Plus a pure `scoreBoardJob({ signals, valueCents, priorJobs }, now)` that
implements the same arithmetic in JS.

**The SQL reads these constants; it does not restate them.** They are
interpolated into the query as parameters. This is the "one write path per
entity, in writing, before anything gets built" gate applied to a derived value:
one definition, one test proving the two evaluators agree.

### 3.2 The score

```
score = Σ over live signals ( base × min(3, 1 + hoursLate / 24) )
      + min(30, valueCents / 20000)
      + min(30, priorJobs × 10)
```

`valueCents` is `COALESCE(invoice_total_cents, estimate_value_cents, 0)` —
invoiced beats estimated, and an unpriced job contributes nothing rather than
being punished.

`priorJobs` is the count of other leads sharing `person_id`, which `app/ops/page.tsx`
already computes for the "Repeat — N jobs" badge. It moves into the query so the
score can see it.

A job is **hot** at `score >= 100`.

### 3.3 SQL changes

Confined to `listBoardJobs` in `lib/ops-data.ts`.

1. `candidates` gains a `weight` column per row: `base × lateness_multiplier`,
   and a `hours_late` column.
2. The `needs` CTE stops collapsing. Replace `DISTINCT ON` with an aggregate:

   ```sql
   , needs AS (
     SELECT lead_id,
       jsonb_agg(jsonb_build_object(
         'kind', kind, 'reason', reason, 'hoursLate', hours_late, 'weight', weight
       ) ORDER BY weight DESC) AS signals,
       sum(weight)               AS signal_weight,
       min(waiting_since)        AS waiting_since,
       (array_agg(reason ORDER BY priority, waiting_since ASC))[1] AS reason
     FROM candidates
     GROUP BY lead_id
   )
   ```

   `reason` is preserved with its original semantics so `board_reason` is
   byte-identical to today. Nothing downstream has to change to keep working.
3. `board` gains `board_signals` (the JSONB array), `board_score`, and
   `board_hot`.
4. `paged` gains an ordering mode. Default stays exactly as it is; `order = 'weight'`
   sorts `board_score DESC, board_since ASC, id DESC`.

Every parameter is cast (`::int`, `::bigint`, `::boolean`, `::text`) per the
standing rule — untyped params in `CASE`/boolean contexts throw 42P18.

### 3.4 Return shape

`BoardJobRow` gains three fields. All additive; nothing is removed or renamed.

```ts
export type BoardSignal = {
  kind: "waiting" | "noreply" | "promise" | "followup" | "bounced"
  reason: string      // the existing human string, unchanged
  hoursLate: number
  weight: number
}

export type BoardJobRow = LeadRow & {
  board_stage: Exclude<JobBoardStage, "board">
  board_reason: string        // unchanged — still the single top reason
  board_since: string
  board_signals: BoardSignal[]  // NEW — every live signal, heaviest first
  board_score: number           // NEW
  board_hot: boolean            // NEW
}
```

`listBoardJobs` takes one new option: `order?: "stage" | "weight"`, default
`"stage"`.

### 3.5 Gate B — how it ships

Migration discipline, borrowed wholesale, because the last board prototype was
deleted for being ungated:

- `/ops?board=v2` selects `order: "weight"` and the new component. Absent or any
  other value gets today's board. The switch is read server-side in
  `app/ops/page.tsx` and gated behind `requireOperator()` like everything else on
  the route — there is no client-side variant switcher and no ungated render path.
- Both boards run against the same live data for **1–2 weeks**. Today's board
  stays the default the whole time.
- The owner picks a cutover date. On that date `v2` becomes the default and the
  stage-ordering branch is deleted in the same commit.
- Decision evidence is the owner's own use, not a metric. There is no operator
  telemetry in this design — `SHOP-BRAIN-PLAN.md` forbids worker surveillance and
  the owner is a worker.

## 4. No migration

Every input already exists:

| Input | Source | Status |
|---|---|---|
| unanswered inbound | `events` via the `comms` CTE | live |
| promise overdue | `commitments.due_at` | live |
| follow-up due | `leads.next_follow_up_at` | live |
| never responded | `leads.first_response_at` | live |
| failed delivery | `leads.email_delivery_status` | live |
| value | `leads.invoice_total_cents`, `leads.estimate_value_cents` | live |
| repeat count | `leads.person_id` | live |

The score is derived at query time and stored nowhere. **`scripts/migrate.mjs` is
not touched, and nothing runs against the shared Neon database.** If the weights
turn out wrong, the fix is a constant and a redeploy.

## 5. Errors and edge cases

- **No signals.** `board_signals` is `[]`, `signal_weight` is 0. Value and repeat
  still contribute, so a quiet $19,000 job outranks a quiet $75 one.
- **Unpriced job.** Contributes 0 value points. It can still be hot on signals
  alone — the new gate lead with no callback is the case that matters.
- **No `person_id`.** Repeat count is 0. Backfill gaps degrade the score, never
  break the query.
- **Clock skew / future `due_at`.** `hoursLate` floors at 0, so a not-yet-due
  promise contributes its base once, not a negative.
- **Test rows.** `is_test` filtering is untouched and applies before scoring.
- **Crew role.** Money redaction happens in `projectLeadForRole` *after* the
  query. Score is computed from real values for everyone, so ordering is
  identical for owner and crew, but a crew member never sees the figure. This is
  a deliberate call and is called out in §7 for review.

## 6. Testing

One new file, `scripts/board-weight.test.mjs`, run under `node --test` and added
to the `test:shop-brain` script — matching the existing convention.

1. **Fixtures → expected order.** Ten hand-built jobs including the Real Floors
   case: today's rules place it fourth, weight places it first. Asserts the exact
   ordering, not just the winner.
2. **SQL and JS agree.** The same fixture rows scored by `scoreBoardJob` and by a
   JS re-implementation of the SQL arithmetic must match to the point.
   This is the test that makes the single-source claim real rather than a comment.
3. **Caps hold.** A signal 40 days late scores exactly 3× base. A $2M job caps at
   30 points. A 40-job regular caps at 30.
4. **Zero case.** A job with no signals, no price and no history scores 0 and is
   not hot.
5. **`board_reason` is unchanged.** For every fixture, the aggregate's `reason`
   equals what `DISTINCT ON` would have chosen. This is the regression guard for
   the still-live board.

## 7. Open questions for the owner

1. **Weights.** The numbers above are a starting guess. The prototype at
   `scored-board.html` carries sliders for lateness / money / repeat; whatever
   they land on replaces the constants before any of this merges.
2. **Crew and money (§5).** Ordering is money-aware for a crew member who cannot
   see money. Correct, or should crew get a value-blind ordering?
3. **`hotThreshold: 100`.** Currently three of ten fixture jobs are hot. If the
   real board runs 40 jobs, is 3–5 hot the right number, or should the threshold
   be a rank rather than a constant?

## 8. Rollback

No schema change, so rollback is a revert. If `v2` is bad, drop the query param —
today's board is still the default and still the code path it always was.
