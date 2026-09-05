# Final polish — handoff

**Landed 2026-09-05. Deployed to production and measured. Nothing is in flight.**

## State, exactly

| | |
|---|---|
| `main` | `22226dc`, pushed to `origin/main`, deployed |
| Task branch | `task/run-factory-on-c-users-2`, fully merged into `main` |
| Production | serving the landed code — verified by request, `/board` 200 with `href="#main"` present |
| Suites on `main` | **517 tests, 517 pass, 0 fail**; typecheck clean |
| Lint | 1 error, `lib/measurement.ts:38 prefer-rest-params`, pre-existing at `HEAD`, `lib/` out of scope |
| Plan checkboxes | all ticked |

The commits, in order, so a bisect has names:

```
ef07318  Task 0 gate + production baseline, Task 1 type system, Task 3 forms
8960698  Task 5 pre-flight inventory (four corrections to the task as written)
c0af6ad  merge Task 4 — focus ring, reduced motion, forced colours
098f629  merge Task 2 — landmarks, skip links, board error surfaces
a2245dc  merge Task 1b — the floor reaches globals.css, contrast node fixed
ad01efc  merge Task 5 — the CSS retirement
dcb3114  the Fable DECLINE fix — Tailwind preflight <small>, and two weak pins
b91529b  the preview-deletion pin counts files, not the directory
6b3b23d  Task 6 — after table, fingerprint diff, final QA record
e4e6db5  this handoff
```

**Nothing is queued and nothing is half-done.** Every session in the plan is
landed. The list at the bottom is follow-ups nobody has started, not work in
progress.

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

## Environment traps. Read this section before you run anything.

### 0. NEVER start a dev server in a Shepherd worktree. It hangs forever.

**This is the most expensive trap in this repo. It cost three sessions on task
D2 in one night.**

`npm run dev` / `next dev` and `npx next build` **cannot run inside a
`.worktrees/<slug>` checkout at all.** `node_modules` is a junction, and
Turbopack rejects it outright:

```
Error [TurbopackInternalError]: Symlink [project]/node_modules is invalid,
it points out of the filesystem root
```

The lethal part is not the failure — it is the *shape* of the failure. `next
dev` is a long-running foreground process that never exits on its own. An agent
that runs it sits there waiting for a server that will never come up, burns its
whole budget on a blocked tool call, and produces nothing. It does not look
like an error; it looks like the agent is working.

**So:**

- **Never run `npm run dev`, `next dev`, `next start`, or any watch/serve
  command in a worktree.** There is no flag that fixes it.
- **Never run `npx next build` in a worktree either.** Same junction, same
  rejection — it fails fast rather than hanging, but it tells you nothing about
  your code.
- **To see a change running, push the branch and read the Vercel build.** That
  is the only build of this app that works from a worktree, and it is what
  proved the client-bundle gate this round.
- If you need a foreground process for any reason, run it with a hard timeout
  and in the background, never as a blocking foreground call.

`npm run typecheck`, `npm run lint`, `npm run test:shop-brain`, `node --test`
and `npm run test:qa` all work fine in a worktree. It is only the bundler.

### The other four

1. **A percentage is invisible to a grep for sizes.** Tailwind preflight ships
   `small{font-size:80%}`. Six sessions swept for `px` and `rem` under 14 and
   all of them found nothing, while 37 `<small>` elements rendered at 12px.
   `styles/control.css` now floors `small`, `sub` and `sup`, and
   `scripts/type-system.test.mjs` pins it *plus* asserts preflight still ships
   the rule being defended against — so the guard cannot outlive its reason.
2. **`npx next build` cannot run in a worktree** — see trap 0 above, which is
   the same junction and the reason.
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

**Owner-only bookkeeping, left deliberately undone:**

