# CRM polish visual fixtures

These development fixtures use synthetic `[INTERNAL TEST]` data and real CRM components. They are stored with `.fixture` extensions so they are not application routes and do not enter production builds.

## Restore locally

From a disposable checkout with dependencies installed, copy all ten `*.fixture` files into `app/board/qa-polish/`, removing only the final `.fixture` extension. Start Next development on localhost with the pinned Node 24:

```powershell
New-Item -ItemType Directory -Path 'app/board/qa-polish' -Force
Get-ChildItem 'scripts/qa/fixtures/crm-polish/*.fixture' | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination ('app/board/qa-polish/' + $_.Name.Replace('.fixture', ''))
}
node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3047
```

The project pins Node 24; Node 22 also satisfies its package engine. Final release validation uses Node 24. The webpack option supports this task's dependency junction. Google Fonts must download successfully before judging typography. Do not copy production environment files or credentials into the fixture checkout.

## Cases

Open `http://127.0.0.1:3047/board/qa-polish` and use these query parameters:

- `?role=crew`: server-side synthetic crew projection without money.
- `?state=empty`: empty board.
- `?state=large`: four-digit counts and large currency values.
- `?surface=forms`: real intake and payment controls.
- `?surface=job`: representative job markup and real reply, payment, and fragment-navigation components.
- `?surface=job&state=pending`: disabled `Ringing…` call action.
- `?surface=job&state=failed`: long call failure status.
- `?surface=job&state=completed`: real completed DoneStamp and photo/note addendum.
- `?surface=account`: representative account history rows with long names.
- `?surface=customers`: customer index, search, pagination, and route navigation.
- `?surface=customers&state=empty`: empty customer index.
- `?surface=shop`: representative team, documents, and export controls.
- `?surface=shop&role=crew`: restricted settings view.

The fixture boundary blocks submissions, file-change upload handlers, and external navigation, disables usage measurement, and permits local disclosures, theme selection, closeout review, and fragment navigation. Only explicitly isolated local adapters allow form submission. It does not prove provider delivery, persistence, or live role authorization. The board's pulse and menu reads return signed-out responses in this credential-free checkout.

Styles are deliberately loaded together to catch collisions that can occur after client navigation. Test 320, 360, 375, 390, 414, 768, 1024, 1280, 1440, and 1920 widths; inspect keyboard focus, zoomed text, the open menu, and the pending/error dock.

After inspection, stop the development server and remove only the copied files from `app/board/qa-polish/` before building or committing. Keep the archived `.fixture` files here. Clear the checkout's generated `.next/dev/types/` directory after verifying that its resolved path remains inside this disposable checkout; otherwise its stale route declarations still reference the removed fixture and fail production typechecking. Next regenerates these types on the next development run. Restore any automatic Next.js-only addition to `AGENTS.md` without overwriting other changes.

## Expanded coverage and limits

Inventory: 15 production page files under `app/board` and `app/ops`, plus the customer page under `app/j`. The fixture route is additional and temporary.

