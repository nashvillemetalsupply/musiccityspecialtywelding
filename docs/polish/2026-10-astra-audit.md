# MCSW final polish audit — October 2026

Date: 2026-10-02. Live site: https://musiccityspecialtywelding.com
Branch: `polish/astra-2026-10`. Starting commit: `2d348c7`.

## Status

The authorized October local polish scope is complete. The live audit and evidence are committed as `5d116c0`; the type-only G01 prerequisite is committed as `a5d04e8`; and the three bounded customer fixes are committed as P01 `693a0cb`, P02 `d990d2c`, and P03 `f7a1877`. The final full Node 24 run for each of G01, P01, P02, and P03 passed with 861 tests passed and 1 skipped, zero ESLint errors and four existing warnings, and a passing production build and bundle budget. Local built-site verification passed 90 P01, 57 P02, and 13 P03 browser assertions. No push, deploy, or merge was performed, so the live site remains unchanged. This completion applies only to the authorized October audit and three-fix scope; it does not close the broader S22 exit-verification row.

## Ranked findings

| Rank / ID | Customer impact | Finding and live URL | Evidence | Status |
| --- | --- | --- | --- | --- |
| 1 / P01 | Major: hard-to-read fixed conversion control | The mobile bottom bar loses its orange Call background and its light Quote text outside the homepage. Quote is near-black on dark brown, at 1.21:1 contrast rather than 4.5:1. Confirmed on `/service-areas`, `/privacy`, `/terms`, all six service pages, and the 404 page. | `evidence/live-audit-2026-10-02/legal-mobile-callbar.json`; `evidence/live-audit-2026-10-02/live-audit.json`; `evidence/verify-local-P01.json`; `evidence/verify-local-P01.png`. | **Fixed in source and verified locally.** Commit `693a0cb`; 13.95:1 local contrast and 90/90 browser assertions. Not deployed. |
| 2 / P02 | Minor: city tiles have small clickable text | On https://musiccityspecialtywelding.com/service-areas, eight city tiles look like roughly 44 px targets, but their actual anchors are only 15–16 px tall. The padded tile area is not part of the link. This falls below the repo's preferred 44 px target; no standalone WCAG target-spacing failure is asserted. | `evidence/live-audit-2026-10-02/live-audit.json`; `evidence/verify-local-P02.json`; `evidence/verify-local-P02.png`; `evidence/verify-local-P02-desktop.png`. | **Fixed in source and verified locally.** Commit `d990d2c`; every city anchor is at least 44 × 44 px and 57/57 browser assertions pass. Not deployed. |
| 3 / P03 | Minor keyboard usability | The navigation disclosure at https://musiccityspecialtywelding.com/ stays open after Escape. It remains operable by Enter/Space and its links, is not a keyboard trap, and is not a modal. This is a navigation convention gap, not a demonstrated standalone WCAG failure. | `evidence/interactions.json`; `evidence/interactions-menu-escape-failure.png`; `evidence/verify-local-P03.json`; `evidence/verify-local-P03.png`. | **Fixed in source and verified locally.** Commit `f7a1877`; Escape close/focus restoration and all 13 browser assertions pass. Not deployed. |

### P01: affected URLs and narrow correction

- https://musiccityspecialtywelding.com/service-areas
- https://musiccityspecialtywelding.com/privacy
- https://musiccityspecialtywelding.com/terms
- https://musiccityspecialtywelding.com/services/mobile-welding
- https://musiccityspecialtywelding.com/services/trailer-welding-repair
- https://musiccityspecialtywelding.com/services/equipment-repair
- https://musiccityspecialtywelding.com/services/architectural-welding
- https://musiccityspecialtywelding.com/services/custom-fabrication
- https://musiccityspecialtywelding.com/services/custom-metal-products
- https://musiccityspecialtywelding.com/__mcsw_public_audit_missing_2026_10_02__

Live screenshots established the failure before source inspection. The shared `.ms-mobile-cta` CSS referenced `--sw-neon`, `--sw-fire`, and `--sw-chalk`, which exist only beneath `.ms-site`. Outside that ancestor, the declarations became invalid. Commit `693a0cb` adds fallbacks equal to the existing token values in two rules in `app/globals.css`. It changes no copy, service content, prices, tracking, visibility logic, or header.

