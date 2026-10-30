# Blob provider acceptance — 2026-10-30

**Blocked by an existing provider quota suspension. Storage acceptance did not pass.**

The configured private store refused a 131-byte synthetic upload with the installed
`@vercel/blob` 2.6.1 SDK's typed `BlobStoreSuspendedError`. Read-only account metadata
then confirmed `status: limits-exceeded-suspended`, `billingState: suspended`,
`usageQuotaExceeded: true`, and `access: private`.

The account is on Hobby. Its Blob feature block started at
`2026-10-13T08:05:39.574Z`, before this QA, and reports an end of
`2026-11-12T08:05:39.574Z` (November 12, 2:05 AM America/Chicago).
The exact exhausted metric was not exposed by the inspected store/team metadata.
These fields establish a usage-limit suspension; they do not establish a billing
payment failure or an application defect.

Vercel documents a 30-day pause after Hobby Blob limits are exceeded, with a plan
upgrade as an alternative. See [Vercel Blob usage and pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing#hobby).
The current [Pro platform fee](https://vercel.com/docs/plans/pro-plan#platform-fee)
is $20/month with one deploying seat and $20 usage credit; additional usage and
deploying seats can cost more. This is an option for the owner, not an authorized
purchase or a promise of a fixed total bill.
No plan, billing, store, access-mode, webhook, or deployment settings were changed.
The reported end time is provider metadata, not a guarantee that a future probe
will succeed. Recheck status and repeat acceptance once service is restored.

## Probe and cleanup evidence

- Two bounded attempts used fresh random `qa/crm-polish/<uuid>/probe.txt` paths,
  a synthetic 131-byte body, private access, and overwrite disabled.
- Durable intent receipts were flushed under ignored `.tmp/` before side effects.
- Each exact path was absent before attempting the upload. Neither attempt
  returned a blob URL. The first runner recorded only the generic error name;
  the second captured the typed suspension error.
- A final read-only reconciliation at approximately `06:39:57Z` returned typed
  `BlobNotFoundError` from `head()` for both exact owned paths. No created object
  was observed and no delete operation was issued.
- Private-origin `get()` was denied while suspended. Consequently origin absence,
  successful authenticated reads, unauthenticated denial for an existing object,
  and successful conditional deletion remain unverified. Receipts retain the
  precise state `metadata-absent-origin-unverified`; this is not a successful
  upload/delete receipt.
- No customer blobs were listed or read. No production database, customer
  messages, calls, payments, AI providers, or existing files were mutated.
- The configured Blob tokens in the main local and production snapshot env files
  were identical and structurally valid, not encrypted placeholders. Credentials,
  private URLs, store IDs, and owner details are excluded from this evidence.

## Repeatable runner

`scripts/qa/blob-storage-acceptance.mjs` requires both
`MCSW_RUN_STORAGE_ACCEPTANCE=1` and an explicit existing `MCSW_BLOB_ENV_FILE`.
It is not part of ordinary test execution. It uses the configured token internally
and reports aggregate evidence only. It enforces private storage, exact synthetic
bytes, no overwrite, exact-path ownership, and conditional ETag deletion.

The runner covers provider storage transport only. It does **not** prove the
browser upload token issuance, signed Vercel callback delivery, closeout receipt
confirmation, real-session upload UX, or production media delivery routes.
The closeout route delegates signature validation to the installed SDK's
`handleUpload`; application authentication is required when issuing an upload
token. Those route and workflow checks need separate evidence.

The new runner passed focused ESLint and whitespace checks. No product source was
changed for this probe and no commits or deployments were made by this task.

## Follow-up local recovery corrections

The subsequent failure-path audit found that voice recording recovery handled a
missing intent but not an existing intent whose Blob upload had failed. The
recording remained in the identity-scoped IndexedDB outbox, but recovery only
polled and could never supply its missing bytes again. The authenticated polling
route now returns an `uploadRequired` boolean for that state without exposing a
private storage path. The existing recovery flow can resubmit the retained audio
once per recovery cycle; completed recordings are not uploaded or transcribed
again. Intent-only state no longer claims that background processing can finish.

Closeout photo uploads previously cleared the file selection before the upload
and discarded the `File` on failure. The component now retains the failed file
while the page remains open and offers an explicit Retry photo button. The retry
is bound to the original job and workflow, and concurrent taps are guarded. Each
photo retry creates a fresh upload receipt; this is not a claim of provider-level
idempotency after a lost response. Navigating away or reloading is not durable
photo recovery; the UI explicitly asks the operator to keep the page open.

Seven new behavioral regressions execute the actual route and component event
handlers with synthetic database, storage, timer, and IndexedDB dependencies.
They cover storage restoration, a missing intent (404), continuing refusal, missing retained bytes,
completed recording replay, operator isolation, and same-file photo retry with
job/workflow isolation. The seven behavior tests and 70 legacy boundary tests pass
together; the 13 related voice-identity and closeout-confirmation tests also passed
before this final test-only update.
Focused lint passes. These local corrections do not remove the provider block or
constitute live-provider, native microphone/camera, or physical-device acceptance.
