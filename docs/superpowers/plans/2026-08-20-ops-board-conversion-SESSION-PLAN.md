# Ops → board conversion — session plan

Splits `2026-08-20-ops-board-conversion.md`.

**Rules.** One row = one fresh chat = one bounded mission. Set the session model in
the picker **before** pasting the prompt. Run one session at a time. Each session
marks its own row done or blocked when it closes.

**Routing authority.** `CLAUDE.md` routing rules apply: plan-attached work routes to
Codex `gpt-5.6-sol`; Pi carries the reading and mechanical sweeps inside every
session (`delegate-to-pi`). Top-tier only where the work is hard to reverse.

**Verification, every session:** `npm run typecheck`, `npm run lint`,
`npm run test:shop-brain` all green before the row is marked done. No session claims
completion on a red suite.

**Standing notes:**

- **Owner gate per page.** Every conversion session ends with the owner eyeballing
  the preview URL. The next session does not open until the previous page is
  approved. 13 rejected `/ops` redesigns are the reason; applying the approved board
  vocabulary verbatim is the mitigation. Any impulse to "improve" on the board's
  language is out of scope.
- Markup and CSS only. A session that finds itself editing `lib/`, `actions.ts`, or
  SQL has left its scope — stop and flag.
- `/j/[token]` (customer GLASS page) is excluded; separate owner decision.
- C8 asks the owner about deleting `weighted-job-index` / `active-job-index` before
  deleting.

## Sessions

| ID | Mission (plan task) | Session model | Effort | Size | Depends on | Status |
|----|--------------------|---------------|--------|------|------------|--------|
| C0 | Task 0: extract `styles/control.css`, board pixel-identical | Codex `gpt-5.6-sol` | high | M | — | pending |
| C1 | Task 1: job page `/ops/leads/[id]` conversion | Codex `gpt-5.6-sol` | xhigh | L | C0 | pending |
| C2 | Task 2: intake pages conversion | Codex `gpt-5.6-sol` | medium | M | C0, C1 approved | pending |
| C3 | Task 3: accounts + analytics conversion | Codex `gpt-5.6-sol` | medium | S | C0, C1 approved | pending |
| C4 | Task 4: call-sketch, shop, install pages | Codex `gpt-5.6-sol` | medium | S | C0, C1 approved | pending |
| C5 | Task 5: build sheets conversion | Codex `gpt-5.6-sol` | high | M | C0, C1 approved | pending |
| C6 | Task 6: sign-in + error surfaces | Codex `gpt-5.6-sol` | medium | S | C0 | pending |
| C7 | Task 7: layout flip, `/ops` → `/board` front door, delete legacy CSS | Opus/Fable | high | M | C1–C6 | pending |
| C8 | Task 8: exit verification — routes walked as owner and crew, breakpoints, print | Codex `gpt-5.6-sol` | high | S | C7 | pending |

**Recommended order:** C0 → C1 (owner gate) → C6, then C2/C3/C4/C5 in any order
(independent gap-fillers, each behind the C1 approval) → C7 → C8.

**Where the top-tier spend goes.** One session: C7. It changes the shared layout
under every ops page at once, makes `/board` the front door, and deletes 7,291 lines
of legacy CSS — the only hard-to-reverse move in the plan. Everything else is
specified conversion against a written vocabulary and runs on Codex. C1 gets `xhigh`
because the job page is 845 lines carrying every money form.

---

### C0 — Shared control-room stylesheet

**Scope.** Plan Task 0 exactly: create `styles/control.css` from the token/role/
component blocks of `app/board/board.css`, leave board-page-specific rules behind,
add the `@import`, write `scripts/control-css.test.mjs`. `/board` must render
pixel-identical.

**Not-touched.** Everything under `app/ops`. No class renamed, no rule reworded —
extraction, not editing.

**Routing.** Codex high. Pi sweeps: list every class defined in board.css and every
class used in board.tsx, to split defined-here vs page-specific.

