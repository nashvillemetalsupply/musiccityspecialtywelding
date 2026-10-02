# MCSW final polish audit — October 2026

Date: 2026-10-02. Live site: https://musiccityspecialtywelding.com
Branch: `polish/astra-2026-10`. Starting commit: `2d348c7`.

## Status

Live audit completed: 22 natural viewport runs and 22 supplemental full-content accessibility runs. No application source fixes have been applied. The required lint gate fails on seven existing type annotations, including one in the protected CSP reporting module. The owner was asked for a narrowly scoped type-only prerequisite exception; no approval has been received. The red-check rule remains in force.

## Ranked findings

| Rank / ID | Customer impact | Finding and live URL | Evidence | Status |
| --- | --- | --- | --- | --- |
| 1 / P01 | Major: hard-to-read fixed conversion control | The mobile bottom bar loses its orange Call background and its light Quote text outside the homepage. Quote is near-black on dark brown, at 1.21:1 contrast rather than 4.5:1. Confirmed on `/service-areas`, `/privacy`, `/terms`, all six service pages, and the 404 page. | `evidence/live-audit-2026-10-02/legal-mobile-callbar.json`; `evidence/live-audit-2026-10-02/live-audit.json`; mobile Privacy and Terms `00-top.png` captures. | **Not fixed in source.** Exact two-declaration CSS proposal prepared in `evidence/P01-callbar-proposed.patch`. Blocked by the existing lint gate and pending prerequisite exception. |
| 2 / P02 | Minor: city tiles have small clickable text | On https://musiccityspecialtywelding.com/service-areas, eight city tiles look like roughly 44 px targets, but their actual anchors are only 15–16 px tall. The padded tile area is not part of the link. This falls below the repo's preferred 44 px target; no standalone WCAG target-spacing failure is asserted. | `evidence/live-audit-2026-10-02/live-audit.json`, the mobile service-area `layout.smallTargets`; `screenshots/mobile-390/service-areas/00-top.png` and section captures. | **Not fixed.** The lint gate is red. A narrow anchor-fill CSS correction would be the next candidate after P01; no city copy or page should be rewritten. |
| 3 / P03 | Minor keyboard usability | The navigation disclosure at https://musiccityspecialtywelding.com/ stays open after Escape. It remains operable by Enter/Space and its links, is not a keyboard trap, and is not a modal. This is a navigation convention gap, not a demonstrated standalone WCAG failure. | `evidence/interactions.json`; `evidence/interactions-menu-escape-failure.png`; `evidence/menu-review.txt`. | **Not fixed.** Lower priority than P01; source work is stopped by the lint gate. One-component proposal is recorded. |

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

Live screenshots established the failure before source inspection. The shared `.ms-mobile-cta` CSS references `--sw-neon`, `--sw-fire`, and `--sw-chalk`, which exist only beneath `.ms-site`. Outside that ancestor, the declarations become invalid. The proposed fix adds fallbacks equal to the existing token values in two rules in `app/globals.css`. It changes no copy, service content, prices, tracking, visibility logic, or header.

See `evidence/callbar-review.txt`. Browser-only checks on Privacy, a service page, and the 404 page resolved the Call gradient and Quote foreground, with zero CTA axe violations. The homepage computed CTA styles remained exactly unchanged. Proposed-state captures are `evidence/live-audit-2026-10-02/P01-*-callbar-proposed.png`; `git apply --check` passed for the unapplied patch. Browser-injected proposed CSS is review instrumentation only; it does not mean the source or live site has been fixed.

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
| Production build and bundle budget | PASS | `evidence/baseline-build.log`; home 530,423 / 648,316 bytes, board 671,894 / 817,538 bytes |
| Repository tests using Node 24.21.0 | PASS: 861 passed, 1 skipped, 0 failed | `evidence/baseline-tests-node24.log` |
| New audit runner scripts | PASS: no new lint errors | `evidence/audit-scripts-lint.log` (exit 0) |
| ESLint using Node 24.21.0 | FAIL: 7 existing errors, 4 warnings | `evidence/baseline-lint-node24.log` |

The shell's default Node 20 cannot run the pinned strip-types test command; the installed cached Node 24 executable was invoked directly without changing PATH or any environment variable. The initial tooling failure is retained in `evidence/baseline-tests.log`. Build passed through the package build command; the Node 24 tests and lint ran the package scripts' underlying commands directly.

The seven lint failures are checked-source `no-explicit-any` errors in `lib/ad-spend.ts`, `lib/ai-usage.ts`, `lib/call-sketch-claims.ts` (two), `lib/csp-report.ts`, `lib/photo-draft-workflow.ts`, and `lib/shop-brain-invariants.ts`. Installed tool versions match the lockfile. The exact type-only prerequisite proposal and protected-CSP exception are in `evidence/gate-review.txt`. No rule was disabled or weakened, and no dependency was changed.

## Changes and stop reason

Application fixes applied: **0**. Application fix commits: **none**. Source work is stopped by the required red-check gate, not by the ten-fix cap or a claim that P01 is cosmetic. Evidence and reviewable proposals are preserved for resumption after the prerequisite decision.

Evidence review: an independent Codex review checked the main finding, browser-only correction, form result, metrics, limits, and unapplied status against artifacts. The final tap-target row is supported by the saved live element geometry and screenshot.

No push, deploy, merge, environment change, DNS change, CSP change, tracking change, price change, or owner-held city-page edit was performed. The pre-existing untracked weekly optimization handoff was left alone.