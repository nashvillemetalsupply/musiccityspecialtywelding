# CRM polish and reliability review — 2026-10-29

**Status: local polish implemented; predeployment verification extended below. Changes are not deployed.**
The [October 30 handoff](predeployment-handoff-2026-10-30.md) is the latest release
record and supersedes the historical gate and recovery limits below.
This report supersedes the earlier completion claim. Passing the recorded checks
supports the specific results below; it does not establish perfection on every
device, every live customer record, or every provider workflow.

The follow-up predeployment pass adds real PostgreSQL persistence/recovery checks,
zero-warning lint cleanup, deployment artifact exclusions, and encrypted backup
publication. See [release readiness](predeployment-readiness-2026-10-29.md),
[backup recovery](backup-recovery.md), and the
[independent follow-up review](visual-polish/2026-10-29/predeploy-review.md).
Those follow-up records supersede the earlier lint-warning and database-test
limits in this report. The subsequently authorized
[production snapshot restore](production-recovery-2026-10-30.md) also passed and
its temporary data copies were removed. Physical devices, native screen readers,
and live providers remain separate acceptance boundaries.
No Claude, Pi, DeepSeek, or paid model evaluation was used for this follow-up.

## Product and scope

The operating principle is to make the next customer or job action clear while
preserving the truth behind calls, messages, promises, payments, and completion.
The work improves the existing shop board and work order rather than replacing
its routes or the owner/crew model. The Golos Text/Chivo typography, square
coal-and-orange controls, compact ledgers, and customer-facing daylight treatment
remain the shared visual language. No worker surveillance or new dashboard
sprawl was introduced.

Changes are isolated in `task/crm-polish-2026-10-29`, based on
`46b4ed5a1aa7b66e26c91eac6309d62ba676b414`, under `.worktrees/crm-polish`.
The main checkout is not the edited application. No schema migration, deployment,
intentional live message/call, or live payment/upload was performed for this pass.
The preview contains synthetic data and no copied production credentials.

## Changes and practical effect

- **Board and shared layout:** desktop navigation and the application fit inside
  the viewport. Calendar screen-reader instructions stay within their scroll
  container instead of creating a 183px document tail. Phone totals use compact
  rows; names, large amounts, and long controls reflow. Customer directory styles
  no longer collide with board customer cells. Modern shell tokens win over
  retained legacy CSS, including the login background and text sizing.
- **Navigation and keyboard use:** the menu has a reachable internal Close
  button, traps visible controls, restores focus, and makes only background
  content inert. It stays above the bottom rail. Skip navigation and job fragment
  links resolve the current visible route even when an older route remains
  cached. Price opens its disclosure and places the field and label above the
  measured action dock. Completed-job Photo can be reopened repeatedly.
  Analytics tables expose labeled keyboard-scroll regions and visible focus.
  Calendar labels reflow when product typography is enlarged, and calendar
  description/agenda relationships use per-instance IDs. Menu chrome no longer
  introduces a duplicate banner landmark or an unsupported dialog role.
- **Forms and feedback:** narrow-screen inputs keep a 16px floor; labels and
  descriptions use per-instance or per-render IDs. Login focuses code entry and
  prevents identity changes while delivery is pending. Error copy no longer
  promises that an interrupted operation was saved. Payment failures retain
  amount, method, settlement, and reversal drafts; successful submissions reset
  deliberately. Reversal keys rotate after success. Reply completion cannot
  erase a newer draft, and pending controls prevent conflicting edits.
  Intake service/referral choices and closeout review controls retain their
  values after resolved action errors instead of being reset by native form
  behavior. Voice capture/transcription blocks conflicting submission, and an
  addendum remains open until successful filing. Automatic filing waits for
  voice and photo work to finish; a completed job cannot reuse a prior voice ID.
- **Ask Jobs and Morning Brief:** saved answers, sources, and brief failures have
  explicit feedback. Late responses cannot replace the currently selected
  answer or reopen a discarded brief. Related audio/request work is cancelled
  when its context changes.
