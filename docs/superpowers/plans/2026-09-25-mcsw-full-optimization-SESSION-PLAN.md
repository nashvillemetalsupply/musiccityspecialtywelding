# MCSW Full Optimization — Session Plan

Plan: `2026-09-25-mcsw-full-optimization.md` (same folder). Generated 2026-09-25.

## Rules

- One row = one fresh chat = one bounded mission. Do not chain sessions in one
  chat; the allowance is spent on carried context, not on work.
- Open each chat with the session model set in the picker **first**, then paste
  the prompt for that row. Routing authority is the Shepherd 2026-09-24 profile:
  a plan-attached session runs on `claude-opus-5-5`, high effort. The owner
  chose Opus 5.5 high for this plan; rows marked "Sonnet-safe" may be run on
  `claude-sonnet-5` medium if the Opus bucket is the one binding this week.
- **Execution (owner, 2026-09-26): this plan runs through the factory.** Codex
  implementers, one row per worktree, Claude review of each branch, serial
  landing through the bridge. Rows run in parallel only when every row in
  their Depends-on column is done and their files do not overlap. That
  replaces "one session at a time" for factory waves. Implementers do not edit
  this file; the factory manager marks each row at landing.
- Land through the bridge (cockpit Land button or
  `POST /tasks/<slug>/actions {action: land}` on the bridge port), never
  `land-ready.ps1` during a wave.
- **This is the only MCSW plan.** Older MCSW plans were folded in on
  2026-09-26. See *Folded plans* at the end of this file.
- Every session: work in its own `.worktrees/<slug>`; never run `next dev` or
  `next build` there; verify on a Vercel preview with
  `scripts/create-local-login.mjs`; run `.\test.ps1` from the worktree with
  `$env:SHEPHERD_BRIDGE_TOKEN = $null`; send the diff to Codex `gpt-5.6-sol`
  `xhigh` for review before landing; open questions go to Fable.
- A session closing marks its own row in the table below, ticks its checkboxes
  in the plan with a one-line observation each, and reruns
  `node library/now.mjs` from the Shepherd root.

## Standing notes (ride along, no session of their own)

- The keepalive step for scheduled workflows (plan, Foreseeable problems) rides
  with S07 (CI gate).
- The `automation_runs` usage logging for AI calls rides with S02.
- The memory pointer update for moved root docs rides with S08.
- Codex MCP failed to connect in the planning session; if it fails again,
  spawn the review as a `codex:` task through `task.ps1` instead.

## Session table

| ID | Mission (plan item) | Session model | Effort | Size | Depends on | Status |
|----|---------------------|---------------|--------|------|------------|--------|
| S00 | P0: next 16.3.6 + sharp unpin + real lockfile + Node pin | Opus 5.5 | high | M | — | open |
| S01 | P1a: owner-cell SMS park/retry/abort, delivery history, preview `is_test` gate, `sms_only` email leg, quiet-hours delivery | Opus 5.5 | high | M | S00 | open |
| S02 | P1b: brief DST + dedupe + TTS reuse, Gmail lease/maxDuration/cap, DeepSeek zod, double extraction, `automation_runs` truth, health `recentErrors` + red-alert text | Opus 5.5 | high | M | S00 | open |
| S03 | P1c: closeout photos via Blob client upload, dead 6 MB check, `error.tsx` trouble row | Opus 5.5 | medium | S | S00 | open |
| S04 | P2a: `events`/`lead_events` triggers, migrate advisory lock + `schema_migrations`, weekly `pg_dump` workflow, export excludes test rows | Opus 5.5 | high | M | S00 | open |
| S05 | P2b: pulse endpoint + board/ops cadence, job page `cache()`, `getAccount` write-on-read, health scan bounds | Opus 5.5 | high | M | S04 | open |
| S06 | P2c: indexes (EXPLAIN-verified), rate limiter off hot path + login strict limiter, single-statement CTE rewrites, month boundary | Opus 5.5 | medium | M | S05 | open |
| S07 | P4a: `ci.yml` + Vercel check, test discovery, two stale tests, behavioral tests for digest/export/ad-spend/document/templates/rate-limit, keepalive | Opus 5.5 | medium | M | S00 | open |
| S08 | P4b: dead deps + `components/ui` + `styles/globals.css` + repo hygiene moves + README + tsconfig/prebuild + patch bumps | Opus 5.5 | low | M | S07 | open |
| S09 | P3a: owner gates ×2, claims in-place decision, NaN validation, raw errors, glass magic bytes + private store, `/review` sameOrigin, session hygiene, build-fact numbers | Opus 5.5 | high | M | S07 | open |
| S10 | P3b: EXIF/GPS strip, glass token expiry, HMAC media URLs, view-counter beacon, customer SMS quiet hours, `payment.reversed` | Opus 5.5 | high | M | S09 | open |
| S11 | P5a: Lighthouse script + baseline, hero image, pixel defer, dead-CSS retirement with fingerprint proof | Opus 5.5 | medium | M | S08 | open |
| S12 | P5b: H1, city links, FAQPage + breadcrumb + geo/priceRange, honeypot, quote form on service pages, header/footer dedupe, favicon/404/sitemap/ACAO, NAP fallback throws | Opus 5.5 | medium | M | S11 | open |
| S13 | P6a: manifest scope, push `url` deep link, offline SWR + banner, signed-out login, push-toggle error, `revalidatePath` | Opus 5.5 | high | M | S08 | open |
| S14 | P6b: base64 logo, theme dedupe, `/ops` hops, iOS install path, social link, sticky action strip + owner loop (screenshot sign-off first) | Opus 5.5 | medium | M | S13 | open |
| S15 | P2d: `is_test` column denormalization across six tables, backfill, writers | Opus 5.5 | high | M | S06 | open |
| S16 | P3c: CSP report-only + report endpoint + HSTS; enforce after one week clean | Opus 5.5 | high | S | S12, S13 | open |
| S17 | P7a: bundle budget in CI, SQL cast guard, evals harness | Opus 5.5 | medium | M | S07 | open |
| S18 | P7b: strip-types migration (`lib/*.mjs` → `.ts`, delete 25 `.d.mts`) | Opus 5.5 | medium | M | S00, S07 | open |
| S19 | P7c: photo-to-quote draft (owner sign-off on flow first) | Opus 5.5 | high | L | S10, S15 | open |
| S20 | P7d: follow-up cadence from won jobs; preview-based QA gate workflow | Opus 5.5 | high | M | S07, S13 | open |
| S21 | P7e: per-city pages (BLOCKED on owner content), call-in-progress chips (gated on S05 budget proof) | Opus 5.5 | high | M | S12, S05 | blocked |
| S23 | Carryover walks from the folded plans: device/env walks (tel keypad, forced colors, reduced motion, `/board/nope` + missing job id, cold-reload layout jump); crew-role production route walk (gated on the first real crew operator) | Opus 5.5 | medium | S | S14 | open (crew half blocked) |
| S22 | Exit verification: QA Procedure 1–15, tick every checkbox, Lighthouse after, Neon CU-hours read, close plan | Opus 5.5 | medium | S | all | open |

