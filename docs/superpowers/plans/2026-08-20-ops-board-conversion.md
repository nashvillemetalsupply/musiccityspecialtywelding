# Ops → Board Design Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every owner-facing `/ops` page wears the approved `/board` design language — dark, Golos/Chivo, square corners, the board's chrome — so leaving the board never drops the owner into the old light app.

**Architecture:** Extract the board's tokens, roles, and component classes from `app/board/board.css` into a shared stylesheet both routes import. Convert `/ops` pages one at a time to that vocabulary — markup changes only, every server action, form `name=`, data path, and invariant untouched. The ops layout flips to dark board chrome last, after every child page speaks the language. `/ops` home then redirects to `/board`, which becomes the front door.

**Tech Stack:** Next.js 16 App Router, plain CSS (no Tailwind on these surfaces), Neon Postgres (untouched), node --test suites in `scripts/`.

**Session split:** `2026-08-20-ops-board-conversion-SESSION-PLAN.md` (C0–C8) — execute from there, one session per chat.

**Spec:** The shipped `/board` page is the spec — `app/board/board.tsx` + `app/board/board.css` (its header comment documents the five rules). Approved by the owner, live in production. `design.md` and `tokens.css` carry the locked palette.

## Global Constraints

- All invariants in `CLAUDE.md` hold: crew money removed **server-side**; `[INTERNAL TEST]`/`is_test` survive every path; `events` immutable; every SQL interpolation carries an explicit cast; roles are exactly `owner` and `crew`; no worker surveillance.
- **Zero data-layer changes.** This plan touches markup and CSS only. No migration, no new column, no action signature change. Any task that finds itself editing `lib/` or `actions.ts` beyond an import path has left its scope — stop and flag.
- **No invented numbers.** A slot with no real data states its absence ("No price", "No photos yet") exactly as the board does. Fixture text never ships.
- **Square corners, board palette, Golos Text for prose, Chivo for numbers.** No component names a hex — raw palette → semantic role → component, per board.css rule 1.
- **Owner gate per page.** Each page task ends with the owner eyeballing the deployed preview. 13 prior `/ops` redesign attempts were rejected; the mitigation is that this is not a redesign — it is the already-approved board language applied. Deviating from board vocabulary re-opens that graveyard. Don't.
- Every task green on `npm run typecheck`, `npm run lint`, `npm run test:shop-brain` before commit. Pages already covered by suites (`mcsw-jobs-activation`, `event-visibility`, `production-flow-regressions`, `job-line-items`, `build-sheets-*`, `call-sketch-*`) must stay green — they pin the behavior this plan must not change.
- Crew uses `/ops` on phones in the shop. Every converted page keeps 44px touch targets on coarse pointers and no horizontal scroll at 320px — both already solved in board.css; reuse, don't re-derive.

---

### Task 0: Shared control-room stylesheet

**Files:**
- Create: `styles/control.css` (tokens, roles, and reusable component classes lifted from `app/board/board.css`)
- Modify: `app/board/board.css` (delete the lifted blocks, `@import "../../styles/control.css"` — board renders pixel-identical after)
- Test: `scripts/control-css.test.mjs`

**Interfaces:**
- Produces: class vocabulary all later tasks consume — layout: `.app`, `.rail`, `.pane`, `.main`, `.top`; type: `.t-sub`, `.t-caption`; controls: `.btn`, `.btn--sm`, `.btn--go`, `.btn--edge`, `.icon`, `.chip`, `.chip--info` (+ tone variants), `.find`; surfaces: `.card`, `.job`, `.job-row`, `.detail`, `.sum`; tokens: every `--*` custom property board.css defines.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test** — `scripts/control-css.test.mjs`:

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const control = readFileSync("styles/control.css", "utf8")
const board = readFileSync("app/board/board.css", "utf8")

test("control.css owns the tokens and board.css imports it", () => {
  assert.match(control, /--surface-raised\s*:/)
  assert.match(control, /\.btn--go\b/)
  assert.match(board, /@import\s+"..\/..\/styles\/control.css"/)
})