- **Operational reliability:** SMS consent and internal-test status are checked
  at dispatch, including deferred sends. Failures before a provider request stay
  retryable, while ambiguous provider outcomes remain unknown. Customer-page
  claim cleanup is bound to its own attempt. Tracked call intents are journaled
  before claiming and reject invalid/test/mismatched job bindings.
- **Voice and upload recovery:** browser voice recovery is scoped to operator
  and role, with matching server checks before side effects. Unscoped legacy
  recordings are preserved without automatic upload. Stale callbacks cannot
  apply audio to another job. Authorized closeout uploads can recover from a
  storage callback arriving after the browser completion request.
- **Performance:** the board imports a pure call-outcome formatter without
  initializing the validation schema. Compatibility exports remain available.
  The final board JavaScript measurement is 712,282 uncompressed bytes, within its
  817,538-byte budget. The earlier first-pass measurement was 761,038 bytes: this
  release is 48,756 bytes smaller (6.41%). This is a historical build-size
  comparison, not a gzip or measured loading-speed claim.

The backend changes above are intentional behavior fixes, not merely visual
changes. The full deterministic suite covers existing authorization, provider,
idempotency, projection, and workflow contracts; it does not substitute for live
provider acceptance testing.

## Coverage and method

The [fixture coverage map](../scripts/qa/fixtures/crm-polish/README.md) enumerates
all 15 production board/ops page files and the customer page. Fourteen rendered
surface families include board, Calls, Updates, customers, job, account, intake
forms, Shop, Analytics, Install, Builds, Call Sketch, login, and the customer page.
Redirect-only branches are source-reviewed. Additional isolated cases cover the
menu, Ask Jobs, voice recovery, and payment action states.

Real reusable components are used where practical. Server-only page markup is
represented with documented synthetic fixtures; its actual authenticated data
loading is not exercised. Styles are loaded together to expose collisions after
client navigation. The browser runners wait for hydration, surface readiness,
and the real Golos Text and Chivo font faces before measuring or capturing.
External navigation and provider requests are blocked by the local harness.

### Browser matrix

The [final matrix](visual-polish/2026-10-29/round2/final-compact.json) contains
**202 verified layout cases**, with zero failed renders, application errors,
horizontal page overflow, or clipped controls. Two pending-job cases that timed
out in development were successfully repeated in the local production build;
their rows explicitly record that mode. The final distributable build passed
after removing the temporary fixture route. The matrix comprises:

| Check | Cases | Widths / states |
| --- | ---: | --- |
| Normal Chromium layouts | 75 | 14 surfaces plus open menu at 320, 390, 768, 1440, 1920 CSS px |
| Enlarged product typography | 38 | 390/768px, all surfaces plus large/error/history/crew/menu cases |
| Alternate roles and states | 44 | 320/768px, documented empty, pending, failure, completed, history, large, and crew variants |
| Breakpoint geometry | 39 | Board, menu, Updates at 375, 414, 420, 421, 479, 480, 481, 767, 768, 769, 899, 900, 901px |
| Short viewport reachability | 6 | Menu, job, forms at 320×568 and 844×390; menu traversal, Price clearance, last form action |

The typography stress test doubles the nine product `--t-*` tokens. It is not OS
text resizing and does not enlarge fixed-pixel text outside those tokens.
Breakpoint-only cases do not run axe. Automated accessibility checks supplement
manual focus, contrast, layout, and screenshot inspection; they do not certify
screen-reader usability.

All non-exempt axe violations are resolved in this matrix. Fifteen board cases
retain the same `region` best-practice finding for the first skip link, which
intentionally precedes page landmarks. That finding remains visible in raw and
compact evidence rather than being suppressed. Incomplete axe checks are also
retained. The seven-column calendar has approximately 40px-wide targets at 320px;
their height remains at least 76px. This practical narrow-grid exception is not
represented as universal 44px touch compliance.

