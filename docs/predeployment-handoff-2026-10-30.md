# CRM predeployment handoff — October 30, 2026

**Local release checks, real local HTTP acceptance, and production snapshot recovery passed. No Vercel preview or final deployment occurred.**
Final build/typecheck evidence covers the voice/photo recovery and closeout
navigation corrections; regression evidence includes the backup connection correction. Native screen-reader,
physical-device, and live-provider acceptance are not established. Blob storage
acceptance is blocked by a confirmed provider quota suspension. A temporary,
credential-free synthetic browser preview was tested separately from the deployed
CRM and its public tunnel was stopped; it was not a Vercel preview or a final deployment. This is not
a claim that deployment is the only remaining acceptance step or that every
possible device and workflow is issue-free.

The changes are isolated in `task/crm-polish-2026-10-29`, based on
`46b4ed5a1aa7b66e26c91eac6309d62ba676b414`. This handoff supersedes the initial
four-warning lint result and the earlier absence of real-database verification.
All work in this follow-up used Codex; Claude, Pi, DeepSeek, and paid model
evaluations were not invoked.

## Recorded checks

| Check | Result and evidence |
| --- | --- |
| Production build | Passed; compilation 29.5s, TypeScript 7.6s, 50 static pages, two workers. No QA route in production manifest. [Build log](visual-polish/2026-10-29/provider-recovery-release/build.log). |
| Full regression suite | 1,067 total; 1,064 passed; 0 failed; 3 skipped. [Summary](visual-polish/2026-10-29/provider-recovery-release/tests-summary.log). |
| ESLint | Passed with `--max-warnings=0`; 0 warnings/errors. [Log](visual-polish/2026-10-29/provider-recovery-release/lint.log). |
| Standalone typecheck | `tsc --noEmit` passed with exit 0 on the final revision. [Log](visual-polish/2026-10-29/provider-recovery-release/typecheck.log). |
| JavaScript budgets | Public 612,409 / 648,316 bytes; board 712,459 / 817,538 bytes. These are uncompressed bytes, not measured loading time. [Log](visual-polish/2026-10-29/provider-recovery-release/budgets.log). |
| Real PostgreSQL | Both previously skipped persistence tests and six additional SQL/runtime checks passed. Migration replay, restart durability, and all 60 public-table counts after encrypted synthetic backup/restore passed. [Backend report](predeployment-backend-2026-10-29.md). |
| Real Next HTTP and forms | 19 authentication/role/browser/recovery checks plus three actual form workflows passed through the rebuilt production app and fresh PostgreSQL. Rejected drafts retained input; retry saved exactly one test job/receipt; Notes survived reload. Missing-audio polling stays private and operator-scoped. 286 actual SQL requests, zero SQL errors/external attempts. [Acceptance report](next-http-acceptance-2026-10-30.md). |
| Temporary synthetic browser preview | Three gateway security tests, public HTTPS smoke, 63 distinct checklist cases after correction, and 16 expanded closeout cases passed. The expanded cases measure every control at 320–1440px, portrait/landscape and enlarged text. These are automated browser results, not physical Android acceptance. [Preview report](testing/2026-10-30-android-preview.md). |
| Blob provider acceptance | Blocked: the configured private store returned typed `BlobStoreSuspendedError`; read-only metadata confirmed usage-limit suspension. Neither synthetic probe created an observed object. [Provider report](testing/2026-10-30-blob-provider-acceptance.md). |
| Production snapshot recovery | Passed using verified TLS and a read-only exported snapshot. All 69 tables / 33,008 rows, 265 constraints, 190 indexes, and five triggers matched after encrypted backup/decrypt/restore. No invalid constraints/indexes. Local server stopped; temporary production-data copies deleted. [Recovery report](production-recovery-2026-10-30.md), [aggregate evidence](visual-polish/2026-10-29/production-recovery/summary.json). |
| Browser/visual coverage | 202 accepted layout cases, four actual Chromium 200% zoom checks, cross-engine and form-recovery checks, with fixture and engine limits recorded. [CRM audit](crm-polish-2026-10-29.md). |
| Independent review | No unresolved implementation blocker in the reviewed follow-up. [Backup/release review](visual-polish/2026-10-29/predeploy-review.md), [recovery/navigation review](visual-polish/2026-10-29/provider-recovery-review.md). |

The final follow-up corrected five concrete defects: an existing voice intent
without uploaded audio could never re-upload its retained recording; a failed
photo upload discarded the selected file; and the Photo shortcut had no target
while the reviewed-closeout prerequisite was incomplete. Expanded closeout
review also inherited narrow legacy grid columns, and its photo label inherited
a dark foreground on the dark panel. The corrected review uses available width,
scales its minimum column size with text, and restores readable photo-label color.
Recovery retains the
operator/job boundaries. Photo retry retains the File only while the page stays
open. The reviewed closeout still requires completed-work review before upload;
its shortcut now reaches an explanation and the required input. Behavioral
regressions cover these failures. Source hashes and final check results are in
[the release summary](visual-polish/2026-10-29/provider-recovery-release/summary.json).

