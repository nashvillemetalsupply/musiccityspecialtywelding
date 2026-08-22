# Cohesion round — session plan

One row = one fresh chat = one bounded mission. Open each chat with the paste-ready
prompt below, with the session model set first. One session at a time; a session
marks its own row done or blocked when it closes.

Routing authority: `CLAUDE.md` (repo root) — plan-specified work goes to Codex; the
orchestrator reviews; Pi only for reading sweeps inside a session. Every session runs
`npm run typecheck && npm run lint && npm run test:shop-brain` before its commit.

Standing notes:
- The crew half of QA step 8 stays blocked until a crew operator exists in
  production — same standing deferral as the conversion plan's Step 3b. Rides along;
  owns no session.
- The restore drill is excluded by the owner. Do not add it back.

## Session table

| ID | Mission (plan task) | Session model | Effort | Size | Depends on | Status |
|----|---------------------|---------------|--------|------|------------|--------|
| K1 | Task 1 — retire the `lead_events` dual-write | Codex `gpt-5.6-sol` | xhigh | M | — | done |
| K2 | Task 2 — record money in hand | Codex `gpt-5.6-sol` | xhigh | M | K1 (shares `app/ops/actions.ts`) | done |
| K3 | Task 3 — "The week" on the board | Codex `gpt-5.6-sol` | high | M | — | done |
| K4 | Task 4 — overflow pager + board fetch tidy-up | Codex `gpt-5.6-sol` | medium | S | K3 (shares `board.tsx` / `page.tsx`) | done |
| K5 | Task 5 — exit verification + docs | Codex `gpt-5.6-sol` | high | S | K1–K4 | done |

**Recommended order:** K1 → K2 → K3 → K4 → K5. (K3 may run before K2 if a
conflict-free window matters; K2 and K3 share no files.)

**Top-tier spend:** concentrated in K1 and K2 — the journal unification and the money
path are the two correctness-sensitive missions. K4 is mechanical; K5 is
verification-only.

---

### K1 — Retire the `lead_events` dual-write

**Scope.** Task 1 of `docs/superpowers/plans/2026-08-21-cohesion-round.md`, all
twelve steps: `recordLeadEvent` rewrite, both read-gate ports, the five CTE sites,
the dead reader deletion, the schema comment, the `CLAUDE.md` invariant wording, the
new suite wired into `package.json`.

**Not-touched.** The `lead_events` table itself (frozen, never dropped), the
`events` write path in `lib/events.ts`, `scripts/backfill-events.mjs`, any board or
page markup.

**Routing.** Codex `gpt-5.6-sol`, `xhigh` — journal semantics and creation gates;
a wrong port silently drops receipts.

**Prompt.**
> Session K1 of `docs/superpowers/plans/2026-08-21-cohesion-round-SESSION-PLAN.md`.
> Read that file and Task 1 of
> `docs/superpowers/plans/2026-08-21-cohesion-round.md`, then the six write sites and
> two read gates the task names. Mission: `events` becomes the only journal — every
> step of Task 1, TDD, exactly as written. Frozen table stays. Present your plan
> before writing code. Gates: typecheck, lint, test:shop-brain all green; paste
> output.

---

### K2 — Record money in hand

**Scope.** Task 2 of the plan, all eight steps: `lib/payments.mjs` + `.d.mts`,
`recordPayment` in `app/ops/actions.ts`, the job-page form and balance line, the
crew-projection check in `lib/ops-data.ts:70`, suite wired into `package.json`.

**Not-touched.** The Gmail/QuickBooks ingest and wire-slip payment paths (their
GREATEST semantics stay), `recordInvoice`, the board pane.

**Routing.** Codex `gpt-5.6-sol`, `xhigh` — money path, idempotency, crew
projection.

**Prompt.**
> Session K2 of `docs/superpowers/plans/2026-08-21-cohesion-round-SESSION-PLAN.md`.
> Read that file and Task 2 of
> `docs/superpowers/plans/2026-08-21-cohesion-round.md`, plus `recordInvoice` in
> `app/ops/actions.ts` and the crew projection at `lib/ops-data.ts:70`. Mission:
> owner-recorded cash/check payments — every step of Task 2, TDD, exactly as
> written. Event lands before the rollup; crew money stays nulled server-side.
> Present your plan before writing code. Gates: typecheck, lint, test:shop-brain all
> green; paste output.

---

### K3 — "The week" on the board

**Scope.** Task 3 of the plan, all nine steps: `getWeekAhead` in `lib/ops-data.ts`,
the board fetch, the pane card, the `.week` CSS in board tokens, suite wired into
`package.json`.

**Not-touched.** `getPromiseSummary` and `getOutTheDoorWeek` (conventions to copy,
not edit), the tracker, the call-sketch panel.

**Routing.** Codex `gpt-5.6-sol`, `high` — the SQL and markup are fully specified;
the judgment is matching the pane's existing rhythm.

**Prompt.**
> Session K3 of `docs/superpowers/plans/2026-08-21-cohesion-round-SESSION-PLAN.md`.
> Read that file and Task 3 of
> `docs/superpowers/plans/2026-08-21-cohesion-round.md`, plus the pane region of
> `app/board/board.tsx` and the card rules in `app/board/board.css`. Mission: the
> week card — every step of Task 3, TDD, exactly as written. Crew never queries the
> invoice lane; test rows stay out; the empty state is honest. Present your plan
> before writing code. Gates: typecheck, lint, test:shop-brain all green; paste
> output.

---

### K4 — Overflow pager + board fetch tidy-up

**Scope.** Task 4 of the plan, all seven steps: `?p=` parsing, `boardHref({ page })`,
the pager markup and CSS, the voice snapshot moved into the `Promise.all`, the
extended tracker suite.

**Not-touched.** `listBoardJobs` internals (its `page`/`hasNext` machinery already
exists — consume, don't rebuild), the week card, the expand panel.

**Routing.** Codex `gpt-5.6-sol`, `medium` — mechanical wiring against existing
machinery.

**Prompt.**
> Session K4 of `docs/superpowers/plans/2026-08-21-cohesion-round-SESSION-PLAN.md`.
> Read that file and Task 4 of
> `docs/superpowers/plans/2026-08-21-cohesion-round.md`, plus `boardHref` in
> `app/board/board.tsx` and the `listBoardJobs` return shape in `lib/ops-data.ts`.
> Mission: the overflow pager and the parallel voice fetch — every step of Task 4,
> TDD, exactly as written. Do not modify `listBoardJobs`. Present your plan before
> writing code. Gates: typecheck, lint, test:shop-brain all green; paste output.

---

### K5 — Exit verification

**Scope.** Task 5 of the plan: full gates with verbatim output, the double
`npm run migrate` dry-run, the owner QA walk record, plan tickboxes, the
`MCSW-JOBS-BUILD-HANDOFF.md` paragraph, and marking every row in this file.

**Not-touched.** Any behaviour — this session verifies and documents. A real failure
gets reported back, not patched around.

**Routing.** Codex `gpt-5.6-sol`, `high`. Report suite output verbatim.

**Prompt.**
> Session K5 of `docs/superpowers/plans/2026-08-21-cohesion-round-SESSION-PLAN.md`,
> the exit gate. Read that file and
> `docs/superpowers/plans/2026-08-21-cohesion-round.md` in full. Mission: Task 5 —
> run every gate, run `npm run migrate` twice, walk the QA Procedure against the
> preview, tick the plan, write the handoff paragraph, and mark every row in the
> session plan. Do not change behaviour to make a check pass; report the failure
> instead.