See `evidence/callbar-review.txt`. Browser-injected checks first confirmed the correction on Privacy, a service page, and the 404 page while leaving homepage CTA styles unchanged. The committed source was then tested through a local production build across 11 mobile and 11 desktop routes. All 90 assertions passed: the Quote control measured 13.95:1 contrast on every mobile route, Call retained its opaque gradient, the CTA had zero axe violations, and desktop routes had no horizontal overflow. Evidence: `evidence/verify-local-P01.json` and `evidence/verify-local-P01.png`. These local results verify the committed source; the live site has not been deployed from this branch.

### P02: complete city-tile targets

Commit `d990d2c` removes the noninteractive `<strong>` wrapper and makes each unchanged Next Link own the existing tile class and presentation. The eight city names, their order, the `/services/mobile-welding#service` destination, business copy, and other routes are unchanged. At both tested widths every anchor is at least 44 × 44 px; padded-edge hit testing, full-tile focus, Enter activation, desktop presentation, and overflow checks pass. Evidence: `evidence/verify-local-P02.json`, `evidence/verify-local-P02.png`, and `evidence/verify-local-P02-desktop.png`.

The first P02 browser run is retained in `evidence/verify-local-P02-initial.json`. Its eight failures came from expecting authored `inline-flex` to remain `inline-flex` in computed style. Because each anchor is itself a flex item, CSS blockification correctly reports computed `display: flex`; every recorded size, padding, border, background, shadow, color, decoration, and rotation already matched. The verifier was narrowed to the standards-correct computed value, then all 57 assertions passed. No application change was made to satisfy that false failure.

### P03: Escape closes the menu

Commit `f7a1877` adds an Escape handler only to the existing native `<details>` menu. It acts only when the menu is open and focus is on its summary or a descendant link, closes the disclosure, and restores focus to the summary. Existing link clicks still close without focus restoration; link text and destinations are unchanged; native Enter and Space behavior remains intact. All 13 focused assertions passed, including Escape from a link and from the summary, link click/href behavior, required-form and FAQ checks, zero page errors, and zero attempted mutating requests. Evidence: `evidence/verify-local-P03.json` and `evidence/verify-local-P03.png`.

## Coverage and evidence

The live sitemap and links yielded ten public pages: home, service areas, privacy, terms, and the six service pages listed above. Every page plus the explicit missing URL was visited at 390 × 844 and 1440 × 900, for 22 natural viewport runs. The separate desktop Lighthouse run used 1440 × 1000. City pages were not added or rewritten. Private customer pages requiring a token and authenticated `/ops`/`board` routes are outside this public customer-site audit; no customer records were queried.

- Page inventory: `evidence/live-audit-2026-10-02/route-manifest.json`.
- Complete natural browser record: `evidence/live-audit-2026-10-02/live-audit.json`.
- HTTP/anchor/link checks: `evidence/live-audit-2026-10-02/link-check.json`.
- Summary: `evidence/live-audit-2026-10-02/summary.json`.
- Captures: `evidence/live-audit-2026-10-02/screenshots/{mobile-390,desktop-1440}/`. The full capture set is retained locally and ignored by Git to avoid adding hundreds of megabytes of duplicate page images. Representative finding screenshots, proposed-state screenshots, the JSON records, and reproducible runners are retained in this audit commit.

Each section was scrolled into view before its natural viewport capture. Natural full-page captures can show blank off-screen sections because the site uses `content-visibility`; those blanks are capture artifacts and were not reported as website failures. The supplemental all-content pass completed all 22 runs with zero failed navigations and no missing instrumentation. It changed only browser-local `content-visibility`, then scrolled through the full page in viewport increments before capturing and running axe. It found the same ten P01 contrast occurrences and no additional axe violations. Evidence: `evidence/live-audit-2026-10-02/forced-render-audit.json`; labeled full-content captures are under `screenshots/forced-content-visibility/`. Browser-only instrumentation must not be mistaken for production changes.

Natural crawl results: all ten public routes returned 200; the explicit missing route returned 404. Zero broken-link findings across 36 link/anchor records, link-network errors, horizontal overflow runs, missing-alt occurrences, or JavaScript page errors. The ten serious axe contrast occurrences are the shared P01 defect, not ten separate fixes. Public pages have route-appropriate titles, descriptions, canonicals, Open Graph and Twitter data. JSON-LD parses successfully: business data site-wide, plus Service/BreadcrumbList/FAQPage on service pages and FAQPage on home. This is syntax/presence verification, not a Google rich-result eligibility certification.

Low-impact plan carryovers, left unchanged: public HTML and sitemap responses still carry `Access-Control-Allow-Origin: *`, despite the earlier S12 API-only goal. The audited data is public, so this was not treated as a customer-facing failure or a reason for a header rewrite. The 404 has an appropriate title and noindex directives. Its duplicate noindex tags are harmless and remain unchanged. The expected 404 resource console line is not a JavaScript failure.