Sonnet-safe rows if the Opus bucket binds: S03, S06, S08, S11, S12, S14, S17, S18.

## Recommended order

S00 → S01 → S02 → S04 → S05 → S07 → S08 → S09 → S10 → S06 → S03 → S13 →
S11 → S12 → S14 → S15 → S16 → S17 → S18 → S20 → S19 → (S21 when unblocked) → S22.

Gap-fillers that can run any time after S00: S03, S07 (then S08), S17, S18.

**Top-tier spend concentrates in** S01, S02, S04, S05, S09, S10, S15, S16 and
S19: the alert path, schema and triggers, authorization, privacy, CSP, and the
one new AI feature. Those are the rows where a confident wrong answer costs
money or a customer's data. Everything else is implementation against a
written spec and is the allowance lever.

---

## S00 — Ship blockers

**Scope.** Plan P0, all four rows: `next`/`eslint-config-next` 16.3.6, react
19.3, eslint 10; remove or raise the `sharp` override and drop `nanoid`,
`undici`, `postcss` overrides; delete `pnpm-lock.yaml` and the `pnpm` block,
add `packageManager`; add `engines` and `.nvmrc`, bump `@types/node`. Deploy a
preview; read its build log; click `/`, `/board`, a job, a glass link.
**Not-touched.** No source changes beyond what the upgrade forces. No dead-dep
removal (S08). No `ai` major.
**Routing.** Haiku subagent: read the build log and `npm audit` output.
Codex xhigh: review the diff and the build log before landing.

Paste-ready prompt:

```
Session S00 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P0.
Scope: upgrade next/eslint-config-next to 16.3.6 (RCE advisories GHSA-p293-qw3h-jr36,
GHSA-2xp9-vwfh-vxw4; AVIF is enabled in next.config.mjs:7), react 19.3, eslint 10;
fix the sharp override (0.35.3 is vulnerable, GHSA-rgj7-g3m4-5g8c) and drop the
unexplained nanoid/undici/postcss overrides; replace the empty pnpm-lock.yaml with a
real lockfile decision (default: delete it and the pnpm block, add packageManager
npm@10.8.3); add engines >=22 and .nvmrc 24, bump @types/node.
Not touched: no dead-dependency removal, no ai major, no source refactors.
Work in your own worktree; never run next dev/build there. Verify on a Vercel preview:
read the build log and confirm the install line and zero fresh resolution; click /,
/board, a job page, a glass link. npm audit --omit=dev must show no critical/high on
next or sharp. Present your plan before writing code. Send the diff to Codex
gpt-5.6-sol xhigh for review. Run .\test.ps1 from the worktree with
$env:SHEPHERD_BRIDGE_TOKEN = $null. Tick the P0 checkboxes with a one-line observation
each, mark S00 done in the session plan, rerun node library/now.mjs. Open questions go
to Fable. End with the completion line.
```

## S01 — Owner alert delivery

**Scope.** Plan P1 rows: park/inline retry/`force` sweep
(`lib/notify.ts:411-416`, `lib/recovery-sweep.ts:50-54,180`,
`voice-status/route.ts:58-65`); preserve `delivery_error` and provider payload
(additive `delivery_history jsonb`); `AbortSignal` on `sendSms` and DeepSeek
and weather; `VERCEL_ENV !== 'production'` forces `is_test` in `notify()` plus
the two `is_test` holes; `sms_only` email leg; quiet-hours delivery from the
sweep. Tests that exercise the retry path with a fake Twilio.
**Not-touched.** Cron schedules, Gmail (S02), health endpoint (S02).
**Routing.** Sonnet subagent: locate every `notify()` caller and every
`runRecoverySweep` caller. Codex xhigh: review; ask it specifically whether
any path can now double-send.

Paste-ready prompt:

```
Session S01 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P1, rows:
"Failed owner SMS parks", "Retry blanks the evidence", "No timeouts", "Previews can
alert the real owner", "sms_only alerts have no email leg", "Quiet-hours interrupts".
Scope: lib/notify.ts, lib/recovery-sweep.ts, lib/twilio.ts, lib/ai.ts, the Twilio
status routes, one additive migration in scripts/migrate.mjs for delivery_history.
Not touched: cron schedules, Gmail ingest, brief route, health endpoint (those are S02).
Invariants: persist intent before side effects; is_test survives; no double-send
(dedupe_key ON CONFLICT stays the guard). Verify on a preview with an [INTERNAL TEST]
lead and a forced SMS failure: one attempt, one inline retry ~2 s, delivery_error
preserved, not parked 10 min, Twilio-triggered sweep runs with force. Confirm on the
preview that a real-shaped notify() writes is_test=true and reaches no real device.
Present your plan before writing code. Codex gpt-5.6-sol xhigh review; ask it whether
any path can double-send. .\test.ps1 from the worktree with SHEPHERD_BRIDGE_TOKEN
cleared. Tick rows, mark S01 done, rerun node library/now.mjs. Questions to Fable.
```

