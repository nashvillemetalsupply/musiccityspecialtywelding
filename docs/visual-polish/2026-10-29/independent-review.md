# Independent review — 29 October 2026

Verdict: no open P0/P1 finding in the reviewed changes after repairs and targeted verification. Source/browser review passes within the documented scope; production release remains conditional on the parent's final build/typecheck/lint/bundle gates. This is not a claim of universal correctness, deployment readiness on untested integrations, or a 10/10 product.

The final source also passed six fresh-context checks against a local Node 24 production build at `http://127.0.0.1:3048`: board at 390/1440px and forms at 390px, in Chromium and WebKit. All six completed with zero application JavaScript errors, failed renders, tested WCAG axe violations, or horizontal page overflow. Calendar keyboard selection, scoped agenda references, semantic Today/compact headers, and mobile modal focus passed. The desktop board document remains 900px high. Forms screenshots were inspected; the Chromium name-field overflow metric is normal horizontal scrolling inside a 44px-high native text input containing a long synthetic customer name, not clipped page content. No development-router error or destroyed execution context recurred in these production checks.

Production evidence: `.tmp/round2-cross-engine/production-smoke/{chromium,webkit}.json` and adjacent screenshots. Final reusable runner: `scripts/qa/crm-polish-cross-engine.mjs`. This local fixture build is not a deployment or live-provider acceptance test; the temporary QA route must be removed before the final distributable build.

## Fresh findings repaired

- An exception during the initial SMS consent lookup happened before any provider dispatch, but reached Customer Page delivery as a generic exception. The link was incorrectly quarantined as possibly sent. The lookup now returns the explicit known-unsent error type; a focused behavior test proves no provider call, unchanged persisted intent, and a successful same-intent retry.
- A missing or reserved Customer Page phone failed before SMS dispatch but was also classified as possibly sent. It now uses the same known-unsent type. The behavior test checks both phone cases, zero sends, and retryable failed status.
- These two tests failed before the repair (14 passed / 2 failed) and passed afterward (16 / 16). Existing provider response-loss tests still preserve unknown status and block automatic resend. Database/idempotency failures were deliberately not blanket-classified as unsent because an existing intent could already have a provider outcome.

## Reviewed trust boundaries

Reviewed SMS immediate/deferred dispatch, Customer Page delivery cleanup, tracked-call intent and contact binding, voice scope/client outbox/server transcription, closeout upload confirmation, and controlled PaymentForm state. No further blocking finding in this reviewed scope.

Evidence includes 24 new behavior tests: 16 outbound dispatch, 4 voice scope, 4 closeout upload confirmation. The parent reported a Node 24 suite at 1,043 passed, 3 skipped, 0 failed (1,046 total), 75.211 seconds, in `.tmp/final-release-tests-verified.log`; the main audit report owns final gate provenance after the last voice cancellation refinement. Skipped integration/evaluation checks do not establish live database or provider behavior.

PaymentForm source SHA256 remains `47b9608a0528a0da3508f600810889cb128b10a46237ad5a455371206bc89037`, matching the existing source-derived WebKit failed/pending/success fixture proof. Errors retain drafts; pending locks edits; success resets explicitly; repeated reversals receive different keys. No money was moved.

The separate form review found and repaired native action resets of intake/closeout selects, closeout inputs remaining editable during pending work, and completed-job addendum forms disappearing before save success. I independently reviewed the final four-file repair. Addenda now retain note/photo receipts through failure, close only after success, and queue automatic filing until voice/photo work is idle. Full completion clears its voice identity before a later addendum; an older closeout recording cannot accidentally become the addendum's recovery ID. Optional voice busy reporting blocks intake submission/context switching and completion during recording/transcription.

The final exact-source form evidence contains 23 checks: 10 form checks in WebKit, 4 addendum checks in WebKit, 9 actual VoiceCaptureButton checks in Chromium. The voice cases include delayed cleanup before queued auto-filing and clearing the old voice identity after completion. Final source hashes: intake `7497b17d4ac33855de7b2860aa0695e61a85464a759ccc518a8f5c3a5a1580a7`; closeout `2cb8bf9d1c8a5251e4135ffb211550e78f3661b7d5f35671cdfd7f4ab6020de4`; voice `b1b3fcf0404805bd2ced249da5d5a64bc08a79d2a48787136041a187a456cd36`.

