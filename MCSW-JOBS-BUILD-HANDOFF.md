# MCSW Jobs — Full-Build Handoff

Prepared: 2026-08-10
Status: production implementation complete, verified, and deployed to `https://musiccityspecialtywelding.com`.

## Final production record — 2026-08-10

The approved Signal + Chivo + MCSW Brand system now runs on `/ops`. The CRM red is `#b34513`; the attention surface is `#fff1eb`.

Home dashboard completion:

- Owner-only `Today’s Leads` sits directly above Active Jobs.
- It reports the current Central-time day’s total, leads needing a first response, contacted leads, booked leads, median first response, and a bounded top-six-plus-Other source ledger.
- Google Ads attribution prefers `gclid` and paid Google UTM evidence. Phone, Walk-in, Text, Email, Website, Referral, Repeat customer, Unknown, and honest fallback sources remain distinct.
- Test and spam records never enter the tally. No ad spend, ROI, or revenue claim is invented.
- Active Jobs has no detached middle status column. `Booked` / `Customer contacted` appears beside the customer or company name in brand red. `In Shop` / `Waiting` leads the job description.
- Row actions are direct and ordered `Call`, consent-gated `Text`, `Open`. Call uses tracked calling when Twilio Voice is ready and the device phone link otherwise. Text is absent unless SMS is configured and immutable consent resolves to `granted`.
- Mobile keeps the same information order and stacks actions without horizontal overflow; desktop keeps one compact two-column row.

Release verification:

- `npm run typecheck`: pass
- `npm run lint`: pass
- full Shop Brain suite: 132 / 132 pass after the dashboard and contact work
- final row-layout regression suite: 15 / 15 pass
- local `npm run build`: pass
- Vercel production build: pass on pinned Next.js `16.2.12`
- production alias: `https://musiccityspecialtywelding.com`

Provider activation remains intentionally separate from code completion. Keep customer Text hidden until Twilio A2P approval and production flags are enabled; keep the existing call ads and old number untouched until the documented cutover is explicitly approved.

Operator phone-login activation is separate from customer messaging. Twilio Verify uses `TWILIO_VERIFY_SERVICE_SID` plus account credentials, preserves a durable pre-send intent, validates the provider-approved code before session creation, and does not enable customer SMS. Philippe Auguste and TJ Harahan are active owner operators ending `4910` and `8197`, respectively. The logged-out `/ops` and `/ops/install` screens share the same operator picker and text-code readiness.

Final navigation refinement: the authenticated and login headers show the MCSW logo without a redundant `Jobs` label. Authenticated navigation uses an accessible animated hamburger-to-X control and the panel title `Menu`. Login name cards stack `Sign in` or `Selected` beneath the owner name so the action never collides with long names on desktop or mobile.

## Start here for future maintenance

1. Read this file completely.
2. Treat `design.md` and production `/ops` as the locked system. The preview at `/design-preview/mcsw-jobs-hybrid-directions` remains design provenance, not a second product.
3. Read `SHOP-BRAIN-PLAN.md` and `SHOP-BRAIN-SETUP.md` before provider, database, or workflow changes.
4. Preserve reliability, privacy, role, receipt, promise, payment, consent, upload, and provider gates.
5. Run typecheck, lint, the full focused suite, and a production build before release.

## Approved design

Approved: **Signal layout + Chivo typography + MCSW Brand treatment**.

- Preview: `http://localhost:3030/design-preview/mcsw-jobs-hybrid-directions`
- Default preview tab: `Brand`
- Comparison tabs: `Red`, `Amber`, `Green`, `Brand`
- All four tabs use exactly the same component geometry, spacing, type, radii, and behavior. Color/brand treatment is the only variable.
- Preview implementation:
  - `app/design-preview/mcsw-jobs-hybrid-directions/page.tsx`
  - `app/design-preview/mcsw-jobs-hybrid-directions/hybrid-client.tsx`
  - `app/design-preview/mcsw-jobs-hybrid-directions/hybrid.css`
