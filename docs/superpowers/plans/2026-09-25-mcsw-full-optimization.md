# MCSW Full Optimization — 2026-09-25

**Run with:** Claude Opus 5.5, high effort, one session per row of
`2026-09-25-mcsw-full-optimization-SESSION-PLAN.md` (the session split). Open
that file, not this one, to start work. This document is the evidence and the
contract; the session plan is the door.

**Goal.** Everything in this repository earns its place. Eight read-only audits
ran on 2026-09-25 across reliability, AI/automation, customer surfaces and
money, SEO/public site, database, CRM UX/PWA, API security, and engineering
health. This plan is what they found, ranked, with the file:line evidence, the
fix, and the proof required before a row is marked done. Ads, pixel semantics
and ad spend are out of scope by owner instruction.

**Verdict in one paragraph.** The product is sound: typecheck and lint are
clean, 575 node tests pass offline in 13 s, no secrets in history, real
production health monitoring, Shop Brain invariants enforced. Two things are
actually dangerous today and go first: production runs `next` 16.2.12 with two
unpatched remote-code-execution advisories while AVIF image optimization is on,
and every Vercel deploy resolves dependencies fresh from an empty
`pnpm-lock.yaml`, so production has never been built from the lockfile the
owner runs locally. After that, the highest-value work is the owner-alert
delivery path (a failed owner-cell SMS can sit for hours), database integrity
guards that the invariants promise but the schema does not enforce, three
missing owner gates, and a Neon compute budget spent mostly on the board
polling itself. Roughly forty dependencies and the whole shadcn scaffold are
dead and come out.

---

## Architecture (what a session must know before touching anything)

- Next.js 16.2.12 App Router on Vercel Hobby, React 19.2, Tailwind 4, Node 24.x
  on Vercel (project setting), Node 20.17 locally, no `engines` pin.
- Neon Postgres, **one shared database** across development, previews and
  production. Free tier: ~100 CU-hours/month, 0.25 CU minimum, 5-minute
  autosuspend, 0.5 GB storage cap. Every wake is paid for; cron cadence and
  polling cadence are the budget.
- Vercel Blob (private), Twilio (voice, SMS, live transcription), Resend (svix
  webhook), Gmail ingest, web-push, AI SDK 6 via `@ai-sdk/gateway`
  (`claude-haiku-4.5` extraction, `claude-sonnet-5`, `openai/tts-1`, DeepSeek
  fallback, Deepgram nova-3).
- Crons: `vercel.json` (digest 12:00, gmail 12:05, brief 11:30, reminders
  13:15 UTC, daily backstop) plus GitHub Actions (`follow-up-reminders`,
  `gmail-sync`, `health-monitor` on `5,20,35,50 12-23` and `5 0-11`;
  `morning-brief` on `30 11,12`) which carry the real cadence. Double-firing is
  safe: `lib/notify.ts:178` `ON CONFLICT (operator_id, dedupe_key) DO NOTHING`,
  claim rows at `:245,:290,:314,:348`, gmail returns 202 on lease contention.
- Tests: `npm run test:shop-brain` (60-file hand list, node --test),
  `npm run typecheck`, `npm run lint`, `npm run test:qa` (Playwright + axe,
  needs `MCSW_QA_BASE` and `MCSW_QA_LOGIN_URL`, cannot run offline). 503 of 618
  tests are regex-over-source; 115 are behavioral.

## Global constraints (every session, no exceptions)

1. **Product invariants** in the repo `CLAUDE.md` are law: additive schema
   only, idempotent migrations, persist intent before side effects, explicit
   `::cast` on every SQL interpolation, `[INTERNAL TEST]` / `is_test` survives
   every path, `events` immutable, `lead_events` frozen, provider ingestion
   idempotent by external id, Twilio signatures verified, crew money removed
   server-side, roles exactly `owner` and `crew`, no worker surveillance, Call
   precedes Text.
2. **Worktree traps.** Never run `next dev`, `next build` or `next start`
   inside a `.worktrees/` checkout; the `.next` junction makes tsc lie and the
   build writes into the root. Verify on a Vercel preview deployment with
   `scripts/create-local-login.mjs`. Run `npx next build` only from a root
   checkout; otherwise the preview build is the build gate.
3. **No real side effects during verification.** Every proof that touches
   notify, SMS, email, push or AI runs as `[INTERNAL TEST]` / `is_test`. Never
   send a customer or the owner's cell anything from a test.
4. **Design is locked.** Shop Wall scene design, owner taste rules, 14 px type
   floor, `next/font`, dark scheme. No visual changes except the ones this plan
   names, and those must render identically or the row says why.
5. **Copy is Phil's voice.** No new outbound copy that is not from the voice
   corpus. Structural SEO changes (H1 aria-label, FAQ markup from existing
   `faqs`) are allowed; invented content is not.
6. **Owner-gated, do not touch:** Google Business Profile verification, review
   URL, DMARC, Twilio numbers and fallback, push enable, Ads and Meta pixel
   configuration (deferring the pixel's load is allowed; changing what it sends
   is not), `verify-ads-tag.mjs`, `/api/ops/ad-spend` semantics.
7. **Delegation.** The Pi/DeepSeek grant never covers this repository, credentials
   or customer data. Reviews go to Codex `gpt-5.6-sol` at `xhigh`. Lookups and
   mechanical bulk edits go to Sonnet/Haiku subagents. Every open question goes
   to Fable, never parked on the owner.