The production recovery drill exposed a connection setup gap in the backup
workflow. The corrected helper supplies separate libpq connection fields,
requires certificate/hostname verification, keeps credentials out of process
arguments, and requests a read-only session. This follows PostgreSQL's
[connection-parameter/default ordering](https://www.postgresql.org/docs/17/libpq-connect.html)
and [environment field mapping](https://www.postgresql.org/docs/17/libpq-envars.html).
Nine focused backup tests pass, including actual libpq negotiation against a
nondefault local port and refusal of a server without TLS. Independent source
review also verified bounded cleanup of only the helper's own container after
failure. Docker/GitHub execution itself remains a release acceptance check.

The full-suite skips are one deliberately disabled paid AI evaluation and two
database tests; the database tests passed in the separate real-PostgreSQL run.
The eight SQL tests use offline provider adapters and do not prove carrier,
email, remote storage, or deployed authentication behavior. The later 19-check
Next HTTP run separately proves the tested local authentication/session/role
boundary using actual application code and PostgreSQL.

After the interrupted native-accessibility attempt, the copied QA route was
removed and its archive verified. The final production route manifest contains
no `qa-polish` entry; the generated AGENTS appendix was removed; whitespace
checks passed. Owned QA servers, the isolated browser, and portable NVDA were
stopped at the end of that earlier pass. A later credential-free production
fixture copy and a gated temporary synthetic preview were started for additional
browser checks. They use a separate build output; the application has no active
QA route. The public preview exposed only allowlisted fixture/static GET/HEAD
requests and could not submit data or reach live CRM/provider routes. Its owned
tunnel processes were stopped after the user declined a manual phone checklist.

## Remaining acceptance boundaries

- **Recurring production backups:** the authorized local production-data
  recovery drill passed; the encrypted GitHub workflow has not been released or
  run remotely. Its missing secrets and successful scheduled execution still
  require the release sequence below. No snapshot was uploaded or written back
  to production during the drill.
- **Native accessibility:** automatic approval review rejected the required
  window inventory even after the user's approval, citing unrelated private
  window metadata. Portable NVDA launch is not a successful screen-reader test.
  The supported Windows API requires a returned window identifier before it
  can target the app; no successful native acceptance is claimed.
- **Devices:** the user has Android but no iPhone/Safari and declined a manual
  phone checklist. Automated preview checks were performed without requiring
  that manual work. Physical iPhone/Android, native Safari, virtual keyboards,
  operating-system text scaling, and native installation remain unverified.
  Playwright WebKit does not replace those checks. Its Windows Blob IndexedDB
  failure and the narrower Chromium voice-recovery proof are recorded in the
  CRM audit.
- **Providers and authentication:** actual local owner/crew login, session
  revocation/expiry, role changes, protected content, and form persistence passed
  the real Next HTTP checks. Carrier/email sign-in delivery, deployed sessions,
  sandbox QuickBooks/Gmail receipt ingestion, and Blob upload/callback workflows
  remain separate acceptance boundaries. Blob transport was attempted and is
  blocked by the existing provider usage-limit suspension; restoration and a
  successful repeat are required. No real customer message, call, payment, or
  upload was used as a test.

## Deployment and configuration sequence

1. Preserve the previous production deployment identifier. Verify the reviewed
   application contains no active QA route, credentials, plaintext dumps, auth
   storage, or temporary browser files before staging/releasing it.
2. Release backup commits `2339806` and `039f859` together, and verify the
   encrypted backup workflow and connection helper on the default branch
   **before** supplying its missing database secret. The public repository's old
   workflow uploads plaintext; do not enable or dispatch it. A main-branch push
   deploys production, and opening a PR triggers a hosted-preview deployment, so
   both stay outside this local-only pass.
3. Retain the random backup key independently in the owner's secure recovery
   store, then provision `BACKUP_ENCRYPTION_KEY` and `DATABASE_URL_UNPOOLED` using
   the secure secret interface. Verify server/client PostgreSQL compatibility,
   a successful backup run, ciphertext-only artifact, and recovery. Local
   testing does not establish the remote schedule is working.
4. Release the reviewed application, then verify signed-out access, real
   owner/crew views, session expiration/offline behavior, mobile navigation, and
   the authorized provider smoke flows. Roll back the application to the
   preserved release if a blocking check fails; this change needs no schema or
   database rollback.

The [backup/recovery runbook](backup-recovery.md) contains key retention,
rotation, restore and cleanup instructions, plus the separate optional hosted
Preview QA secrets. The [readiness report](predeployment-readiness-2026-10-29.md)
records the failed historical backup runs, artifact exclusions, and credential
name-only inspection. No remote secret was provisioned and no workflow was
dispatched during the local readiness work.

The local implementation is saved in four commits:

- `2339806` — `fix(backup): encrypt retained database dumps`
- `a97e299` — `fix(crm): polish responsive flows and recovery`
- `039f859` — `fix(backup): pass explicit verified connections`
- `ac91fca` — `fix(crm): recover uploads and clarify closeout`

The two backup commits together permit the workflow-first release sequence. The
main checkout remains clean. The handoff and aggregate evidence are packaged
separately from those code commits. No branch push, PR, Vercel preview, or
production release occurred. The temporary synthetic tunnel was a separate
preproduction testing surface with no production credentials or records; it has
been stopped.
