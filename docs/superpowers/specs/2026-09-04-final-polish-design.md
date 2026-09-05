# Final polish — accessibility, type, rhythm, and the gate that proves it

**Date:** 2026-09-04. **Status:** approved 2026-09-05 (14px scale and preview deletion decided in the planning session); execute from the session plan.
**Plan:** `docs/superpowers/plans/2026-09-04-final-polish.md`.

## What this is, and what it is not

This is the last optimization round on the CRM (`/board` and every `/ops/*`
route). It makes the shipped board language *correct* — measured, not eyeballed —
and it does not change the language. Thirteen `/ops` redesigns were rejected;
the board vocabulary in `styles/control.css` + `app/board/board.css` is the
approved reference, and every task below is applied inside it. No new props, no
new palette, no new layout. Anything a session is tempted to "improve" visually
is out of scope.

The owner's own words for the target: **"highly accessible"**, readable "for an
old dude", "nothing below 14px", "phone type one step larger". Those are the
acceptance bar. The public marketing site is locked and untouched.

## What the survey found (2026-09-04, `12965ec`)

| Area | Finding | Consequence |
|---|---|---|
| Measurement | No accessibility measurement exists for the CRM at all. The only Lighthouse runs are the marketing homepage (`accessibility: 1.0`). `/board` is behind auth and has never been audited by a tool. | Every claim of "accessible" so far is by eye. |
| Type floor | `styles/control.css` base scale: body 13.5px, data 13.5px, label 12px, caption 11.5px. Phone override in `board.css` lifts to 15 / 13 / 12.5 — only on `/board`, only under 55rem. Desktop and every `/ops` route render 11.5–13.5px. | Violates the owner's stated 14px floor on most of the app. |
| Type source | Two weight ladders (420/500/640 in `control.css`, 400/480/620 in `ops-shell.css`), two type scales (base + phone override), fonts loaded by a Google Fonts `@import` at the top of `control.css` — render-blocking CSS, third-party fetch on every page, FOUT on cold cache. Chivo is *also* loaded via `next/font` in `app/ops/layout.tsx`; Golos never is. | Weights and sizes are defined in three files; one change needs three edits; fonts swap late. |
| Rhythm | 0 off-rhythm px values — the 8px ladder is already held. 8 hard-coded `font-size` px, none under 14. | Spacing is right; it needs a pin so it stays right. |
| Structure | `/board` has **no `h1`**; `/ops/shop` has three; `/ops/intake/new` has none. No skip link anywhere (the grep hit is `result.skipped`). 27 `<main>` across 14 routes — nested mains likely. | Screen-reader landmark navigation is broken on the front door. |
| Forms | Zero `autocomplete`, zero `inputmode` on any input in `app/ops` / `app/board`. 14 files with `<label>` against 23 with `<input>`. | Phones cannot autofill name/tel/email on intake; numeric keypad never appears for money. |
| Focus / modes | `focus-visible` exists per component (12 CSS rules) with no global rule; one `outline:none`. `prefers-reduced-motion` only in `board.css` — `/ops` transitions never stop. No `forced-colors` rule; chips and tabs vanish in Windows High Contrast. | Keyboard and OS-accessibility users get parity on `/board` only. |
| Error surfaces | `error.tsx` / `not-found.tsx` / `loading.tsx` exist under `/ops` only. `/board` (a top-level route) has none — a thrown error there falls to Next's default page. | The front door's failure state is unstyled. |
| Dead CSS | `app/globals.css` is 8,968 lines, ~5,449 of them ops-era rules for 234 `.ops-*` selectors; 131 are still referenced. Every marketing and CRM page ships the whole file. `app/design-preview/*` — 9 unauthenticated public routes of rejected drafts, ~9,500 lines of CSS — are still built and served. | Page weight, cascade fights (the 1.0:1 contrast bug of 2026-09-03 came from here), and rejected drafts reachable by URL. |

## Decisions

1. **Measure first, fix, measure again.** The first task builds the gate
   (Playwright + axe-core against a signed-in Vercel preview, every route, every
   breakpoint) and records the *before* numbers. The last task re-runs it and
   publishes the *after* table. No task in between claims a result the gate does
   not show.
2. **One type system, one file.** `styles/control.css` becomes the single owner
   of scale, weights, line-heights, and rhythm. The phone override in `board.css`
   and the weight ladder in `ops-shell.css` are deleted, not moved. The floor is
   **14px everywhere** — the owner's number — with the scale:
   `caption 14 · label 14 · body 15 · data 15 · sub 15 · name 16 · title 18 · lede 22 · display 40→56`.
   Line-heights: body 1.5, data 1.35, label 1.3, name 1.3, title 1.25, lede 1.25,
   display 1.0. Phone and desktop share the scale; only `display` and `title`
   step up with the viewport, as today.
3. **Weights are one ladder, corrected for ground.** Light ground 420 / 500 / 640.
   Dark ground 400 / 480 / 620 — light text on dark reads heavier, so the dark
   step is one notch lighter. Both ladders live in `control.css`; the dark ladder
   rides the same `[data-theme="dark"]` / `prefers-color-scheme` / `.ops-shell`
   selectors that already switch the palette.
4. **Fonts self-hosted through `next/font`.** `app/fonts.ts` exports Golos Text
   and Chivo on their variable axes with `display: "swap"`, Latin subset, and
   `adjustFontFallback` so the metric-matched fallback holds layout while the
   face loads. The `@import` in `control.css` goes. The Chivo instance in
   `app/ops/layout.tsx` is replaced by the shared one.
