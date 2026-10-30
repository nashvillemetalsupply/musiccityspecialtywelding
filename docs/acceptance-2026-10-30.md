# CRMACCEPT - October 30, 2026

Acceptance started from fetched, clean `origin/main` `3c3db1d068e09b94f5d44bf0dc4cd2f613430131`. Application fixes are committed and landed on main as `d77a11f` (`fix(crm): close phone acceptance defects`). The test-only Linux/Windows newline correction is landed as `a4241a8`. Automated acceptance remains incomplete for the exact A, B, and C blockers below.

## A - Automated phone acceptance

**Result: FAIL / partial acceptance.** Playwright covered iPhone 15 emulation with WebKit and Pixel 8 emulation with Chromium, portrait and landscape, with actual computed text enlarged to 200%. These are browser stand-ins, not physical-device, native Safari, camera, microphone, or OS installation acceptance.

The signed-out live checks use only GET/HEAD: home, sign-in render, the install entry, manifest, icons, and service worker. The signed-out `/ops/install` entry renders sign-in; authenticated install instructions were not accessed in production. No production login or form submission occurs. The initial run found three undersized targets and enlarged text clipped behind horizontal overflow suppression. The corrected public-page regression passes all eight device/orientation/text cases on the rebuilt local production app: all three repaired targets measure at least 44px in each dimension, full-page text Range bounds stay within the viewport, and enlarged fonts are verified beyond the heading. Hidden honeypot controls, decorative SVG/aria-hidden content, the unfocused skip link, and text in closed menu details are excluded appropriately.

Chromium's live PWA diagnostics returned no manifest or installability errors; the service worker activated in a secure context. This verifies automated prerequisites, not an actual installed PWA. The final production matrix passed **24/24 signed-out page cases** at 100%/200% text: every response was 200, every visible interactive target measured at least 44px, and there were zero page errors, console errors, or document overflow cases. The separate full-text-bound regression passed **8/8 live cases**, detecting text that body clipping could otherwise conceal. Analytics scripts were answered with empty browser-local stubs and non-GET/HEAD requests were blocked. Both engines activated the root-scoped service worker in both orientations; Chromium reported zero manifest/installability errors, and WebKit loaded the manifest successfully. WebKit has no equivalent CDP native-install audit. Final matrix interval: **2026-10-30T12:32:32.099Z to 2026-10-30T12:33:23.162Z**.

A real local production build with the existing fixture/seed approach passed **20/24 workflow checks**. Every device/orientation combination passed fixture-user sign-in, new test job and reload durability, closeout and addendum reload, and SMS acceptance through the local mock provider. Chromium also passed photo bytes saved on device, reload recovery and same-intent retry, voice transcription, and the filed voice note after reload. Four mock SMS acceptances occurred; no carrier/email message was sent.

**Exact single A blocker:** Windows Playwright WebKit cannot store Blob values in IndexedDB. A standalone engine probe reproduced the failure independently of the CRM. This blocks durable photo and voice recovery in both iPhone-emulated orientations, accounting for the four missing checks. The UI truthfully shows these captures as unsaved; no WebKit durability pass is claimed.

The local WebKit harness made a loopback-only secure-cookie accommodation after real login verification because its HTTP-loopback cookie policy differs from Chromium; production authentication was untouched. Four local canceled/RSC fetch access-control diagnostics were recorded in the WebKit landscape case. No external browser/provider request or SQL error occurred; these local transport diagnostics do not establish an error-free native Safari session.

The existing real HTTP regression also passed **19 authentication/role checks and three actual form workflows**. Final synthetic transport totals were **1,767 SQL requests, zero SQL errors, zero external connection attempts**, with Blob/Twilio/transcription doubles. The disposable database was stopped and removed. Evidence: `.tmp/crmaccept/local-final-summary.json`, `.tmp/crmaccept/local-public-green.json`, and the final local run directory.

Three real defects were corrected:

- Public process phone and legal-consent links now have at least 44px touch targets.
- Public header, hero sign, stickers, territory copy, and job-glass content wrap at 200% text without being hidden by body clipping.
- A PostgreSQL bigint job identifier arrived as a string, preventing the client photo queue from accepting the job. The validated route identifier is now passed to the photo workflow; the browser regression covers the serialized type.