8. **Prove, then tick.** A row is done when its acceptance criterion below has
   been observed on a preview or in a real test run, not when the diff compiles.
   Say in the closing note what was observed and where.

---

## Acceptance Criteria

**P0 — shippable and reproducible**
- Given the production build log, when a deploy runs, then it installs with
  `npm ci` from `package-lock.json` (or a real, populated `pnpm-lock.yaml`,
  whichever the session chose) and no dependency is resolved from a range.
- Given `npm audit --omit=dev`, when run at the root after the upgrade, then no
  critical or high advisory names `next` or `sharp`.
- Given `package.json`, when read, then `engines.node` is `>=22` and `.nvmrc`
  says `24`.

**P1 — the owner hears about it**
- Given a Twilio SMS failure to the owner cell, when the failure is recorded,
  then one inline retry fires within ~2 s and, if it fails again, the next
  Twilio-triggered sweep retries it regardless of the 10-minute cooldown.
- Given a retried notification, when it is re-sent, then the previous
  `delivery_error` text and Twilio message are kept in the row's history, not
  blanked.
- Given a preview deployment, when any code path calls `notify()`, then the
  interrupt is treated as `is_test` and no real owner channel is used.
- Given the morning brief cron after the DST change, when it fires, then it
  fires at 06:30 Central on both schedules and a resumed run does not re-run
  TTS or re-send the interrupt.
- Given the Gmail ingest route, when `gmailAccessToken()` throws, then an
  `automation_runs` row records the failure and the lease is released in
  `finally`.

**P2 — the database keeps its promises and its budget**
- Given `DELETE FROM events WHERE id = <x>`, when executed as the app role, then
  Postgres raises and the row remains.
- Given any `INSERT`, `UPDATE` or `DELETE` on `lead_events`, when executed, then
  Postgres raises.
- Given two concurrent `node scripts/migrate.mjs` runs, when both start, then
  one waits on the advisory lock and `schema_migrations` records each migration
  once.
- Given the weekly backup workflow, when it runs on Sunday, then a
  `pg_dump --format=custom` artifact exists in the workflow run and the export
  route excludes `is_test` rows unless `?includeTests=1`.
- Given an idle `/board` tab, when five minutes pass with no change, then the
  tab has made no full data refresh, only pulse checks.
- Given the Neon console, when the month closes after this phase lands, then
  compute hours are materially below the pre-plan run rate (target: under 50
  CU-hours; the audit estimated ~85 before and ~45 after).

**P3 — authorization and privacy hold server-side**
- Given a `crew` session, when it calls `sendUsualPaperwork` or
  `undoLeadComplete`, then the action is refused server-side.
- Given a served customer photo, when its bytes are inspected, then no EXIF or
  GPS metadata is present.
- Given an unconverted job older than 180 days, when its glass link is opened,
  then the link is refused.
- Given a Twilio status callback with a non-numeric id, when it is handled, then
  no `NaN` reaches a `::int` cast and the request is rejected cleanly.
- Given the login route, when the same IP + email hash exceeds the strict limit,
  then further attempts are refused even if the rate-limit store errors.

**P4 — engineering health gates itself**
- Given a pull request, when opened, then a GitHub Actions workflow runs
  typecheck, lint and the full discovered test set and reports a check.
- Given a new `scripts/*.test.mjs`, when added, then `npm test` runs it with no
  edit to `package.json`.
- Given `npm ls --omit=dev`, when read, then no `@radix-ui/*`, `cmdk`, `vaul`,
  `embla-carousel-react`, `react-day-picker`, `input-otp`,
  `react-resizable-panels`, `react-hook-form`, `@hookform/resolvers`, `sonner`,
  `next-themes`, `date-fns`, `recharts`, `class-variance-authority`,
  `tailwind-merge`, `tailwindcss-animate` or `@vercel/analytics` remain, and
  `components/ui/` does not exist.

**P5 — the public site is measured and fast**
- Given a mobile Lighthouse run of `/` on production, when compared with the
  committed baseline, then performance is ≥ 0.90 and LCP ≤ 2.5 s, and a
  committed JSON in `scripts/qa/` records it with a date.
- Given the home page HTML, when inspected, then the hero image is served
  through the image optimizer with a `sizes` attribute and the Meta pixel loads
  only after the same interaction/8 s trigger as gtag.
- Given a service page, when its JSON-LD is validated, then it carries `FAQPage`
  from the page's existing `faqs`, a breadcrumb whose item URLs are absolute,
  and `LocalBusiness` includes `geo` and `priceRange`.

**P6 — the CRM installs and survives a tunnel**
- Given the installed PWA, when a push notification is tapped, then the
  notification's `url` opens `/ops/leads/<id>` directly.
- Given the installed PWA with the network off, when `/board` is opened, then
  the last cached board renders with an offline banner instead of a browser
  error page.
- Given a signed-out visit to `/board`, when the page loads, then it shows the
  login screen, not the empty-board zero state.

---

## QA Procedure

Numbered human steps. Run on a Vercel preview with `scripts/create-local-login.mjs`
unless the step says production. Never on a worktree dev server.

1. **Build source.** Open the preview's Vercel build log. Confirm the install
   line names the package manager the plan chose and "resolved N, reused N"
   shows zero fresh registry resolution beyond the lockfile.
