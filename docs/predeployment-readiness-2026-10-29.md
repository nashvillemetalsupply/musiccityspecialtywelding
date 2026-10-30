# Predeployment release-readiness evidence — October 29, 2026

This supplements `crm-polish-2026-10-29.md`. It reports local changes and
read-only operational inspection, not a deployment or a universal device claim.

## Fixes completed

- Removed unused closeout-upload import and unused digest/QA parser locals.
- Kept full-document navigation on service-worker session expiration, with one
  explained lint exception. The worker can serve cached authenticated markup
  before background revalidation detects sign-out; a full navigation discards
  that markup and the retained App Router state.
- Excluded `.tmp/**` from ESLint. The previous plain lint command traversed
  downloaded WebKit code and generated local bundles despite Git ignore rules.
- Explicitly excluded env files, Git internals, browser auth storage, archived QA
  fixtures, screenshots/evidence, test reports, and debug logs from Vercel source
  upload. Added the browser-generated root `debug.log` to Git ignore.
- Replaced plaintext backup publication with streamed AES-256-GCM ciphertext,
  authenticated header, random nonce, owner-only temporary files, atomic output
  publication, and failure cleanup. The workflow enforces read-only database
  access and uploads only the explicit `.dump.enc` path.
- Added encryption/decryption behavioral tests and [recovery/runbook](backup-recovery.md).

## Concrete checks

- 21 focused digest, service worker, PWA, preview-workflow, and original backup
  checks passed after warning cleanup. Targeted changed-source ESLint passes
  with `--max-warnings=0`.
- Four encryption tests plus the updated workflow test pass: binary roundtrip,
  unique nonce, wrong-key/tampered-header/ciphertext/tag rejection, truncation,
  invalid keys, existing-output preservation, and empty input. Failure cases
  also assert no partial plaintext remains.
- Synthetic PostgreSQL 17 backup lifecycle passed: `pg_dump` -> AES-256-GCM
  encrypt -> decrypt -> `pg_restore`. Plaintext/decrypted SHA-256 values match,
  all 60 public-table row counts match, and 295 migration records are retained.
  The disposable cluster was stopped; all seven initialized synthetic cluster
  directories and generated dumps/ciphertext were removed. Aggregate evidence:
  [backend summary](visual-polish/2026-10-29/predeployment-backend/summary.json)
  and [backend report](predeployment-backend-2026-10-29.md).
- Before root's temporary screen-reader fixture was restored: final artifact
  contained 92 routes, zero QA fixture routes; all 94 server trace manifests had
  no local env or archived fixture paths. The worktree contained no env files.
- Pattern scan covered 151 changed/new text files: no credential patterns.
  Scan of 124 browser artifact files found only a PKCS#8 parser's literal header
  marker, not a key. This is a bounded pattern scan, not proof against every
  possible secret format. No environment values were printed.
- Existing source changes include no schema migration or dependency update.
  `git diff --check` passes. Root owns final build/typecheck/test/lint checks
  after temporary fixture removal and all current edits.

## Operational findings

GitHub metadata confirms `nashvillemetalsupply/musiccityspecialtywelding` is
public. Signed-in repository readers can download workflow artifacts, according
to [GitHub's documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts).
The old workflow would upload a full unencrypted production dump. It was not
enabled or dispatched during this audit.

The three latest weekly backup runs all failed:

- [October 25](https://github.com/nashvillemetalsupply/musiccityspecialtywelding/actions/runs/40208498654)
- [October 18](https://github.com/nashvillemetalsupply/musiccityspecialtywelding/actions/runs/39141133200)
- [October 11](https://github.com/nashvillemetalsupply/musiccityspecialtywelding/actions/runs/38159912394)

Latest run step metadata confirms dump failure and skipped upload; artifact
inventory is empty. Failure-log classification identifies the missing
`DATABASE_URL_UNPOOLED` repository secret without printing raw logs. Repository
secret-name inventory contains only `CRON_SECRET`. No secret was provisioned.
The repaired workflow must reach the default branch before adding database and
backup encryption secrets, then its real backup/restore acceptance must pass.

Production env snapshot **names only** support presence of database, Blob,
Twilio, Deepgram, Gmail, Resend, Customer Page, ops punch, and VAPID variables.
`AI_GATEWAY_API_KEY` is absent there, but code accepts Vercel OIDC/platform
identity; this is not proof of a missing required credential. Site/webhook base
URL variables have explicit production-origin defaults. `GOOGLE_REVIEW_URL` is
absent in the snapshot; its optional review link is therefore not established.
Snapshot names do not prove current remote values or provider acceptance.

No BrowserStack, Sauce Labs, LambdaTest, or TestingBot config was found in
repository QA/config paths or env names. Tools provide local browser engines,
not physical-device coverage. Root owns accessibility and device findings.

## Open acceptance boundaries

- **Production snapshot recovery passed after explicit owner authorization.**
  The initial approval hold was resolved by the owner's subsequent permission.
  The [October 30 drill](production-recovery-2026-10-30.md) used a read-only,
  consistent production snapshot and verified TLS; encrypted/decrypted backup
  restored into an isolated local cluster with all 69 tables and 33,008 rows
  matching. Constraints, indexes, and triggers also matched. All temporary
  production-data copies and the owned cluster were removed. This does not
  establish that the hosted recurring backup workflow has been released or run.
- Hosted Preview QA secrets are absent; the [runbook](backup-recovery.md)
  separates those optional hosted-deployment prerequisites from local gates.
- No Claude, Pi, DeepSeek, or paid model evaluation was invoked. Deterministic
  contract tests exercise AI boundaries; model configuration was not changed.
- No push, staging, commit, preview hosting, deployment, production write,
  remote secret change, or external message occurred in this readiness work.

Local code readiness and operational acceptance are separate. The encrypted
backup repair is ready for final integration/review; successful recurring
production backups cannot be claimed until its release and protected acceptance.