One development-preview navigation produced an unreproduced JavaScript syntax
exception and failed hydration. That run is retained as failed evidence. Three
fresh isolated diagnostics on unchanged source then hydrated with zero browser
exceptions; the affected board cases subsequently passed. The initial runner did not
capture the script URL/offset, so the cause is unknown and is not attributed to
HMR or dismissed as a proven browser defect. The reusable runner now records
error stacks. Production compilation is checked independently by the release
build.

The pending-job hydration timeouts occurred without a captured browser exception.
Both cases passed the strict production-mode repeat at 320/768px, including
readiness, real fonts, geometry, axe, and screenshot inspection. The failed
development attempts remain archived separately. The independent reviewer also
preserves its development-only router initialization/navigation failures. Their
exact cause remains undiagnosed; successful production checks are additional
evidence, not proof of a specific development-server cause.

### Interaction and browser-specific checks

- **16/16 isolated interaction scenarios passed**, with zero uncaught application
  errors. These cover login focus and locks, menu Tab/Shift-Tab/Escape and retained
  route isolation, Price and Photo navigation, action-dock clearance,
  stale Ask Jobs responses, and voice identity/recovery transitions. The two
  voice fixture cases passed again after the final cancellation guard change.
- **Three WebKit payment states passed:** failed drafts remain intact, pending
  actions lock conflicting edits, and successful payment/reversal resets and
  key rotation behave as intended. The fixture is derived from the exact
  production PaymentForm source and records its SHA-256. Local adapters perform
  no money movement or server persistence.
- **23 additional source-derived behavior checks passed**, with zero application
  errors: ten intake/closeout draft and pending-state checks, four addendum
  failure/success/reopen checks in WebKit, and nine actual VoiceCaptureButton
  lifecycle checks in Chromium. Synthetic MediaRecorder and local action/network
  adapters exercised the real components, including delayed permission/identity
  cancellation, without live microphone, provider, or
  database writes. [Before/after evidence and source hashes](visual-polish/2026-10-29/form-recovery/after.json)
  are archived beside the reusable harness results.
- **True 200% Chromium page zoom passed** for board, job, forms, and customers
  without horizontal document overflow. The isolated browser used its actual
  page-zoom setting: outer width stayed 1280px, inner width changed 1264→632px,
  DPR changed 1→2, root font remained 16px, and visualViewport scale remained 1.
  Native viewport captures are 1264×905 physical pixels. This is distinct from
  merely changing the root font or emulating a small viewport.
- Firefox and WebKit review found and drove repairs to skip-link sizing, menu
  stacking, archive-link styling, and the calendar/login tail. Eighteen current
  surface/theme cases passed, with corrected login cases replacing artificial
  fixture-wrapper measurements. Final narrow-calendar/menu checks verified
  compact weekday headings, semantic Today, local agenda references, arrow-key
  selection, modal containment, and Escape restoration.
- **Eight local production-mode cases passed:** six fresh-context board/form
  checks across Chromium and WebKit, plus the two strict pending-job widths above.
  All had zero application errors, render failures, tested axe violations, or
  horizontal overflow. The two pending widths are replacements inside the 202-case
  ledger, not extra unique matrix cases. The temporary diagnostic build used a
  local-only fixture flag and localhost port 3048. Its server was stopped, the original
  fixture guard restored, and the route removed before the final release build.

Selected synthetic screenshots:
[production phone board](visual-polish/2026-10-29/round2/production-chromium-board-owner-normal-390.jpg),
[production desktop board](visual-polish/2026-10-29/round2/production-chromium-board-owner-normal-1440.jpg),
[short landscape Price focus](visual-polish/2026-10-29/round2/job-owner-populated-844h390-1x-viewport.jpg),
[short phone menu](visual-polish/2026-10-29/round2/menu-owner-populated-320h568-1x-viewport.jpg),
and [true 200% zoom](visual-polish/2026-10-29/round2/zoom200-job-viewport.jpg).

