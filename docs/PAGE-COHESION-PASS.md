# Public page cohesion pass

Date: November 10, 2026. Branch: `golive`. Local commit only; no push or deployment.

## Standard and recovery

Reviewed `BRAND-BRIEF.md`, the MAINSTREET conversion/craft/stack references,
`docs/homepage-final-polish-2026-08-20.md`, and repository design notes. The
parked operations redesign in `docs/design.md` is outside this public-site pass.
The existing Barlow display face follows the accepted homepage polish; `swap`
keeps that face consistent when a cold load misses the optional-font window. Body and
utility type remain the existing local stacks. No new fonts or dependencies.

Recovery point: `ce2a6f5`. A complete local source snapshot is available at
`.scratch/page-cohesion/before-ce2a6f5.zip`.

## Before and after

| Section | Before | After |
| --- | --- | --- |
| Shared visual system | Carbon/Bone base competed with brown wood, pegboard, neon, blue/red badges, tilted paper and multiple orange gradients. | Carbon canvas, Bone text/paper, legible neutral text and rules, flat Arc call buttons. Straight image frames let the actual work carry the character. |
| Header and menu | Serif brand lettering, mixed CTA wording, phone-only desktop action and different contact labels. | Shared display lettering, readable sentence-case navigation, Call the shop primary and Ask the shop secondary. Mobile menu retains Escape and navigation close behavior. |
| Hero | Large wooden phone plank and Show us the job used different action treatments. | One standard Call/Ask pair, phone detail below it, clear Nashville/mobile/fabrication message and the existing real shop photo. |
| Shop facts | Decorative color variants and a Call sticker competed with the actionable call button. | Quiet facts about shop/mobile work, metals and Middle Tennessee. |
| Work/proof | Tilted polaroids, staged wall props, longer sales language and a separate Facebook sign. | Aligned photos, solid caption fields, shorter proof copy, subordinate Facebook link and a Call/Ask pair. |
| Services | Repeated sales lines, differing heading wraps and a telephone button labeled Ask the shop. | Plain job descriptions, one heading scale, consistent image treatment and the proper Call/Ask pair after capabilities. Existing ad-verified services stay visible. |
| We get it | Handwritten styling and decorative scene treatments competed with the message. | One Bone transition, Carbon headline and a short explanation of the next step. |
| Process | Pinned notes, decorative magnets and another large phone treatment. | Three aligned steps, readable text, one shared Call/Ask pair. |
| Customer page example | Ready Friday, promised-date language, a named/timestamped photo and conflicting stages looked like actual commitments. | Clearly labeled example, consistent In progress status, no date or arrival promise, neutral paper and standard actions. |
| Territory | Broad everywhere-else wording and tilted city stickers. | Lebanon base, Greater Nashville/Middle Tennessee wording, consistent address and flat city labels. |
| FAQ | Clipboard props, mixed typography and repetitive answers. | Simple rules, readable disclosure controls and shorter answers consistent with call-first intake. FAQ schema uses the same answers. |
| Contact | Decorative work-order form and oversized phone treatment. | Job details heading, standard call action, separate phone detail, readable Bone form and secondary submit button. Required fields, photo upload, consent, honeypot, intake and accepted-only conversions remain intact. |
| Before footer | No uniform closing pair. | Call/Ask pair after the form; footer repeats the same actions alongside business details. |
| Footer | Different type treatment, email casing and no shared action pair. | Shared type, Call/Ask actions, Sales@musiccityspecialtywelding.com, full Lebanon address and verified coverage. |
| Mobile sticky bar | Call now and Quote; differing gradients and inherited colors. | Call the shop and Ask the shop, Arc/Carbon primary, outlined secondary, safe-area spacing and bottom page clearance. Hidden bar remains inert. |
| Assistant | Separate button metrics/colors and focus always returned to the desktop launcher. | Same action sizing and colors; closing returns focus to the invoking control. Mobile continues using the sticky bar. |
| All seven service pages | Mixed Call/Show/Send labels, lengthy intros and old closing styles. | Shared actions after hero, scope, customer-page explanation and closing content; consistent type, spacing and palette. Each retains its specific work, FAQs, schema, related services and quote form. |
| Service areas | Mixed action labels and speculative farther-travel copy. | Same action pair after hero, city list and travel explanation, verified cities/address and plain scope wording. |

## Implementation boundaries

- `components/shop-actions.tsx` owns Call the shop / Ask the shop. Every call
  receives the existing phone helper's URL. No phone number was hardcoded.
- Ask the shop dispatches `ms:open-assistant` only when
  `NEXT_PUBLIC_ASSISTANT_CHAT === "1"`; otherwise it links to `/#contact`.