## S02 — Cron and automation truth

**Scope.** Brief cron `30 11,12` with in-route hour check; `brief:${day}`
dedupeKey; reuse stored TTS on resume; `automation_runs.ok` real;
Gmail `maxDuration`, 50-message cap, per-message checkpoint, lease release in
`finally`, run row on token failure, dead-letter `isTest`; DeepSeek fallback
through the zod schema, skip job creation on failure; second extraction skips
when a claim with the same `sourceEventId` exists; `maxRetries` + usage logging
on AI calls; doc/model mismatch fixed; health `delivery.recentErrors` and
`/board/updates` view; `if: failure()` Twilio text in `health-monitor.yml`
(persisted intent, `is_test`).
**Not-touched.** notify internals (S01), DB schema beyond `automation_runs.meta`.
**Routing.** Sonnet subagent: map every `automation_runs` writer. Codex xhigh review.

Paste-ready prompt:

```
Session S02 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P1, rows:
"Morning brief cron and resume", "Gmail ingest lease and accounting", "DeepSeek
fallback is unvalidated", "Extraction runs twice per call", "AI calls carry no
maxRetries", "Health shows delivery failures".
Scope: .github/workflows/morning-brief.yml and health-monitor.yml, app/api/ops/brief,
app/api/ingest/gmail, lib/call-summary.ts, the two Twilio transcript routes, lib/ai.ts,
app/api/ops/health, the /board/updates view.
Not touched: lib/notify.ts internals (S01 owns them), any schema change beyond
automation_runs.meta.
Verify on a preview: trigger the brief twice, one TTS call and one interrupt; kill the
Gmail token on the preview and confirm an automation_runs failure row and a released
lease; feed a malformed DeepSeek fallback fixture and confirm no job is created; health
JSON shows recentErrors. Present your plan before code. Codex gpt-5.6-sol xhigh review.
.\test.ps1 from the worktree with SHEPHERD_BRIDGE_TOKEN cleared. Tick rows, mark S02
done, rerun node library/now.mjs. Questions to Fable.
```

## S03 — Uploads and client errors (Sonnet-safe)

**Scope.** Closeout photos (`app/ops/actions.ts:1222,1415`) through the
existing Blob client-upload path; delete the dead `MAX_REQUEST_SIZE` on
quote; `app/board/error.tsx` POSTs to a new `/api/ops/client-error` that
writes a trouble row (is_test aware) which health surfaces.
**Not-touched.** Glass upload validation (S09), EXIF (S10).
**Routing.** Haiku subagent: find every caller of the closeout action.

Paste-ready prompt:

```
Session S03 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P1, rows
"Closeout photos exceed body limits" and "Error reporting".
Scope: app/ops/actions.ts closeout upload path, app/api/quote/route.ts dead size check,
app/board/error.tsx, new app/api/ops/client-error/route.ts writing a trouble row.
Not touched: glass upload validation, EXIF stripping, any schema change beyond what the
trouble row needs (additive).
Verify on a preview: upload a 10 MB closeout photo, confirm it lands in Blob and the job
shows it; throw in a board component and confirm a trouble row appears in health.
Present plan before code. Codex gpt-5.6-sol xhigh review. .\test.ps1 from the worktree
with SHEPHERD_BRIDGE_TOKEN cleared. Tick rows, mark S03 done, rerun node library/now.mjs.
```

## S04 — Database integrity

**Scope.** Triggers `events_truth_no_delete` and `lead_events_frozen` (SQL in
plan P2); `scripts/migrate.mjs` advisory lock on a WebSocket Pool +
`schema_migrations`; `.github/workflows/backup.yml` weekly `pg_dump
--format=custom` artifact; export route `is_test` exclusion, streaming, no
`LIMIT 5000`.
**Not-touched.** Indexes, polling, rate limits (S05/S06). No table or column
changed, only added.
**Routing.** Codex xhigh review with the specific question: can the advisory
lock deadlock with Neon's autosuspend?

Paste-ready prompt:

```
Session S04 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P2, rows:
"events can be deleted", "Migrations have no lock", "No backup exists".
Scope: scripts/migrate.mjs (triggers, advisory lock, schema_migrations), new
.github/workflows/backup.yml, app/api/ops/export/route.ts.
Not touched: indexes, board polling, rate limiter, any live column or table.
Invariants: additive only, idempotent, safe to rerun, is_test survives export.
Verify against the shared Neon DB using only [INTERNAL TEST] rows: DELETE on events and
INSERT on lead_events both raise; two parallel migrate runs both exit 0 with each step
recorded once; dispatch the backup workflow by hand and confirm an artifact; export as
owner excludes test rows and as crew is refused. Present plan before code. Codex
gpt-5.6-sol xhigh review; ask whether the advisory lock can wedge on Neon autosuspend.
.\test.ps1 from the worktree with SHEPHERD_BRIDGE_TOKEN cleared. Tick rows, mark S04
done, rerun node library/now.mjs. Questions to Fable.
```

## S05 — Compute budget: polling

**Scope.** `/api/ops/pulse` returning `max(events.id)` and
`max(calls.updated_at)`; board polls it every 10 s, refreshes only on change,
backs off to 5 min idle; `ops-live.tsx` same; job page loaders in `cache()`
and `generateMetadata` reusing `getLead`; `getAccount` last-seen write moved
to `after()` with a 15-minute guard; health endpoint scans bounded and cached
5 min in-process. Record Neon CU-hours before and after in the closing note.
**Not-touched.** Indexes (S06), schema.
**Routing.** Sonnet subagent: list all 11 board loaders and their queries.
Codex xhigh review.

