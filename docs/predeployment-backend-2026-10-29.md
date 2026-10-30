# Backend predeployment verification — 2026-10-29

The two previously skipped persistence checks now pass against a real, disposable
PostgreSQL 17.10 database. Six additional runtime checks pass against the full
migrated schema, with external providers replaced by explicit offline adapters.
The synthetic database also survived a stop/restart and an authenticated encrypted
backup/decrypt/restore cycle. No application-source change was required.

This establishes the synthetic checks below. A subsequent owner-authorized
[production snapshot recovery drill](production-recovery-2026-10-30.md) also
passed: all 69 tables and 33,008 rows matched after encrypted backup and isolated
restore, with matching constraint/index/trigger totals and verified cleanup.
Neither drill certifies live provider delivery, production authentication, or
every possible recovery incident.

## Reproduction and isolation

```powershell
& '.tmp/node-v24.22.2-win-x64/node.exe' scripts/qa/predeploy-local-postgres.mjs
```

The runner uses installed PostgreSQL binaries at
`C:/Program Files/PostgreSQL/17/bin` (override with `MCSW_POSTGRES_BIN`). It creates
a uniquely named cluster under the worktree's ignored `.tmp`, binds PostgreSQL
and the WebSocket transport to `127.0.0.1`, selects an unused local port, and
strips inherited application/provider credentials. Both database URL variables
are explicitly overwritten with the disposable URL. No production environment
file is loaded or copied.

The actual Neon Pool driver speaks PostgreSQL's wire protocol through a local
WebSocket/TCP transport; SQL is not mocked. The transport rejects any URL outside
the dedicated loopback database. The full migration runner executes once on a
fresh schema and once again to prove replay. There are 295 migration records.

The runtime harness transpiles actual application modules and invokes their
functions, including the call route's POST handler with a real Request. SQL,
locking, unique constraints, triggers, and journal writes use PostgreSQL.
Twilio, Blob storage, operator authentication, and notification delivery have
explicit local adapters. This is not an HTTP/Next session-cookie authentication
test, a provider delivery test, or a network end-to-end test.

Windows `initdb` cannot create its restricted process token inside the command
sandbox. These isolated runs were approved outside that sandbox. Subprocesses
have a three-minute limit, and the runner stops its exact owned cluster even
when a startup attempt fails after creating a server. No service is installed.

## Results

| Check | Result |
| --- | --- |
| Fresh full migration and replay | Passed twice |
| Existing real persistence suite | 2 passed; 0 failed; 0 skipped |
| Additional actual-database runtime suite | 6 passed; 0 failed; 0 skipped |
| Journal truth | Event rewrite and deletion rejected by database triggers |
| Crew projection | Owner money and search-vector content absent from crew board trails |
| Payment ledger | Concurrent duplicate receipts/reversals converge; receipt replay does not undo reversal; excessive reversal rejected |
| SMS consent and internal tests | STOP after durable enqueue cancels before adapter dispatch; test-partition SMS cannot dispatch |
| Ambiguous SMS | Concurrent replay calls provider adapter once; unknown receipt cannot automatically resend |
| Actual call POST handler | Lost response stays unknown; replay and cross-job intent reuse do not redial |
| Closeout upload | Wrong job/operator/mode/test partition rejected before storage access; finish/callback race converges |
| Real database restart | Receipt and migration counts unchanged |
| Custom-format backup | `pg_dump` completed; authenticated encrypt/decrypt plaintext SHA-256 matched |
| Restoring decrypted archive | `pg_restore --exit-on-error` passed into a second local database; exact counts matched across all 60 public tables |
| Focused ESLint | Passed without warnings/errors for the three new QA files |

The restart and restore retained 11 events, 3 messages, 2 calls, 1 upload receipt,
and 295 migration records. All records in this drill were generated synthetic
fixtures. Provider adapters simulate acceptance/failure; no real call, text,
email, upload, payment movement, model API request, or cron was executed.

The backup used a fresh random 256-bit key held only in process memory. The
decrypted archive matched the original SHA-256:
`3AA002EE8C108A428F33567564B638668DB5B83A7342076C5B6A24C7A8D024C2`.
Ciphertext differed, then the decrypted archive successfully restored.

## Evidence and cleanup

[Summary and source hashes](visual-polish/2026-10-29/predeployment-backend/summary.json),
[stage exits](visual-polish/2026-10-29/predeployment-backend/result.json),
[existing persistence output](visual-polish/2026-10-29/predeployment-backend/persistence.log),
[runtime check output](visual-polish/2026-10-29/predeployment-backend/backend-behavior.log),
[source table counts](visual-polish/2026-10-29/predeployment-backend/source-table-counts.log),
and [restored table counts](visual-polish/2026-10-29/predeployment-backend/restored-table-counts.log)
record the final successful run. Schema migration, restart, restore, and stop logs
are in the same directory. The source hashes identify the scripts executed.

Final run: `.tmp/predeploy-postgres-1793311164026`. PostgreSQL stopped cleanly.
All seven successfully initialized QA cluster data directories and all generated
synthetic dump/ciphertext files were removed after path-containment and stopped
cluster checks. Logs remain. Earlier unsuccessful harness setup attempts are
retained in ignored `.tmp` logs, including sandbox token failure, Windows pipe
inheritance, ESM preload URL, and TAP reporter selection; none required an
application change or accessed production.

## Remaining acceptance boundaries

- **Recurring production backups:** The later owner-authorized production
  snapshot restore [passed](production-recovery-2026-10-30.md), resolving the
  original export approval hold and local-recovery gap. The hosted recurring
  workflow still requires safe release, credential/key provisioning, and a
  successful encrypted artifact run. The production drill compared snapshot
  data and structural totals, not production migration IDs against every current
  migration-file entry; no additional migration-compatibility claim is made.
- **Twilio:** Actual call forwarding, carrier delivery, inbound/outbound status
  callbacks, and real number configuration need an isolated provider test setup,
  controlled recipient phone(s), and a reachable staging webhook origin with
  appropriate Twilio account/auth/messaging-service configuration. Local
  signature/route tests and adapters do not demonstrate carrier delivery.
- **Resend:** Actual email acceptance/delivery/webhook verification needs a
  dedicated permitted test mailbox, isolated sender/API credentials, webhook
  secret, and staging endpoint. No message was sent.
- **Blob:** Real upload token/callback behavior needs a dedicated nonproduction
  Blob store/token and staging endpoint. The local adapter proves receipt
  authorization and race handling, not remote storage availability.
- **QuickBooks/Gmail:** Payment coverage is ledger projection and reversal,
  including concurrent SQL, not settlement of money. Actual receipt ingestion
  requires isolated sandbox invoice/email fixtures and authorized mailbox OAuth
  access. No real invoice, payment, or inbox was mutated.
- **Authentication:** Runtime checks use a controlled operator adapter. Actual
  owner/crew login sessions and deployed role projections still require staging
  test accounts. Device/accessibility coverage is recorded separately.

No deployment, main-branch push, remote secret provisioning, or backup workflow
activation was performed by this backend verification stream.
