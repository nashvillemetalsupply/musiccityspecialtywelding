# Real Next HTTP and browser acceptance — October 30, 2026

The final rebuilt revision passed **22 checks: 19 real HTTP/auth/browser
checks plus three form workflows**, completing at `2026-10-30T07:21:44.677Z`.
Build ID: `4OoUmdCuqfSBDDV2j-Voz`. This run includes the final closeout layout
and photo-label contrast corrections, not just the earlier recovery changes.
It used a freshly migrated, disposable PostgreSQL database. No product
source or authentication function was replaced by the harness. The server ran on loopback port
3050; all records and operators were synthetic, and provider credentials were
absent. The server stopped and its database and temporary login tokens were
removed after the run.

The current [HTTP results](visual-polish/2026-10-29/next-http/final-revision/http-browser-results.json),
[workflow results](visual-polish/2026-10-29/next-http/final-revision/workflow-results.json),
[run summary](visual-polish/2026-10-29/next-http/final-revision/summary.json),
and [transport summary](visual-polish/2026-10-29/next-http/final-revision/transport-summary.json)
record **286 real SQL requests, zero SQL errors and zero external connection
attempts**. The saved screenshots contain only synthetic records.

Three added HTTP checks exercise the rebuilt voice-recovery GET endpoint against
a real synthetic failed intent with no stored audio. The owner receives
`uploadRequired: true`, `private, no-store`, and no private Blob path. Signed-out
access returns 401, another operator receives 404, and a stale operator scope
returns 409. These calls do not POST audio or invoke Blob/Deepgram. They verify
the actual route, session authorization and SQL boundary, not provider delivery.

## Earlier acceptance runs

The earlier 22-check recovery run is preserved in
[recovery-revision](visual-polish/2026-10-29/next-http/recovery-revision/summary.json).
It predates the last layout/contrast correction and is historical evidence.

A second fresh-database run retained all 16 passing checks and added three
actual browser form workflows. These passed through the compiled Next server
actions and real PostgreSQL, with no route, action, or SQL mocks:

- An operator was deactivated after entering an intake draft. Submitting the
  real form returned `Not signed in.`, retained its name and needs, and created
  no job. The owner was reactivated in the disposable database before retry.
- Retrying saved exactly one clearly marked internal-test job and its
  `form.quote` test receipt. The actual job page displayed it after a reload.
- Saving Notes persisted the text and one `note.text` test receipt. Reloading
  the actual page retained the saved note. Every event for the created job
  remained in the test partition, and no provider request occurred.

The separate [workflow results](visual-polish/2026-10-29/next-http/workflows/workflow-results.json),
[run summary](visual-polish/2026-10-29/next-http/workflows/summary.json), and
[transport summary](visual-polish/2026-10-29/next-http/workflows/transport-summary.json)
preserve this additional evidence alongside screenshots of the rejected draft,
saved intake receipt, and persisted notes. The first 16-check run remains
archived separately. Both databases were stopped and removed.

The QA-only preload translates the Neon driver's HTTP payload to the real Neon
wire driver and local PostgreSQL. It preserves parameterized SQL, result types,
and transaction boundaries. It rejects other database identities, blocks
non-loopback socket/fetch traffic, and records aggregate transport activity.
The browser independently rejects off-origin requests. This is a database
transport adapter, not an authentication, route, SQL, or provider-response mock.

## Passed checks

- Signed-out session and export endpoints reject access.
- Malformed and expired one-use links cannot create sessions; a redeemed link
  cannot be replayed.
- Real `/api/ops/verify` responses issue HttpOnly, Secure, SameSite=Lax cookies;
  Chromium accepts and uses them on localhost.
- Owner and crew sessions retain correct roles and distinct session-cache and
  voice scopes.
- The actual owner job response includes its unique private note and money
  value. Crew HTML, including its serialized server-component payload, contains
  neither that note nor the unique raw cents value nor formatted amount.
- A crew session cannot obtain an internal-test job by its URL. Owner access
  succeeds. Next's streamed not-found response is checked for missing protected
  content and its 404 fallback, not merely its outer HTTP status.
- Export and analytics require the owner role; crew settings omit team controls.
- Real owner (1440px) and crew (390px) browser sessions render the board and job
  with no horizontal overflow, application JavaScript error, or remote request.
- Downgrading a role affects the existing session. Deactivation and expiry
  reject existing sessions. Logout removes the durable session and clears its
  cookie.

Results and synthetic screenshots are in
[the HTTP evidence folder](visual-polish/2026-10-29/next-http/http-browser-results.json).
The [transport summary](visual-polish/2026-10-29/next-http/transport-summary.json)
records actual SQL requests and zero SQL errors or external connection attempts.
The owner board deliberately refuses its production-only Gmail wake in this
local environment; no Gmail request is made.

Reproduction uses the pinned Node 24 runtime:

```text
node scripts/qa/next-auth-acceptance.mjs
```

Windows PostgreSQL initialization needs execution outside the restricted
command sandbox. The runner uses a unique owned cluster, strips inherited
provider/environment secrets, migrates the full schema, seeds short-lived
synthetic login links, runs the current production build and Playwright, then
stops and removes only its own database. It refuses checkouts containing
production dotenv files and checks that its local app port is available before
starting. Earlier harness failures (restricted
initdb, an invalid derived numeric-loopback URL, and assumptions about streamed
404/redirect status) were corrected before this passing run; they were not
application failures or counted as passes.

This closes the real HTTP/session/role boundary on the tested local build. It
does not establish delivery of email or SMS sign-in codes, physical-device or
Safari acceptance, native screen-reader behavior, external Blob storage, or
deployed infrastructure behavior.