5. **Landmarks are real.** One `h1` per page, one `<main id="main">` per page,
   a skip link as the first focusable element on both shells, `aria-current="page"`
   on the rail, a `<title>` per route. `/board` gets `error.tsx`,
   `not-found.tsx`, `loading.tsx` in the board vocabulary.
6. **Forms autofill and speak.** Every text input carries `autocomplete`
   (`name`, `tel`, `email`, `street-address`, `off` for free text) and
   `inputmode` (`tel`, `numeric` for money, `decimal` for measurements); every
   input has an associated label; hints and errors are wired via
   `aria-describedby`; a failed submit moves focus to the first invalid field;
   pending submits set `aria-busy`.
7. **Modes are parity, not extras.** Global `:focus-visible` in `control.css`;
   `prefers-reduced-motion` in `control.css` (so it covers `/ops`);
   `forced-colors: active` borders on chips, tabs, buttons, and the tracker's
   service marks; `prefers-contrast: more` lifts `--text-muted` to
   `--text-secondary` and `--border` to `--border-strong`. Every state that is
   conveyed by colour today also carries text (visible or `sr-only`).
8. **Dead CSS goes, with a fingerprint to prove nothing moved.** The 131 live
   `.ops-*` selectors move to `styles/ops-legacy.css`, imported by the ops layout
   and the three board satellites; the other ~5,300 lines are deleted from
   `globals.css`. The marketing half of `globals.css` is not touched. A computed-
   style fingerprint (per route, per class: font, colour, background, padding,
   display) is captured before the move and diffed after, because load order
   changes and order is what decided the 2026-09-03 contrast bug.
   `app/design-preview/*` is deleted — rejected drafts, public, kept in git
   history. Decided 2026-09-05. The folder at the repo root named
   `design-previews/` (static images) stays.
9. **No redesign, no new abstraction.** No component library, no Tailwind
   migration, no token rename. Where a task can be a deletion, it is a deletion.

## Acceptance Criteria

- **Given** any CRM route, signed in as owner, at 320 / 375 / 768 / 1440 widths,
  **when** the gate runs axe with the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` tags,
  **then** it reports zero violations.
- **Given** any CRM route, **when** the gate walks every rendered text node,
  **then** no computed `font-size` is below 14px and none is a hard-coded px in
  the board-language stylesheets.
- **Given** any CRM route, **when** the gate checks structure, **then** exactly
  one `h1`, exactly one `main`, a skip link that is the first focusable element
  and moves focus to `main`, and no heading level skipped.
- **Given** `/ops/intake/new` on a phone, **when** the owner taps the name, phone,
  or email field, **then** the OS offers autofill and the phone field opens the
  tel keypad.
- **Given** any CRM route with `prefers-reduced-motion: reduce`, **then** no
  transition or transform animates; with `forced-colors: active`, **then** every
  chip, tab, button and tracker mark keeps a visible boundary.
- **Given** `/board` throws or is asked for a job that does not exist, **then**
  the error and not-found pages render in the board vocabulary with a link back
  to the tracker.
- **Given** the CSS retirement is done, **when** the fingerprint diff runs,
  **then** no live `.ops-*` class changed a computed value on any route, and
  `app/globals.css` no longer contains an ops-era rule.
- **Given** the owner opens `/board` on a cold cache, **then** no request goes to
  `fonts.googleapis.com`, and text renders in the fallback face without a layout
  shift before Golos loads.
- **Given** a crew session, **then** nothing in this round adds a money figure,
  a per-worker count, or any surveillance surface.

## QA Procedure

1. Root only: `npm i -D @playwright/test @axe-core/playwright` and
   `npx playwright install chromium`. Then `node scripts/create-local-login.mjs`,
   swap `localhost:3030` for the preview host, and export it as
   `MCSW_QA_LOGIN_URL`; export `MCSW_QA_BASE`, `MCSW_QA_JOB_ID`,
   `MCSW_QA_ACCOUNT_ID`.
2. `npx playwright test scripts/qa/final-polish.spec.mjs` — read the summary
   table: violations per route, minimum font-size per route, structure checks,
   overflow at each width. Before the round this table is the baseline; after,
   it is the proof.
3. Open `/board` in Chrome DevTools, Network, filter `font`: confirm the two
   faces come from `/_next/static/media/` and no request goes to
   `googleapis`. Reload with cache disabled and watch for a layout jump — there
   must be none.
4. On a phone, open `/ops/intake/new`: tap the phone field (tel keypad), the
   name field (autofill chip), submit empty (focus lands on the first invalid
   field, error text is read).
5. Keyboard only, from the top of `/board`: Tab once (skip link appears),
   Enter (focus lands on the tracker), Tab through the rail (each link shows a
   2px focus ring), open a job row with Enter, close with Enter.
6. Windows: Settings → Accessibility → Contrast themes → any theme. Walk `/board`,
   a job page, intake: chips, tabs, buttons and tracker marks all keep a border.
7. Chrome DevTools → Rendering → emulate `prefers-reduced-motion: reduce`:
   toggle the theme, open a row, open the calls dropdown — nothing animates.
8. Visit `/board/nope` and a job id that does not exist: board-vocabulary
   not-found page with a link back to the tracker.
9. Visit each of the nine `app/design-preview/*` URLs: 404.
10. Owner eyeballs the preview URL for every visual task before the next session
    opens. That is the gate that has always mattered here.