- `app/page-cohesion.css` owns active public colors and action treatments.
  Retained historical colors were extracted without changing their values into
  `styles/public-color-tokens.css`. This preserves customer-page/operations
  history while removing hexadecimal literals from rendered declarations.
  The strict historical CSS test still compares every byte after resolving
  those exact token aliases.
- The assistant derives capability vocabulary from public copy. Keeping
  “fixed where it sits” preserves recognition of existing repair questions.
  No assistant routing or backend code changed.
- No prices, new work claims, credentials, guarantees or availability promises
  were added. Phone routing and fallback policy remain unchanged.

## Verification

- Full suite: **1,474 passed, 3 skipped, 0 failed** (1,477 total), using installed
  Node 22. No behavioral assertions were weakened to accommodate the copy pass.
- `npx tsc --noEmit`: passed. Full `eslint .`: passed.
- Production build: passed with `next build --webpack`, followed by the exact
  `scripts/bundle-budget.mjs` check. Default `npm run build` hit the existing
  Turbopack limitation: this worktree's `node_modules` junction points outside its
  filesystem root. No dependency or deployment configuration was changed.
- Bundle budgets: home **622,421 / 648,316 bytes**; board
  **725,238 / 817,538 bytes**. Assistant enabled in this local build.
- **20 production viewport checks:** home at 320, 390, 768 and 1440px; all seven
  service pages and service areas at 390 and 1440px. Every section was scrolled
  into view. Zero horizontal overflow, heading clipping, targets below 44px,
  browser errors or automated WCAG A/AA violations. Full-page captures force
  already-visited lazy sections visible so offscreen screenshot rendering cannot
  substitute blank placeholders for page content.
- Assistant dialog at 390 and 1440px: opens from Ask the shop, Escape closes it,
  focus returns to the invoking control, and dialog AA checks pass. Existing
  unit tests verify both exact flag branches, including `/#contact` fallback.
- Mobile menu opens/closes with Escape and navigation. FAQ toggles work.
  Empty-form submission stays on native required-field validation. **Zero quote
  or assistant POSTs** were made during interaction checks.
- At the mobile page bottom, footer content ends at 659.64px and the sticky bar
  starts at 787px in an 844px viewport. Safe-area padding remains included.
- Primary keyboard focus is inset Carbon on Arc; secondary focus follows its
  contrasting text color. The service-closing fallback link settles to Carbon
  on Bone on hover; checked in Chromium after the transition.
- Two local cold-browser samples at 390px, 200 KB/s download, 150ms latency and
  4x CPU slowdown measured LCP **2.224–2.268s**, CLS **0**; the hero image was LCP.
  This is above MAINSTREET's 2s target under that synthetic setup; no claim
  of a field-performance improvement is made. Real production network and lead
  provider delivery were outside this local, no-deploy pass.

Local logs, measurements and screenshots are in `.scratch/page-cohesion/`,
including `browser-results.json`, `interactions.json`, `full-suite-final.log`,
`typecheck-final.log`, `eslint-final.log`, `build-webpack.log` and the full-page
`home-390.png` / `home-1440.png` captures. No server or acquisition settings were
changed. No push or deployment was performed.

## CTA trim — November 10, 2026

Branch: `cta-trim`. Baseline: `1e7a23e`, including the actions introduced in
`51d0ea0`. Local commit only; no push or deployment.

Home now has three in-page Call the shop / Ask the shop pairs: the hero,
after the process steps (following services), and beside the quote form before
the footer. Removed the work/proof, capabilities, customer-example, separate
after-form, and footer actions. The customer-page example retains its wording
as plain text. Each service page and service areas retain only hero and closing
pairs. Header, mobile menu, `.ms-mobile-cta`, and assistant widget are unchanged.
Existing plain phone links in the form fallback and footer remain.

Counts below come from parsed **production HTML**, excluding only the header
and `.ms-mobile-cta`. Both builds enable `NEXT_PUBLIC_ASSISTANT_CHAT=1`. Each
`tel:` anchor counts once; Ask counts actual links/buttons labeled Ask the shop.
Hydration payload strings and copy mentions do not count. The unchanged assistant
launcher/dialog contributes **2 tel links and 1 Ask button** to every row,
including its hidden dialog link.

| Page | Tel before | Tel after | Ask before | Ask after |
| --- | ---: | ---: | ---: | ---: |
| `/` | 12 | 7 | 8 | 4 |
| `/services/mobile-welding` | 10 | 6 | 6 | 3 |
| `/services/trailer-welding-repair` | 10 | 6 | 6 | 3 |
| `/services/gate-repair` | 10 | 6 | 6 | 3 |
| `/services/equipment-repair` | 10 | 6 | 6 | 3 |
| `/services/architectural-welding` | 10 | 6 | 6 | 3 |
| `/services/custom-fabrication` | 10 | 6 | 6 | 3 |
| `/services/custom-metal-products` | 10 | 6 | 6 | 3 |
| `/service-areas` | 7 | 5 | 5 | 3 |