11. **Four finished Codex child tasks are still registered `active`** —
    `session-p2-`, `session-p4-`, `session-p1b-` and `session-p5-of-docs-superpowers`.
    Their branches are merged into `main` and their worktrees are clean, so this
    is bookkeeping and not risk, but `shepherd exit-check` fails on them and on
    their four worktrees until they are dropped.

    They could not be cleared from inside the round: in
    `bridge/spine/task-coordinator.mjs` **`land`, `park`, `drop` and `reconcile`
    are owner-scoped — an agent may create a task but not end one.** `shepherd
    wait <slug> --for task` times out because they sit idle awaiting input
    rather than exiting, and messaging them to stop restarts their turn and
    resets the idle clock, which is what kept them alive.

    **They will not age out either, and the reason is a Shepherd bug worth
    fixing.** `.shepherd-state.json` at the Shepherd root still registers a
    whole project tree that no longer exists on disk:

    ```
    C:/Users/Owner/Desktop/Shepherd/.shepherd-bridge/w25-disposable
    C:/Users/Owner/Desktop/Shepherd/.shepherd-bridge/w25-disposable/.worktrees/c4b-real-check-one-print
    C:/Users/Owner/Desktop/Shepherd/.shepherd-bridge/w25-disposable/.worktrees/w25-one-append-a-line
    …and several more
    ```

    Any pass that walks registered projects dies on it:

    ```
    FAIL exit-check could not inspect run-factory-on-c-users-2:
      git worktree list --porcelain failed: fatal: cannot change to
      '…\.shepherd-bridge\w25-disposable': No such file or directory
    ```

    That is one dead registration failing the inspection *of an unrelated
    task in an unrelated project*. Two earlier children (P2, P4) did clear, so
    the reconcile is not dead — it is dying partway through, which is exactly
    the shape that leaves some tasks finished and others stuck forever with no
    error anyone reads.

    **The durable fix is in Shepherd, not here:** prune registrations whose
    directory is gone, and make the project walk skip an unreachable root with
    a `REPORT` instead of failing the whole inspection — it already does
    exactly that for five *other* dead paths (`b2f-disposable`,
    `wave15-disposable`, `Text_Phil_Products`, `wetherby-radar`, a
    `wave-25-re-run-task-b2` temp dir), which is why they appear as REPORT
    lines rather than FAILs. `w25-disposable` is reached by a different code
    path that does not have that guard.

    This round did **not** edit `.shepherd-state.json`: it is outside this
    worktree, outside this project, and written live by the running bridge.
    `CLAUDE.md` forbids modifying anything outside your worktree to satisfy a
    gate, and hand-editing live state under a running bridge risks a lost
    update.

    Clear with, from the console or cockpit:

    ```
    drop session-p2-of-docs-superpowers
    drop session-p4-of-docs-superpowers
    drop session-p1b-of-docs-superpowers
    drop session-p5-of-docs-superpowers
    ```

    then `git worktree remove` each of the four paths. `exit-check -Force` was
    deliberately **not** used: the gate is reporting a true condition, not an
    environment quirk, and forcing past it would have put a false clean bill in
    `TASKS.md`.

## If you are the next parent, read this first

- **Do not re-run the round.** It is landed and measured; the numbers are in the
  plan under `### After — 2026-09-05` and frozen in `scripts/qa/baseline/`.
- **The gate is the instrument to reuse.** `npm run test:qa` against production,
  `MCSW_QA_STRICT=1` to assert instead of record. It takes ~3.3 minutes and
  needs a one-use login link (see the re-run block above).
- **Do not regenerate `scripts/qa/baseline/pre-retirement-globals.css`.** It is
  the frozen 8,968-line original that `css-move-verbatim.test.mjs` diffs
  against, and its git blob SHA was checked against `a2245dc:app/globals.css`.
  Regenerating it would make that proof assert nothing.
- **The routing that worked here**: four Codex `gpt-5.6-sol` sessions at high in
  their own worktrees for plan-attached implementation, reviewed serially and
  merged one at a time; a Fable reviewer as the approval gate because the owner
  does not review; Claude for anything needing a browser, because the Codex
  sandbox has no network. The Fable DECLINE caught what six implementation
  sessions and every automated sweep had missed — it was worth more than any of
  the passes.

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
