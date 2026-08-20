# /board wiring — session plan

Splits `BOARD-WIRE-PLAN.md`.

**Rules.** One row = one fresh chat = one bounded mission. Set the session model in
the picker **before** pasting the prompt. Run one session at a time. Each session
marks its own row done or blocked when it closes.

**Everything left routes to Codex.** Shepherd's first delegation rule is *plan
attached to Codex* — the work is already specified, so the expensive model adds
nothing. Every session below names its file and its boundaries, which is what that
rule is testing for. `gpt-5.6-sol` at `xhigh`. W2 is the one exception worth watching:
it is large, so it presents its markup plan before writing code, but it still runs on
Codex.

**Verification, every session:** `npm run typecheck`, `npm run lint`, and
`npm run test:shop-brain` all green before the row is marked done. No session claims
completion on a red suite.

**Standing notes** (ride along with whichever session touches them, no session of
their own):

- `BoardCallSketch` gains `leadId` in W4, which owns that change end to end.
- `.job[data-open]`, `.detail`, `.drawing`, `.stages`, `.why`, `.sum` already exist in
  `app/board/board.css`. Restoring the panel is markup, not styling. Do not re-author
  the CSS; if a rule is genuinely missing, add it, don't rewrite the block.
- Every session inherits the invariants in `CLAUDE.md` and §3 of the plan: crew money
  removed server-side, test rows excluded, no invented numbers, no worker surveillance.

## Sessions

| ID | Mission (plan item) | Session model | Effort | Size | Depends on | Status |
|----|---------------------|---------------|--------|------|------------|--------|
| W0 | `job_line_items` store, owner entry on `/ops/leads/<id>`, crew stripped (plan §2 block C) | Opus | high | M | — | **done** |
| W1 | Batched per-job detail query — `getBoardJobDetails(ids, role)` (plan §2 "Query cost") | Codex `gpt-5.6-sol` | xhigh | M | W0 | **done** |
| W2 | The expand panel: blocks A, B, C and the open/close interaction (plan §2) | Codex `gpt-5.6-sol` | xhigh | L | W1 | **done** |
| W3 | Signal filter — `?signal=<kind>` through `listBoardJobs`, pane buttons, "Work the N" (plan §1 rows 13–14) | Codex `gpt-5.6-sol` | high | M | — | **done** |
| W4 | Call sketch wiring — `leadId` on `BoardCallSketch`, "Open the job", "Text him the three" (rows 15–16) | Codex `gpt-5.6-sol` | medium | S | — | **done** |
| W5 | Header and rail chrome — date, search, New job, who-dot, seven rail links (rows 1–12) | Codex `gpt-5.6-sol` | medium | S | — | **done** |
| W6 | Exit verification — panel and control assertions in `job-control-tracker.test.mjs`, full suite, tick the plan | Codex `gpt-5.6-sol` | high | S | W2, W3, W4, W5 | todo |

**Recommended order:** W0 → W1 → W2, then W5, W4, W3 in any order (all independent
gap-fillers), then W6 last. W0 first because the owner is entering costs today and
cannot until the store and its form exist.

**Where the spend goes.** W0 ran on Opus here and is done — it was the schema and the
owner-gated money write, the part that was genuinely hard to reverse. Everything left
is specified work against a written plan, so it runs on Codex `gpt-5.6-sol`. Effort is
the dial: `xhigh` for W1 and W2, which carry the crew/owner money split and the
largest markup in the redesign; `high` for W3 and W6; `medium` for the two link
sessions.

**Standing handoff.** Each session ends by committing its own work on this branch and
marking its row. Do not merge — the orchestrator integrates.

---

### W0 — Line items store and owner entry

**Scope.** Idempotent `CREATE TABLE IF NOT EXISTS job_line_items` in
`scripts/migrate.mjs` (`lead_id`, `position`, `label`, `note`, `amount_cents`,
`created_at`, `updated_at`, `is_test`), a `lib/` reader and writer beside the existing
money code, an owner-only server action following `saveEstimate`'s shape — 
`requireOwner`, explicit `::` casts on every interpolation, `recordLeadEvent`,
`revalidatePath` — and the entry form on `/ops/leads/<id>` next to the estimate field.
`is_test` follows the lead. No board markup.