Paste-ready prompt:

```
Session S05 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P2, rows:
"The board is the compute bill", "Health endpoint does six full scans", "getAccount
writes on read".
Scope: new app/api/ops/pulse/route.ts, app/board/board.tsx polling, ops-live.tsx,
app/ops/leads/[id] loaders and generateMetadata, lib/accounts.ts, app/api/ops/health.
Not touched: indexes, schema, notify.
Verify on a preview: idle /board five minutes with Network open, only pulse requests;
change a job in a second tab, board refreshes within ~10 s; read Neon compute hours
for the last 7 days before landing and note it. Present plan before code. Codex
gpt-5.6-sol xhigh review. .\test.ps1 from the worktree with SHEPHERD_BRIDGE_TOKEN
cleared. Tick rows, mark S05 done, rerun node library/now.mjs. Questions to Fable.
```

## S06 — Compute budget: queries (Sonnet-safe)

**Scope.** The index list in plan P2, each verified with `EXPLAIN` on the
query it serves and dropped if unused; rate limiter delete moved to the sweep,
strict limiter fails closed, login on `ip + emailHash`; `createLead`,
`replaceJobLineItems`, `supersedeClaim` as single-statement MATERIALIZED CTEs;
`getMonthRevenueCents` in `America/Chicago`; test jobs #34/#19 marked.
**Not-touched.** Polling (S05), `is_test` column (S15).
**Routing.** Haiku subagent: run and collect `EXPLAIN` output. Codex xhigh review.

Paste-ready prompt:

```
Session S06 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P2, rows:
"Missing indexes", "Rate limiter on the hot path", "Non-transactional multi-statement
writes", "Small correctness".
Scope: scripts/migrate.mjs (CREATE INDEX IF NOT EXISTS only), lib/leads.ts rate limiter,
app/api/ops/login/route.ts, lib/job-line-items.ts, the createLead and supersedeClaim
writers, getMonthRevenueCents.
Not touched: polling, is_test denormalization, any column change.
Every index: show EXPLAIN before and after on the query it serves in the closing note;
skip any the planner ignores. Every SQL interpolation carries an explicit ::cast.
Verify on a preview: login limiter refuses after the strict limit even with the store
erroring; line-item replace is one statement. Present plan before code. Codex
gpt-5.6-sol xhigh review. .\test.ps1 from the worktree with SHEPHERD_BRIDGE_TOKEN
cleared. Tick rows, mark S06 done, rerun node library/now.mjs.
```

## S07 — CI gate and tests

**Scope.** `.github/workflows/ci.yml` on `pull_request` + `push: main`
registered as a Vercel check; `"test": "node --test scripts/"` and
`test:all`; fix `public-discovery-regressions.test.mjs:64`, delete
`ops-conversion-exit.test.mjs`; behavioral tests for digest, export, ad-spend,
shop/document, email-templates, rate-limit; monthly keepalive commit step in
`health-monitor.yml`.
**Not-touched.** Dependency removal (S08); any product code beyond what a test
exposes as broken (report it, do not fix it here unless one line).
**Routing.** Sonnet subagents write the six behavioral tests against the
spec in the plan's coverage table. Codex xhigh review.

Paste-ready prompt:

```
Session S07 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P4, rows
"No CI gate", "Test discovery", "Behavioral tests where a wrong WHERE costs money", plus
the keepalive step from Foreseeable problems.
Scope: new .github/workflows/ci.yml, package.json test scripts, the two stale tests,
six new behavioral test files under scripts/, health-monitor.yml keepalive.
Not touched: dependency removal, product code (report anything the new tests expose).
Verify: open a PR with a deliberately failing test and confirm the check is red, revert,
green; npm test discovers a new file with no package.json edit. Present plan before
code. Codex gpt-5.6-sol xhigh review. .\test.ps1 from the worktree with
SHEPHERD_BRIDGE_TOKEN cleared. Tick rows, mark S07 done, rerun node library/now.mjs.
```

## S08 — Dead weight and hygiene (Sonnet-safe, low effort)

**Scope.** Plan P4 rows "Dead weight out", "Repo hygiene", "README", "Small
config". Mechanical; typecheck and CI from S07 catch misses.
**Folded in 2026-09-26 (from the 08-18 weighted-board plan).** Also remove
the unreachable board-scoring path in `lib/ops-data.ts`: `order: "weight"`,
`board_score`, `board_signals`, `board_hot`. The only live caller passes
`order: "newest"` (`app/board/page.tsx`), and the `?board=v2` UI that used it
was deleted on 08-20. Grep for callers before deleting.
**Not-touched.** `BRAND-BRIEF.md` location, `archive/ops-legacy-2026-08-20/`
contents (move only), `lucide-react` (upgrade, keep), any product behaviour.
**Routing.** Haiku subagents for the bulk deletes and moves in batches;
never a recursive delete on a path that may hold a junction (unlink first, the
Shepherd `CLAUDE.md` rule). Codex xhigh review of the final `git status`.

Paste-ready prompt:

```
Session S08 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P4, rows
"Dead weight out", "Repo hygiene", "README", "Small config". Also update the memory
pointer for SHOP-BRAIN-PLAN.md's new location.
Scope: remove components/ui, hooks, lib/utils.ts, components.json, styles/globals.css,
app/ops/intake/job-intake-form.tsx, the unused ops-legacy.css selectors, and every
dependency named in the P4 acceptance criterion; upgrade lucide-react to 1.x; moves
under docs/ and docs/archive/ as listed; README rewrite in UTF-8; tsconfig target
ES2022; prebuild mkdir into the repro script; patch-bump ai, @ai-sdk/gateway,
@vercel/blob, resend, tailwindcss.
Not touched: BRAND-BRIEF.md, archive contents, product behaviour.
Never use rmdir /s, Remove-Item -Recurse or rm -rf on any directory that may contain a
junction; use git rm. Verify on a preview: /, /board, /ops/leads/<id>, /j/<token>
render; npm ls --omit=dev shows no radix; typecheck, lint, npm test green. Present plan
before code. Codex gpt-5.6-sol xhigh review of git status. .\test.ps1 from the worktree
with SHEPHERD_BRIDGE_TOKEN cleared. Tick rows, mark S08 done, rerun node library/now.mjs.
```