Within main content plus footer, home changes from **10 tel / 7 Ask** to
**5 tel / 3 Ask** (3 call buttons plus 2 plain phone links). Each service changes
from **8 / 5** to **4 / 2**; service areas changes from **5 / 4** to **3 / 2**.
The unchanged header/menu contributes 2 tel / 2 Ask, and the unchanged sticky
bar contributes 1 tel / 1 Ask. Thus the baseline whole home HTML has 15 tel links.

Removed unused action-wrapper CSS from the cohesion and homepage polish sheets.
Kept shared action components and historical CSS still covered by preservation
tests. The quote form's closing action group keeps the original top spacing and
aligns both controls together. No other copy, colors, or layout changed.

Verification and built-HTML measurements are recorded in
`.scratch/cta-trim/`. Rendered regression tests cover all seven service routes,
home, and service areas with the assistant both enabled and disabled.

- Full final suite: **1,492 passed, 3 skipped, 0 failed** (1,495 total), Node
  24.22.1. `npx tsc --noEmit` and full `npx eslint .`: passed.
- Production build: `npx next build --webpack` passed, followed by
  `node scripts/bundle-budget.mjs`: home **622,536 / 648,316 bytes**, board
  **725,353 / 817,538 bytes**. Default `npm run build` encounters the same
  pre-existing Turbopack external-dependency-junction limitation documented above.
- All nine public route HTML files were counted before/after. Header/menu and
  sticky counts match exactly on every route.
- Six production viewport checks: home, mobile welding, and service areas at
  390px and 1440px. Expected action-group counts, aligned Call/Ask controls,
  targets at least 44px tall, and no horizontal overflow. Home contact screenshots
  visually checked at both widths. No form submissions or outbound messages.

## Palette

November 10, 2026, `palette-final`: the owner-approved Fable ruling supersedes
both the rejected brief palette and the espresso/tan interpretation above.
`BRAND-BRIEF.md` §Palette now records the complete approved role/hex/usage table.
This pass preserves today's typography, spacing, flat 1px button geometry,
44px action targets, copy and CTA trim.

`app/page-cohesion.css :root` is the single active public palette. Existing
`--mx-*` and `--sw-*` roles alias it; the historical preservation stylesheet and
its tokens remain intact. Night is `#100c08`; work, get-it, territory, contact,
subscope and subfaq use brown plank `#241809`. Hero/services use the approved
wall stripes; brown sections use the approved plank stripes. Every main section
has the top radial lamp pool, `rgba(255,180,107,.08)`. Dark body text is enamel,
headlines chalk, secondary text enamel-dark, and dark rules line-bone.

Fire `#ff8a2a` restores call actions, accent words and seams; neon `#ffb46b`
restores the hero sign, footer phone and primary hover. Buttons use flat fire
with button ink `#1b0f02`, without the historical gradient foot. Paper surfaces
use `#fdf9ec` through `#f4ecd8`, ink/ink-muted text, red `#b3402a` accents and
paper-rule borders. Red text is confined to those paper endpoints; fire is not
paper text. Focus rings retain `currentColor`.

Chat uses night/enamel for launcher, header and frame; paper/ink for the
messages pane; fire/ink for customer bubbles; fire/button ink for send/call;
and surface brown for the composer. The old chat orange is not restored.

The legacy wrapper noise overlay is disabled so it cannot introduce grayscale
over the approved paper/text pairs; the wall/plank stripes and section lamp
pseudos remain. The optional consent label explicitly uses ink-muted rather
than inheriting a border token. The existing aria-hidden 404 numeral retains
its decorative rule tone; the fire kicker has the ticket's surface behind it
to prevent the numeral from reducing its text contrast. Dark ticket rules use
line-bone. These corrections do not change dimensions or content.

### Historical comparison

Recovery snapshot: `.scratch/palette-final/before-69c9fc5.zip`.
The unmodified historical render is `51d0ea0^` (`ce2a6f5`). Its `globals.css`
contains later “walls go steel” and “FINAL PUBLIC UNIT” overrides after SHOP
WALL. Consequently the owner's explicit brown/night table and that commit's
effective rendered palette are not identical. The explicit ruling wins;
historical differences are recorded rather than reported as an exact match.

