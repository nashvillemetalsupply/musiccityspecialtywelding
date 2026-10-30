# CRMREVIEW — October 30, 2026

**Verdict: NO-GO for deploy.** One defect fixed; acceptance blockers remain. No deploy, push, merge, production DB access, provider/configuration writes, or messages.

Scope: full diff from `46b4ed5` (`git merge-base HEAD origin/main`) through `384e2ac`, plus this fix, on `crm-polish`. Independent standards/security and requirements/recovery reviews found no other confirmed defects. No migrations or dependency changes.

- **Fixed P1 — `9a7ed63`:** SMS preflight outages could label accepted/queued/concurrent sends unsent, enabling duplicate fresh-key retries. Resolve receipts and claim first; preserve same-key recovery. Regression tests failed before correction; focused checks passed **31/31**, related checks **56/56**.
- **Final checks, Node 24.22.2:** **1,082 tests: 1,079 passed, 0 failed, 3 skipped** (paid AI evaluation, two DB tests). Typecheck, zero-warning full/changed-file lint, production build, and bundle budgets passed. Six Chromium phone/landscape fixture cases passed. No QA route; owned server stopped; line endings preserved; whitespace clean.

**Remaining pre-deploy blockers — verbatim [handoff](predeployment-handoff-2026-10-30.md) excerpts; responsible actors added:**

- **Vercel storage quota suspension:** “Blob transport was attempted and is blocked by the existing provider usage-limit suspension; restoration and a successful repeat are required.” **Owner/account administrator:** restore storage; **release QA:** repeat acceptance.
- **Live-provider checks:** “Carrier/email sign-in delivery, deployed sessions, sandbox QuickBooks/Gmail receipt ingestion, and Blob upload/callback workflows remain separate acceptance boundaries.” **Release owner/provider QA:** complete these checks.
- **Device checks:** “Physical iPhone/Android, native Safari, virtual keyboards, operating-system text scaling, and native installation remain unverified.” **Owner/device QA:** supply and test physical devices.
- **Recurring backups:** “the encrypted GitHub workflow has not been released or run remotely.” **Release maintainer:** workflow-first sequence; **owner:** secure secrets/key retention; **release QA:** scheduled backup/recovery acceptance.
- **Native accessibility:** “Portable NVDA launch is not a successful screen-reader test.” **Owner/accessibility QA:** native screen-reader acceptance.

## Storage

**STORAGEFIX: local mitigation complete; safe to deploy before reset: NO.**
Implementation and regression tests are committed as `9b52dcf`
(`fix(crm): survive blob quota suspension`). No deployment, push, merge,
provider/configuration write, production database access, or message occurred.
No stored object or capture was deleted. The earlier storage administrator
restore step does not require a dashboard visit or purchase: the provider reports
an automatic pause end, and the application now preserves new captures while it
waits. This does not establish restored service or remove the other blockers above.

### Read-only diagnosis

Authenticated CLI GET metadata at **2026-10-30 09:20 UTC** confirms the configured
**private Vercel Blob store in `iad1`**, Hobby plan,
`status=limits-exceeded-suspended`, `billingState=suspended`, and
`usageQuotaExceeded=true`. The store count/size metadata agrees with one paginated
SDK metadata-list request: **417 files, 70,410,215 bytes (70.41 MB)**.
Only metadata was read; filenames, private URLs, store/account IDs, file contents,
and customer data are excluded from this report.

| Generic prefix | Files | Bytes |
| --- | ---: | ---: |
| `leads/` | 297 | 49,342,056 |
| `briefs/` | 118 | 21,067,008 |
| `glass/` | 2 | 1,151 |
| **Total** | **417** | **70,410,215** |

