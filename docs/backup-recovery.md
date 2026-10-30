# Encrypted database backup and recovery

The repository is public. Never upload an unencrypted database dump, a backup
key, local environment files, or authenticated browser storage to its artifacts.
GitHub permits signed-in readers to download workflow artifacts:
https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts.

## Enable only after the secure workflow is released

The predeployment branch adds authenticated AES-256-GCM encryption. Until that
version of `.github/workflows/backup.yml`, `scripts/backup-dump.mjs`, and
`scripts/backup-crypto.mjs` is on the
default branch, **do not add `DATABASE_URL_UNPOOLED` to repository secrets or run
the old backup workflow**. The old workflow uploads plaintext. No secrets were
provisioned and no backup workflow was triggered in the October 29 audit.

After releasing the reviewed workflow:

1. Create a cryptographically random 32-byte key, represented as exactly 64 hex
   characters. Retain it in the owner's secure password manager independently
   of GitHub; GitHub repository secrets cannot be retrieved later. Losing the
   key makes the corresponding backups unrecoverable. Keep older keys while
   backups encrypted with them are retained. Never put a key in a command
   argument, public log, repository file, or uploaded artifact.
2. Provision repository secrets `BACKUP_ENCRYPTION_KEY` and
   `DATABASE_URL_UNPOOLED` through the authenticated secret interface. Use the
   existing direct production connection and secure stdin/environment handling.
3. Manually dispatch **Weekly Neon backup**, not Preview QA. This uses
   `default_transaction_read_only=on`, PostgreSQL 17 `pg_dump`, and no application
   runtime. Verify the source server is compatible with PostgreSQL 17 dump tools
   before enabling; a newer server major requires matching or newer tools.
4. Confirm the run succeeds and the retained artifact contains only
   `mcsw-backup.dump.enc`. Check the Sunday schedule and the 90-day retention.
   Artifact creation proves backup creation; a restore check proves recovery.

For key rotation, first store the new key and its activation date alongside the
old key in the secure recovery record, then update `BACKUP_ENCRYPTION_KEY`. Verify
a new encrypted backup can be decrypted with that key. Do not discard the old
key before its last retained backup expires. The key record must be available
to the owner even if GitHub access is lost.

The dump starts as an owner-only file and is removed by an EXIT trap. Encryption
streams through bounded buffers. A fresh 96-bit nonce and authenticated format
header accompany each backup; a 128-bit GCM tag detects corruption/wrong keys.
Output is published only after successful completion, never over an existing
file. An interrupted process can leave a private `.partial` file; delete it
before retrying. Never upload wildcard paths from the backup workspace.

The dump helper parses the connection URL into separate libpq environment
variables; a URI in `PGDATABASE` alone is not expanded by libpq. Credentials never
appear in Docker/pg_dump arguments or public logs. The helper forces read-only
transactions, a 15-second connection timeout, and `sslmode=verify-full`, using
Node 24's bundled public CA roots in a temporary owner-only file mounted into
the container. It preserves required channel binding and refuses URL options
that could redirect or override the session. `--no-password` prevents an absent
credential from hanging on an interactive prompt. Docker must be available;
errors are deliberately sanitized rather than printing connection details.
On a failed or timed-out dump, the helper also makes a bounded cleanup attempt
against only its recorded container ID. The shell trap removes the plaintext;
Git and deployment exclusions cover known backup and temporary certificate paths.

## Restore check in an isolated environment

Download the encrypted artifact into a restricted temporary directory. Set
`BACKUP_ENCRYPTION_KEY` in that process's environment from the secure key store.
Use a current Node 24 runtime:

```text
node scripts/backup-crypto.mjs decrypt mcsw-backup.dump.enc mcsw-restored.dump
```

The tool exits nonzero for incorrect keys, modified/truncated data, or an
existing destination; no final plaintext file is published on authentication
failure. Clear the key environment variable after decryption.

Create a new disposable PostgreSQL cluster bound only to `127.0.0.1`, with a new
empty database, no provider credentials, and no application/cron processes.
Explicitly pass its loopback host, distinct port, and database to `pg_restore`:

```text
pg_restore --host=127.0.0.1 --port=LOCAL_PORT --dbname=DISPOSABLE_DB --no-owner --no-privileges --exit-on-error mcsw-restored.dump
```

Never use a production connection for this step. Check restore exit status,
schema, constraints, and aggregate row counts without printing customer data.
Do not replay job queues, send notifications, run the CRM, or call providers
against the restored production snapshot. Stop the disposable server, delete
the restored cluster and plaintext dump, and retain only aggregate evidence.

## Application rollback

This polish branch adds no schema migration or dependency update. Keep the
previous known-good deployed revision available and revert the application
release if its postdeployment checks fail; do not restore the production
database merely to roll back UI code. Database recovery is a separate,
explicitly approved incident procedure. Record the actual previous deployment
identifier at final deployment time; no deployment or alias change occurs as
part of predeployment validation.

## Final release sequence and separate preview prerequisites

1. Finish local review and release checks, remove the temporary QA route, and
   confirm no credentials, plaintext dumps, auth storage, or `.partial` files
   are staged. Preserve the previous production deployment identifier.
2. Release the secure backup workflow first. Only after its default-branch
   contents are verified may its two secrets be provisioned and a backup run
   dispatched. Confirm ciphertext-only artifact and authorized isolated restore.
   Code readiness does not establish operational backup acceptance.
3. Release the reviewed application when its acceptance gates are satisfied.
   A push to `main` deploys production. A pull request triggers `qa-preview.yml`,
   which also deploys a hosted preview and creates a database-backed owner login;
   neither action belongs to the local-only predeployment phase.
4. Check the deployed build, signed-out access, authenticated owner/crew views,
   cache/session behavior, mobile navigation, and critical read-only routes.
   Run communication/payment/upload smoke actions only with the intended
   authorized test records and recipients; verify durable receipts and no
   duplicate side effects. Check scheduled health and backup results. Revert
   the application to the preserved release if a release-blocking check fails.

Read-only GitHub inspection on October 29 found only `CRON_SECRET` in repository
Actions secrets. Hosted Preview QA separately needs
`VERCEL_AUTOMATION_BYPASS_SECRET`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
`VERCEL_PROJECT_ID`, and `DATABASE_URL`; none were configured during this audit.
Provision and verify them only if the hosted Preview QA deployment path is
chosen. Local checks do not establish that hosted workflow can currently pass.