2. **Owner alert path.** Create an `[INTERNAL TEST]` lead. Set
   `MCSW_TEST_SMS_FAIL=1` (or the equivalent the session adds) on the preview,
   trigger an owner interrupt, watch `notifications` in Neon: one attempt, one
   inline retry ~2 s later, `delivery_error` populated and preserved, row not
   parked 10 minutes. Trigger a Twilio status callback; confirm the sweep ran
   with `force`.
3. **Preview isolation.** On the same preview, trigger any real-shaped
   notification path. Confirm the row is `is_test = true` and no SMS, email or
   push reached a real device.
4. **Immutability.** In the Neon SQL editor as the app role run
   `DELETE FROM events WHERE id = (SELECT max(id) FROM events WHERE is_test)`
   and `INSERT INTO lead_events DEFAULT VALUES`. Both must raise.
5. **Migrations.** Run `node scripts/migrate.mjs` twice in parallel from two
   terminals. Both exit 0; `SELECT * FROM schema_migrations` shows each
   migration once.
6. **Board cadence.** Open `/board` on the preview, leave it idle five minutes
   with DevTools Network open. Only pulse requests appear until a change is
   made in a second tab, after which the board refreshes within ~10 s.
7. **Owner gates.** Sign in as `crew` (`create-local-login.mjs --role crew`).
   Attempt `sendUsualPaperwork` from an account page and `undoLeadComplete`
   from a job. Both refuse; nothing is sent.
8. **Photo privacy.** Upload a photo with GPS EXIF to a glass link. Download
   it from the job page and from the glass page. `exiftool` (or the script the
   session adds) shows no GPS or camera metadata.
9. **Glass expiry.** Set a test job's glass link `expires_at` to yesterday.
   Open it: refused with the plain-language page, no stack, no raw error.
10. **CI gate.** Open a pull request with a deliberately failing test. The
    Actions check is red; revert; green.
11. **Dead weight.** `npm ls --omit=dev | grep -c radix` returns 0;
    `components/ui/` is absent; preview builds and `/board`, `/ops/leads/<id>`,
    `/j/<token>` all render.
12. **Public site.** Run `npm run lighthouse:mobile` (or the script the session
    adds) against production. Performance ≥ 0.90. View source: hero `<img>`
    has `srcset` and `sizes`; the Meta pixel `<script>` is not in the initial
    HTML. Validate a service page at the Rich Results test: FAQPage and
    BreadcrumbList pass.
13. **Honeypot.** Fill the quote form with browser autofill on. Submit. It
    succeeds; no error about a hidden field.
14. **PWA.** Install from the preview on Android Chrome and iOS Safari. Tap a
    test push: lands on the job. Airplane mode, reopen: cached board with
    offline banner. Sign out, open `/board`: login screen.
15. **Exit.** `npm run test:all` green at the root; `MCSW_QA_STRICT=1 npm run
    test:qa` green against the preview; `.\test.ps1` green from the task
    worktree; every checkbox below ticked with a one-line observation.

---

## P0 — Ship blockers (do first, one session)

- [ ] **Upgrade `next` off two RCE advisories.** `npm audit --omit=dev` reports
  `next` critical, range `16.0.0-canary - 16.3.2`: GHSA-p293-qw3h-jr36
  (unauthenticated RCE) and GHSA-2xp9-vwfh-vxw4 (RCE in the Image Optimization
  API with AVIF). `next.config.mjs:7` enables `image/avif`. Bump `next` and
  `eslint-config-next` to 16.3.6 (latest at audit time), `react`/`react-dom`
  to 19.3, `eslint` to 10 (9.39.5 is deprecated per the build log). Run
  `npm run test:shop-brain && npm run typecheck && npm run lint`, deploy a
  preview, click through `/`, `/board`, a job page, a glass link.
- [ ] **Fix the sharp pin.** Both `overrides` blocks pin `sharp` to 0.35.3,
  which is inside GHSA-rgj7-g3m4-5g8c (`<0.35.4`). Remove the pin or raise to
  ≥0.35.4. Remove the `nanoid`, `undici` and `postcss` overrides too; re-add
  only one that a current advisory names, with a one-line comment naming it.
- [ ] **Make the lockfile real.** `pnpm-lock.yaml` is a 92-byte v0 stub (zero
  packages). The last production build log
  (`dpl_GHuKFRK1g42rNJUekU4g9yd5AxeT`) reads `Detected pnpm-lock.yaml 9 …
  resolved 595, reused 0, downloaded 515`. Every deploy resolves every `^`
  range fresh; `package-lock.json` (338 KB) is dead in production and the npm
  `overrides` block is ignored. Decision: delete `pnpm-lock.yaml` and the
  `pnpm` block, add `"packageManager": "npm@10.8.3"`, confirm the next build
  log says `npm ci`. (Alternative of committing to pnpm is acceptable if the
  session finds a reason; say which and why.)
- [ ] **Pin Node.** Add `"engines": {"node": ">=22"}` and `.nvmrc` = `24`.
  Vercel is already on 24.x; local is 20.17; Node 20 is deprecated on Vercel
  2026-10-01. Bump `@types/node` to match. This unblocks the strip-types
  migration in P7.

## P1 — Owner alerting and automation correctness

Owner-cell delivery is the business. Everything else in this repo exists so
this path fires.