## S09 — Authorization and input hardening

**Scope.** Plan P3 rows: owner gates on `sendUsualPaperwork` and
`undoLeadComplete` with crew-session refusal tests; claims in-place decision
(replacement + `superseded_by`, or a written exemption in `CLAUDE.md`); zod on
Twilio status ids; plain-language errors on glass upload/finalize; magic-byte
check via `imageTypeMatches`; Blob store private regardless of client
`access`; `sameOrigin()` on `/j/[token]/review`; `validateSessionToken` fails
closed, 14-day idle sliding timeout, `revokeSession` on the Shop card;
customer IP dropped from the owner quote email; build-fact `Number.isFinite`.
**Not-touched.** EXIF, token expiry, media URLs (S10). CSP (S16).
**Routing.** Sonnet subagent: enumerate every Server Action and its gate.
Codex xhigh review; ask it to attempt each action as crew.

Paste-ready prompt:

```
Session S09 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P3, rows:
"Three missing owner gates", "Claims mutated in place", "NaN reaches ::int", "Raw error
messages reach customers", "Glass uploads trust the extension", "/j/[token]/review lacks
sameOrigin", "Session hygiene", "Build-fact numbers unchecked".
Scope: app/ops/accounts/[id]/actions.ts, app/ops/actions.ts, lib/routing.ts, the two
Twilio status routes, app/api/glass/upload and finalize, app/j/[token]/review,
lib/session (validateSessionToken, revokeSession), app/api/quote/route.ts owner email,
app/ops/builds/actions.ts.
Not touched: EXIF stripping, glass token expiry, media URL signing, CSP.
Crew money and roles are server-side; roles are exactly owner and crew. Verify on a
preview as crew (create-local-login.mjs --role crew): both gated actions refuse, nothing
sent; a bad Twilio id returns 400; a bad glass upload shows plain copy. Present plan
before code; the claims decision must be stated outright, not hedged. Codex
gpt-5.6-sol xhigh review; ask it to try every Server Action as crew. .\test.ps1 from
the worktree with SHEPHERD_BRIDGE_TOKEN cleared. Tick rows, mark S09 done, rerun
node library/now.mjs. Questions to Fable.
```

## S10 — Customer privacy and money paths

**Scope.** EXIF/GPS strip at serve and upload with `sharp`; glass
`expires_at` 180 days idle, expire on lost, extend on activity; HMAC-signed
15-minute media URLs replacing bearer-in-query; view counter on a 3 s visible
beacon; customer SMS quiet hours 8 a.m.–9 p.m. Central in `sendSmsPersisted`
with deferral and owner-initiated exception; `payment.reversed` event and
ledger entry, owner-only, reason required.
**Not-touched.** Existing payment rows or types; notify internals.
**Routing.** Codex xhigh review with the question: can a signed media URL be
replayed past expiry, and can a deferred SMS be sent twice?

Paste-ready prompt:

```
Session S10 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P3, rows:
"Photos serve EXIF and GPS", "Glass tokens never expire", "Bearer token in query
strings", "View counter counts bots", "Customer SMS has no quiet hours", "No refund
path".
Scope: app/api/glass/photo and the attachment route, lib/glass.ts, app/j/[token]/page.tsx,
glass-upload.tsx, sendSmsPersisted, lib/payment-ledger.ts (additive event type only).
Not touched: existing payment rows and types, notify.ts internals, CSP.
Persist intent before any SMS. Verify on a preview with [INTERNAL TEST] jobs: a photo
with GPS EXIF downloads with none; an expired glass link is refused with plain copy; a
media URL fails after 15 min; a customer text queued at 23:00 Central is deferred to
08:00; a reversal writes a payment.reversed event and the ledger balances. Present plan
before code. Codex gpt-5.6-sol xhigh review; ask about URL replay and double-send.
.\test.ps1 from the worktree with SHEPHERD_BRIDGE_TOKEN cleared. Tick rows, mark S10
done, rerun node library/now.mjs. Questions to Fable.
```

## S11 — Public site performance (Sonnet-safe)

**Scope.** `scripts/qa/lighthouse.mjs` and a dated baseline committed before
changes; hero image through the optimizer with `sizes` and a 1600 px source;
Meta pixel behind the gtag trigger (load only, payload untouched); dead-CSS
retirement via `retire-ops-css.mjs` proven with `fingerprint-diff.mjs` at
320/375/768/1440. Second Lighthouse run after, committed.
**Not-touched.** Pixel events, design tokens, copy.
**Routing.** Haiku subagent runs Lighthouse and fingerprint diffs. Codex
xhigh review of the CSS diff.

Paste-ready prompt:

```
Session S11 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P5, rows
"Measure first", "Hero image", "Meta pixel loads eagerly", "Dead CSS".
Scope: new scripts/qa/lighthouse.mjs, app/page.tsx hero, components/public-analytics.tsx
load trigger only, app/globals.css via scripts/qa/retire-ops-css.mjs.
Not touched: what the pixel or gtag send, design tokens, any copy, service pages (S12).
Design is locked; the page must render identically, proven by fingerprint-diff.mjs at
all four widths. Verify on production after landing: Lighthouse mobile performance
>= 0.90, LCP <= 2.5 s, committed JSON before and after; hero has srcset and sizes; the
pixel script is absent from initial HTML. Present plan before code. Codex gpt-5.6-sol
xhigh review. .\test.ps1 from the worktree with SHEPHERD_BRIDGE_TOKEN cleared. Tick
rows, mark S11 done, rerun node library/now.mjs.
```

