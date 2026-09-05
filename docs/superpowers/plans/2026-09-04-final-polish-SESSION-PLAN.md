# Final polish — session plan

Splits `2026-09-04-final-polish.md` (spec: `docs/superpowers/specs/2026-09-04-final-polish-design.md`).

**Rules.** One row = one fresh chat = one bounded mission. Set the session model in
the picker **before** pasting the prompt. Run one session at a time. Each session
marks its own row done or blocked when it closes.

**Routing authority.** `CLAUDE.md` rules apply: plan-attached implementation routes
to Codex `gpt-5.6-sol`; Pi carries the reading and mechanical sweeps inside every
session (`delegate-to-pi`); Codex `xhigh` reviews every branch before merge (the
Shepherd integrator does this serially). **The Codex sandbox has no network**, so
every step that signs in to a preview or production — the gate, the fingerprint
capture, DevTools checks, the owner walk — runs in a Claude session with Chrome.

**Verification, every session:** `npm run typecheck`, `npm run lint`,
`npm run test:shop-brain` green before the row is marked done. A session that adds a
client-side value import from `lib/` also runs `npx next build`.

**Standing notes:**

- **Owner gate per visual session.** P1, P2 and P5 change pixels the owner will see.
  Each ends with the preview URL in the owner's Chrome; the next session does not open
  until the owner says yes. P3 and P4 change nothing visible in default modes; they
  still get the preview link.
- **The floor is 14px.** Any session that finds a token, rule or inline style under it
  fixes it in place even if it is outside the session's file list, and says so.
- **No redesign.** A session tempted to "improve" the board's look has left scope.
- **Root-only jobs** (P0): `npm i`, `npx playwright install chromium`. Worktrees junction
  `node_modules`.
- **Dev does not run in a worktree.** Verify on the branch's Vercel preview with
  `node scripts/create-local-login.mjs` (host swapped).
- Deleting `app/design-preview/` is decided (2026-09-05). P5 does not ask.

## Sessions

| ID | Mission (plan task) | Session model | Effort | Size | Depends on | Status |
|----|--------------------|---------------|--------|------|------------|--------|
| P0 | Task 0: the gate — Playwright + axe against signed-in production, baseline frozen | Claude Fable | medium | M | — | **done** — baseline frozen 2026-09-04 |
| P1 | Task 1: one type system, 14px floor, one weight ladder, fonts via `next/font` | Codex `gpt-5.6-sol` | high | M | P0 (baseline exists) | **merged** — owner approval outstanding |
| P2 | Task 2: landmarks, one h1, skip link, `/board` error surfaces | Codex `gpt-5.6-sol` | medium | M | P1 approved | **merged** (Codex, review PASS) — owner approval outstanding |
| P3 | Task 3: forms — autofill, keypads, labels, focus on first error | Codex `gpt-5.6-sol` | medium | S | P0 | **merged** (Codex, review PASS) |
| P1b | **Added, not in the original plan.** The 14px floor reaches `app/globals.css`: 39 sub-floor declarations, and the axe contrast node | Codex `gpt-5.6-sol` | high | S | P1, P4 (found it) | **merged** (Codex, review PASS) |
| P4 | Task 4: focus ring, reduced motion, forced colours, more-contrast | Codex `gpt-5.6-sol` | medium | S | P1 (control.css settled) | **merged** (Codex, review PASS) — owner approval outstanding |
| P4c | Mid-round gate: `test:qa` on the P1–P4 preview; capture `pre-retirement-fingerprint.json` | Claude Sonnet | low | S | P1–P4 merged | **blocked** — Vercel protection blocks the gate from previews; fingerprint never captured |
| P5 | Task 5: retire dead CSS into `ops-legacy.css`; delete the seven preview routes | Codex `gpt-5.6-sol` | high | L | P4c | **merged** (Codex, review PASS) — verbatim proof green; owner approval outstanding |
| P6 | Task 6: strict gate, fingerprint diff, owner walk, before/after tables, record | Claude Fable | high | M | P5 merged + deployed | **blocked** — needs a landed build or a Vercel bypass secret; see QA execution record |

