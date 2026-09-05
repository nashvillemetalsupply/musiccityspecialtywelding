# Final polish — handoff

**Landed 2026-09-05. `main` is at `e16e6c2`, deployed to production, measured.**

Plan: `2026-09-04-final-polish.md` (every checkbox ticked).
Session split: `2026-09-04-final-polish-SESSION-PLAN.md`.
Evidence: `scripts/qa/baseline/`.

---

## What changed, in one table

| | Before (2026-09-04) | After (2026-09-05) |
|---|---|---|
| Smallest rendered text, worst route | 10.8px on `/ops/leads` | **14px** |
| Routes with text under the 14px floor | 13 of 13 | **0 of 13** |
| Skip link | absent everywhere | present everywhere, moves focus to `main` |
| Heading order | broken on `/board`, all widths | correct everywhere |
| axe violations (wcag2a/2aa/21a/21aa/22aa) | 1 `color-contrast` | **0** |
| Requests to `fonts.googleapis.com` | 3 on a cold `/board` | **0** |
| `app/globals.css` | 8,968 lines | **3,477**, zero `.ops-*` selectors |
| Dead preview routes | 7 live and public | deleted |

Both runs are `npm run test:qa` against **production signed in as owner**, 13
surfaces × 4 widths. The after run had `MCSW_QA_STRICT=1`, so every number above
is an assertion that passed, not an observation. **52/52 in 3.3 minutes.**

## How to re-run the gate

```powershell
$env:MCSW_QA_BASE = "https://musiccityspecialtywelding.com"
$env:MCSW_QA_LOGIN_URL = (node scripts/create-local-login.mjs) -replace "http://localhost:3030", $env:MCSW_QA_BASE
$env:MCSW_QA_JOB_ID = "290"        # any real open job
$env:MCSW_QA_ACCOUNT_ID = "23"     # any real person id with jobs
$env:MCSW_QA_STRICT = "1"          # omit to record instead of assert
npm run test:qa
```

The login link is one-use and lives 15 minutes. `$env:MCSW_QA_REUSE_AUTH = "1"`
reuses `scripts/qa/.auth.json` within 6 hours instead of burning another.

## Four traps this round paid for. Do not re-learn them.

1. **A percentage is invisible to a grep for sizes.** Tailwind preflight ships
   `small{font-size:80%}`. Six sessions swept for `px` and `rem` under 14 and
   all of them found nothing, while 37 `<small>` elements rendered at 12px.
   `styles/control.css` now floors `small`, `sub` and `sup`, and
   `scripts/type-system.test.mjs` pins it *plus* asserts preflight still ships
   the rule being defended against — so the guard cannot outlive its reason.
2. **`npx next build` cannot run in a worktree.** Turbopack rejects the
   junctioned `node_modules`: *"Symlink [project]/node_modules is invalid, it
   points out of the filesystem root."* Verify the bundle on a Vercel build.
3. **The junctioned `.next` makes `tsc` lie in a worktree.** `tsconfig.json`
   includes `.next/types/**/*.ts`, and the junction points at the *root*
   checkout's generated route validator — so deleting a route in a worktree
   produces `TS2307` about a file you removed on purpose. `rm .next` (plain
   `rm`; it unlinks the symlink, never the target) and re-run.
4. **`existsSync` on a directory is true for an empty one, and git does not
   track empty directories.** An abandoned `app/design-preview/<something>/`
   from three weeks earlier survived the deletion commit and failed a pin at the
   root that passed in the worktree. Pins about deletion should count files.

## Instruments this round added

| File | What it is |
|---|---|
| `scripts/qa/final-polish.spec.mjs` | the gate: axe + floor + landmarks + overflow, per route per width |
| `scripts/qa/run.mjs` | runs it. **Do not** revert to `playwright test …; node report.mjs` — on Windows npm hands that to cmd.exe, where `;` is not a separator, and it also swallowed the exit code so a failing strict run exited 0 |
| `scripts/qa/fingerprint-diff.mjs` | computed-style diff between two runs |
| `scripts/css-move-verbatim.test.mjs` | proves every rule in `ops-legacy.css` is byte-identical to the frozen original, same selector arms, same at-rule context, same source order |
| `scripts/{type-system,landmarks,form-affordances,modes,dead-css}.test.mjs` | source pins, all wired into `test:shop-brain` |

`scripts/qa/baseline/` holds the before summary and fingerprint, the after
summary and fingerprint, the full fingerprint diff, and
`pre-retirement-globals.css` — the frozen 8,968-line original the verbatim proof
reads. Its git blob SHA was checked against `a2245dc:app/globals.css`; do not
regenerate it.

## Open items

**Needs a human at a device** — each is source-pinned but not browser-verified:

1. Phone: `/ops/intake/new` — tel keypad, autofill chip, focus to first invalid.
2. Windows contrast theme — chips, tabs, buttons, tracker marks keep a border.
3. `prefers-reduced-motion: reduce` — nothing animates.
4. `/board/nope` and a missing job id — board-vocabulary not-found.
5. Cold-reload `/board` and watch for a layout jump as the face loads. (The
   *no-googleapis* half is measured and passing; the jump is not.)

**Worth a decision:**

6. **`--t-title` went 22px → 18px at ≥420px.** Sanctioned by the one-scale goal
   and invisible to the gate, but it is a real change to how card titles look on
   a desktop screen. It is the single change most likely to be noticed.
7. **Vercel Deployment Protection blocks the gate from previews.** Every preview
   path 302s to `vercel.com/login`, and no automation bypass secret exists. This
   round worked around it by landing first and measuring production immediately
   after. The next round that wants to measure a branch *before* merging will hit
   the same wall. Enabling *Protection Bypass for Automation* is the one-setting
   fix and was deliberately not done here.

**Cleanups, non-blocking:**

8. `app/ops/intake/job-intake-form.tsx` is dead — nothing imports it, both intake
   routes render `InlineJobIntake`. It was maintained this round only because the
   plan pins it. Delete it rather than keep two intake forms.
9. `scripts/ops-conversion-exit.test.mjs` fails at `HEAD` and is in no npm
   script — an orphaned suite the project gate never runs. Wire it in or delete
   it. It predates this round.
10. `lib/measurement.ts:38` trips `prefer-rest-params`. Pre-existing; `lib/` was
    out of scope.

## How this was built

Seven implementation sessions, four of them Codex `gpt-5.6-sol` at high in their
own worktrees, each reviewed against its own worktree before merge and merged
serially. One session (**P1b**) is not in the original plan — it was added after
Task 4's implementer found the axe contrast node lived in `globals.css`, where
Task 1 had been fenced out, and chasing it turned up 39 sub-floor declarations
in the same file.

The approval gate was a Fable review, which **DECLINED once** — on the preflight
`<small>` bug above, which nothing else in the round had the shape to find — and
ACCEPTED after the fix. The one DECLINE was worth more than the six PASSes.