**Not-touched.** `/board` entirely. `estimate_value_cents` keeps its current meaning:
line items explain the quoted price, they do not replace or recompute it.

**Routing.** Opus, high. Schema plus an owner-gated money write. Present the column
list and the action's authority check for sign-off before writing code.

**Prompt.**
> Session W0 of `BOARD-WIRE-SESSION-PLAN.md`, splitting `BOARD-WIRE-PLAN.md` — read
> both first, especially §2 block C. Mission: a `job_line_items` store the owner can
> fill in today. Idempotent migration, `lib/` read/write, an owner-only server action
> shaped like `saveEstimate`, and the entry form on `/ops/leads/<id>`. Every SQL
> interpolation carries an explicit Postgres cast. `is_test` follows the lead. Crew
> never reads it. Nothing on `/board` changes this session. Present the columns and the
> authority check for sign-off before writing code.

---

### W1 — Batched per-job detail query

**Scope.** Add `getBoardJobDetails(ids: number[], role)` to `lib/ops-data.ts`,
returning a `Map<number, BoardJobDetail>` covering, for every visible row: active
claims, open/broken commitments, the newest photo date, a short event trail, and the
job's line items (owner only — crew gets an empty list, stripped server-side).
Five queries over the whole id list — never one per row. Call it from
`app/board/page.tsx` beside the existing `Promise.all`, and add the result to
`BoardPaneData`. Type the shape. Nothing renders yet.

**Not-touched.** `app/board/board.tsx` markup, `board.css`, the tracker query itself,
`/ops`.

**Routing.** Codex `gpt-5.6-sol`, `xhigh`. Event visibility already lives in
`lib/events.ts` behind `OWNER_ONLY_EVENT_*` and `projectEventForRole` — put the
batched trail query there and let `ops-data.ts` call it. Do not copy the role filter
into a second file.

**Prompt.**
> Session W1 of `BOARD-WIRE-SESSION-PLAN.md`, splitting `BOARD-WIRE-PLAN.md`. Read
> both first. Mission: add `getBoardJobDetails(ids, role)` to `lib/ops-data.ts` —
> batched active claims, commitments, newest photo date, a short event trail and the
> job's line items for a page of board rows, five queries total, plus the type and the call from
> `app/board/page.tsx`. Do not touch `board.tsx` markup or `board.css`. Crew rows keep
> their money nulled and test rows stay out. Present your plan and the query shapes
> for sign-off before writing code.

---

### W2 — The expand panel

**Scope.** Restore the mockup's expanded row against real data: block A "The part",
block B the five-stage rail, block C "Why it needs you", and one-row-at-a-time
open/close with `useState` in `app/board/board.tsx`. Follow plan §2 exactly, including
the "What is in it" table against the real `job_line_items` rows, its honest empty
state, and the note when the lines do not add up to the quoted price. Every number
comes from `getBoardJobDetails` or a `BoardJobRow` column.

**Not-touched.** `lib/ops-data.ts` (W1 finished it), the pane, the call sketch card,
the header, the rail.

**Routing.** Codex `gpt-5.6-sol`, `xhigh`. Large, so present the markup plan and the
exact source of every visible value for owner sign-off before writing code.

**Prompt.**
> Session W2 of `BOARD-WIRE-SESSION-PLAN.md`. Read it and `BOARD-WIRE-PLAN.md` §2
> first; W1 has landed `getBoardJobDetails`. Mission: restore the tracker row's expand
> panel in `app/board/board.tsx` — blocks A, B and C plus one-row-at-a-time open/close.
> The CSS already exists in `board.css`; do not re-author it. "What is in it" renders
> the real `job_line_items` rows W0 landed, with an honest empty state and a note when
> they do not add up to the quoted price. Only `getBoardJobDetails` values and
> `BoardJobRow` columns may appear on screen. Present the markup plan and the source of
> every visible value for sign-off before writing code.

---

### W3 — Signal filter

**Scope.** Add an optional `signal?: BoardSignalKind` to `listBoardJobs`, filtering
rows to those carrying that signal, with the counts left as aggregates over the
unfiltered stage. Validate `?signal=` in `app/board/page.tsx` strictly against the
signal kinds, the way `?stage=` already is. Turn the five pane buttons into links that
set it, mark the active one, and give it a way back. Point "Work the N that need you"
at `?stage=attention`.