**Recommended order:** P0 → P1 → P3 (gap-filler, independent of P1's approval) → P2 →
P4 → P4c → P5 → P6. P3 can run while the owner is looking at P1's preview.

**Top-tier spend** is P0 and P6 only — the two sessions that hold a browser against
the live app and decide what the numbers mean. P1–P5 are plan-attached Codex work.
P4c is a mechanical network run and takes Sonnet.

---

## P0 — The gate and the baseline

**Scope.** Task 0 in full: install the two dev deps at the root, write
`scripts/qa/routes.mjs`, `scripts/qa/playwright.config.mjs`,
`scripts/qa/final-polish.spec.mjs`, wire `test:qa`, run it against production signed
in as owner, freeze `scripts/qa/baseline/2026-09-04-*.{md,json}`, paste the baseline
table into the plan.

**Not-touched.** No app code. No CSS. No fix of anything the baseline finds — that is
the whole point of a baseline.

**Routing.** Session model Claude Fable (needs Chrome + the one-use login). Pi:
none needed. The spec is written in the plan; type it in, do not redesign it.

**Paste-ready prompt:**

> Session **P0** of `docs/superpowers/plans/2026-09-04-final-polish-SESSION-PLAN.md`.
> Execute **Task 0** of `docs/superpowers/plans/2026-09-04-final-polish.md` exactly as
> written: the Playwright + axe gate, run against production signed in as owner via
> `node scripts/create-local-login.mjs` (swap the host), baseline frozen under
> `scripts/qa/baseline/`, table pasted into the plan. Root-only: `npm i` and
> `npx playwright install chromium`. Touch no app code or CSS — this session measures,
> it does not fix. Present the file list and the env vars you will use before writing
> anything. Close by marking P0 done in the session plan.

## P1 — One type system

**Scope.** Task 1 in full: `app/fonts.ts`, the type block and both weight ladders in
`styles/control.css`, delete the phone override in `board.css` and the weight copy in
`ops-shell.css`, retire the 8 hard-coded `font-size` px, apply the font variables on
all five shell roots, `scripts/type-system.test.mjs` wired into `test:shop-brain`,
`npx next build` green, branch pushed, preview link handed to the owner.

**Not-touched.** No markup beyond className changes. No new token. No `lib/`.
`/j/[token]` untouched.

**Routing.** Codex `gpt-5.6-sol` at high. Pi: the sweep for hard-coded `font-size`
and for `--font-mcsw-jobs` uses. The Chrome check (no `googleapis` request, no layout
shift) and the owner's eyeball happen after the push, outside the sandbox.

**Paste-ready prompt:**

> Session **P1** of `docs/superpowers/plans/2026-09-04-final-polish-SESSION-PLAN.md`.
> Execute **Task 1** of `docs/superpowers/plans/2026-09-04-final-polish.md`: one type
> scale with a 14px floor and one weight ladder in `styles/control.css`, fonts through
> `app/fonts.ts` (`next/font`), duplicates in `board.css` and `ops-shell.css` deleted,
> the pin test wired in. Scope is CSS, `app/fonts.ts`, and className edits on the five
> shell roots; nothing else. Present your plan before code. Run typecheck, lint,
> `test:shop-brain`, and `npx next build`; push the branch and hand back the preview
> URL. The owner approves the preview before P2 opens.

## P2 — Landmarks and the board's error surfaces

**Scope.** Task 2 in full: `SkipLink`, `main#main` on every route (ops layout owns it;
board and satellites carry their own), one `h1` per page, titles on every page,
`app/board/{error,not-found,loading}.tsx` in the board vocabulary, `scripts/landmarks.test.mjs`.

**Not-touched.** No CSS beyond `.skip` and `.empty-state`. No behaviour change in any
form or action.

**Routing.** Codex `gpt-5.6-sol` at medium. Pi: enumerate every `<main` and `<h1` in
`app/board` and `app/ops` before the edit.

**Paste-ready prompt:**

> Session **P2** of `docs/superpowers/plans/2026-09-04-final-polish-SESSION-PLAN.md`.
> Execute **Task 2** of `docs/superpowers/plans/2026-09-04-final-polish.md`: skip link
> on both shells, exactly one `main#main` and one `h1` per route, a title per page, and
> `/board`'s own error / not-found / loading pages in the board language. Markup only;
> CSS limited to the `.skip` and `.empty-state` rules the plan gives. Present your plan
> before code. Suites green, branch pushed, preview URL handed back for the owner's
> eyeball before P4 opens.

## P3 — Forms

**Scope.** Task 3 in full: the attribute contract on every input under `app/ops` and
`app/board`, labels, `aria-describedby`, focus-to-first-invalid, `aria-busy`,
`scripts/form-affordances.test.mjs`.

**Not-touched.** No validation logic, no `actions.ts`, no schema, no copy changes.

**Routing.** Codex `gpt-5.6-sol` at medium. Pi: list every `<input|select|textarea`
with its file and current attributes first.

**Paste-ready prompt:**

> Session **P3** of `docs/superpowers/plans/2026-09-04-final-polish-SESSION-PLAN.md`.
> Execute **Task 3** of `docs/superpowers/plans/2026-09-04-final-polish.md`: the
> autofill / keypad / label contract on every CRM form field, focus to the first invalid
> field on a failed submit, `aria-busy` while pending, pin test wired in. Attributes and
> one focus effect only — no validation or server changes. Present your plan before
> code. Suites green, branch pushed, preview URL handed back; the owner checks the tel
> keypad and autofill on a phone.

## P4 — Modes

**Scope.** Task 4 in full: the four global blocks in `control.css`, the per-component
focus rules removed, `board.css:509` removed, the colour-only walk in Step 4 recorded
in the commit body, `scripts/modes.test.mjs`.

**Not-touched.** No palette change in default modes. No new selector on any component.

**Routing.** Codex `gpt-5.6-sol` at medium. Pi: the `outline:none` / `:focus-visible` /
`transition` sweep.

**Paste-ready prompt:**

> Session **P4** of `docs/superpowers/plans/2026-09-04-final-polish-SESSION-PLAN.md`.
> Execute **Task 4** of `docs/superpowers/plans/2026-09-04-final-polish.md`: global
> focus ring, reduced motion, forced-colors and prefers-contrast blocks in
> `styles/control.css`, duplicates removed, the colour-only state walk written into the
> commit body, pin test wired in. Present your plan before code. Suites green, branch
> pushed, preview URL handed back.

## P4c — Mid-round gate

**Scope.** Sign in to the preview that carries P1–P4 merged, run `npm run test:qa`
(STRICT off), read the summary table against the baseline, copy
`scripts/qa/report/fingerprint.json` to `scripts/qa/baseline/pre-retirement-fingerprint.json`,
commit it. If the table shows a route still under 14px or with an axe violation a
P1–P4 task was supposed to clear, file it as a one-line note in the plan under that
task — do not fix it here.

**Not-touched.** No app code.

**Routing.** Claude Sonnet, low effort. Chrome for the login.

**Paste-ready prompt:**

> Session **P4c** of `docs/superpowers/plans/2026-09-04-final-polish-SESSION-PLAN.md`.
> Run the gate (`npm run test:qa`, STRICT off) against the preview with P1–P4 merged,
> compare the summary to `scripts/qa/baseline/2026-09-04-summary.md`, and commit
> `scripts/qa/report/fingerprint.json` as
> `scripts/qa/baseline/pre-retirement-fingerprint.json`. Note any row a P1–P4 task
> should have cleared under that task in the plan. Change no app code. Say what you
> will run before you run it.

## P5 — Retire the dead CSS

**Scope.** Task 5 in full: `styles/ops-legacy.css` holding only the live `.ops-*`
rules moved verbatim; every ops-era block deleted from `app/globals.css` except the
`/j/[token]` and public-stub blocks the plan names; imports added on the ops layout
and three satellites; `ops-shell-tokens.test.mjs` retargeted; `scripts/qa/fingerprint-diff.mjs`;
`scripts/dead-css.test.mjs`; `app/design-preview/` deleted.

**Not-touched.** The marketing half of `globals.css`. `/j/[token]`. The root
`design-previews/` folder. No selector rewritten, no rule "improved" while moving.

**Routing.** Codex `gpt-5.6-sol` at high — this is the hard-to-reverse session. Pi:
build the used-class list and the block inventory of `globals.css` before any move.
The fingerprint diff against the preview runs in P6.

**Paste-ready prompt:**

> Session **P5** of `docs/superpowers/plans/2026-09-04-final-polish-SESSION-PLAN.md`.
> Execute **Task 5** of
> `docs/superpowers/plans/2026-09-04-final-polish.md`: move only the live `.ops-*` rules
> verbatim into `styles/ops-legacy.css`, delete the rest of the ops-era CSS from
> `app/globals.css` (leave the marketing half and the `/j/[token]` blocks the plan
> names), add the imports, write `fingerprint-diff.mjs` and the pin, retarget the token
> test. Present the block inventory and your move list before code. Suites and
> `npx next build` green, note the CSS chunk size before and after in the commit body,
> push, hand back the preview URL. The fingerprint diff runs in P6.

## P6 — Exit verification

**Scope.** Task 6 in full: `MCSW_QA_STRICT=1 npm run test:qa` against production after
P5 deploys; `fingerprint-diff.mjs` pre-retirement vs now (font-size / weight columns
excluded from that comparison only if P1 landed after the pre-retirement capture,
which the order above prevents); QA Procedure steps 3–10 walked by hand; the crew
check; the after table pasted beside the baseline; `### QA execution record` written;
every checkbox ticked; row marked done.

**Not-touched.** Nothing is fixed in this session. A red line is filed as a one-line
follow-up task under the owning task, and the record says so.

**Routing.** Claude Fable, high effort — it decides whether the numbers are good.
Chrome for the walk.

**Paste-ready prompt:**

> Session **P6** of `docs/superpowers/plans/2026-09-04-final-polish-SESSION-PLAN.md`.
> Execute **Task 6** of `docs/superpowers/plans/2026-09-04-final-polish.md`: the strict
> gate against production, the fingerprint diff, QA steps 3–10 walked in Chrome, the
> crew check, the after table beside the baseline, and the QA execution record. Fix
> nothing; file anything red as a one-line follow-up under its task. Say what you will
> run before you run it. Close by ticking the plan and marking P6 done.