## S12 — SEO and site correctness (Sonnet-safe)

**Scope.** Plan P5 rows: H1 accessible text, city links, FAQPage +
absolute breadcrumb + `geo`/`priceRange`, honeypot rename and client success,
`MainstreetContact` on service pages, shared header/footer on home with
`Sales@` case fixed, favicon/`icon.svg`/stray PNGs, 404 double robots, sitemap
`lastmod`, ACAO scoped to API routes, NAP fallback throws in production.
**Not-touched.** GBP `sameAs` (owner), per-city pages (S21), any new copy.
**Routing.** Haiku subagent validates JSON-LD with the Rich Results test.

Paste-ready prompt:

```
Session S12 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P5, rows:
"H1 is the brand name", "Service-area cities are unlinked", "Structured data",
"Honeypot punishes autofill", "Quote form only on the home page", "Home duplicates
header and footer", "Small correctness", "Twilio fallback number silently swaps NAP".
Scope: app/page.tsx, app/service-areas/page.tsx, app/services/[slug]/page.tsx,
lib/service-pages.ts JSON-LD, app/api/quote/route.ts honeypot,
components/mainstreet-contact.tsx, app/not-found.tsx, app/sitemap.ts, next.config.mjs
headers (ACAO only), lib/shop-contact.ts.
Not touched: GBP sameAs, per-city pages, invented copy, CSP.
Every visible change keeps the design identical; new text comes only from existing
content. Verify on a preview: Rich Results test passes FAQPage and BreadcrumbList on a
service page; autofill on the quote form succeeds; view-source shows one robots meta on
404 and lastmod in the sitemap. Present plan before code. Codex gpt-5.6-sol xhigh
review. .\test.ps1 from the worktree with SHEPHERD_BRIDGE_TOKEN cleared. Tick rows,
mark S12 done, rerun node library/now.mjs.
```

## S13 — PWA and offline

**Scope.** Manifest scope `/`, `start_url` `/board`, dark background,
maskable icons; push payload `url` and service-worker `notificationclick`
open it; SWR fetch handler for `/board*`, `/ops/leads/*`, `_next/static`
versioned by commit SHA with an offline banner; writes never queued offline;
signed-out `/board` shows login; push-toggle shows its error;
`revalidatePath` in `glass-actions.ts` and `calendar-actions.ts`.
**Not-touched.** Push enable (owner-gated), design tokens, board loaders.
**Routing.** Codex xhigh review with the question: can the SWR cache serve a
signed-out user another user's board?

Paste-ready prompt:

```
Session S13 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P6, rows
"Manifest scope is wrong", "No offline", "Signed-out /board shows the empty board".
Scope: app/ops/manifest.webmanifest/route.ts, register-ops-service-worker.ts,
public/ops-sw.js, the push payload builder, app/board/page.tsx signed-out branch,
push-toggle.tsx, glass-actions.ts, calendar-actions.ts, new offline banner component.
Not touched: push enable (owner-gated), design tokens, board data loaders, S05's pulse.
Cache is per-session and cleared on sign-out; never cache a write. Verify on a preview
installed on Android Chrome and iOS Safari: tapping a test push lands on the job;
airplane mode shows the cached board with the banner; sign out then open /board shows
login and no cached data. Present plan before code. Codex gpt-5.6-sol xhigh review;
ask whether the cache can leak across sessions. .\test.ps1 from the worktree with
SHEPHERD_BRIDGE_TOKEN cleared. Tick rows, mark S13 done, rerun node library/now.mjs.
```

## S14 — Board client and owner loop (Sonnet-safe)

**Scope.** Serve the logo as a file (`board.tsx:422`); one theme boot;
`/ops` redirect hops; iOS install instructions; duplicate social link; sticky
action strip (Call, Text, Photo, inline quote amount), photo-first tap
target, voice capture on the row. **Screenshot to the owner before building
the strip**; design rules apply; no per-worker stats anywhere.
**Not-touched.** Job page form logic, notify, anything money server-side.
**Routing.** Sonnet subagent for the mechanical dedupes. Codex xhigh review.

Paste-ready prompt:

```
Session S14 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P6, rows
"Client bundle" and "Owner loop".
Scope: app/board/board.tsx (logo, theme dedupe), theme-boot.tsx, /ops redirect, the
install page, the job page action strip and board detail quote amount.
Not touched: job form logic, notify, server-side money, design tokens.
Call precedes Text in every strip. No worker surveillance of any kind. Produce a
screenshot of the strip on a 375 px preview and get owner sign-off before wiring it.
Verify on a preview: first-load JS for /board drops by at least the 15 KB logo; the
strip is reachable in one tap from the board row. Present plan before code. Codex
gpt-5.6-sol xhigh review. .\test.ps1 from the worktree with SHEPHERD_BRIDGE_TOKEN
cleared. Tick rows, mark S14 done, rerun node library/now.mjs.
```

## S15 — `is_test` column

**Scope.** Additive `is_test boolean NOT NULL DEFAULT false` on `events`,
`claims`, `commitments`, `calls`, `messages`, `notifications`; backfill from
the existing ILIKE predicate; every writer sets it through one helper; the old
predicate stays until a source test proves every writer sets the column.
**Not-touched.** Reads that already work; nothing dropped.
**Routing.** Sonnet subagent: enumerate every INSERT into the six tables.
Codex xhigh review: ask for any writer that could insert `false` for a test row.

Paste-ready prompt:

