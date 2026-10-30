# CRM predeployment handoff — October 30, 2026

**Local release checks and production snapshot recovery passed. Nothing is deployed.**
Build/typecheck evidence covers the unchanged application source; regression
evidence includes the backup connection correction. Native screen-reader,
physical-device, and live-provider acceptance are not established. This is not
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
| Production build | Passed; compilation 44s, TypeScript 39.6s, 50 static pages. [Build log](visual-polish/2026-10-29/predeployment-release/production-build.log). |
| Full regression suite | 1,054 total; 1,051 passed; 0 failed; 3 skipped. [Summary](visual-polish/2026-10-29/predeployment-release/tests-summary.log). |
| ESLint | Passed with `--max-warnings=0`; 0 warnings/errors. [Log](visual-polish/2026-10-29/predeployment-release/lint.log). |
| Standalone typecheck | `tsc --noEmit` passed with exit 0 after final fixture cleanup. [Log](visual-polish/2026-10-29/predeployment-release/typecheck.log). |
| JavaScript budgets | Public 612,409 / 648,316 bytes; board 712,282 / 817,538 bytes. These are uncompressed bytes, not measured loading time. [Log](visual-polish/2026-10-29/predeployment-release/bundle-budget.log). |
| Real PostgreSQL | Both previously skipped persistence tests and six additional SQL/runtime checks passed. Migration replay, restart durability, and all 60 public-table counts after encrypted synthetic backup/restore passed. [Backend report](predeployment-backend-2026-10-29.md). |
| Production snapshot recovery | Passed using verified TLS and a read-only exported snapshot. All 69 tables / 33,008 rows, 265 constraints, 190 indexes, and five triggers matched after encrypted backup/decrypt/restore. No invalid constraints/indexes. Local server stopped; temporary production-data copies deleted. [Recovery report](production-recovery-2026-10-30.md), [aggregate evidence](visual-polish/2026-10-29/production-recovery/summary.json). |
| Browser/visual coverage | 202 accepted layout cases, four actual Chromium 200% zoom checks, cross-engine and form-recovery checks, with fixture and engine limits recorded. [CRM audit](crm-polish-2026-10-29.md). |
| Independent review | No unresolved implementation blocker in the reviewed follow-up. Five backup crypto/workflow tests passed. [Review](visual-polish/2026-10-29/predeploy-review.md). |

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
email, remote storage, or production authentication behavior.

After the interrupted native-accessibility attempt, the copied QA route was
removed and its archive verified. The final production route manifest contains
no `qa-polish` entry; the generated AGENTS appendix was removed; whitespace
checks passed. Owned QA servers, the isolated browser, and portable NVDA were
stopped. No production source changed after the successful production build.

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
- **Devices:** physical iPhone/Android, native Safari, virtual keyboards,
  operating-system text scaling, and native installation remain unverified.
  Playwright WebKit does not replace those checks. Its Windows Blob IndexedDB
  failure and the narrower Chromium voice-recovery proof are recorded in the
  CRM audit.
- **Providers and authentication:** carrier/email delivery, remote Blob
  upload/callbacks, real owner/crew login, and sandbox QuickBooks/Gmail receipt
  ingestion need permitted test identities/endpoints. No real customer message,
  call, payment, or upload was used as a test.

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

The local implementation is saved in three commits:

- `2339806` — `fix(backup): encrypt retained database dumps`
- `a97e299` — `fix(crm): polish responsive flows and recovery`
- `039f859` — `fix(backup): pass explicit verified connections`

The two backup commits together permit the workflow-first release sequence. The
main checkout remains clean. The handoff and aggregate evidence are packaged
separately from those code commits. No branch push, PR, hosted preview, or
production release occurred.