- Production `/ops` pages were intentionally not rebuilt during this design phase.

### Why this is the recommendation

The Signal structure is faster and clearer than the earlier dashboard concepts. It does not resemble a generic card dashboard: the phone call itself becomes an editable job sentence, there is one next action, and the job list is a searchable/paged index. The Brand treatment adds a recognizable MCSW identity without forcing the marketing site's dark coal/bone treatment across every working surface.

Brand treatment:

- Header: website coal `#12100d`
- Real current MCS logo plus visible `Jobs` label
- Working surfaces: crisp white/cool gray, not tan
- Primary action: original CRM red-orange `#b34513` with white text (5.56:1 contrast)
- Bright website orange `#e8611c`: focus and small emphasis only
- Attention surface: very light orange tint `#fff1eb`
- Main ink: `#171a1d`; muted ink: `#59626b`
- Strong control rule: `#838c94` for older-eye/non-text contrast
- Chivo variable font throughout
- 48 px minimum operational controls; 14 px minimum visible product text

## Product thesis

**The call becomes the job.** Simple on the surface, rigorous underneath.

Daily owner workflow:

1. A phone call opens or pre-fills the intake.
2. Philippe checks the name, phone, and need.
3. He optionally speaks a correction or opens More details.
4. He taps `Save Job`.
5. He handles one `Next move`.
6. He searches or pages through Active Jobs.

Philippe wears glasses, dislikes reading, and dislikes admin. Every page must optimize for quick recognition, large reliable touch targets, plain language, and minimal decisions.

## Locked home structure

### Header

- 56–64 px normal-flow header; no oversized mast and no fixed bottom dock.
- Brand direction uses the real MCS logo + `Jobs`, Philippe's first name, and `More`.
- At extreme Android text scaling, stack secondary controls or omit Philippe before shrinking type.

### Intake

- `Phone call` is the default and primary path.
- Incoming call data pre-fills customer, phone, and need.
- A quiet `Walk-in` action switches the same form to a blank walk-in intake; it is not an equal-weight default selector.
- Walk-in requires customer/name and need; phone is explicitly `Phone (optional)`.
- Blank walk-ins cannot save.
- `Cancel` returns to Phone call.
- `Not a job` creates a reversible cleared state; `Undo` restores it.
- `Speak` is optional voice correction, never required.
- `More details` is collapsed by default and reveals only Service and How they found us.
- `Save Job` is the only solid primary action.
- Saved output must derive from entered data; never show hard-coded customer copy.

### Needs Attention

- One `Next move` card on home, with one primary action and `View 3`.
- A restrained light attention tint separates it from Active Jobs.
- No status dots, noisy badges, or equal-priority task piles.

### Active Jobs

- Search + filters + five rows per page in the locked preview. Production can show up to six rows per the product plan, but must remain bounded and paged.
- Names and needs receive the full mobile row width; the action sits on the next grid line with state.
- Sample data is untruncated at 320 px. Longer real data may use a deliberate two-line need with ellipsis, never collision or horizontal scroll.
- Desktop uses dense horizontal rows.
- Results summary has 16 px above and 12 px below.
- Mobile pagination uses its own summary row above equal Previous/Next controls; desktop returns to one horizontal row.

## Visual and interaction rules

- Typography: Chivo only; do not substitute Inter, system UI, or another generic SaaS face.
- No gradients, glass effects, decorative icons, fake phone frames, status dots, oversized headlines, or nested card clutter.
- Use the named 4 px spacing scale. No arbitrary spacing added during page-by-page work.
- All buttons and adjacent inputs share a 48 px base height.
- Clickable labels never wrap at 320–1920 px.
- No horizontal overflow at 320, 360, 375, 390, 414, 768, 1280, or 1440 px.
- Headings remain one clean line where their copy is fixed. Dynamic list data gets controlled wrapping/ellipsis.
- Focus rings are immediate and never clipped by segmented-control containers.
- Intake underlines are neutral at rest and turn orange on focus; orange remains a signal rather than constant decoration.
- Side-effect buttons disable while submitting, cancel when a touch becomes a scroll gesture, and submit idempotently.
- Reduced motion is honored. Motion is restrained and purposeful; no decorative animation.
- No fixed dock or large reserved bottom padding. The existing ShopDock becomes an on-demand panel under More.