- [ ] **Failed owner SMS parks for 10 minutes and can lag hours.**
  `lib/notify.ts:411-416` parks a failed interrupt for 10 min; only
  `retryPendingInterrupts`, the last step of `runRecoverySweep`
  (`lib/recovery-sweep.ts:180`), revives it; the sweep has its own 10-minute
  cooldown (`:50-54`); the `after()` sweep in
  `app/api/twilio/voice-status/route.ts:58-65` fires before the park expires;
  overnight hourly cadence makes the worst case ~6 h 45 m. Fix: one inline
  retry at ~2 s, park at `now()` rather than +10 min, pass `force: true` on
  Twilio-triggered sweeps.
- [ ] **Retry blanks the evidence.** `lib/notify.ts:491` sets
  `delivery_error = ''` and the Twilio message at L664-700 is discarded. Keep
  the last error and provider payload (append to a `delivery_history jsonb`
  column, additive) before retrying.
- [ ] **No timeouts on Twilio or DeepSeek.** `lib/twilio.ts:437-478` `sendSms`
  and `lib/ai.ts:30,61` have no `AbortSignal`. Add 8 s for SMS, 30 s for AI,
  and a timeout on the weather fetch in `app/api/ops/brief/route.ts:29-31`.
- [ ] **Previews can alert the real owner.** Gate in `notify()`
  (`lib/notify.ts:113-145`): `process.env.VERCEL_ENV !== 'production'` forces
  `is_test`. Also close the two holes where `is_test` is only honoured with a
  `sourceEventId` (`notify.ts:118-122`) and where the Gmail dead-letter path
  writes without `isTest` (`app/api/ingest/gmail/route.ts:290`).
- [ ] **`sms_only` alerts have no email leg.** `lib/notify.ts:326, :634`. A
  failed SMS on an `sms_only` interrupt should fall through to email after the
  inline retry.
- [ ] **Morning brief cron and resume.** `morning-brief.yml` runs `30 11 * * *`,
  which is 06:30 CDT and 05:30 CST after 2026-11-01; change to `30 11,12` and
  let the route reject the off-hour one. The resumed path
  (`app/api/ops/brief/route.ts:82-86`) re-runs TTS and re-sends the interrupt
  without a `dedupeKey` (`:83`); use `brief:${day}` and reuse the stored audio.
  `automation_runs` writes `ok = true` unconditionally (`:173`); record the real
  outcome.
- [ ] **Gmail ingest lease and accounting.** `app/api/ingest/gmail/route.ts:99`
  throws out of `gmailAccessToken()` with no `automation_runs` row and the
  8-minute lease not released (`:303` is not in `finally`). Add `maxDuration`,
  cap 50 messages per run, checkpoint per message, release in `finally`,
  record the failure.
- [ ] **DeepSeek fallback is unvalidated but auto-creates jobs.**
  `lib/call-summary.ts:90-94, 175-183`. Run the fallback output through the
  same zod schema as the primary; on failure record the summary and skip job
  creation.
- [ ] **Extraction runs twice per call.**
  `app/api/twilio/live-transcript/route.ts:47` and
  `app/api/twilio/transcript/route.ts:74` both extract. Make the second one
  skip when a claim with the same `sourceEventId` already exists.
- [ ] **AI calls carry no `maxRetries`, no usage logging.** Add both across
  `lib/ai.ts` call sites and write `usage` into `automation_runs.meta`. Confirm
  the production extraction model in code matches what the docs claim
  (`claude-haiku-4.5` in code, `gemini-2.5-flash-lite` in docs; fix the doc).
  Check gateway 403s are surfaced, not swallowed.
- [ ] **Health shows delivery failures and pages the owner on red.** Add
  `delivery.recentErrors` (last 24 h `delivery_error` rows) to
  `app/api/ops/health/route.ts` and to the `/board/updates` view. Add
  `if: failure()` step to `health-monitor.yml` that texts the owner via Twilio
  (persist intent row first, `is_test` honoured).
- [ ] **Quiet-hours interrupts are never delivered.** `lib/notify.ts:194-198`
  defers and nothing resumes them. Deliver at the next window open from the
  sweep.
- [ ] **Closeout photos exceed body limits.** `app/ops/actions.ts:1222,1415`
  accept up to 12 MB through a Server Action against Next's 1 MB default and
  Vercel's 4.5 MB cap. Route through the existing Blob client-upload path and
  delete the dead 6 MB `MAX_REQUEST_SIZE` on quote.
- [ ] **Error reporting.** `app/board/error.tsx` reports nothing; logging is
  console only. Minimum: `error.tsx` POSTs to `/api/ops/client-error`, which
  writes a `trouble` row (is_test aware) that health surfaces. No new vendor.

## P2 — Database integrity and compute budget

- [ ] **`events` can be deleted; `lead_events` can be written.**
  `events_truth_immutable` is UPDATE-only and `lead_events` has an FK CASCADE.
  Add in `scripts/migrate.mjs` (idempotent `CREATE OR REPLACE` / `DROP TRIGGER
  IF EXISTS`):

  ```sql
  CREATE OR REPLACE FUNCTION events_no_delete() RETURNS trigger AS $$
  BEGIN RAISE EXCEPTION 'events is immutable'; END $$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS events_truth_no_delete ON events;
  CREATE TRIGGER events_truth_no_delete BEFORE DELETE ON events
    FOR EACH ROW EXECUTE FUNCTION events_no_delete();
  DROP TRIGGER IF EXISTS lead_events_frozen ON lead_events;
  CREATE TRIGGER lead_events_frozen BEFORE INSERT OR UPDATE OR DELETE ON lead_events
    FOR EACH ROW EXECUTE FUNCTION events_no_delete();
  ```
  Prove with the QA step, not a source regex.