**Prompt.**
> Session C0 of `docs/superpowers/plans/2026-08-20-ops-board-conversion-SESSION-PLAN.md`,
> executing Task 0 of `docs/superpowers/plans/2026-08-20-ops-board-conversion.md` —
> read both first. Mission: extract the board's tokens, roles, and shared component
> classes into `styles/control.css`, import it from `board.css`, prove `/board`
> unchanged. Write `scripts/control-css.test.mjs` per the plan. Nothing under
> `app/ops` changes. Present your extraction split (which blocks move, which stay)
> before writing code. Exit: typecheck, lint, `job-control-tracker` and the new test
> green; board pixel-identical by eye.

### C1 — Job page conversion

**Scope.** Plan Task 1: convert `app/ops/leads/[id]/page.tsx` markup to the board
vocabulary, page CSS in `app/ops/leads/[id]/job.css`, importing `styles/control.css`
directly until C7 flips the layout. Every form, action, `name=`, and conditional
stays byte-identical. Line-items and estimate forms get the `.sum` table treatment.

**Not-touched.** `lib/`, `actions.ts`, any other route, the ops layout.

**Routing.** Codex xhigh — largest page, every money form crosses it. Present the
section-by-section class map for sign-off before converting. Pi sweeps: the current
class inventory of the page and which rules in `jobs-brand.css` they hit.

**Prompt.**
> Session C1 of `docs/superpowers/plans/2026-08-20-ops-board-conversion-SESSION-PLAN.md`,
> executing Task 1 of `docs/superpowers/plans/2026-08-20-ops-board-conversion.md` —
> read both first, then read `app/board/board.tsx` and `styles/control.css` as the
> vocabulary. Mission: the job page `/ops/leads/[id]` speaks the board language.
> Markup classes only; every form action and field name byte-identical; no invented
> numbers. Present the section map before converting. Exit: typecheck, lint,
> `test:shop-brain` green; owner approves the page at the preview URL opened from a
> real board row.

### C2 — Intake

**Scope.** Plan Task 2: `/ops/intake/new`, `/ops/intake/[draftId]`, and their local
components. Field names and option lists untouched (`mcsw-jobs-activation` pins
them).

**Not-touched.** Extraction logic, draft persistence, any other route.

**Routing.** Codex medium. Pi: class inventory sweep.

**Prompt.**
> Session C2 of `docs/superpowers/plans/2026-08-20-ops-board-conversion-SESSION-PLAN.md`,
> executing Task 2 of `docs/superpowers/plans/2026-08-20-ops-board-conversion.md` —
> read both, plus `styles/control.css` and the C1 diff as the pattern. Mission:
> intake pages in board language, every field name and option list untouched. Exit:
> suites green, owner approves at preview.

### C3 — Accounts + analytics

**Scope.** Plan Task 3: `/ops/accounts/[id]`, `/ops/analytics`. Analytics stays
shop-level — restyling adds no per-worker anything.

**Not-touched.** Data queries.

**Routing.** Codex medium.

**Prompt.**
> Session C3 of `docs/superpowers/plans/2026-08-20-ops-board-conversion-SESSION-PLAN.md`,
> executing Task 3 of `docs/superpowers/plans/2026-08-20-ops-board-conversion.md` —
> read both, follow the C1 pattern. Mission: accounts and analytics in board
> language; shop-level numbers only. Exit: suites green, owner approves at preview.

### C4 — Call sketch, shop, install

**Scope.** Plan Task 4: the three small pages. Call-sketch page chrome only — the
component already ships dark inside the board; `call-sketch-*` suites stay green.

**Not-touched.** `components/call-sketch` internals beyond class names its page
chrome owns.

**Routing.** Codex medium.

