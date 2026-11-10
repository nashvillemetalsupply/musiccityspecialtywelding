# Final production review — November 10, 2026

Branch: `palette-final`. Review started at `9cf0f01`, including the `chat-audit`
merge. The comparison is the complete `git diff origin/main...HEAD`, with
`origin/main` fixed at `69c9fc5e05a1d98c642ccef1eb3a2bf8a6dcd59f`.
All work is local. No push or deployment was performed.

## Ruling and scope

The owner's current request, `BRAND-BRIEF.md` §Palette, and the Palette section
of `docs/PAGE-COHESION-PASS.md` govern this review. The approved brown/orange
Shop Wall palette takes precedence over the rejected Carbon/Bone/Steel/Arc
palette and the espresso/tan interpretation. Existing typography, spacing,
flat button geometry and verified business copy remain the baseline.

The review covers the complete branch diff, the home page, all seven service
routes, `/service-areas`, and the assistant open and closed at 390px and
1440px. There are no individual city routes in this repository. Standards and
spec reviews were performed independently; their findings are recorded below.

## Findings and fixes

Five defects were found and fixed.

1. **Assistant guards could miss claims assembled by sanitization.** Inline
   HTML or Markdown could split an invented price, phone number, credential,
   insurance assertion or unsafe towing approval before the guard inspected
   it. Removing the markup then assembled the customer-visible claim. The
   reply pipeline now strips money again after normalization, checks both raw
   and visible text for foreign phone numbers, and applies the expert concern
   guard to the visible reply as well. Regression cases cover split prices,
   credentials, insurance, towing claims and unapproved contact destinations.
   Those cases return the approved human route with phone and quote-form links.

2. **Desktop controls exceeded the current CTA ruling.** The header repeated
   Ask the shop, and the floating assistant launcher repeated Call the shop.
   The header now contains only the phone CTA; the floating launcher contains
   only the clearly labeled Ask the shop button. The launcher is retained as
   the requested chat entry. The dialog's direct call route remains available
   when chat is open. Interior action groups retain the accepted CTA trim:
   three on home (hero, post-process and closing contact section), and two on
   each service page and service areas (hero and closing). The mobile sticky
   Call/Ask pair remains. Rendered component tests assert the header and
   launcher counts, in-content placements, both chat flag branches and the
   retained dialog call route.

3. **The focused chat textarea's ring was nearly invisible.** Its ink
   `currentColor` outline sat outside the paper field, against the brown
   composer, with only 1.024:1 contrast. The ring now sits inside the paper
   field, retaining the required `currentColor` treatment and providing
   14.50–16.21:1 contrast across the approved paper endpoints.

4. **The chat quote-form link lost its destination scroll.** Browser testing
   showed the URL changing to `/#contact` and the dialog closing, followed by
   focus restoration scrolling back to the hero. Quote-form navigation now
   skips launcher focus restoration; ordinary dismissal still restores the
   invoking control with `preventScroll`. The same navigation behavior applies
   to replies and the static error/turn-limit fallback. The fallback uses a
   native anchor like the reply link: the prior Next.js link could scroll to
   the form while leaving the keyboard's next tab back at the hero.

5. **Mobile closing Call labels wrapped inconsistently.** On service and
   service-area pages the closing action row shrank to its content width,
   putting Call the shop on two lines while the hero's matching action fit on
   one. The closing row now uses the available width below 600px, preserving
   the shared button geometry and single-line labels at the requested 390px.

The standards review identified the normalization gap in item 1. The spec
review identified items 2 and 3; rendered review identified items 4 and 5.
No additional actionable source-level
standards or spec defect remained after those fixes. This conclusion does not
substitute for the rendered and final validation results below.

## Assistant evidence and limits

The frozen 143-question bank was replayed against the repaired application
through the real chat POST handler with the existing isolated database and
provider fixtures. `.scratch/final-review/assistant-audit-replay.json` records
42 sourced answers, 101 handoffs, zero WRONG and zero DEAD END results. The
new normalization regression cases supplement that bank.

These are fixture-backed application checks, not 143 live model calls and
not a certification of unrestricted model accuracy. The limitations in
`docs/ASSISTANT-AUDIT-2026-11-10.md` still apply: live Sales inbox receipt,
owner SMS/push delivery and unseen model answers are not established by this
local review. No production provider or live-model assurance is claimed.
Unverified prices, payment policies, operating hours, credentials and current
availability continue to route to the shop rather than becoming site facts.

## Rendered review

Screenshots and browser measurements are in
`C:/Users/Owner/AppData/Local/Temp/mcsw-final-review-2026-11-10`, resolved from
Node's `os.tmpdir()`. The matrix covers `/`, `/service-areas`, and all seven
`/services/` slugs: `mobile-welding`, `trailer-welding-repair`, `gate-repair`,
`equipment-repair`, `architectural-welding`, `custom-fabrication`, and
`custom-metal-products`, each at 390×844 and 1440×1000.

Every section was scrolled into view before capture. After that pass,
`content-visibility` was expanded for complete full-page screenshots. The
full pages were visually inspected, with viewport captures and native-width
service-page slices used for readable inspection from hero through footer.
Additional screenshots show chat over night and paper, the mobile sticky
bar at the footer, normal and turn-limit conversations, and quote navigation.