## Production information architecture

Rebuild all production surfaces with the locked system, not only the home page:

- `/ops` home
- intake states and call/walk-in entry
- job/work-order detail
- accounts and regular customers
- Calls & Messages / Updates / Promises
- Customer Page controls and customer-facing `/j/[token]`
- install page
- More menu and on-demand advanced tools
- owner analytics
- settings, auth, empty/loading/error/offline states

Mobile job detail order:

1. Compact job header
2. Customer and contact actions
3. Job summary and photos
4. Promises when present
5. Calls & Messages
6. Customer Page
7. Collapsed Job Details
8. Swipe to Finish
9. Recent Activity

History rules:

- Show three recent human-readable events.
- Full Record is paged at 25 items.
- Preserve role-safe evidence links beside AI-derived facts without exposing internal receipt vocabulary.

## Plain-language vocabulary

- The Works / The Wall → MCSW Jobs / Jobs
- Write up a call or walk-in → Add Job
- Needs You Now → Needs Attention
- The Wire / Receipt Cabinet → Updates / All Updates
- The Spike → Calls & Messages
- Promise Rack / Promise Tags → Promises
- Setup Jig → Job Summary
- Command Bench / drawers → Job Details / Contact / Price & Invoice / Status & Notes
- Story So Far / Source Ledger → Recent Activity / Full Record
- Handset / Jobsite Radio → Ask Jobs / Morning Brief
- GLASS / traveler → Customer Page / Job Status
- Regulars' Rail → Regular Customers
- Pull → Search or View
- Slam DONE → Swipe to Finish

Technical routes, table names, bearer tokens, and internal receipt terms stay unchanged.

## Owner analytics — required

The owner liked the analytics dashboard. Include it in the full build under `More`, not on the daily home surface.

Show useful, accurate operational measures only:

- leads received
- booked jobs / conversion
- revenue and paid/unpaid totals
- response speed
- lead source
- period-over-period trend

Use readable comparisons and compact tables before decorative charts. No fabricated metrics, vanity stats, or noisy real-time surveillance. Owner-only financial data must remain role protected.

## Completion gesture

Replace hold-to-slam with `Swipe to Finish`:

- vertical movement cancels and preserves page scrolling
- release below 70% resets
- crossing 70% submits exactly once
- preserve atomic completion, addenda, promise closing, caption separation, and 10-second undo
- provide an equivalent deliberate keyboard/assistive path

## Customer uploads

Add `Add photos or files` to every active Customer Page.

- Types: JPEG, PNG, WebP, HEIC/HEIF, PDF, DXF, DWG, STEP/STP, IGES/IGS
- Limits: 10 files/batch; 20 MB/file; 30 files and 100 MB/link/day
- Direct-to-private Vercel Blob upload; do not proxy large bodies through Vercel functions
- Persist intent before token, deterministic private pathname, server verification, idempotent callback/finalization, stale reconciliation
- `glass_uploads` states: pending, uploading, uploaded, projecting, stored, failed, unknown
- Visible states: Uploading, Filing, Added, Retry, or honest failure
- Raster preview only through authenticated scoped routes
- Documents/CAD download with `nosniff` and sandbox headers; never render SVG/HTML inline
- One customer-activity receipt per batch; project into Calls & Messages and Needs Attention
- Suppress alerts for test jobs
- Revoked, expired, or closed Customer Pages cannot upload or retrieve

Required routes:

- `/api/glass/upload`
- `/api/glass/upload/finalize`
- `/api/glass/attachment`

## SMS consent and Twilio