The strict comparison requires the section background/grain, `::before` glow
and sampled accents all to match the unmodified historical render. At both
requested widths, every section below differs in at least one of those fields.
The historical lamp pseudo uses alpha `.10`; the approved ruling uses `.08`.
Historical work/get-it/territory use steel-panel colors, contact has another
steel-panel set, services has pegboard, and the customer example uses gray steel.
Today's typography, spacing and CTA counts intentionally remain in the result.

| Section | Approved final layer | Exact pre-today render match |
| --- | --- | --- |
| Header | night | no |
| Hero | night + wall grain + glow | no |
| Work | plank + plank grain + glow | no |
| Services | night + wall grain + glow | no |
| Get-it | plank + plank grain + glow | no |
| Process | night + glow; paper cards | no |
| Customer example | night + glow; paper example | no |
| Territory | plank + plank grain + glow; paper map | no |
| FAQ | night + glow; paper disclosures | no |
| Contact | plank + plank grain + glow; paper form | no |
| Service hero | night + glow | no |
| Service scope | plank + plank grain + glow | no |
| Service plan | night + glow; raised dark cards | no |
| Service FAQ | plank + plank grain + glow | no |
| Service closing | night + glow | no |
| Area hero | night + glow | no |
| Area cities | plank + plank grain + glow; paper city links | no |
| Area travel | night + glow | no |
| Footer | night; neon phone | no |
| Sticky bar | night; fire primary, surface secondary | no |
| Assistant | night/enamel shell, paper/ink pane, fire actions/customer bubble | no |

### Verification

- Full suite: **1,492 passed, 3 skipped, 0 failed** (1,495 total), Node
  **22.23.2**. The final public CSS/chat/CTA regression run passed **40/40**.
- `tsc --noEmit`: passed. Full-source ESLint: passed, excluding only the
  temporary `.scratch` historical checkout from this verification run.
- Default `npm run build` reproduced the pre-existing Turbopack external
  `node_modules` junction limitation. The final `next build --webpack` passed,
  including TypeScript and static generation. Exact bundle check passed: home
  **622,536 / 648,316 bytes**; board **725,353 / 817,538 bytes**.
- Approved-role contrast calculations include enamel/night **15.69:1**,
  enamel/plank **13.99:1**, muted/surface **10.59:1**, chalk/plank **14.53:1**,
  button ink/fire **7.99:1**, button ink/neon **10.75:1**, customer ink/fire
  **7.25:1**, red/paper **4.84–5.41:1**, and muted ink/paper **8.08:1** minimum.

Historical production captures are complete for all nine routes at 390px and
1440px, plus home at 320px and 768px. Every section was visited before capture.
Those 20 viewports have zero automated WCAG A/AA violations, overflow,
undersized action targets or browser errors. Screenshots and computed-color
reports are under `os.tmpdir()/mcsw-palette-final/pre-today/`; comparison contact
sheets are in the sibling `sheets/` directory. Local command logs are in
`.scratch/palette-final/`.

The final production rebuild was captured again after all source corrections:

- **20 final page viewports:** every requested route at 390px and 1440px, plus
  home at 320px and 768px. Zero automated WCAG A/AA violations, horizontal
  overflow, action targets below 44px or browser errors. All sections were
  visited before full-page capture; real images and headings were inspected.
- **45 distinct effective text pairs:** zero contrast failures, colors outside
  the approved palette or unresolved image-backed text pairs. The audit includes
  open FAQ/menu text, placeholders, generated content, hover states, gradient
  endpoints and the maximum section glow. Red remains on approved paper;
  minimum normal-text contrast is **4.842:1**. Focus remains `currentColor`.
- Assistant normal and turn-limit states at 390px and 1440px: zero automated
  A/AA violations; nine effective chat text pairs pass. Customer bubble, send,
  call, paper links, composer and keyboard focus were checked; Escape closes
  the dialog. No quote or assistant POSTs were made.
- Additional 404 captures at 390px and 1440px pass automated AA and overflow
  checks. Visual overlap was checked explicitly: the kicker's surface mask
  preserves normal-text contrast, and chalk over the decorative rule-tone
  numeral is **4.397:1**, above the **3:1** large-headline requirement.
- The unmodified historical render and the final ruling are compared across
  **182 section/viewport entries** at the 18 requested viewports. **0/182**
  match all three strict background/glow/accent fields. The per-section table
  above records those results; the approved ruling is implemented directly.
- Fresh final screenshots/data: `os.tmpdir()/mcsw-palette-final/final/`.
  Chat and 404 captures are in sibling `chat/` and `notfound/` directories;
  the complete contrast/comparison report is `analysis.json` in their parent.
  Prior captures remain under `final-before-role-fix/` for traceability.

No push or deployment is authorized or performed.