- The approved wall/plank stripes and radial lamp pools paint correctly.
  Hiding the section pseudo-elements changes 51,641 mobile pixels and
  297,495 desktop pixels in the hero comparison, confirming a painted glow
  rather than merely a declared gradient. Paper, ink, fire and neon roles
  match the ruling; the existing logo colors remain confined to the mark.
- The complete matrix has zero page or hydration errors, horizontal
  overflow, broken images, sub-44px `.ms-button` targets, or automated
  WCAG A/AA violations in closed-page and open-chat scans. Four additional
  normal/turn-limit chat scans also pass. Gradient-aware checks of 40
  distinct computed text/pseudo/placeholder color combinations find zero
  contrast failures or colors outside the palette; the lowest measured
  text ratio is 4.842:1. Tests also cover both paper endpoints and maximum
  lamp glow over every dark stripe endpoint.
- Headings fit, body copy remains readable, section spacing is coherent,
  and the Southern shop character survives the palette restoration. The
  closing-button wrap was treated as a reproducible geometry defect, not
  an invitation to redesign the accepted typography.
- Header phone, in-page action groups, desktop Ask launcher and mobile
  Call/Ask bar remain distinct, usable controls. Footer content clears the
  mobile bar. Desktop footer text and link centers remain unobstructed;
  the launcher intersects only the bottom 7.95px of two 44px footer link
  boxes, below their text, leaving their centers and usable targets clear.
- Every route returns 200, retains one H1, its own title/description and
  canonical, and valid JSON-LD. Service pages retain their Service,
  Breadcrumb and FAQ data alongside the business schema. No metadata,
  image source, responsive sizing, measurement ID or lead-conversion code
  was changed by this review.

The initial capture overlapped source edits and produced mixed server/client
navigation with hydration errors. Those captures were discarded and replaced
after a frozen-source production build. A hardcoded phone in the browser
fixture also initially differed from the no-environment fallback number;
inspection confirmed the real API and widget both use `getShopPhone()`, and
the fixture was corrected. These were harness issues, not product defects.
All browser POSTs were blocked; no quote or customer notification was sent.

The final navigation replay passes all 16 combinations of home/service
origin, 390px/1440px, mouse/keyboard, and normal-reply/turn-limit fallback.
The dialog closes, contact sits 80–100px below the viewport top, and the
next Tab stays in the contact section. Ordinary Escape still restores the
invoking control. At 390px the corrected service closing buttons both
measure 173×48px with single-line labels.

Four final cold-browser samples at 390×844, 200 KB/s download, 150ms latency,
4× CPU slowdown and normal motion measured LCP of 2.652, 3.168, 2.204 and
1.704 seconds: range 1.704–3.168s, median 2.428s. CLS was 0.001328 in every
sample. The hero image remained LCP, transferring 9,223 bytes in 405–449ms;
total transferred bytes were identical at 252,429. `perf-final.json` retains
all four samples, including the slow one. This is a local synthetic result,
not a field score or evidence of a timing improvement. The spread crosses
2.5s and does not consistently meet the craft guide's 2s target; no asset,
bundle or layout-shift regression was found. Exact LCP phase attribution was
not recorded, so the timing spread is not assigned to a specific cause.

## Verification

| Check | Result |
| --- | --- |
| Focused widget and public CTA tests after navigation fixes | 27 passed, zero failed |
| New public palette regression checks | Six passed |
| Frozen assistant bank replay | 143 acceptable: 42 sourced answers, 101 handoffs, zero WRONG/DEAD END |
| Final full suite after all fixes and new tests | 1,517 passed, zero failed, three existing opt-in skips (1,520 total), Node 22.23.2 |
| Final `tsc --noEmit` | Passed, exit 0 |
| Final repository ESLint | Passed, exit 0 (`eslint . --ignore-pattern '.scratch/**'`; only temporary review scripts and recovery snapshots excluded) |
| Final production build and bundle budgets | `next build --webpack` passed; budget script passed: home 622,504 / 648,316 bytes; board 725,321 / 817,538 bytes |

The palette checks protect the approved token values, permitted color use,
surface treatments and accessible color combinations. Computed styles,
pixel comparisons and screenshot inspection verify the actual rendered cascade.

Final command logs are `.scratch/final-review/suite-release.log`,
`tsc-release.log` and `eslint-release.log`; the production build log is
`.scratch/final-review-build-final.log`. The suite uses
`node --experimental-strip-types --test --test-concurrency=4 'scripts/**/*.test.mjs'`.
The three skipped tests are the opt-in live model evaluation and two
real-database persistence/concurrency tests requiring `DATABASE_URL`.
No assertions were weakened to make the final checks pass.

The build uses the documented webpack path because this checkout's external
`node_modules` junction is incompatible with its Turbopack filesystem root.
No dependency or deployment configuration was changed to work around it.

Release decision: **ship yes**. Five verified defects are fixed, all required
local checks pass, and no blocker remains within this review's scope. The
commit containing this report is local on `palette-final`; nothing was pushed
or deployed. Live provider delivery and unrestricted model behavior remain
the explicitly stated limits of this source-and-render review.