**Not-touched.** The expand panel, the tracker markup below the row, the header.

**Routing.** Codex `gpt-5.6-sol`, `high`. The signal CTE is already in
`listBoardJobs`; extend it, do not rebuild it.

**Prompt.**
> Session W3 of `BOARD-WIRE-SESSION-PLAN.md`. Read it and `BOARD-WIRE-PLAN.md` rows
> 13–14. Mission: `?signal=<kind>` end to end — an optional signal filter in
> `listBoardJobs`, strict validation in `app/board/page.tsx`, the five pane signal
> buttons as links with an active state and a way back, and "Work the N that need you"
> pointing at `?stage=attention`. Stage tab counts stay aggregates over the unfiltered
> stage. Every SQL interpolation carries an explicit cast. Present your plan before
> writing code.

---

### W4 — Call sketch wiring

**Scope.** Add `leadId: number | null` to `BoardCallSketch` in
`lib/call-sketch-store.ts` — `calls.lead_id` is already in the join. Make "Open the
job" a link to `/ops/leads/<id>`, hidden when there is no lead. Point "Text him the
three" at the lead's existing message composer.

**Not-touched.** The sketch spec, the panel's fact rendering, anything in `lib/`
besides the one query and type.

**Routing.** Codex `gpt-5.6-sol`, `medium`. Mechanical wiring against an existing join.

**Prompt.**
> Session W4 of `BOARD-WIRE-SESSION-PLAN.md`. Read it and `BOARD-WIRE-PLAN.md` rows
> 15–16. Mission: add `leadId` to `BoardCallSketch`, wire "Open the job" to
> `/ops/leads/<id>` and "Text him the three" to that lead's message composer, and hide
> both when there is no lead behind the call. Nothing else in the sketch panel changes.

---

### W5 — Header and rail chrome

**Scope.** Plan rows 1–12: the header date becomes today in Central; the search box
becomes a GET form to `?q=` that `listBoardJobs` already accepts; "New job" links to
`/ops/intake/new`; the `who-dot` shows the signed-in operator's initial; the seven rail
buttons become links to the destinations in the table, with Money hidden for crew and
the current section marked `aria-current`.

**Not-touched.** The tracker, the pane, the call sketch card.

**Routing.** Codex `gpt-5.6-sol`, `medium`. Confirm each destination against the
routes that actually exist before linking it — `/ops/accounts` has no index page.

**Prompt.**
> Session W5 of `BOARD-WIRE-SESSION-PLAN.md`. Read it and `BOARD-WIRE-PLAN.md` rows
> 1–12. Mission: wire the header and the left rail — real date, search as a GET form to
> `?q=`, "New job" to `/ops/intake/new`, the operator's initial in the `who-dot`, and
> the seven rail buttons as links with `aria-current` on the current one. Money is
> owner-only. Confirm every destination route exists before linking it. Nothing below
> the header changes.

---

### W6 — Exit verification

**Scope.** Extend `scripts/job-control-tracker.test.mjs` so the panel and the newly
live controls are pinned: no mockup fixture string survives, no hardcoded date, every
cost line traces to a `job_line_items` row, every rail link resolves to a route that
exists, and the crew projection still nulls money inside the panel. Run `npm run typecheck`, `npm run lint` and
`npm run test:shop-brain`. Tick the plan and mark every row in this file.

**Not-touched.** Any behaviour — this session fixes tests, not features. A real
failure gets reported back, not patched around.

**Routing.** Codex `gpt-5.6-sol`, `high`. Report suite output verbatim.

**Prompt.**
> Session W6 of `BOARD-WIRE-SESSION-PLAN.md`, the exit gate. Read it and
> `BOARD-WIRE-PLAN.md`. Mission: pin W2–W5 in `scripts/job-control-tracker.test.mjs`
> — no fixture strings, no hardcoded date, no cost line the owner did not type, rail
> links resolve, crew money still nulled inside the expand panel — then run `npm run typecheck`,
> `npm run lint` and `npm run test:shop-brain` and paste the output. Do not change
> behaviour to make a test pass; report the failure instead. Tick §3 of the plan and
> mark every row in the session plan.