| Production page | Fixture case | Coverage |
| --- | --- | --- |
| `/board` | default, `role=crew`, `state=empty`, `state=large` | Real JobControl, BusinessSwitcher, JobCalendar, MoreMenu; synthetic server projection. |
| `/board/[...unknown]` | none | Redirect/not-found routing; source-only, no independent visual surface. |
| `/board/calls` | `surface=calls`, `state=empty` | Representative server row/list/navigation markup with long names and mixed call statuses. |
| `/board/customers` | `surface=customers`, `state=empty` | Representative server customer list/search/pagination; real route nav. |
| `/board/updates` | `surface=updates`, `state=empty`, `state=history` | Real WireStrip with synthetic slips; representative delivery failures. Search submits and actions blocked. |
| `/ops` | `surface=login`, `state=failed`, `state=pending` | Real OpsLoginForm with browser-only request adapter. Successful SMS request enables the real code field. Verification always fails locally; no credentials/session generated. Redirect branch source-only. |
| `/ops/accounts/[id]` | `surface=account` | Representative account header and history rows; no actual data load. |
| `/ops/analytics` | `surface=analytics`, `state=empty` | Representative comparison/source tables and unavailable state; synthetic counts and money, no real metric calculations. Crew gate explanatory stand-in for actual redirect. |
| `/ops/call-sketch` | `surface=sketch`, `role=crew` | Actual CallSketchPrototype embedded, local demo controls and drawing; representative owner-only gate. Demo uses its own synthetic timed script. |
| `/ops/install` | `surface=install`, `state=pending`, `state=failed` | Representative production instructions and button/status markup. No service worker registered and no native install prompt; pending means installed-button presentation. |
| `/ops/intake/new` | `surface=forms&state=empty` | Real InlineJobIntake without a draft; submits and voice/provider actions blocked. |
| `/ops/intake/[draftId]` | `surface=forms` | Real InlineJobIntake and LiveCallSketch with browser-local synthetic call payload; no persistence. |
| `/ops/leads/[id]` | `surface=job`, `state=pending`, `state=failed`, `state=completed` | Representative production section/dock markup; real JobFragmentNavigation, SpikeReply, PaymentForm, DoneStamp, and CloseoutPhotoInput. Native labels use per-render IDs with stable fragment aliases. No actual lead loading or mutation. |
| `/ops/leads/[id]/builds` | `surface=builds`, `state=empty`, `state=failed` | Representative facts/correction/locked-history panels plus actual BuildSheetDrawing SVG. Empty only changes drawing/history; not an entirely empty draft. Actions inert. |
| `/ops/shop` | `surface=shop`, `role=crew` | Representative team/documents/phone/export controls. No exports, credentials, or integrations. |
| `/j/[token]` | `surface=customer`, `state=empty` | Representative customer job/promise/progress/price and closed-page markup. No view beacon, uploads, reviews, payment navigation, or token validation. Chivo variable uses actual shared Chivo font. |

Additional real shared component case: `surface=dock`. Browser-only adapters supply saved answers and sources for ShopDock. `state=delayed-source` returns source A after 5 seconds and source B after 100ms; opening A then B exercises stale response protection. `state=stale-brief` delays first brief 5 seconds and subsequent briefs 100ms. `state=failed` supplies synthetic non-OK replies. Audio URLs are blank, so audio cancellation requires source/unit validation rather than this fixture.

Add `tools=1` to any case for a fixed top-right development panel. It runs locally installed axe-core and exposes concise JSON in `#qa-audit-report` and status in `#qa-audit-status`. The controls are excluded from axe. Use the delayed audit button, then open MoreMenu within five seconds, to audit while the dialog correctly makes outside controls inert. Close the dialog to read results. Automated results require human review and do not prove overall accessibility.

The root text-size checkbox sets the HTML font size to 200%; this tests rem-based scaling and is **not browser zoom** or physical-device testing. The separate product type-token checkbox doubles all nine computed `--t-*` variables (including pixel-based tokens); fixed-pixel text outside those tokens is unchanged. Toggle it off/on after changing viewport breakpoints to recalculate its baseline. Reports include computed tokens and 24 visible samples with rendered font size, line height and element height. Reports persist in localStorage per query and restored reports are explicitly marked as previous results. Remove `tools=1` for unobstructed screenshots. Each fixture's default populated content already stresses long labels; unsupported state values do not fabricate an unimplemented production state.

`surface=voice` uses the actual VoiceCaptureButton recovery component with three synthetic text blobs in the browser's local IndexedDB: owner, crew, and unscoped legacy. It starts under a synthetic crew scope, intercepts all cache-session/transcribe requests, and exposes requests in `#qa-voice-events` and remaining synthetic notes in `#qa-voice-stored`. The microphone button is disabled. After crew recovery, inspect that only crew was posted and that owner and legacy notes remain. Switching to owner allows its own recovery. The fixture cleans only its three specifically named synthetic IDs and localStorage pointers on unmount; it does not clear the database. No microphone capture, real audio, credential, provider call or backend write occurs.