Trust Hub was submitted as of 2026-08-10.

- Add optional `Text me about this job` consent to the quote form with frequency, message/data, STOP/HELP, privacy, and terms disclosure.
- Add immutable `messaging_consents` records for web, inbound, verbal/operator, START, STOP, and HELP provenance.
- STOP overrides prior consent; START restores; HELP records without changing consent.
- Project Twilio `OptOutType` idempotently and do not duplicate Twilio's keyword response.
- Add `TWILIO_MESSAGING_SERVICE_SID` and `TWILIO_PUBLIC_NUMBER_ENABLED`.
- Keep `TWILIO_SMS_ENABLED=false` and hide customer-facing Text controls until A2P approval and complete smoke tests.
- Keep `TWILIO_PUBLIC_NUMBER_ENABLED=false` during private testing.
- Call controls and Text controls gate independently.
- Configure voice webhook `/api/twilio/voice`, SMS webhook `/api/twilio/sms`, and a Twilio-hosted TwiML Bin fallback that directly dials the owner.
- Retain `/api/twilio/fallback` for application testing only.
- Never put Twilio/Vercel/provider secrets in chat or source control.
- Do not purchase a number, approve charges, or change a public number without explicit user confirmation.

Existing call ads have the old number and must not be touched. Preserve the ads. Public-number cutover happens only on owned website/app surfaces after real-device and real-voice acceptance.

## Installable app

- Manifest/app name: `MCSW Jobs`
- Private `/ops/install` page with native Android install button and plain Chrome fallback instructions
- Link from More
- Preserve standalone display, push navigation, current icon assets, and 90-day login

## Provider and release gates

- Complete Deepgram, AI Gateway, Resend webhook, Gmail OAuth, remaining security secrets, and GitHub `CRON_SECRET` as required.
- User must perform Google password entry and any provider/financial approval.
- Upgrade to Vercel Pro before commercial cutover.
- Set `SHOP_BRAIN_REQUIRED=true` only when every production readiness field is green.
- Extend `/api/health` for public number, Messaging Service, consent, upload recovery, and provider readiness.
- All migrations are additive, explicitly cast, idempotent, and safe on the shared Neon database.
- Do not delete production files, route trees, existing interfaces, tables, bearer tokens, or role logic.

## Verification required in the full-build chat

- Migration twice
- Typecheck
- ESLint
- Complete focused test suite
- Production build
- Deterministic tests for hierarchy/terminology, safe touch cancellation, swipe threshold/idempotency/undo, role-safe activity paging, upload authorization/limits/recovery/delivery, consent provenance and STOP/START/HELP, SMS-disabled rendering, and public-number gating
- Visual checks at 320, 360×800, 375, 390, 414, 768, 1280, and 1440 px
- Default and enlarged Android text/display settings
- Reduced motion; owner/crew; empty/populated/overflow; pending/failed; offline/reload
- Physical Moto G acceptance matrix from the product plan
- Full real Twilio scenario matrix, including database/Vercel failure fallback
- Fresh independent hostile review after material repair

## Design-phase audit record

Independent design-disputer verdict: PASS; lock Signal layout and Chivo.

Independent brand-review verdict: AGREE; Brand is the clear final winner at 320, 390, and desktop. The coal logo/Jobs header plus cool-white workspace was judged both the most ownable and the easiest to scan all day. Red felt generic/urgent, Amber too heavy for daylight default, and Green semantically conflicted with Needs Attention.

Verified in the design phase:

- no horizontal overflow at supported widths
- no wrapped clickable labels at supported widths
- no clipped sample customer/job text at 320+
- product controls 48 px minimum
- source header and phone sentence optically aligned
- Needs Attention and Active Jobs visually distinct
- walk-in validation and derived saved copy correct
- Cancel, Not a job, Undo, Speak, More details, Reply, empty search, and pagination states work
- saved state is neutral rather than urgency-colored
- tablet comparison switcher stacks without a squeezed description
- keyboard filter focus remains visible inside clipped segmented controls
- preview-only Next.js badge is hidden