- [ ] **Migrations have no lock, no transaction, no version table.** Wrap
  `scripts/migrate.mjs` in `SELECT pg_advisory_lock(hashtext('mcsw-migrate'))`
  on a WebSocket `Pool` connection, add `schema_migrations(name text primary
  key, applied_at timestamptz)`, record each named step once.
- [ ] **No backup exists.** `.backups` is empty; the export route is leads-only
  `LIMIT 5000` and includes test rows. Add `.github/workflows/backup.yml` on
  `5 12 * * 0` running `pg_dump --format=custom` to a workflow artifact (90-day
  retention). Change `app/api/ops/export/route.ts` to `WHERE is_test = false`
  unless `?includeTests=1`, and make it stream, not `LIMIT`.
- [ ] **The board is the compute bill.** `app/board/board.tsx:373`
  `router.refresh()` every 60 s (8 s when active), 11 loaders plus
  `getBoardJobDetails` plus an `after()` sweep per refresh; `/ops`
  (`ops-live.tsx:22`) every 30 s; `generateMetadata` on the job page duplicates
  `getLead`. Together ~44 CU-hours/month. Fix: a `/api/ops/pulse` endpoint
  returning `max(events.id)` and `max(calls.updated_at)` (one cheap query), the
  client polls that every 10 s and only calls `router.refresh()` on change;
  idle tabs back off to 5 min; wrap the job page loaders in `cache()`.
- [ ] **Missing indexes.** Add, idempotently (`CREATE INDEX IF NOT EXISTS`):
  `leads(follow_up_at) WHERE follow_up_at IS NOT NULL`,
  `leads(scheduled_at)`, `leads(phone)`, `leads(id) WHERE open_invoice`,
  `leads(won_at)`, `leads USING gin (name gin_trgm_ops)`,
  `events(occurred_at)`, `events(id) WHERE NOT processed`,
  `events(source_event_id)`, `notifications(quote_lead_id)`,
  `calls(to_phone)`, `calls(id) WHERE outbound_pending`,
  `calls(id) WHERE transcript IS NULL`, `messages(id) WHERE status='sending'`,
  `commitments(person_id) WHERE open`, `people(account_key)`,
  `rate_limits(key, ts)`, `rate_limits(ts)`, `automation_runs(job)`.
  Exact column names are in the DB audit; verify each against `EXPLAIN` on the
  query it serves before adding, and drop any the planner does not use.
- [ ] **Rate limiter on the hot path.** `lib/leads.ts:511` `DELETE`s old rows
  on every check and fails open on error. Move the delete to the sweep, fail
  closed for the strict limiter, and use `consumeStrictRateLimit` on
  `app/api/ops/login/route.ts` keyed on `ip + emailHash`.
- [ ] **Health endpoint does six full scans 60+ times a day.**
  `app/api/ops/health/route.ts:143`. Bound each scan by time window and index,
  and cache the result for 5 minutes in-process.
- [ ] **`getAccount` writes on read.** `lib/accounts.ts` issues an UPDATE on
  GET, twice per view under `cache()`. Move the "last seen" write to a
  fire-and-forget `after()` with a 15-minute guard.
- [ ] **Non-transactional multi-statement writes.** `createLead`,
  `replaceJobLineItems` (`lib/job-line-items.ts:81` DELETE then loop),
  `supersedeClaim`. Rewrite each as a single-statement `MATERIALIZED` CTE in the
  house style of `lib/payment-ledger.ts` and `lib/build-sheets.ts:200`
  (`jsonb_to_recordset`).
- [ ] **`is_test` is a copied ILIKE predicate at ~15 sites.** Add
  `is_test boolean NOT NULL DEFAULT false` to `events`, `claims`,
  `commitments`, `calls`, `messages`, `notifications`; backfill from the
  existing predicate; set at write time through the one helper; leave the old
  predicate in place as a belt until the source-regex test proves every writer
  sets the column. Additive; nothing dropped.
- [ ] **Small correctness.** `getMonthRevenueCents` uses UTC month boundaries;
  use `America/Chicago`. Retire the test jobs #34 and #19 by marking, not
  deleting.

## P3 — Authorization, input hardening, customer privacy

- [ ] **Three missing owner gates.** `app/ops/accounts/[id]/actions.ts:15`
  `sendUsualPaperwork` has no owner check and no `is_test`;
  `app/ops/actions.ts:1696` `undoLeadComplete` has no owner check. Gate both
  server-side through the existing `requireOwner` helper; add tests that call
  them with a crew session and assert refusal.
- [ ] **Claims mutated in place.** `app/ops/actions.ts:848-852` and
  `lib/routing.ts:76-81` UPDATE claims on routing. Either write a replacement
  claim with `superseded_by` or record a written exemption in `CLAUDE.md`
  naming the field and why. Decide, do not leave it.
- [ ] **`NaN` reaches `::int`.** `app/api/twilio/voice-status/route.ts:20,23`
  and `outbound-status/route.ts:14,51`. Validate with zod; 400 on bad id.
- [ ] **Raw error messages reach customers.**
  `app/api/glass/upload/route.ts:30-34` and the finalize route return
  `error.message`. Map to plain-language copy from the voice corpus; log the
  real one.
- [ ] **Glass uploads trust the extension.** `finalizeGlassUpload` validates
  extension and declared MIME only. Reuse `imageTypeMatches` from
  `lib/public-quote.mjs:147-159` on the first bytes. Confirm the Blob store is
  private-only regardless of the `access` value the client sends
  (`glass-upload.tsx`).