test("no component in control.css names a raw colour", () => {
  // roles are defined once in the :root token block; component rules use var()
  const afterTokens = control.slice(control.indexOf("}") + 1)
  assert.doesNotMatch(afterTokens, /#[0-9a-fA-F]{3,8}\b/)
})
```

- [ ] **Step 2: Run it** — `node --test scripts/control-css.test.mjs` — expect FAIL (file missing).
- [ ] **Step 3: Extract.** Move from `board.css` into `control.css`: the font `@import`, the full `:root` token/role block, dark/light scheme blocks, `.btn*`, `.chip*`, `.icon`, `.find`, `.t-*` type classes, focus-visible rules, the touch-target and safe-area blocks. Leave in `board.css` everything board-page-specific (`.job`, `.stages`, `.why`, `.sum`, `.sketch`, pane/rail layout). Add the `@import` at the top of `board.css`.
- [ ] **Step 4: Verify board unchanged** — `npm run typecheck && npm run lint && node --test scripts/job-control-tracker.test.mjs scripts/control-css.test.mjs`, then eyeball `/board` locally: identical before/after.
- [ ] **Step 5: Commit** — `git commit -m "refactor(design): extract board language into styles/control.css"`

### Task 1: Job page — `/ops/leads/[id]`

The page "Open job" lands on; the highest-traffic mismatch. Convert first so board → job stays in one design.

**Files:**
- Modify: `app/ops/leads/[id]/page.tsx` (845 lines: markup classes only — every form, action, and field name stays byte-identical)
- Create: `app/ops/leads/[id]/job.css` (page-specific rules in board vocabulary, importing nothing — tokens come from the layout once Task 7 flips; until then the page imports `styles/control.css` directly)
- Test: extend `scripts/job-line-items.test.mjs`

**Interfaces:**
- Consumes: Task 0's class vocabulary.
- Produces: the conversion pattern every later page task copies — old `jobs.css` classes → board classes, section headed by `.t-sub`, actions as `.btn--sm .btn--edge`, money in Chivo via the token already set on `.sum`-style tables.

- [ ] **Step 1: Map the page.** Read the full page. List every rendered section (customer header, estimate form, line-items form, photos, events trail, build-sheets link, claims, notify controls) and the class each currently wears.
- [ ] **Step 2: Add a wrapper test** asserting the page module still exports its actions untouched and its markup carries board classes:

```js
test("job page speaks board language", () => {
  const src = readFileSync("app/ops/leads/[id]/page.tsx", "utf8")
  assert.match(src, /className="t-sub"/)
  assert.doesNotMatch(src, /jobs-brand/)  // no legacy stylesheet hooks
})
```

- [ ] **Step 3: Convert section by section** — classes and structure only; keep every `<form action={...}>`, `name=`, and conditional exactly. The line-items entry (W0) and estimate form get the board's `.sum` table treatment so "What is in it" on the board and the entry form on the job page read as the same object.
- [ ] **Step 4: Verify** — `npm run typecheck && npm run lint && npm run test:shop-brain`; then owner opens a real job from the board at the preview URL. **Owner gate: approval before Task 2.**
- [ ] **Step 5: Commit** — `git commit -m "feat(ops): convert the job page to the board language"`

### Task 2: Intake — `/ops/intake/new` + `/ops/intake/[draftId]`

**Files:**
- Modify: `app/ops/intake/new/page.tsx`, `app/ops/intake/[draftId]/page.tsx`, and the components they render (`inline-job-intake`, `paperwork-submit` under `app/ops/intake/`)
- Test: `scripts/mcsw-jobs-activation.test.mjs` stays green (it reads intake form option lists)

Steps mirror Task 1: map, convert classes, keep every field name and action, verify, owner gate, commit `feat(ops): convert intake to the board language`.

### Task 3: Accounts + analytics — `/ops/accounts/[id]`, `/ops/analytics`

**Files:**
- Modify: `app/ops/accounts/[id]/page.tsx` (52), `app/ops/analytics/page.tsx` (171), their local components
- Constraint reminder: analytics stays shop-level only — no per-worker numbers exist and none get invented while restyling.

Steps mirror Task 1. Commit `feat(ops): convert accounts and analytics to the board language`.

### Task 4: Call sketch + shop + install — `/ops/call-sketch`, `/ops/shop`, `/ops/install`

**Files:**
- Modify: `app/ops/call-sketch/page.tsx` (31 — wrapper over `@/components/call-sketch`), `app/ops/shop/page.tsx` (100), `app/ops/install/page.tsx` (37)
- The call-sketch component already ships dark inside the board; this task converts its standalone page chrome only. `scripts/call-sketch-*.test.mjs` all stay green.

Steps mirror Task 1. Commit `feat(ops): convert call sketch, shop and install pages`.

### Task 5: Builds — `/ops/leads/[id]/builds`

**Files:**
- Modify: `app/ops/leads/[id]/builds/page.tsx` (279) + `components/build-sheets/*` markup classes
- `scripts/build-sheets-*.test.mjs` (5 suites) pin behavior; all stay green.

Steps mirror Task 1. Commit `feat(ops): convert build sheets to the board language`.

### Task 6: Auth + error surfaces

**Files:**
- Modify: `app/ops/login-form.tsx`, `app/ops/error.tsx`, `app/ops/loading.tsx`, `app/ops/not-found.tsx`
- The sign-in card is the first thing anyone sees; it currently renders on a light field.

Steps mirror Task 1. Commit `feat(ops): convert sign-in and error surfaces`.

### Task 7: Layout flip + front door

Only after Tasks 1–6: every child now speaks board vocabulary, so the shared chrome can change under all of them at once.

**Files:**
- Modify: `app/ops/layout.tsx` — import `styles/control.css` instead of `jobs.css`/`jobs-brand.css`; `colorScheme: "dark"`; keep `OpsCompactHeader`, `ConnectivityStatus`, `OpsLive` (they carry live behavior — restyle, don't rebuild); remove per-page direct `control.css` imports added in Tasks 1–6.
- Modify: `app/ops/page.tsx` — replace the dashboard body with `redirect("/board")`. The board is the front door; two job lists was always one too many. The weighted index components it rendered (`weighted-job-index`, `active-job-index`) are deleted **only if nothing else imports them** — `grep -rn "weighted-job-index\|active-job-index" app components` first.
- Delete: `app/ops/jobs.css`, `app/ops/jobs-brand.css` (7,291 lines) — **only after** `grep -rn "jobs.css\|jobs-brand\|jobs-product-frame\|data-jobs-theme" app components lib` returns nothing outside the files being deleted this task.
- Test: `scripts/ops-conversion-exit.test.mjs`

- [ ] **Step 1: Write the exit test:**

```js
test("ops layout wears the board language and the old sheets are gone", () => {
  const layout = readFileSync("app/ops/layout.tsx", "utf8")
  assert.match(layout, /control.css/)
  assert.doesNotMatch(layout, /jobs-brand/)
  assert.equal(existsSync("app/ops/jobs-brand.css"), false)
})
test("/ops front door is the board", () => {
  assert.match(readFileSync("app/ops/page.tsx", "utf8"), /redirect\("\/board"\)/)
})
```

- [ ] **Step 2: Flip, redirect, delete, run everything** — full `npm run test:shop-brain` + typecheck + lint.
- [ ] **Step 3: Walk every route signed in as owner AND as crew** at the preview: /board, a job, intake, accounts, analytics, call-sketch, shop, install, builds, sign-out/sign-in. Crew sees no money anywhere (server-side check unchanged — verify by eye anyway).
- [ ] **Step 4: Owner gate on the whole app. Then commit** — `git commit -m "feat(ops): flip the layout to the board language and make /board the front door"`

### Task 8: Exit verification

- [ ] `npm run typecheck && npm run lint && npm run test:shop-brain` — all green.
- [ ] 320px/375px/768px pass on the three highest-traffic pages (board, job, intake): no horizontal scroll, 44px targets.
- [ ] Print pass: the owner prints the board Mondays — `@media print` rules survived the extraction.
- [ ] Mark this plan done; note in `MCSW-JOBS-BUILD-HANDOFF.md` that `jobs.css`/`jobs-brand.css` are retired.

## Self-Review

- **Coverage:** every route under `app/ops` has a task (dashboard→redirect T7; leads T1; intake T2; accounts+analytics T3; call-sketch+shop+install T4; builds T5; auth/error T6; layout T7). `/j/[token]` (customer GLASS page) is deliberately out: customer-facing, separate design decision — flag to owner, not silently included.
- **Placeholder scan:** conversion steps necessarily say "convert classes" rather than reprint 845 lines — the contract making that safe is Task 0's produced vocabulary plus the byte-identical-behavior constraint and green pinned suites. Test code shown is real and runnable.
- **Type consistency:** no new exported types; class names in tests match Task 0's produced list.