`surface=payment-check&state=failed|pending|success` renders a source-derived PaymentForm copy. Only its action import and relative SafeSubmitButton path are replaced, plus a source SHA-256 export for provenance. The browser-local adapters return after 800ms (or remain pending) and append submitted FormData to `#qa-payment-submissions`. Compare `[data-payment-source-sha]` with the current production source before using this case after later code changes. It verifies controlled-field retention/reset and reversal-key rotation; it does not run server validation, money movement, or production revalidation.

For the local interaction suite, run `node scripts/qa/crm-polish-interactions.mjs` after restoring the route and starting the preview. It writes evidence under `.tmp/round2-interactions` and blocks provider traffic. Browser engines should run serially to avoid CPU contention and noisy timing failures.

## Reproduce the final visual matrix

Use the pinned Node 24 runtime and the restored development route. The normal run
tests fourteen surface families at five widths; menu is an additional targeted
surface. Each run waits for hydration and real Golos/Chivo font faces.

```powershell
node scripts/qa/crm-polish-matrix.mjs --phase=normal --tag=final
node scripts/qa/crm-polish-matrix.mjs --phase=normal --surface=menu --tag=final
node scripts/qa/crm-polish-matrix.mjs --phase=stress --tag=final
node scripts/qa/crm-polish-matrix.mjs --phase=states --tag=final
node scripts/qa/crm-polish-matrix.mjs --phase=breakpoints --tag=final
node scripts/qa/crm-polish-matrix.mjs --phase=short --tag=final
node scripts/qa/crm-polish-summary.mjs
node scripts/qa/crm-polish-zoom.mjs
```

The `short` phase covers menu, job, and forms at 320×568 and 844×390. It checks
keyboard reachability and dock clearance, not native virtual keyboards. The
`stress` phase doubles product type tokens and checks actual ArrowRight scrolling
inside the enlarged Analytics table. Menu cases traverse every focusable control.
The zoom script opens an isolated Chromium profile, changes the browser's actual
page zoom through its appearance settings, verifies viewport/DPR ratios, and
takes native viewport captures without a CSS clipping rectangle. It is not a
physical-device test. Profiles and large raw artifacts remain under `.tmp`.

Targeted reruns can use `--surface=board` (or another supported surface) with the
same phase/tag. The summary replaces matching case keys with their targeted
results in chronological order and records every replacement file and timestamp.
`--state=pending` narrows alternate-state cases. `QA_BASE_URL` accepts only the
isolated localhost port 3047 development or port 3048 production fixture server; each result
records which mode supplied it. Do not treat an older
raw phase file as final evidence when a targeted replacement exists. The audit's
five login cases were replaced after removing an artificial fixture-only wrapper
so the login form matched its production direct-child DOM.

Cross-engine runner: `node scripts/qa/crm-polish-cross-engine.mjs webkit` (or
`firefox`). Set `PLAYWRIGHT_BROWSERS_PATH` to the absolute task-local
`.tmp/pw-browsers` directory containing matching Playwright browser binaries.
Optional `QA_CASES` is a JSON array of surface/width/role/state objects;
`QA_VARIANT` selects an output subdirectory and `QA_THEME=dark` uses the real theme
toggle. Payment states use `node scripts/qa/crm-polish-payment.mjs` with the same
browser-path environment setting and the source-derived fixture
described above. No runner requires live provider credentials.

The additional form-recovery harness is independent of this route:
`crm-form-recovery-build.mjs` generates source-derived copies and local action
adapters under `.tmp/form-recovery-check`. Its companion form, addendum, and voice
runners exercise real React components and preserve source hashes. These prove
browser state and draft retention, not live call ingestion, persistence, payment,
or provider success. The Windows WebKit Blob-storage probe is preserved separately;
the actual audio Blob lifecycle proof uses Chromium.

The archived route remains development-only. For this audit's bounded local
production diagnostic, the guard temporarily allowed `MCSW_LOCAL_QA=1` in the
isolated build/start child processes, with the server bound to127.0.0.1:3048.
That temporary exception was restored, the copied route removed, and a separate
unflagged production build run for release validation. The diagnostic build was
not deployed and is not the final distributable.
