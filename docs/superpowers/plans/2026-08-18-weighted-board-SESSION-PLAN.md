# Weighted board — session plan

> Split of [`2026-08-18-weighted-board.md`](2026-08-18-weighted-board.md).
> Named for its plan rather than the bare `SESSION-PLAN.md` the command defaults
> to, because the repo root already has a `SESSION-PLAN.md` for Shop Brain.

**Rules:** one row = one fresh chat = one bounded mission. Open each chat with the
paste-ready prompt, session model set **first**. One session at a time, in order.
Every session starts by reading the plan file and this file; it ends with a commit
and its own verification only, and marks its own status row as it closes. Never mix
sessions in one chat.

**Routing authority is the root Shepherd `CLAUDE.md`, not this file.** Its first
rule — *plan attached → Codex* — applies to all four sessions: the prompt names a
file under `docs/superpowers/plans/` and the work is already specified down to the
SQL. The generic advice to put a data-model session on a top-tier model loses to
that, deliberately. W2 gets `xhigh` effort instead of a bigger model, because the
risk there is arithmetic and ordering correctness, which effort buys and model tier
does not.

## Standing notes

These ride along; none owns a session.

- **The weight numbers are not settled.** `BOARD_WEIGHTS` in W1 ships the starting
  guess. The owner tunes lateness / money / repeat on the prototype
  (`scored-board.html`) and the landed constants must match whatever they pick.
  W1 may merge before this happens — the numbers are a one-line change.
- **Spec open question 2 is unanswered:** a crew member cannot see money but is
  currently given a money-aware ordering. Owner decides before W3 closes.
- **No migrations, in any session.** `scripts/migrate.mjs` is not touched and
  nothing runs against Neon. A session that believes it needs a schema change has
  misread the plan — stop and say so.
- **The visual treatment is a separate live thread.** W3 renders the signal stack
  with existing `jobs-*` classes and invents no design.

## Sessions

| ID | Mission (plan task) | Session model | Effort | Size | Depends | Status |
|---|---|---|---|---|---|---|
| W1 | Task 1 — `BOARD_WEIGHTS`, pure scorer, tests, npm wiring | codex | medium | S | — | pending |
| W2 | Task 2 — candidates weights, `needs` aggregate, board score, `order` option | codex | **xhigh** | M | W1 | complete |
| W3 | Task 3 — `?board=v2` gate + `weighted-job-index.tsx` | codex | medium | S | W2 | pending |
| W4 | Exit verification — both boards on real data, checklist ticked | codex | medium | S | W3 | pending |

**Recommended order:** W1 → W2 → W3 → W4. No gap-fillers; the chain is strictly
sequential because each session consumes the previous one's exports.

**Where the spend is concentrated:** W2 only. It is the session where a wrong
`ORDER BY` or a broken `array_agg` silently changes what the owner sees on a live
board, and the one place `board_reason` can regress. W1 and W3 are small and fully
specified. Inside every session, use cheap subagents for code location, running
the suite, and closing notes; keep the main model on the arithmetic.

---

### W1 — weight constants and the pure scorer

**Scope:** Plan Task 1, whole. `BOARD_WEIGHTS`, `signalWeight`, `scoreBoardJob`,
`isBoardJobHot` in `lib/shop-brain-invariants.mjs`; declarations in the `.d.mts`;
`scripts/board-weight.test.mjs`; the `test:shop-brain` entry.

**Not-touched:** `lib/ops-data.ts`, any SQL, any component, `scripts/migrate.mjs`.

**Routing:** codex, medium. Explorer subagent confirms where the existing exports
in `shop-brain-invariants.mjs` end before appending.

