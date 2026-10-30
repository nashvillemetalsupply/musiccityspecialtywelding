# Independent predeployment review — 2026-10-29

The October 30 addendum below supersedes this initial review's unverified
production-recovery status and records the later backup connection correction.

Scope: the additional backup encryption/workflow, disposable PostgreSQL QA runner,
artifact exclusions, and lint cleanup. This is a separate review from the earlier
CRM interaction and visual review. Codex only; no deployment, remote writes,
production database export, paid model calls, or native UI operations were performed
by this reviewer.

## Result

No unresolved implementation blocker found in the reviewed files. This conclusion
does **not** mean that production backups are working or that a production recovery
has been demonstrated. The existing remote workflow must remain without its missing
database secret until the encrypted replacement is released. Production recovery
verification remains a separate acceptance item.

## Findings resolved during review

- The host shell's `umask` does not set Docker's file-creation mask. The workflow now
  precreates its plaintext dump with mode `0600` before invoking the container.
- Failed authenticated decryption must not leave temporary plaintext. The tests now
  inspect the directory for `.partial` files after wrong-key, tampering, and truncated
  input failures, as well as checking that no final output was published.
- A failed or timed-out `pg_ctl start` can leave a server running before the runner
  sets its success flag. The runner now checks only its unique cluster's
  `postmaster.pid` and `pg_ctl status` during cleanup and stops that cluster if needed.
  Child processes also have bounded timeouts.

## Evidence inspected

- Backup code streams AES-256-GCM with a fresh 12-byte random nonce and authenticates
  its versioned header. Keys are 32 random bytes represented as exactly 64 hex digits;
  no password-derived key or unauthenticated encryption is used.
- Decrypted output is published only after GCM authentication succeeds. Temporary
  output is private, publication refuses to overwrite an existing destination, and
  failed transformations remove temporary output. CLI errors omit keys, contents,
  and provider connection strings.
- The workflow receives credentials through environment variables, requests a
  read-only database session, removes plaintext on step exit, and uploads only the
  exact `.dump.enc` filename on success. No wildcard or plaintext artifact path is
  present. Permissions remain `contents: read`.
- The PostgreSQL runner creates a unique local cluster, strips inherited provider
  credentials, supplies fixed synthetic database identities, and binds loopback
  only. Its Neon wire-protocol bridge rejects non-loopback and unexpected database
  configurations. Production functions run against real SQL; external module
  boundaries require explicit local adapters and otherwise fail closed.
- Added backend cases exercise immutable journal enforcement, crew money removal,
  concurrent payment deduplication/reversal, SMS consent/test suppression, ambiguous
  SMS/call retry behavior, and upload authorization before storage lookup.
- The runner encrypts its synthetic custom-format archive using a process-memory
  random key, decrypts it, compares SHA-256 digests, and restores the decrypted
  archive into a separate synthetic database in its own local cluster. It checks
  all public-table row counts in addition to selected durable
  receipt counts. This establishes synthetic restore mechanics, not recovery of a
  current production snapshot.
- `.vercelignore` excludes environment files, auth state, archived QA fixtures,
  browser evidence, and temporary reports. Ignoring downloaded `.tmp` dependencies
  in ESLint does not exclude application source. The narrowly documented lint
  suppression preserves the required full-document reload after session expiry.

Independent commands with pinned Node 24.22.2:

```text
node --test scripts/backup-crypto.test.mjs scripts/backup-workflow.test.mjs
5 tests passed; 0 failed; 0 skipped (343 ms on final review rerun).
git diff --check
Passed.
```

## Release limits

- The encrypted GitHub workflow has not been run remotely; local unit tests and
  source inspection do not prove GitHub secret configuration, artifact retention,
  network access, or production PostgreSQL/client compatibility.
- Store the encryption key independently of the repository secret and retain keys
  for the full lifetime of encrypted artifacts. A backup without its key is not
  recoverable. The deployment handoff must include provisioning, a successful
  encrypted backup, and an isolated restore verification.
- `docs/backup-recovery.md` was reviewed: it explicitly covers independent key
  retention and rotation, private temporary files, separate restore infrastructure,
  application rollback without a database rollback, and the safe release order.
- Physical devices, native Safari, screen-reader acceptance, and real provider
  workflows are outside this review. Refer to the parent gate ledger rather than
  treating this report as universal product certification.

## October 30 addendum: connection correction and production recovery

The release-handoff reviewer independently inspected the final
`scripts/backup-dump.mjs`, its tests, and the updated workflow. No unresolved
implementation blocker was found in that reviewed change. The helper separates
URI connection fields for libpq, requires full TLS certificate/hostname
verification with trusted public roots, supplies the password only through the
child environment, strips unrelated runtime credentials, requests a read-only
session, and keeps errors free of connection details. The workflow still creates
the plaintext dump with mode `0600`, removes it on exit, and uploads only the
authenticated ciphertext path.

One review suggestion was repaired: a terminated Docker client can leave its
container alive. Failure cleanup now uses only this invocation's unique CID
file, validates a complete 64-hex container identifier, and makes a bounded
removal attempt without enumerating or stopping other containers. Certificate
and CID files are removed afterward. Tests exercise credential-free arguments,
environment filtering, and owned-resource cleanup. A real libpq regression test
also reaches the requested nondefault local port and refuses a server that
rejects TLS before authentication.

The implementer's focused run passed nine backup tests. The parent's final
full-suite run passed 1,051 of 1,054 tests, with zero failures and three disclosed
skips; the two database skips passed separately, while paid model evaluation
remained intentionally disabled. Final full lint passed with zero warnings.
See the [final release gate record](predeployment-release/release-gates.json).

The explicitly authorized [production recovery drill](../../production-recovery-2026-10-30.md)
passed using native verified TLS and a read-only exported snapshot: all 69
tables / 33,008 rows and checked structural totals matched after authenticated
encryption, decryption, and isolated restore. The owned server stopped and
temporary production-data copies were deleted. This result supersedes the
earlier production-data recovery hold. The Docker/GitHub scheduled workflow
still needs its protected release, secret provisioning, and remote acceptance;
native-screen-reader, physical-device, and live-provider limitations remain.
