# Production snapshot recovery verification — October 30, 2026

**Passed.** The owner explicitly authorized a temporary read-only production
backup, isolated local restore, and deletion of both copies. That authorization
supersedes the earlier approval hold in the October 29 reports. The completed
run began at 05:53:56 UTC and finished at 05:54:44 UTC on October 30.

## What was verified

- Native PostgreSQL 17 tools connected to production using full TLS certificate
  and hostname verification. The source reported PostgreSQL 17 and
  `transaction_read_only=on`. Its extensions were only `pg_trgm` and `plpgsql`.
- A read-only repeatable-read transaction exported a snapshot. Both the source
  table/structure checks and `pg_dump --snapshot` used that same snapshot, so live
  activity during the drill could not create a false comparison.
- The complete custom-format dump was encrypted and decrypted by the reviewed
  AES-256-GCM helper with a fresh key held only in process memory. Original and
  decrypted SHA-256 digests matched; ciphertext differed.
- The decrypted archive restored successfully with `pg_restore --exit-on-error`
  into a new PostgreSQL 17.10 cluster bound only to `127.0.0.1`. No CRM server,
  cron, provider credentials, or notification worker ran against that database.
- All **69 non-system tables and 33,008 rows** matched. Structural totals also
  matched: **265 constraints, 190 indexes, and five application triggers**.
  Both snapshots had zero invalid constraints and zero invalid indexes.
- The owned server stopped successfully. The complete owner/SYSTEM-only
  temporary directory was deleted, including the database, dump, ciphertext,
  decrypted archive, and server log. A final filesystem check found no remaining
  `production-recovery-*` directories. Only aggregate evidence is retained.

The [machine-readable record](visual-polish/2026-10-29/production-recovery/summary.json)
contains stage exit codes and timings, aggregate comparisons, the archive digest,
and cleanup confirmation. It contains no connection URLs, credentials, customer
records, or backup key.

## Findings closed during the drill

The first connection exposed an operational bug: a URI placed only in
`PGDATABASE` is treated as a database-name default, not an expanded connection
string. A safe fake-credential/nondefault-port probe proved that native `psql`
instead attempted its default port. The release backup helper was therefore
sent back for correction to explicit libpq environment fields and a real client
regression check. Earlier failed attempts created no production dump and their
restricted temporary directories were removed. Their sanitized failure records
remain next to the successful record.

Windows PostgreSQL's system-trust setting then failed certificate validation.
The completed drill supplied the trusted CA bundle embedded in the pinned Node
24 runtime as an explicit temporary `PGSSLROOTCERT` file while retaining
`PGSSLMODE=verify-full`. TLS verification was never disabled. A contemplated
WebSocket bridge was not used for the successful dump or restore.

## Scope of this result

This proves that the observed production snapshot can be dumped, authenticated,
decrypted, and restored locally with matching aggregate data and structure. It
does not prove the hosted scheduled backup workflow has run successfully; that
workflow still needs its safe release, secure key/connection provisioning, and
ciphertext-only artifact acceptance. It also does not test live provider
delivery, application authentication, external Blob contents, or every possible
recovery incident. Production migration IDs were not compared with the current
migration runner; the earlier fresh-schema/replay check is separate evidence.
No production write, provider/model request, customer
communication, deployment, remote secret change, or backup upload occurred.
