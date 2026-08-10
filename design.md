# Design — MCSW Jobs

The operations app follows one rule: **simple on the surface, rigorous underneath**. Reliability, privacy, consent, receipts, promises, roles, and idempotency stay in the system; the shop sees a short, plain workflow.

## Primary workflow

1. Capture a Phone call or Walk-in and Save Job
2. Needs Attention
3. Owner-only Today’s Leads snapshot
4. Active Jobs
5. Open a job, call or reply, and finish it

At approximately 360 CSS pixels wide, the first screen uses a 60px normal-flow coal header with the real MCS logo + `Jobs`, the operator’s first name, and `More`. The open phone-call intake follows immediately. Home shows one Next Move and five Active Jobs per page, with truthful totals and explicit paging.

## Hierarchy

- `More` contains Updates, Promises, Regular Customers, Search Jobs, Morning Brief, Ask Jobs, installation, settings, push controls, and sign-out.
- No fixed bottom controls, floating install cards, oversized mast, or reserved dock padding.
- Desktop keeps the same information order. Intake becomes a compact horizontal row and jobs remain dense rows.
- Today’s Leads sits directly above Active Jobs for owners. It shows today’s total, first-response queue, contacted and booked counts, median first response, and a bounded source breakdown. It never invents ad spend or ROI.
- Active Job rows have no detached middle status column. Lifecycle truth (`Booked`, `Customer contacted`) sits beside the customer name in brand red. Operational stage (`In Shop`, `Waiting`) leads the job description. Direct `Call`, consent-gated `Text`, then `Open` remain grouped at right on desktop.
- A job reads in this order: compact job header; customer/contact actions; Job Summary and photos; Promises; Calls & Messages; Customer Page; collapsed Job Details; Swipe to Finish; Recent Activity and paged Full Record.
- Customer Page is the only visible name for the private customer portal.

## Plain language

Visible labels describe the action or information directly: Phone call, Walk-in, Save Job, Needs Attention, Updates, Calls & Messages, Promises, Job Summary, Job Details, Contact, Price & Invoice, Status & Notes, Recent Activity, Full Record, Ask Jobs, Morning Brief, Customer Page, Job Status, Regular Customers, Search, View, and Swipe to Finish.

Technical route names, database columns, and immutable event terminology may remain internal. They are not presented as product vocabulary.

## Theme

- Coal header: `#12100d`; header ink: `#f1ebdc`; header muted: `#c8bead`.
- Workspace paper: `#f7f8f9`; surface: `#ffffff`; secondary surface: `#eceff1`.
- Main ink: `#171a1d`; secondary ink: `#394047`; muted ink: `#59626b`.
- Rules: `#d9dde1`; strong control rule: `#838c94`.
- Primary action: original CRM red-orange `#b34513` with `#ffffff` text.
- Focus only: bright website orange `#e8611c`.
- Attention surface: `#fff1eb`; attention ink: `#b34513`.
- Status colors always include text. Accent color remains a signal, not decoration.

The canonical values live in [`tokens.css`](tokens.css). New operations CSS uses those tokens and does not introduce a second visual language.

## Typography and density

- Chivo variable is the only visible product face for headings, body, controls, evidence, and customer pages.
- Visible product text never drops below 14px; the mobile baseline remains 16px.
- Names and customer copy stay in natural case.
- No glow, gradient text, decorative handwriting, oversized mobile headings, or faint metadata.

Rows favor scan speed: one customer, one job description, one state, and a centered action lane. Long copy truncates safely in lists and is available on the job page.

## Touch and motion

- Operational controls and adjacent inputs are at least 48px. Non-operational inline links still preserve a 44px touch target.
- Side-effect actions live away from screen edges, cancel when pointer movement becomes scrolling, disable while submitting, and rely on idempotent server actions.
- Swipe to Finish preserves vertical scrolling, resets below 70%, submits once at or above 70%, keeps the 10-second undo, and has a deliberate keyboard equivalent.
- Reduced motion removes decorative transition while preserving state feedback.

## Customer Page

Customer Page is calm daylight paper. It may show only owner-approved facts, promises, photos, and money. Active links can accept approved customer uploads. Raster images render only through authenticated scoped routes; documents and CAD download safely. Revoked, expired, and closed links cannot upload or retrieve files.

## Accessibility and verification

- Focus is immediate and visible.
- Controls never depend on color or gesture alone.
- Text and Call are gated independently; Text is absent until provider readiness and consent are both true.
- Verify 320, 360, 375, 390, 414, 768, 1280, and 1440 CSS-pixel widths, enlarged Android text, reduced motion, empty/populated/overflow states, owner/crew roles, failed uploads, and offline/reload behavior.