## Form and interactions

Exactly one authenticated `[INTERNAL TEST]` quote was submitted on the live site at 2026-10-02T16:26:50.631Z. It used the reserved phone `(615) 555-0199`, an `example.com` email, and no text consent. The request returned HTTP 200 with `{ "ok": true, "accepted": true }`. The UI showed its existing success message and cleared the form, matching the response.

- Response and assertions: `evidence/form-live-response.json`.
- Screenshot: `evidence/form-live-390.png`.
- Reproducible guarded runner: `evidence/form-live-verify.mjs` (refuses to duplicate the recorded attempt).
- Summary: `evidence/form-live-verification.md`.

Zero Google/Meta measurement requests and zero page errors were observed in this isolated test. Source inspection confirms that authenticated test requests use the branch which suppresses shop/customer email and notifications; external provider non-delivery was not independently observed. No secret is included in evidence.

Separate interaction checks produced zero quote POSTs: keyboard menu opening, link-triggered closing, scroll restoration, visible focus, FAQ opening/closing, and required-field validation passed. Empty form submission focused the name field and showed native required-field feedback. Escape behavior is recorded as P03. See `evidence/interactions.json` and `evidence/menu-review.txt`.

## Performance and protected observations

Lighthouse 13.5.0, live homepage, cold profile, simulated throttling:

| Width | Performance | Accessibility | SEO | LCP | CLS | Total blocking time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 390 | 86 | 100 | 100 | 2.5 s | 0 | 370 ms |
| 1440 | 98 | 100 | 100 | 0.8 s | 0 | 40 ms |

Evidence: `evidence/lighthouse-live-mobile.json` and `evidence/lighthouse-live-desktop.json`, with corresponding `.jpg` captures. These are lab observations, not field Core Web Vitals. The mobile run is close to the good LCP threshold, with moderate blocking time. The measured unused-JavaScript entries are Google/Meta resources, which the owner explicitly protected; none were changed. No performance rewrite is proposed from one lab sample.

The scrolling crawl's LCP observer can select later scrolled images; it must not be presented as initial-viewport LCP. The trailer-page response was slow once (responseStart 20,011 ms; LCP 20,856 ms). Three fresh follow-up visits all returned 200 with responseStart 370/120/95 ms and initial LCP 1,404/900/932 ms. The delay did not reproduce; no speculative source fix was made. Evidence: `evidence/live-audit-2026-10-02/trailer-mobile-remeasure.json`.

Report-only CSP messages were observed for analytics resources. They are recorded in the Lighthouse/browser evidence and left untouched under S16 / FR-33 and the owner's explicit instruction. No enforcement flip, allowlist change, or clean-seven-day claim was made.

Approved business facts were checked against `BRAND-BRIEF.md`: phone, address, 24/7 availability and listed services match the recorded owner-approved facts. No warranties, years, certifications, review counts, or response-time claims were added. Earlier work and current-plan boundaries are summarized in `evidence/prior-work.txt`.

## Validation gate

| Check | Result | Evidence |
| --- | --- | --- |
| Historical baseline - production build and bundle budget | PASS | `evidence/baseline-build.log`; home 530,423 / 648,316 bytes, board 671,894 / 817,538 bytes |
| Historical baseline - repository tests using Node 24.21.0 | PASS: 861 passed, 1 skipped, 0 failed | `evidence/baseline-tests-node24.log` |
| Historical baseline - ESLint using Node 24.21.0 | **HISTORICAL FAIL: 7 errors, 4 warnings** | `evidence/baseline-lint-node24.log` |
| G01 - type-only prerequisite | PASS: 861 passed, 1 skipped; lint 0 errors/4 existing warnings; build and budget pass; six runtime ASTs equivalent | `evidence/G01-checks.json`; `evidence/G01-runtime-equivalence.json`; commit `a5d04e8` |
| P01 initial run | **HISTORICAL FAIL:** frozen public-CSS snapshot expected the exact pre-change rules | `evidence/P01-initial-checks.json`; `evidence/P01-initial-frozen-css-test.log` |
| P01 final repository gate | PASS: 861 passed, 1 skipped; lint 0 errors/4 existing warnings; build and budget pass | `evidence/P01-checks.json`; commit `693a0cb` |
| P01 local built-site verification | PASS: 90/90 assertions across 11 mobile and 11 desktop routes | `evidence/verify-local-P01.json`; `evidence/verify-local-P01.png` |
| P02 initial browser verifier | **HISTORICAL FALSE FAIL:** 8 presentation assertions expected authored `inline-flex` instead of blockified computed `flex` | `evidence/verify-local-P02-initial.json` |
| P02 final repository gate | PASS: 861 passed, 1 skipped; lint 0 errors/4 existing warnings; build and budget pass | `evidence/P02-checks.json`; commit `d990d2c` |
| P02 local built-site verification | PASS: 57/57 assertions; all eight city anchors at least 44 × 44 px | `evidence/verify-local-P02.json`; `evidence/verify-local-P02.png`; `evidence/verify-local-P02-desktop.png` |
| P03 final repository gate | PASS: 861 passed, 1 skipped; lint 0 errors/4 existing warnings; build and budget pass | `evidence/P03-checks.json`; commit `f7a1877` |
| P03 focused browser verification | PASS: 13/13 assertions | `evidence/verify-local-P03.json`; `evidence/verify-local-P03.png` |