- [ ] **Photos serve EXIF and GPS.** Strip at serve time in
  `app/api/glass/photo` and the attachment route with `sharp` (already a
  dependency): `.rotate().withMetadata({})`. Strip on upload too where the
  server sees the bytes.
- [ ] **Glass tokens never expire for unconverted jobs.** `lib/glass.ts`
  `createGlassLink` writes `expires_at NULL`. Set 180 days idle, and expire on
  `lost`. Extend on any customer activity.
- [ ] **Bearer token in query strings.** `app/j/[token]/page.tsx:127` and
  `glass-upload.tsx:198` put the token in media URLs (logged by CDNs and
  browsers). Issue short-lived HMAC-signed media URLs (15 min) from the page
  server component.
- [ ] **`/j/[token]/review` lacks `sameOrigin()`.** Add it; every other write
  under `/j` has it.
- [ ] **View counter counts bots.** `app/j/[token]/page.tsx:55-70`. Count only
  on a client beacon after 3 s visible.
- [ ] **Customer SMS has no quiet hours.** `sendSmsPersisted` will text a
  customer at 3 a.m. Enforce 8 a.m.–9 p.m. `America/Chicago` (TCPA) with
  deferral to the window, owner-initiated replies excepted with a visible
  warning.
- [ ] **No refund path.** `parseDollarsToCents` rejects negatives. Add a
  `payment.reversed` event and ledger entry, owner-only, with reason required.
  Do not touch the existing rows or types.
- [ ] **Session hygiene.** `validateSessionToken` swallows DB errors (fail
  closed); 90-day cookie has no idle timeout (add 14-day idle, sliding); expose
  `revokeSession` on the Shop card. Owner quote email includes the customer's
  IP (`app/api/quote/route.ts:~571`); drop it.
- [ ] **Build-fact numbers unchecked.** `app/ops/builds/actions.ts:58,72`
  `Number()` without `Number.isFinite`. Validate.
- [ ] **CSP and HSTS.** `next.config.mjs` has no CSP; HSTS lacks
  `includeSubDomains; preload`. Ship `Content-Security-Policy-Report-Only`
  first with a report endpoint that writes a trouble row, run it for one week
  after P5 (which changes the script set), then enforce. Do this last in the
  plan.

## P4 — Engineering health