Release checks on Node 24: **1,126 tests / 1,123 passed / zero failed / three intentional skips**, zero-warning lint, standalone post-build typecheck, and production webpack build passed. Build generated **51 static pages**, with no QA route. Bundle budgets passed: public **612,409 / 648,316 bytes**, board **715,225 / 817,538 bytes**. The CSS provenance test permits exactly the two approved touch-target rule replacements and continues to freeze all other public globals. Initial Linux CI caught hardcoded CRLF rule literals; the test-only `a4241a8` correction adapts those literals to the input newline without normalizing or weakening the final byte comparison. Focused CRLF and scratch-LF checks each passed 5/5; the final full local suite passed again and [GitHub CI succeeded](https://github.com/nashvillemetalsupply/musiccityspecialtywelding/actions/runs/41055867167).

## B - Uploads

**Result: blocked until provider reset.** Read-only authenticated CLI metadata at **2026-10-30T12:12:34.929Z** reports the existing private Hobby Blob store as `limits-exceeded-suspended`, billing suspended, quota exceeded, with **417 files / 70,410,215 bytes**. No object contents, private object paths, identifiers, or credentials are included. No upload probe or remote storage/configuration write occurred.

**Exact single B blocker:** the provider's current Blob feature suspension, scheduled to end at **2026-11-12T08:05:39.574Z**. The handoff/review names no already-provisioned free fallback behind a flag, and the previous name-only environment inspection found no alternate object-store credential. There is no fallback-enabling command to provide without inventing/provisioning a provider.

The new local script can recheck metadata on or after that instant, using Node 24 from this worktree:

```text
node scripts/qa/blob-reset-check.mjs --config-root ../..
```

It reads existing local CLI/configuration privately, issues only metadata GETs, prints sanitized states/counts, and exits 0 for available metadata, 2 for still blocked/unknown, or 1 for a failed check. It never uploads or changes environment/flags. Available metadata alone is not proof that a real upload succeeds; repeat the authorized provider acceptance separately. Evidence: `.tmp/crmaccept/blob-reset-check.json`.

## C - Encrypted backups

**Result: blocked by missing required repository secrets.** Read-only `gh` inspection confirmed the encrypted workflow and both helpers already exist on default branch `main`; GitHub file hashes match fetched `origin/main`. No workflow-first release was necessary. The active workflow dumps with read-only transactions and verified TLS, uploads only `mcsw-backup.dump.enc`, retains artifacts for 90 days, and schedules Sunday at 12:05 UTC.

`gh secret list` returned the name `CRON_SECRET` only. **Exact single C blocker:** TJ must add both required secret names **`BACKUP_ENCRYPTION_KEY` and `DATABASE_URL_UNPOOLED`** through the secure interface, retaining the encryption key independently as the runbook requires. No secret/key/password was created, set, or printed. Because prerequisites are missing, no dispatch or restore was attempted. The latest historical backup run predates the encrypted release and failed; this task does not establish a successful remote backup. Evidence: `.tmp/crmaccept/backup-summary.json` and [backup/recovery runbook](backup-recovery.md).

## D - Conditional deployment

The A fixes triggered the authorized deployment route. Before landing them, the prior READY rollback target was recorded as **https://music-city-speciality-welding-r2dgppuys.vercel.app**, source `3c3db1d068e09b94f5d44bf0dc4cd2f613430131`. Fix `d77a11f` was fast-forwarded to main, following the same Git route as the live starting revision. The project-targeted command recorded in the predeployment review is:

```powershell
$storagefixProject = Get-Content -Raw -LiteralPath 'C:\Users\Owner\Desktop\Shepherd\Music City Speciality Welding\.vercel\project.json' | ConvertFrom-Json
$env:VERCEL_ORG_ID = $storagefixProject.orgId
$env:VERCEL_PROJECT_ID = $storagefixProject.projectId
vercel deploy --prod --yes --cwd 'C:\Users\Owner\Desktop\Shepherd\Music City Speciality Welding\.worktrees\crm-polish'
```

The exact command above completed successfully from clean application commit `d77a11ff212247d7d758eb7aeed37b957ca2434c` at **2026-10-30T12:28:27.7896064Z**, producing **https://music-city-speciality-welding-p2zivgbo9.vercel.app**. The canonical alias was READY, six initial signed-out paths returned 200, and the initial runtime query reported zero errors/fatal/5xx records. Published CSS confirmed the repaired targets and wrapping rules. Vercel CLI supplied no Git SHA metadata; the clean-command record and published asset checks establish that release provenance.

The later test-only portability commit `a4241a88d652ba56d8d1c66986ca2a115eaf48a3` received an automatic Git deployment. Application files are byte-identical to `d77a11f`; only `scripts/css-move-verbatim.test.mjs` changed. Its READY production URL is **https://music-city-speciality-welding-chukh3hnd.vercel.app**, and the canonical alias's Git source SHA matched `a4241a88d652ba56d8d1c66986ca2a115eaf48a3`.

Monitoring ran from **2026-10-30T12:33:39.792Z through 2026-10-30T12:38:46.430Z** (306.6 seconds). **All 42 signed-out HTTPS checks returned 200**, health stayed OK, and Vercel runtime queries over that exact interval returned **0 errors, 0 fatal records, and 0 HTTP 5xx records**, without truncation. The alias stayed on the same READY deployment. No rollback was required. The live phone/PWA checks above cover this deployed application. Evidence: `release-monitor.json`, `live-summary.json`, `pwa-final-results.json`, `live-assets.json`, and `deploy-command-summary.json` under `.tmp/crmaccept/`.

This report is a separate documentation-only commit; application source remains unchanged by that follow-up.

## Screenshots

All files are in `C:/Users/Owner/AppData/Local/Temp/claude/C--Users-Owner-Desktop-Mirror/a80af7ab-0ba3-4bba-aa93-ef57e3bc0436/scratchpad`, contain public or synthetic fixture content, and use the requested `accept-*.png` prefix. Local final workflow screenshots (35 files):

- `accept-local-iphone15-portrait-board.png`
- `accept-local-iphone15-portrait-job.png`
- `accept-local-iphone15-portrait-addendum.png`
- `accept-local-iphone15-portrait-sms-mock.png`
- `accept-local-iphone15-portrait-photo-unsaved.png`
- `accept-local-iphone15-portrait-voice-unsaved.png`
- `accept-local-iphone15-landscape-board.png`
- `accept-local-iphone15-landscape-job.png`
- `accept-local-iphone15-landscape-addendum.png`
- `accept-local-iphone15-landscape-sms-mock.png`
- `accept-local-iphone15-landscape-photo-unsaved.png`
- `accept-local-iphone15-landscape-voice-unsaved.png`
- `accept-local-pixel8-portrait-board.png`
- `accept-local-pixel8-portrait-job.png`
- `accept-local-pixel8-portrait-photo-queued.png`
- `accept-local-pixel8-portrait-photo-retry.png`
- `accept-local-pixel8-portrait-voice.png`
- `accept-local-pixel8-portrait-addendum.png`
- `accept-local-pixel8-portrait-voice-filed.png`
- `accept-local-pixel8-portrait-sms-mock.png`
- `accept-local-pixel8-landscape-board.png`
- `accept-local-pixel8-landscape-job.png`
- `accept-local-pixel8-landscape-photo-queued.png`
- `accept-local-pixel8-landscape-photo-retry.png`
- `accept-local-pixel8-landscape-voice.png`
- `accept-local-pixel8-landscape-addendum.png`
- `accept-local-pixel8-landscape-voice-filed.png`
- `accept-local-pixel8-landscape-sms-mock.png`
- `accept-local-http-owner-board.png`
- `accept-local-http-owner-job.png`
- `accept-local-http-crew-board.png`
- `accept-local-http-crew-job.png`
- `accept-local-http-intake-rejected-draft.png`
- `accept-local-http-intake-saved-receipt.png`
- `accept-local-http-notes-persisted.png`

Final post-deployment live matrix screenshots (24 files):

- `accept-live-iphone15-portrait-100-home.png`
- `accept-live-iphone15-portrait-100-signin.png`
- `accept-live-iphone15-portrait-100-install.png`
- `accept-live-iphone15-portrait-200-home.png`
- `accept-live-iphone15-portrait-200-signin.png`
- `accept-live-iphone15-portrait-200-install.png`
- `accept-live-iphone15-landscape-100-home.png`
- `accept-live-iphone15-landscape-100-signin.png`
- `accept-live-iphone15-landscape-100-install.png`
- `accept-live-iphone15-landscape-200-home.png`
- `accept-live-iphone15-landscape-200-signin.png`
- `accept-live-iphone15-landscape-200-install.png`
- `accept-live-pixel8-portrait-100-home.png`
- `accept-live-pixel8-portrait-100-signin.png`
- `accept-live-pixel8-portrait-100-install.png`
- `accept-live-pixel8-portrait-200-home.png`
- `accept-live-pixel8-portrait-200-signin.png`
- `accept-live-pixel8-portrait-200-install.png`
- `accept-live-pixel8-landscape-100-home.png`
- `accept-live-pixel8-landscape-100-signin.png`
- `accept-live-pixel8-landscape-100-install.png`
- `accept-live-pixel8-landscape-200-home.png`
- `accept-live-pixel8-landscape-200-signin.png`
- `accept-live-pixel8-landscape-200-install.png`

Supplemental read-only live-page layout probes with proposed CSS injected locally into the browser (16 files; these are layout evidence, not deployed-source evidence):

- `accept-layout-iphone15-portrait-100-home.png`
- `accept-layout-iphone15-portrait-100-jobglass.png`
- `accept-layout-iphone15-portrait-200-home.png`
- `accept-layout-iphone15-portrait-200-jobglass.png`
- `accept-layout-iphone15-landscape-100-home.png`
- `accept-layout-iphone15-landscape-100-jobglass.png`
- `accept-layout-iphone15-landscape-200-home.png`
- `accept-layout-iphone15-landscape-200-jobglass.png`
- `accept-layout-pixel8-portrait-100-home.png`
- `accept-layout-pixel8-portrait-100-jobglass.png`
- `accept-layout-pixel8-portrait-200-home.png`
- `accept-layout-pixel8-portrait-200-jobglass.png`
- `accept-layout-pixel8-landscape-100-home.png`
- `accept-layout-pixel8-landscape-100-jobglass.png`
- `accept-layout-pixel8-landscape-200-home.png`
- `accept-layout-pixel8-landscape-200-jobglass.png`

No paid plan, account creation, dashboard/billing/environment/storage write, production authentication/form/data write, or outbound message was performed. Authorized writes were local fixture activity, code/report commits and pushes, and the conditional application release. No production database was accessed directly under this task.

Report finalized at 2026-10-30T12:39:42.706Z.

## C - Backups (blocked follow-up)

**Result: BLOCKED; section C remains open.** Follow-up at **2026-10-30T12:51:26Z** confirmed that both required repository secret names, `BACKUP_ENCRYPTION_KEY` and `DATABASE_URL_UNPOOLED`, now exist alongside `CRON_SECRET`. No secret value was read, printed, or logged. The earlier missing-secret blocker is superseded by the encryption-key format failure below.

The workflow-first requirement is satisfied: fetched `origin/main` at `37500f865cc997ee7e96726c12103bdd6f3e3330` contains both backup fixes, `2339806` and `039f859`. GitHub file hashes match the reviewed `.github/workflows/backup.yml`, `scripts/backup-dump.mjs`, and `scripts/backup-crypto.mjs`. No workflow release or configuration change was needed.

Dispatched exactly once with `gh workflow run backup.yml --ref main`, then checked with `gh run watch 41058053189 --exit-status`. [Run **41058053189**](https://github.com/nashvillemetalsupply/musiccityspecialtywelding/actions/runs/41058053189) **failed**, from **2026-10-30T12:47:46Z to 2026-10-30T12:47:55Z**, on that reviewed main revision. Checkout and Node setup succeeded. The dump/encrypt step failed its key-format preflight with the static annotation: `Set a 32-byte hexadecimal BACKUP_ENCRYPTION_KEY repository secret before enabling backups.` The production dump command was not reached, and the upload step was skipped.

**Artifact facts:** GitHub reports **zero artifacts** for this run; no actual artifact name, size, or expiration exists. The workflow would name the artifact `mcsw-neon-backup-41058053189`, containing only `mcsw-backup.dump.enc`, with **90-day retention**. These are configured values, not evidence of a created backup. With no artifact available, no download, checksum/manifest check, decryption, or local restore could be performed. No production database write or local database restore occurred.

**Future schedule:** workflow ID `368413259` is **active**, repository Actions are **enabled**, and main retains cron `5 12 * * 0` (Sunday at 12:05 UTC). The next scheduled slot is **2026-11-01T12:05:00Z**, or **November 1, 2026 at 6:05 a.m. CST (America/Chicago)**; actual GitHub start time may be delayed. The key preflight will continue to reject runs until the secret is corrected.

**Required next step:** TJ must replace `BACKUP_ENCRYPTION_KEY` through GitHub's secure secret editor with the independently retained 32-byte key encoded as exactly 64 hexadecimal characters, without sharing it in chat or logs. Then retry the run and verify its ciphertext artifact and permitted local integrity/recovery check before marking backups closed. Sanitized local evidence: `.tmp/crmbackup/summary.json`. No backup closure is claimed by this follow-up.