```
Session S15 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P2, row
"is_test is a copied ILIKE predicate".
Scope: scripts/migrate.mjs additive columns and backfill, one helper that every writer
into events, claims, commitments, calls, messages, notifications calls, a source test
that fails if any INSERT into those tables omits it.
Not touched: existing read predicates (they stay as a belt), any drop or rename.
Verify against the shared DB: backfill count matches the old predicate exactly; create
an [INTERNAL TEST] lead through every intake path and confirm is_test=true on each
resulting row. Present plan before code. Codex gpt-5.6-sol xhigh review; ask for any
writer that could insert false on a test row. .\test.ps1 from the worktree with
SHEPHERD_BRIDGE_TOKEN cleared. Tick the row, mark S15 done, rerun node library/now.mjs.
Questions to Fable.
```

## S16 — CSP and HSTS

**Scope.** `Content-Security-Policy-Report-Only` in `next.config.mjs` with a
`/api/ops/csp-report` endpoint writing trouble rows (rate-limited, is_test
aware); HSTS `includeSubDomains; preload`. Runs one week clean, then a
follow-up flips to enforce (same session ID, second chat).
**Not-touched.** Script set (S11/S12 must be landed first).
**Routing.** Codex xhigh review of the policy against every script/style/
connect origin the site uses (gtag, Meta, Vercel, Twilio client, fonts).

Paste-ready prompt:

```
Session S16 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P3, row
"CSP and HSTS". S11, S12 and S13 must be landed first; confirm in the session table.
Scope: next.config.mjs headers, new app/api/ops/csp-report/route.ts.
Not touched: any script or style source; if the policy needs a source added, that is a
finding, not a change.
Ship report-only first. Verify on production for seven days: zero unexpected reports in
trouble; then a second chat under this ID flips to enforce and re-verifies /, /board, a
job page, a glass link, the quote form and a push. Present plan before code. Codex
gpt-5.6-sol xhigh review of the policy against every origin in use. .\test.ps1 from
the worktree with SHEPHERD_BRIDGE_TOKEN cleared. Tick the row, mark S16 done, rerun
node library/now.mjs. Questions to Fable.
```

## S17 — Guards and evals (Sonnet-safe)

**Scope.** `scripts/bundle-budget.mjs` in CI at 10% above today's `/` and
`/board` first-load; the `sql` cast guard (wrapper or eslint rule) with zero
false positives on the tree; `scripts/ai-evals.test.mjs` with `[INTERNAL
TEST]` fixtures, on demand only.
**Not-touched.** Production AI calls, CI schedule.
**Routing.** Sonnet subagents for each of the three, in parallel. Codex xhigh
review of the cast guard's false-positive run.

Paste-ready prompt:

```
Session S17 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P7, rows
"Bundle-size budget", "SQL cast guard", "Evals harness for extraction".
Scope: new scripts/bundle-budget.mjs wired into ci.yml, the cast guard and its run over
the whole tree, scripts/ai-evals.test.mjs with fixtures under scripts/fixtures/.
Not touched: production AI call sites, CI schedule, product code.
Verify: budget fails when a client file value-imports lib/db (prove with a throwaway
branch, then revert); guard reports zero findings on main; evals run and print a score.
Present plan before code. Codex gpt-5.6-sol xhigh review. .\test.ps1 from the worktree
with SHEPHERD_BRIDGE_TOKEN cleared. Tick rows, mark S17 done, rerun node library/now.mjs.
```

## S18 — Strip-types migration (Sonnet-safe)

**Scope.** Rename `lib/*.mjs` to `.ts`, delete the 25 `.d.mts`, update ~80
import specifiers, run tests with `node --experimental-strip-types --test`
under Node 24 (S00 pinned it). No logic changes.
**Not-touched.** Any behaviour; `lib/*.ts` that already exist.
**Routing.** Haiku subagents for the rename and import rewrites in batches;
Codex xhigh review confirms zero semantic diff.

Paste-ready prompt:

```
Session S18 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P7, row
"Strip-types instead of .d.mts twins". Requires local Node 24 (S00) and test discovery
(S07); confirm both landed.
Scope: lib/*.mjs to lib/*.ts, delete lib/*.d.mts, import specifiers, package.json test
command.
Not touched: any logic, existing lib/*.ts.
Verify: typecheck, lint, npm test all green; git diff shows renames and specifiers only;
preview builds and /board renders. Present plan before code. Codex gpt-5.6-sol xhigh
review confirming no semantic change. .\test.ps1 from the worktree with
SHEPHERD_BRIDGE_TOKEN cleared. Tick the row, mark S18 done, rerun node library/now.mjs.
```

## S19 — Photo to quote draft (L, present plan for sign-off)

**Scope.** From a glass upload, draft `claims` (scope, material, dimensions;
never a price) for owner acceptance using the existing claims schema and
`superseded_by`; drafts are `is_test` aware, never auto-send, never
auto-price. **Present the flow, the prompt, the schema and the UI to the owner
before any code.**
**Not-touched.** Pricing, outbound copy, customer-facing surfaces.
**Routing.** Codex xhigh review of the prompt injection surface (customer
photo captions reach the model).

Paste-ready prompt:

```
Session S19 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P7, row
"Photo to quote draft". S10 and S15 must be landed.
Scope: a draft-claims step after glass upload finalize, the claims it writes (scope,
material, dimensions only), an owner accept/reject affordance on the job page.
Not touched: any price field, any outbound message, customer-facing pages.
This is design-heavy: present the flow, model prompt, zod schema, failure modes and a
375 px mockup for owner sign-off before writing code. Persist intent before the AI
call; is_test survives; a rejected draft is superseded, never deleted. Verify on a
preview with an [INTERNAL TEST] job: upload two photos, drafts appear, accept one,
reject one, events journal shows both. Codex gpt-5.6-sol xhigh review of the prompt
injection surface. .\test.ps1 from the worktree with SHEPHERD_BRIDGE_TOKEN cleared.
Tick the row, mark S19 done, rerun node library/now.mjs. Questions to Fable.
```