The [provenance manifest](visual-polish/2026-10-29/round2/provenance.json) records
final production-source and guarded-fixture hashes, raw result hashes, and the
selected archived artifacts. Targeted reruns replace matching case keys in time
order; their source files and timestamps remain explicit.

## Automated release checks

The pinned **Node 24.22.2** runtime ran the full suite:
**1,046 total; 1,043 passed; 3 skipped; 0 failed**, in 41.62 seconds.
The skipped checks are the opt-in AI evaluation and two real-database integration
checks; this checkout has no database credentials. The full result is recorded in
`.tmp/final-source-tests.log`; earlier focused CSS checks also passed 71/71.

All final release commands exited 0:

| Gate | Final result |
| --- | --- |
| Production build | Passed; webpack compilation 47s, build TypeScript 23s, 50 static pages generated |
| Standalone `tsc --noEmit` | Passed |
| Full ESLint | Passed with 0 errors and 4 existing warnings |
| Public JavaScript budget | 612,409 / 648,316 uncompressed bytes |
| Board JavaScript budget | 712,282 / 817,538 uncompressed bytes |
| Fixture exclusion | No `qa-polish` source route or final route-manifest entry |
| Worktree hygiene | Whitespace check clean; main checkout clean; generated Next AGENTS appendix removed |

The [release-gate record](visual-polish/2026-10-29/round2/release-gates.json) links
the archived build/lint/budget logs and test summary. The four existing lint
warnings concern an unused closeout import, offline internal navigation, and two
unused test variables. They are disclosed rather than counted as zero warnings.

The guarded fixture archive was hash-verified before removing the copied
application route and its generated type caches. Both local preview servers are
stopped. The final build used no local-fixture flag and contains no QA route.

## Independent judgment

The [independent review](visual-polish/2026-10-29/independent-review.md) found no
open P0/P1 issue in the reviewed changes after repairs. Its source/browser verdict
passes within the recorded scope, and the final distributable gates passed.
These are subjective, bounded judgments, not competitive
measurements or a claim of perfection:

| Release axis | Score / 10 | Remaining evidence limit |
| --- | ---: | --- |
| Truth | 8.5 | Live provider and database recovery untested |
| Time saved | 8 | No measured field time study |
| Crew usability | 8.5 | No physical-device or gloved-hand field trial |
| Visual distinction | 8.5 | Representative content states, not every possible record |
| Forward invention | 7 | Existing distinctive workflows hardened; no novelty benchmark |

## Limits and release status

- Physical iPhone/Android hardware, native keyboards, OS enlarged text/display,
  actual Safari, screen readers, and native installation are not verified.
  Playwright WebKit is useful engine coverage, not a physical Safari certificate.
- Windows Playwright WebKit failed a minimal IndexedDB Blob write even outside
  the command sandbox, while the equivalent plaintext write passed. The isolated
  probe returned `UnknownError: Error preparing Blob/File data to be stored in
  object store`. Consequently, the real voice Blob recovery proof uses Chromium;
  this audit does not claim Safari voice persistence passed.
- Live delivery, call forwarding, payments, uploads, database-backed recovery,
  provider webhooks, and production role projection were not executed end to end.
  Synthetic browser adapters and deterministic server tests prove narrower
  properties, which are identified above.
- The automated matrix covers representative records and states. It does not
  cover every combination of account history, customer data, permission, network
  timing, provider behavior, or device.
- Existing source code and configuration determine which integrations are active.
  This audit does not claim missing credentials are configured or that provider
  activation is complete.
- No production deployment has occurred. Post-deployment behavior is unverified.
  No competitive benchmark or universal 10/10 score is claimed.

The temporary preview targets were `http://127.0.0.1:3047/board/qa-polish`
(development) and `http://127.0.0.1:3048/board/qa-polish` (local production
diagnostic). Both servers are stopped and the application fixture route has
been removed. Reproduction commands and boundaries are in the fixture coverage
map. The archived fixtures retain their original development-only guard.