The Windows WebKit build could store text in IndexedDB but failed a minimal Blob write with `UnknownError: Error preparing Blob/File data to be stored in object store`, both sandboxed and unsandboxed. Therefore actual voice Blob persistence/recovery was verified in Chromium only. This isolated engine limitation does not prove either success or failure on physical Safari.

I also reviewed the final Analytics focusable named scroll regions and focus outline, valid MoreMenu dialog semantics, scoped calendar agenda ID, and narrow calendar presentation. Two-letter weekday headers and semantic Today marking retain complete accessible date labels without cramped repeated labels.

## Fresh browser verification

Eighteen bundle cases: board, login, job, and shop at phone/desktop widths in Firefox and WebKit (8 per engine), plus WebKit board dark theme at 390 and 1440px. These cases have zero horizontal page overflow, zero tested WCAG axe violations, zero uncaught application errors, and no case failure. Screenshots were inspected for board, login, job Price focus, shop wrapping, and dark menu. Final narrow-calendar/menu changes received the separate smoke checks below.

- Desktop board document height is exactly 900px at the 900px viewport; internal board scrolling remains available.
- Login document height is exactly 900px at 320 and 1440px in both engines. An extra fixture-only wrapper initially defeated the production direct-child padding rule; removing that wrapper restored production-equivalent DOM and the four login cases were rerun. Earlier 932px fixture measurements are superseded.
- Mobile menus initially focus inside the dialog, remain inside for 32 Tab presses, cover the bottom rail, and restore the trigger on Escape in both engines and WebKit dark mode.
- Mobile Price navigation focuses the correct field. Label top is about 71.8px below a 57px header; field bottom about 115.8px is above the 838px dock top.
- WebKit dark checks used the actual theme toggle and included axe and menu keyboard checks.

After the last calendar/menu source changes, a fresh Firefox 390px case and a fresh WebKit 390px case each passed without application errors, axe violations, or horizontal overflow. Both proved seven compact two-letter weekday headings, one semantic current date, ArrowRight changing selection with focus retained, the agenda reference resolving within the same calendar, and modal focus containment/Escape restoration. The final calendar screenshot was inspected.

Two additional development-preview attempts were not counted as clean passes: one WebKit attempt emitted `Router action dispatched before initialization`; another lost its execution context during a navigation after layout/axe/screenshot succeeded. An unchanged-source WebKit repeat completed fully without either failure. The preview log contains a router stack through `hmrRefresh`, but the exact cause and production behavior are not established. Failed attempts are preserved, not silently discarded or relabeled as successful. The runner now captures error stacks for subsequent runs.

Evidence: `.tmp/round2-cross-engine/final-shell/{firefox,webkit}.json` (non-login cases), `.tmp/round2-cross-engine/final-login-dark/{firefox,webkit}.json` (corrected login and WebKit dark cases), `final-calendar-menu/firefox.json` and the first case in `final-calendar-menu-clean/webkit.json` (final clean smoke), `final-calendar-menu/webkit.json` and the second clean-file case (failed additional attempts), `payment-check.json`, `.tmp/outbound-final-{red,green}.log`. The reusable cross-engine runner now accepts `QA_THEME=dark` and `QA_CALENDAR=1`.

These are desktop browser engines with resized viewports, not physical iPhone/Android/Safari, native keyboards, or assistive-technology testing. Synthetic fixtures do not prove live data, credentials, production integration, or post-deployment behavior.

## Subjective release axes

These are bounded reviewer judgments, not measured competitive rankings or promises. No axis is averaged away.

| Axis | Score / 10 | Basis and limit |
| --- | ---: | --- |
| Truth | 8.5 | Explicit provider states, retry boundaries, role-scoped voice recovery, and draft preservation have deterministic evidence. Live provider/database recovery remains unproven. |
| Time saved | 8 | Clear next actions, direct Price/Photo access, and preserved drafts remove avoidable steps. No measured field time study. |
| Crew usability | 8.5 | Phone layouts, keyboard focus, modal containment, and persistent Call-first actions are substantially improved. No physical-device or gloved-hand field trial. |
| Visual distinction | 8.5 | Cohesive coal/orange shop identity, strong readable hierarchy, and responsive work surfaces. No claim that every possible content state was viewed. |
| Forward invention | 7 | Receipt-backed shop context and recovery workflows are useful differentiators. This pass mainly hardens existing invention; no verified competitive novelty benchmark. |

Production deployment, live-provider acceptance, physical-device validation, and diagnosis of the isolated development-preview failures remain outside this source/browser pass. No claim is made that every possible route/state/device combination or every live provider workflow is verified.