**Exact exhausted metric: unknown.** Current file size is below the included
storage allowance, but current size cannot establish historical monthly average,
operation counts, or transfer. Vercel's documented Hobby allowances are 1 GB-month
storage, 10,000 simple operations, 2,000 advanced operations, and 10 GB transfer.
The authenticated store/team metadata did not expose the exhausted counter;
`vercel usage --json` returned billing-charge totals, not Blob operation/transfer
counters. Bounded GET usage endpoint checks did not supply those counters either.
Simple operations, advanced operations, and transfer usage therefore remain
unknown; neither file count nor an unrelated charge total is substituted for them.
See [Vercel Blob pricing and quota behavior](https://vercel.com/docs/vercel-blob/usage-and-pricing).

**Provider-reported reset: `2026-11-12T08:05:39.574Z` — November 12 at 2:05 AM
America/Chicago.** The block began `2026-10-13T08:05:39.574Z`. The team reports
`billing.period=null`: Hobby has no invoice billing cycle; this is a 30-day feature
pause, not a November 1 billing reset. Restoration at that instant is provider
metadata, not a successful upload receipt. See [Hobby billing cycle](https://vercel.com/docs/plans/hobby#hobby-billing-cycle).

Production environment inspection returned **60 key names only**. The configured
Blob credential exists; no alternate object-store credential was present. No
fallback provider, account, signup, OAuth, upgrade, paid plan, or new remote
configuration was introduced. Neon was not used as replacement file storage.

### Built and verified

- Voice and closeout photos save original bytes into identity/job-scoped
  IndexedDB before uploading. Reload recovery discovers retained records directly;
  it does not depend on a localStorage pointer. The UI distinguishes **saved on
  this device; will upload** from **not saved yet**. A failed local save keeps the
  capture in memory, retries saving, and blocks parent submission until durable.
- Automatic retries use bounded backoff, online/focus events, and reopening the
  relevant job. Completion captures can recover from that same completed job's
  addendum, retaining the original intent ID, object path, and workflow identity.
  Archived records retain original bytes and do not replay.
- Photo preparation downsizes supported JPEG/PNG/WebP images to a maximum
  1,600-pixel edge, encodes JPEG/WebP at quality 0.78, and chooses the smaller
  result only when it saves bytes. Original and prepared payloads are retained.
  Other formats remain intact. Voice requests mono capture at **32 kbps** where
  supported by the browser. Small photos use one upload rather than multipart.
- SHA-256 photo dedupe is serialized within the same device/operator/job/workflow.
  Retries reuse the original receipt and exact prepared bytes. Voice retries reuse
  their intent and deterministic path. Existing uploads are reconciled before
  retransmission; only confirmed absence permits another attempt. Writes prohibit
  overwrites/random suffixes. Already stored/attached media avoids another upload.
  This is not global or cross-device content deduplication.
- Photo token issuance checks the new client's recorded operator scope; identity
  changes cannot authorize the old capture under a new cookie. Receipt renewal
  preserves the same operator/job/test boundaries across the pause. Voice archive
  failures retry without repeating a successful callback in that mounted page.
  No schema migration or dependency change is required.

**Final verification on Node 24.22.2:** full suite **1,124 total / 1,121 passed /
0 failed / 3 skipped** (paid AI evaluation and two database tests; no production
database was accessed). Standalone `tsc --noEmit`, full ESLint with
`--max-warnings=0`, and production `next build --webpack` passed. Build generated
50 static pages, with no QA route. Bundle budgets passed: public
612,409 / 648,316 bytes; board 715,259 / 817,538 bytes.

Nine real Chromium checks using synthetic pixels and blocked external requests
verified IndexedDB reload retention, original-byte hashes, concurrent dedupe,
identity/job isolation, and compression: **8,120,018 bytes → 745,963 bytes at
1600×1200**. Re-run with
`node scripts/qa/storagefix-browser.mjs`. Aggregate results are in
[STORAGEFIX evidence](testing/storagefix-2026-10-30.json); local check logs are
`.tmp/storagefix-{tests,lint,typecheck,build,budgets}.log`.

**Remaining limits:** the suspended store still cannot serve/accept live media;
this code cannot reverse that provider decision. Browser storage denial, device
loss, or clearing site data cannot be made lossless by application code. A capture
is called saved only after IndexedDB commits; a raw-only capture must keep its
page open. Closed browsers cannot retry: saved media resumes when its job/workflow
is reopened with its original operator. Durable queued media does not block other
job work. Actual microphone/camera devices, live callbacks/uploads, and storage
restoration remain unverified, alongside the original release boundaries above.
No live write probe was run under this task's read-only provider restriction.

### Exact deployment command for TJ's OK

**Recorded only; not executed. The release remains NO-GO.** Once TJ approves a
release after the outstanding acceptance gates, this PowerShell command targets
the existing project from this worktree without printing IDs or credentials:

```powershell
$storagefixProject = Get-Content -Raw -LiteralPath 'C:\Users\Owner\Desktop\Shepherd\Music City Speciality Welding\.vercel\project.json' | ConvertFrom-Json
$env:VERCEL_ORG_ID = $storagefixProject.orgId
$env:VERCEL_PROJECT_ID = $storagefixProject.projectId
vercel deploy --prod --yes --cwd 'C:\Users\Owner\Desktop\Shepherd\Music City Speciality Welding\.worktrees\crm-polish'
```

This task neither authorizes that deployment nor performs the separate backup
workflow release/configuration sequence in the handoff.