**Prompt.**
> Session C4 of `docs/superpowers/plans/2026-08-20-ops-board-conversion-SESSION-PLAN.md`,
> executing Task 4 of `docs/superpowers/plans/2026-08-20-ops-board-conversion.md` —
> read both, follow the C1 pattern. Mission: call-sketch, shop, and install pages in
> board language. Exit: suites green (all `call-sketch-*` included), owner approves.

### C5 — Build sheets

**Scope.** Plan Task 5: `/ops/leads/[id]/builds` and `components/build-sheets`
markup. Five `build-sheets-*` suites pin behavior.

**Not-touched.** Build-sheet domain logic and persistence.

**Routing.** Codex high — paperwork the shop runs on.

**Prompt.**
> Session C5 of `docs/superpowers/plans/2026-08-20-ops-board-conversion-SESSION-PLAN.md`,
> executing Task 5 of `docs/superpowers/plans/2026-08-20-ops-board-conversion.md` —
> read both, follow the C1 pattern. Mission: build sheets in board language, domain
> logic untouched. Exit: all five build-sheets suites green, owner approves.

### C6 — Sign-in + error surfaces

**Scope.** Plan Task 6: `login-form.tsx`, `error.tsx`, `loading.tsx`,
`not-found.tsx`. The auth flow itself is untouched — classes and structure only.

**Not-touched.** `lib/ops-auth.ts`, cookie names, token logic.

**Routing.** Codex medium. Touches auth-adjacent files but only their markup; any
change beyond className is out of scope and flags.

**Prompt.**
> Session C6 of `docs/superpowers/plans/2026-08-20-ops-board-conversion-SESSION-PLAN.md`,
> executing Task 6 of `docs/superpowers/plans/2026-08-20-ops-board-conversion.md` —
> read both. Mission: sign-in card and error surfaces in board language. Auth logic
> byte-identical — className and structure only. Exit: suites green, sign-in
> round-trip works at preview, owner approves.

### C7 — Layout flip + front door

**Scope.** Plan Task 7: ops layout imports `control.css`, colorScheme dark,
restyled `OpsCompactHeader`/`ConnectivityStatus`/`OpsLive` kept; `/ops` home becomes
`redirect("/board")`; `jobs.css` + `jobs-brand.css` deleted after the grep proves
nothing references them; `scripts/ops-conversion-exit.test.mjs` written per plan.
Ask the owner before deleting `weighted-job-index`/`active-job-index`.

**Not-touched.** Child page markup (already converted), auth, data.

**Routing.** Opus/Fable high — the one hard-to-reverse session: shared chrome under
every page, the front-door decision, and a 7,291-line deletion. Present the flip
order and the grep results for sign-off before deleting anything.

**Prompt.**
> Session C7 of `docs/superpowers/plans/2026-08-20-ops-board-conversion-SESSION-PLAN.md`,
> executing Task 7 of `docs/superpowers/plans/2026-08-20-ops-board-conversion.md` —
> read both. Mission: flip the ops layout to the board language, make `/board` the
> front door, retire the legacy stylesheets. Present the flip order and the
> reference-grep results before deleting anything. Exit: exit test green, full
> `test:shop-brain` green, every route walked signed in as owner and as crew at the
> preview, crew sees no money.

### C8 — Exit verification

**Scope.** Plan Task 8: full suite run, 320/375/768 passes on board+job+intake,
print pass, tick the plan, note stylesheet retirement in
`MCSW-JOBS-BUILD-HANDOFF.md`.

**Not-touched.** Everything — verification only; a failure files a fix note, it does
not patch inline.

**Routing.** Codex high.

**Prompt.**
> Session C8 of `docs/superpowers/plans/2026-08-20-ops-board-conversion-SESSION-PLAN.md`,
> executing Task 8 of `docs/superpowers/plans/2026-08-20-ops-board-conversion.md` —
> read both. Mission: verify the whole conversion. Full suites, breakpoint passes,
> print pass, tick the plan checklist, record the stylesheet retirement. Exit:
> everything green and the plan marked done, or a precise list of what is not.