## S20 — Cadence and the preview QA gate

**Scope.** `follow_up_at` default from median days-to-close of won jobs,
per-lead override, no per-worker stats; a workflow that deploys a preview,
runs `create-local-login.mjs`, then `MCSW_QA_STRICT=1 npm run test:qa`, with
the Actions minutes measured in the closing note.
**Folded in 2026-09-26 (from the 09-04 final-polish plan).** The gate needs
`VERCEL_AUTOMATION_BYPASS_SECRET`, which is not set anywhere. Its absence
already produced one false "unverified" QA record in final-polish. Set it on
the Vercel project and as an Actions secret before the workflow's first run.
**Not-touched.** Reminder copy, existing follow-up rows.
**Routing.** Sonnet subagent for the workflow; Codex xhigh review of the
cadence query for surveillance leakage.

Paste-ready prompt:

```
Session S20 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P7, rows
"Follow-up cadence from won jobs" and "Preview-based QA gate".
Scope: the follow_up_at default computation (lib) and its override on the job page; new
.github/workflows/qa-preview.yml.
Not touched: reminder copy, existing follow_up_at values, worker-level data of any kind.
Verify: a new [INTERNAL TEST] lead gets the computed default and the owner can change
it; the QA workflow runs green against a preview once and the minutes used are in the
closing note. Present plan before code. Codex gpt-5.6-sol xhigh review; ask whether the
cadence query could expose per-worker timing. .\test.ps1 from the worktree with
SHEPHERD_BRIDGE_TOKEN cleared. Tick rows, mark S20 done, rerun node library/now.mjs.
```

## S21 — Blocked: per-city pages and live-call chips

**Scope.** `/service-areas/[city]` for eight cities only once the owner
supplies real jobs per city; call-in-progress chips via SSE only once S05's
closing note shows compute headroom.
**Not-touched.** Anything, until unblocked. Do not invent city content.
**Routing.** Opus high when it runs; Codex xhigh review.

Paste-ready prompt:

```
Session S21 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md, section P7, rows
"Per-city pages" and "Call-in-progress chips". Check the blockers first: owner-supplied
per-city job content exists in the repo, and S05's closing note shows Neon compute under
50 CU-hours/month. If either is missing, stop and say which; do not build.
Scope when unblocked: app/service-areas/[city]/page.tsx from the supplied content; an SSE
route off live-transcript feeding a board row chip.
Not touched: invented copy, design tokens, notify. Present plan before code. Codex
gpt-5.6-sol xhigh review. .\test.ps1 from the worktree with SHEPHERD_BRIDGE_TOKEN
cleared. Tick rows, mark S21 done, rerun node library/now.mjs.
```

## S22 — Exit verification

**Scope.** Run QA Procedure steps 1–15 against a fresh preview and
production; confirm every checkbox in the plan is ticked with an observation;
run the Lighthouse script and commit; read Neon CU-hours for the month; write
the closing note in the plan; mark the plan closed in `NOW.md`.
**Not-touched.** No fixes here. A failure becomes a new row in this table
under the owning session's ID with a suffix (S01b), not a patch in this chat.
**Routing.** Haiku subagents run the mechanical checks; Opus reads the results.

Paste-ready prompt:

```
Session S22 of docs/superpowers/plans/2026-09-25-mcsw-full-optimization-SESSION-PLAN.md.
Plan: docs/superpowers/plans/2026-09-25-mcsw-full-optimization.md. Every other row must
read done or blocked in the session table.
Scope: execute QA Procedure steps 1 through 15 on a fresh preview (and production where
the step says so); verify every checkbox carries an observation; run
scripts/qa/lighthouse.mjs and commit the JSON; read Neon compute hours for the month and
record them against the P2 acceptance criterion; write the closing note under the plan's
Verdict; mark the plan closed and rerun node library/now.mjs.
Not touched: no fixes. A failed step becomes a new row (e.g. S01b) in the session table
naming the failure; do not patch it here. .\test.ps1 from the worktree with
SHEPHERD_BRIDGE_TOKEN cleared; shepherd exit-check before the completion line.
```

## Folded plans (2026-09-26)

Owner, 2026-09-26: one plan for MCSW, run by the factory. Every older MCSW plan
was read against the code. Each carries a banner pointing here and none is
deleted. Everything still open was folded into a row above.

| File | Disposition | Folded into |
|---|---|---|
| `SESSION-PLAN.md` (root, S1–S12) | Done in code. The table still read pending; it is a copy of SHOP-BRAIN-PLAN Part E | — |
| `SHOP-BRAIN-PLAN.md` | Done | — |
| `BOARD-WIRE-PLAN.md`, `BOARD-WIRE-SESSION-PLAN.md`, `MCSW-JOBS-BUILD-HANDOFF.md` | Done | — |
| `docs/superpowers/plans/2026-08-18-weighted-board*` | Done. Unreachable scoring code left behind | S08 |
| `docs/superpowers/plans/2026-08-20-ops-board-conversion*` (incl. C8-FIXES) | Done except the crew-role production route walk, which has no crew operator to run as | S23 |
| `docs/superpowers/plans/2026-08-21-cohesion-round*` | Done | — |
| `docs/superpowers/plans/2026-09-04-final-polish*`, `2026-09-05-final-polish-HANDOFF.md` | Done. The device/env walks and the bypass secret carry over; components/ui and dead deps were already in S08 | S20, S23 |
| `Shepherd/Philosophy/issues/mcsw-ops-redesign-plan.md` + `-SESSION-PLAN.md` | Obsolete. The redesign was parked 2026-08-17 (`design.md`) and design.md was retired as an authority (418219b) | — |
| `docs/weekly-optimization/*-HANDOFF.md` | Complete, and a separate lane (weekly ad work) | — |