> W1 of `docs/superpowers/plans/2026-08-18-weighted-board-SESSION-PLAN.md`
> (plan: `docs/superpowers/plans/2026-08-18-weighted-board.md`, spec:
> `docs/superpowers/specs/2026-08-18-weighted-board-design.md`).
> Implement plan Task 1 only: board weight constants and the pure scorer, with its
> test file registered in `test:shop-brain`. Do not touch `lib/ops-data.ts`, any SQL,
> any component, or `scripts/migrate.mjs`. Present your implementation plan before
> writing code. Exit: `node --test scripts/board-weight.test.mjs` passes 8 tests and
> `npm run test:shop-brain` is green.

---

### W2 — keep every signal, score in SQL

**Scope:** Plan Task 2, whole. Weight and age columns on all five `candidates`
branches; `needs` aggregate replacing `DISTINCT ON`; the `prior_jobs` join;
`board_signals` / `board_score` / `board_hot`; the `order` option and its
`ORDER BY`; the `BoardSignal` and `BoardJobRow` types;
`lib/ops-data-testkit.mjs` and the parity + regression tests.

**Not-touched:** every component, `app/ops/page.tsx`, `scripts/migrate.mjs`.
`board_reason` and `board_stage` must come out byte-identical — that is the
regression this session is most likely to cause and is explicitly tested.

**Routing:** codex, **xhigh** — the arithmetic and the two-mode `ORDER BY` are
where this goes quietly wrong. Verifier subagent runs the full suite plus a
before/after diff of `/ops` row order with `order` defaulted.

> W2 of `docs/superpowers/plans/2026-08-18-weighted-board-SESSION-PLAN.md`.
> Implement plan Task 2 only: per-signal weights in the `candidates` CTE, replace
> `DISTINCT ON` with the `jsonb_agg` + `array_agg` aggregate, add the prior-jobs
> join, `board_signals` / `board_score` / `board_hot`, and the `order` option.
> Cast every parameter. No migration — if you think you need one, stop and say so.
> Do not touch any component or `app/ops/page.tsx`. Present your implementation plan
> before writing code. Exit: `npm run typecheck`, `npm run lint` and
> `npm run test:shop-brain` all pass, and `/ops` with no query param renders in the
> exact same order as before the change.

---

### W3 — ship it behind `?board=v2`

**Scope:** Plan Task 3, whole. The server-side `board=v2` read in
`app/ops/page.tsx`, and `app/ops/weighted-job-index.tsx` rendering the signal stack.

**Not-touched:** `lib/ops-data.ts`, `lib/shop-brain-invariants.mjs`, any new CSS
beyond existing `jobs-*` classes. No client-side variant switcher — the previous
prototype harness was deleted for exactly that.

**Routing:** codex, medium. Owner reviews live at localhost before the commit.

> W3 of `docs/superpowers/plans/2026-08-18-weighted-board-SESSION-PLAN.md`.
> Implement plan Task 3 only: read `?board=v2` server-side inside the existing
> `requireOperator()` gate, pass `order: "weight"`, and add
> `app/ops/weighted-job-index.tsx` rendering every signal with its age. Reuse
> existing `jobs-*` classes — the visual redesign is a separate thread, invent
> nothing. Exit: `/ops` unchanged, `/ops?board=v2` ordered by score with full signal
> stacks, `/ops?board=garbage` falls back, and both redirect when signed out.

---

### W4 — exit verification

**Scope:** Run the plan's "After the plan" checks against real data. Confirm both
boards agree on membership and differ only in order; confirm `board_reason` on the
live board is unchanged; confirm no migration ran; tick the plan checklist and mark
every row in this file.

**Not-touched:** any code. This session verifies and reports; a defect it finds
reopens the owning session rather than being fixed here.

**Routing:** codex, medium. Cheap subagent runs the suites and drafts the closing
note.

> W4 of `docs/superpowers/plans/2026-08-18-weighted-board-SESSION-PLAN.md`.
> Exit verification only, no code changes. Confirm: both boards show the same jobs
> and differ only in order; `board_reason` is unchanged on the default board;
> `git diff` touches no migration; full suite green. Tick the plan checklist, mark
> the status rows in the session plan, and report the cutover readiness in three
> lines.