Physical Android enlarged-text verification is still required before production acceptance.

Design-phase verification completed on 2026-08-10:

- `npm run typecheck`: pass
- ESLint: 0 errors; one unrelated pre-existing warning in `lib/ingest.ts` for `attachRecoveredCallArtifacts`
- `git diff --check`: pass for preview, Hallmark log, and handoff
- `npm run build`: pass; one non-blocking fallback-font warning for existing `Atkinson Hyperlegible Next`
- responsive browser sweep: pass at 320, 360, 375, 390, 414, 768, 832, 1280, and 1440 px

## CRM optical polish record — 2026-08-11

Scope: every private CRM surface under `/ops`, production Call Sketch, and the private Customer Page under `/j/[token]`. The public homepage and marketing routes were deliberately excluded.

Locked outcome:

- Preserve the Signal structure, navigation order, workflows, copy meaning, data, and provider behavior.
- Keep Chivo as the only visible product face.
- Use the MCSW welding red-rust `#b34513`; do not imitate Apple styling or introduce a new palette.
- Apply a 14px meaningful-text floor, natural tracking for names/customer language/questions, 48px primary controls, a 44px compact floor, and one Lucide 16/18/20px optical system.
- Support the owner's Motorola Moto G (2026) first, with installed PWA primary and Chrome fallback.
- Keep the current Call Sketch hierarchy in production. The task-first hierarchy is available only in `/design-preview/mcsw-jobs-call-sketch` for owner comparison.
- Keep all changes reversible in small commits with evidence under `docs/visual-polish/2026-08-11/`.

Rollback checkpoints:

- Baseline: `c777bc2` (`feat(ops): add Call Sketch launcher`)
- Visual foundation: `916433e` (`style(ops): refine visual foundation`)
- Call Sketch: `ef62c61` (`style(call-sketch): sharpen visual hierarchy`)

Verified on 2026-08-11:

- `npm run typecheck`: pass
- `npm run lint`: pass
- `npm run test:shop-brain`: 149/149 pass
- `npm run build`: pass; the existing Atkinson fallback-font warning is unrelated
- browser widths: 320, 360, 375, 390, 414, 768, 1280, and 1440 pass
- landscape: 720×360 and 800×360 pass
- 125% Moto display-size proxy: effective 288×640 pass
- 14px minimum text, no squeezed computed tracking, no horizontal overflow, and no interactive control below 44px
- keyboard focus: immediate 3px ring; core tested contrast pairs: 5.56:1 or better

Still required before production acceptance: physical testing on the owner's Moto G (2026), including actual CSS viewport measurement, installed/PWA and Chrome modes, gesture navigation, keyboard-open layouts, and default plus enlarged Android text/display settings. Browser emulation is evidence, not physical signoff.

## Do not change after lock without owner approval

- Signal structure
- Chivo
- sentence-form intake
- phone-call default and quiet Walk-in switch
- optional Speak and collapsed More details
- solid Save Job action
- single Next move card
- bounded searchable/paged Active Jobs index
- 64rem two-column product breakpoint
- 48 px touch targets and current readable type sizes
- restrained, icon-free, dot-free, gradient-free language
- production marketing visuals except required SMS consent and Call/Text readiness

## Paste-ready next-chat prompt

> Read `MCSW-JOBS-BUILD-HANDOFF.md` completely, then inspect the current dirty diff and the locked preview at `/design-preview/mcsw-jobs-hybrid-directions`. The owner has approved the locked Signal + Chivo + MCSW Brand system. Rebuild the complete production product to that system, including every page/state and owner analytics under More, while preserving all existing reliability/privacy/role/receipt/payment/promise logic and every additive upload/consent/Twilio requirement. Do not touch existing call ads or switch public/SMS provider flags. Work through implementation and verification, but stop for any financial/provider approval or secret entry that requires the user.