The historical baseline ESLint failure is retained because it originally stopped source work. The owner then authorized the narrow type-only prerequisite. G01 removed those seven checked-source `no-explicit-any` errors without disabling or weakening a rule, changing a dependency, or changing runtime behavior. Its six modules are `lib/ad-spend.ts`, `lib/ai-usage.ts`, `lib/call-sketch-claims.ts`, `lib/csp-report.ts`, `lib/photo-draft-workflow.ts`, and `lib/shop-brain-invariants.ts`. The protected CSP edit was type-only; CSP headers, enforcement, report-only behavior, and configuration were not changed.

The shell's default Node 20 cannot run the pinned strip-types test command; the installed cached Node 24 executable was invoked directly without changing PATH or any environment variable. The initial tooling failure remains in `evidence/baseline-tests.log`.

The first P01 validation run also remains recorded. It stopped on `scripts/css-move-verbatim.test.mjs`, whose frozen public-CSS snapshot required the exact pre-change CTA rules. Review confirmed that P01 and P02 intentionally change only five complete rules. The test now applies an explicit full-rule allowlist: each original rule must occur exactly once, each is replaced only by its approved form, the rest of public CSS remains equal to the frozen baseline, and imports and leaf at-rules remain byte-identical. The complete P01 and P02 suites then passed. This resolves the expected snapshot conflict while preserving the freeze guard for every unapproved CSS change.

## Changes and stop reason

The bounded commit sequence is:

- `5d116c0` — audit and before-state evidence.
- `a5d04e8` — G01 type-only lint prerequisite.
- `693a0cb` — P01 mobile call-bar color fallbacks.
- `d990d2c` — P02 complete city-tile links.
- `f7a1877` — P03 menu Escape close and focus restoration.

The authorized work stops after three customer-facing fixes and one type-only prerequisite. All are committed and locally verified. The remaining observations are cosmetic, protected, externally blocked, or part of a broader plan; the audit found no additional material customer-facing defect that justified another source change.

| Left unchanged | Reason |
| --- | --- |
| Duplicate noindex tags on the 404 | The page already has the correct 404 response, title, and noindex behavior. The duplicate is harmless markup and does not justify a cosmetic source change. |
| `Access-Control-Allow-Origin: *` on public HTML and sitemap responses | This is a prior S12 carryover on public data. Left unchanged because the audit demonstrated no customer impact and the remaining work is low priority. |
| Google/Meta analytics resources and report-only CSP messages | Tracking was explicitly protected. CSP report-only configuration remains untouched pending its separate clean-seven-day evidence requirement; no enforcement or allowlist change was authorized. |
| S21 per-city pages | Still blocked on owner-supplied real job content for each city. No city pages or city copy were invented. |
| S21 call-in-progress chips | Still blocked until the S05 closing note demonstrates Neon compute below 50 CU-hours/month. No SSE chip work was attempted. |
| S22 exit verification | Remains open. This October audit does not substitute for S22's fresh preview/production QA Procedure 1–15, Lighthouse rerun, Neon CU-hours read, closing note, and plan closure. |

An independent Codex review found no actionable issue in the P01/P02 or P03 implementation scope. It confirmed the exact frozen-CSS allowlist, unchanged business copy and URLs, and the bounded Escape behavior. Evidence: `evidence/customer-fix-review.txt`.

No push, deploy, merge, environment change, DNS change, CSP behavior or configuration change, tracking change, price change, or owner-held city-page edit was performed. The live site remains unchanged. The pre-existing untracked weekly optimization handoff was left alone.