- [ ] **No CI gate.** All four workflows are `schedule` + `workflow_dispatch`
  against production. Add `.github/workflows/ci.yml` on `pull_request` and
  `push: main`: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`.
  Register it as a Vercel deployment check so a red suite cannot promote.
- [ ] **Test discovery.** Seven `scripts/*.test.mjs` are in no npm script
  (`board-final-navigation`, `board-internal-tests`, `control-css`,
  `job-calendar`, `job-scheduling`, `ops-conversion-exit`,
  `public-discovery-regressions`) and two fail on stale source regexes
  (`ops-conversion-exit.test.mjs:92`, `public-discovery-regressions.test.mjs:64`).
  Replace the 60-file hand list with `"test": "node --test scripts/"` and
  `"test:all": "npm run typecheck && npm run lint && npm test"`. Fix or delete
  the two stale tests (delete `ops-conversion-exit` per the CRM audit; fix the
  gtag assertion to match `queueMeasurementEvent`).
- [ ] **Behavioral tests where a wrong `WHERE` costs money.** Import-and-call
  tests for `app/api/ops/digest` (is_test excluded, subject/body shape),
  `app/api/ops/export` (crew 403, no crew-money columns), `app/api/ops/ad-spend`
  (401, idempotent), `app/api/ops/shop/document` (persist-before-side-effect,
  size/MIME rejection), `lib/email-templates.ts` (`[INTERNAL TEST]` prefix
  survives), `lib/rate-limit.ts` (window arithmetic with injected clock). Policy
  going forward: new tests exercise code, not source text.
- [ ] **Dead weight out.** `components/ui/*` (56 files, zero importers outside
  itself), `hooks/`, `lib/utils.ts`, `components.json`, and every dependency
  listed in the P4 acceptance criterion. Keep `lucide-react` (12 importers) and
  upgrade it to 1.x, fixing renamed icons where typecheck flags them. Delete
  `styles/globals.css` (only `app/globals.css` is imported,
  `app/layout.tsx:7`), `app/ops/intake/job-intake-form.tsx`, the 15 unused
  selectors in `styles/ops-legacy.css`, `autoprefixer` (not in
  `postcss.config`). Consolidate the token roots in five files into one.
- [ ] **Repo hygiene.** Delete tracked `.hallmark/`, `skills-lock.json`, and
  one of the two identical skill mirrors (`.agents/skills/`, 453 KB; keep
  `.claude/skills/`). Move `output/`, `design-previews/`,
  `archive/ops-legacy-2026-08-20/`, `CLOSEOUT-2026-08-03.md`,
  `CONTINUATION.md` under `docs/archive/`; move `SHOP-BRAIN-PLAN.md`,
  `SESSION-PLAN.md`, `SHOP-BRAIN-SETUP.md`, `BOARD-WIRE-*.md`,
  `MCSW-JOBS-BUILD-HANDOFF.md`, `design.md`, `tokens.css` under `docs/` and
  update the memory pointer. Keep `BRAND-BRIEF.md` at root. Add `.tmp/`,
  `.codex/`, `skill-staging/` to `.gitignore`. Delete the untracked lighthouse
  JSONs, logs, `tsconfig.tsbuildinfo`, `error_discovery_data/`, `tmp/`,
  `.scratch/`.
- [ ] **README.** Currently a UTF-16 one-liner. Rewrite as UTF-8: stack, run,
  the worktree rule, test commands, QA env vars, deploy = push to main, cron
  topology (Vercel is the daily backstop, Actions carry cadence), env var
  names only.
- [ ] **Small config.** `tsconfig.json` `target` ES6 to ES2022. Move the
  `prebuild` `mkdirSync('.backups')` (`package.json:10`) into
  `scripts/mobile-crm-repro.mjs`. Comment why `ws`/`@types/ws` exist. Patch-bump
  `ai`, `@ai-sdk/gateway`, `@vercel/blob`, `resend`, `tailwindcss`. Stay on
  zod 3 and TypeScript 5.9.

## P5 — Public site: performance, SEO, correctness

No P0 here. Lighthouse baseline is 8 weeks stale (2026-08-02, pre-Shop-Wall:
perf 0.82, LCP 3.6 s, TBT 360 ms). Home is 145 KB HTML, 53 scripts, 210 KB gz
JS, 38 KB gz CSS, 204 KB raw CSS.

- [ ] **Measure first.** Add `scripts/qa/lighthouse.mjs` that runs mobile
  Lighthouse against production for `/`, one service page, `/service-areas`,
  and commits the JSON with a date. Run it before and after this phase.
- [ ] **Hero image.** `app/page.tsx:235-242` is `unoptimized`, 800×640 source
  upscaled. Drop `unoptimized`, supply a 1600 px source, add `sizes`, keep
  `priority`. Visually identical.
- [ ] **Meta pixel loads eagerly.** gtag is deferred in
  `components/public-analytics.tsx`; put the pixel behind the same 8 s /
  first-interaction trigger. `__mcswMetaQueue` already queues events. Do not
  change what it sends.
- [ ] **Dead CSS.** `app/globals.css` is 3,477 lines with 559 `.ms-` and 178
  `.glass` rules. Finish the retirement with `scripts/qa/retire-ops-css.mjs`,
  prove no visual change with `fingerprint-diff.mjs` at all four widths.
- [ ] **H1 is the brand name.** `app/page.tsx:203-209`. Keep the sign visually
  identical; carry service + city in the accessible text.
- [ ] **Service-area cities are unlinked `<strong>`.**
  `app/service-areas/page.tsx:176`. Link each to the matching service page
  anchor (per-city pages are P7, owner-gated on content).
- [ ] **Structured data.** Add `FAQPage` to service pages from
  `lib/service-pages.ts` `faqs`; fix breadcrumb item 2 to an absolute URL
  (`app/services/[slug]/page.tsx:51-59`); add `geo` and `priceRange` to
  `LocalBusiness`. `sameAs` for GBP waits on the owner.
- [ ] **Honeypot punishes autofill.** `app/api/quote/route.ts:203-207` and
  `components/mainstreet-contact.tsx:152,266`: field named `company` gets
  autofilled and the user sees an error. Rename to something no browser fills,
  and on the client treat a honeypot hit as success (silent drop server-side).
- [ ] **Quote form only on the home page.** Import `MainstreetContact` into
  service pages below the fold.
- [ ] **Home duplicates header and footer inline** (`app/page.tsx:163-198,
  473-492`); footer `Sales@` capitalised. Use the shared components; fix the
  case.
- [ ] **Small correctness.** Favicon path contains a space, stray PNGs, move
  `icon.svg` to `app/`; 404 page emits `robots` twice; sitemap has no
  `lastmod` (use the file's git date); `Access-Control-Allow-Origin: *` is set
  on HTML responses, scope it to the API routes that need it.
- [ ] **Twilio fallback number silently swaps NAP.** `lib/shop-contact.ts`
  falls back to `(615) 810-4910`. Make the fallback throw in production and
  log in preview so a misconfigured env can never publish the wrong number.

## P6 — CRM client, PWA, owner loop

- [ ] **Manifest scope is wrong.** `app/ops/manifest.webmanifest/route.ts`
  sets `scope: "/ops/"` while `/ops` redirects to `/board`, and
  `public/ops-sw.js:164-185` `notificationclick` only matches `startsWith("/ops")`.
  Set scope `/`, `start_url` `/board`, dark `background_color`, 192/512
  maskable PNGs; have push payloads carry `url: /ops/leads/<id>` and the
  service worker open it.
- [ ] **No offline.** The service worker has no fetch handler. Add
  stale-while-revalidate for `/board*`, `/ops/leads/*` and `_next/static`,
  versioned by commit SHA, with an offline banner component. Writes are never
  queued offline (Call precedes Text; a failed write must be visible).
- [ ] **Signed-out `/board` shows the empty board.** Show the login screen.
  Push toggle vanishes on error (`push-toggle.tsx:255-257`); show the error.
  `glass-actions.ts` and `calendar-actions.ts` never `revalidatePath`; add it.
- [ ] **Client bundle.** 15 KB base64 logo inline in `board.tsx:422` (serve
  the file); theme boot duplicated (`board.tsx:383-414` vs `theme-boot.tsx`,
  keep one); `/ops` redirect hops; install page is Chrome-only (add the iOS
  Share → Add to Home Screen path); duplicate social link.
- [ ] **Owner loop.** Today a lead takes 2–4 taps. Sticky action strip on the
  job page (Call, Text, Photo, Quote amount inline in the board detail), photo
  as first tap target, voice capture on the row. Present the layout to the
  owner as a screenshot before building; design rules apply.

## P7 — Innovation that earns its place

Each item below is gated: it ships only if its guard is met. Items that did not
earn a place are listed at the end so nobody re-proposes them.

- [ ] **Bundle-size budget.** `scripts/bundle-budget.mjs` reads
  `.next/build-manifest.json` on the preview build and fails CI when `/` or
  `/board` first-load JS exceeds a threshold set 10% above today's number.
  Catches the "use client value-imports a server lib" class before Vercel does.
  Guard: runs in CI from P4.
- [ ] **SQL cast guard.** A 30-line `sql` wrapper (or eslint rule) that rejects
  an interpolation without a `::cast` at development time, enforcing the
  invariant where it happens instead of in a regex test. Guard: zero false
  positives across the existing tree.
- [ ] **Evals harness for extraction.** `scripts/ai-evals.test.mjs` with a
  fixture set of real-shaped `[INTERNAL TEST]` calls and emails, scoring the
  claims schema output. Runs on demand, not in CI. Guard: model swaps become a
  measured decision.
- [ ] **Strip-types instead of `.d.mts` twins.** After Node 24 locally
  (P0): rename `lib/*.mjs` to `.ts`, delete the 25 `.d.mts`, run tests with
  `node --experimental-strip-types --test`. Removes the "declaration lied"
  class. Guard: typecheck and full suite green; 80 import specifiers updated.
- [ ] **Photo to quote draft.** From a glass upload, draft `claims` (scope,
  material, dimensions, no price) for the owner to accept. Uses the existing
  claims schema and `superseded_by`. Guard: owner sign-off on the flow before
  code; never auto-prices; never auto-sends.
- [ ] **Follow-up cadence from won jobs.** Learn the median days-to-close from
  `won_at` and set `follow_up_at` defaults from it instead of a constant.
  Guard: owner can override per lead; no per-worker stats.
- [ ] **Preview-based QA gate.** A workflow that deploys a preview, runs
  `create-local-login.mjs`, then `MCSW_QA_STRICT=1 npm run test:qa`. The
  harness exists; it needs a runner. Guard: Vercel Hobby preview and Actions
  minutes allow it; measure the first month.
- [ ] **Per-city pages `/service-areas/[city]`.** Eight cities. **Blocked on
  the owner** supplying real jobs per city; no invented content. Build the
  route and template only when content exists.
- [ ] **Call-in-progress chips.** SSE from the live-transcript route to the
  board row so the owner sees the call being read as it happens. Guard: ships
  only after P2's pulse endpoint proves the compute budget has room.

**Did not earn a place (do not re-propose):** `vercel.ts` (four crons do not
need it); `HowTo` schema; `@vercel/speed-insights` on Hobby; Vercel Queues for
Gmail (only if a backlog ever happens); "reply in my voice" auto-drafts to
customers (consent and voice risk, owner decision, not this plan); weekly audio
brief (the daily one exists); `/work` gallery (owner decision on consented
photos); review loop (blocked on GBP verification); zod 4 migration; TypeScript
7; Next 17 before a preview soak in Q1.

---

## Foreseeable problems (fix now or watch)

- **Vercel deprecates Node 20 on 2026-10-01.** Production is already 24.x;
  the risk is local drift and the `.d.mts` twin friction. P0 pins it.
- **GitHub disables scheduled workflows after 60 days without a push.** Every
  cron cadence in this repo depends on pushes continuing. The backup workflow
  and CI gate in P2/P4 make a push likely, but add a `keepalive` step to
  `health-monitor.yml` that commits a dated file to a `keepalive` branch
  monthly.
- **`after()` work is lost on function recycle.** Sweeps and extraction that
  run in `after()` are best-effort. The sweep's cooldown removal (P1) reduces
  the window; do not move anything money-related into `after()`.
- **DST.** Every cron in `vercel.json` and the Actions files is UTC. The brief
  fix in P1 is the pattern: schedule both hours, let the route reject the
  wrong one.
- **Neon storage cap 0.5 GB.** Blob grows forever and `events` is immutable by
  design. Add a monthly row count and Blob size to health; decide retention
  for Blob only (events never).
- **Webhook signature drift.** Count Twilio and Resend 403s in health; a spike
  is a rotated secret.
- **Playwright drift.** `@playwright/test` pins a Chromium; pin the browser
  install in whatever runs `test:qa`.
- **Large files at upgrade time.** `app/api/quote/route.ts` (742 lines) and
  `app/ops/actions.ts` (1,814 lines) are where Next 17 semantics will bite.
  Keep them behavioral-tested (P4) before the Q1 upgrade.

## Do-not-touch list

`lead_events` (any write), live column names and types, Shop Wall design and
tokens, Phil's voice corpus, `verify-ads-tag.mjs`, Ads/Meta pixel event
payloads, `/api/ops/ad-spend` contract with Mirror, Twilio numbers, GBP,
DMARC, `archive/ops-legacy-2026-08-20/` contents (move only), `BRAND-BRIEF.md`
location, worker-surveillance surfaces of any kind.

## Session split

See `2026-09-25-mcsw-full-optimization-SESSION-PLAN.md` next to this file. One
row, one fresh chat, Opus 5.5 high, present the session's plan before code.
