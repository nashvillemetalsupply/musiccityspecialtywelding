# Design — MCSW Jobs

> **Active Jobs redesign — PARKED 2026-08-17. Nothing below is superseded; the shipped
> flat styling this file describes is still what runs.** Owner will restart with
> reference images when they have a clean head.
>
> Seven attempts, all rejected. Read this before generating an eighth.
>
> **What was tried and what the owner said**
>
> | Attempt | Direction | Verdict |
> |---|---|---|
> | A/B/C (`.scratch/active-jobs/a-wall,b-ledger,c-traveler.html`) | whiteboard columns / dense ledger table / work-order slips, all light | "very very basic, generic AI slop, formatting subpar" |
> | 1/2/3 (Clock, One Job, Editorial) | age-scaled list / single-job focus / no-container editorial, all light | "they all look the same, same format as the old one" |
> | 4 (Wall) | coal ground, Barlow Condensed 900 uppercase names ~68px, arc orange, letterpress plates | "way too big and bold. trash." |
>
> **What that rules out.** Both ends of the scale dial are rejected: timid flat-white
> editorial *and* huge bold coal letterpress. The problem is therefore not type size,
> not the light/dark choice, and not the list arrangement — attempts 1–3 proved that
> rearranging a vertical list of text records changes nothing perceptible to the owner.
>
> **Known-good constraints (unchanged, still binding).** No glowing text, no candy
> palette, no hazard stripes, no faint secondary copy, no section numbering ("no.01"
> reads as an AI tell), nothing below 14px, high contrast for a full workday.
>
> **How to restart.** Do not generate variants from a text brief — it failed seven
> times. Wait for the owner's reference images, and work from those. The owner judges
> only rendered pixels in their own browser and cannot describe a target in advance.
>
> **Prototype harness removed.** The four variants lived behind `?variant=` on `/ops`
> in an uncommitted working tree and were deleted, not merged: the render branch was
> never gated for production, and the restart works from reference images rather than
> from these rejected drafts. `/ops` renders `ActiveJobIndex` and nothing else. Attempt
> 8 builds its own harness — and gates the whole thing, not just the switcher UI.
>
> **The "ops has no type voice" finding was wrong. Checked 2026-08-17; do not act on
> it.** `app/ops/layout.tsx` returns a `<div>`, not an `<html>`, so it nests under the
> root layout and already inherits `--font-ms-display`, `--font-ms-sans`,
> `--font-ms-mono`, `--font-ms-slab` and `--font-ms-marker` from `<body>`. Nothing is
> locked out of `/ops`. The ops stylesheet simply never references them.
>
> There is also no cheap seam to flip. `jobs-brand.css` defines four type tokens, and
> only `--font-body` is used (8 times); `--font-display`, `--font-outlier` and
> `--font-receipt` have zero uses, and every other element is `font-family: inherit`.
> Repointing those tokens changes nothing on screen. Giving `/ops` a display face means
> adding `font-family` to heading rules across 5,800 lines of stylesheet — that is the
> redesign itself, not a tidy-up, and it waits for the reference images like everything
> else here.
>
> One real but not-worth-fixing defect noted while checking: `Barlow_Condensed` in
> `app/layout.tsx` is the only font without `preload: false`, so `/ops` preloads a font
> it never renders. Preloading it is correct for the public site, and `next/font`
> preload is per-instance rather than per-route, so the fix costs more than the waste.

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
- Primary action: MCSW welding red-rust `#b34513` with `#ffffff` text.
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

### Optical polish contract

- Chivo remains a deliberate single-family product system. Weight, size, case, and spacing create hierarchy; no replacement face is introduced.
- Product body text uses a real variable weight near 450. Labels use 650, controls 680, headings 760, and the strongest names or display moments 780.
- Natural-case names, messages, questions, and body copy use natural tracking. Fixed headings may tighten only to `-0.012em`; compact headings use `-0.008em`. Utility labels cap at `0.025em` positive tracking.
- Customer names, current customer language, and active questions stay substantial. Small labels and metadata remain quiet without dropping below 14px.
- Tabular figures are required for times, phone numbers, money, counts, and aligned operational data.
- Browser-synthesized bold is disabled. Kerning and standard ligatures remain enabled.

## Icons and symbols

- Lucide is the only product icon family. Unicode symbols are replaced when a Lucide equivalent exists.
- Use 16px compact, 18px action, and 20px prominent optical sizes with a consistent `1.875` stroke.
- Filled or strongly colored symbols are reserved for selected, confirmed, warning, or destructive states. Important unfamiliar actions keep a text label.
- Icons support recognition; they are not decoration. The restrained icon-free language remains the default wherever words are clearer.

## Primary device contract

- Primary acceptance hardware: the owner’s Motorola Moto G (2026).
- Development baseline: 360 CSS pixels wide until the installed app and Chrome viewport values are measured on the physical phone.
- Installed standalone mode is primary. Regular Chrome is a fully supported fallback.
- Portrait receives the optical composition. Landscape remains functional, readable, and free of horizontal overflow.
- Verify 320, 360, 375, 390, 414, 768, 1280, and 1440 CSS-pixel widths.
- Verify default Android text/display sizing and at least one enlarged setting. Stack or reflow controls before shrinking type.
- Safe-area handling must protect headers, menus, and bottom actions in both installed and browser modes.
- Emulator evidence is provisional. Physical Moto G acceptance is required before this pass is called final.

## Call Sketch hierarchy review

- Production retains the polished-current hierarchy until the owner compares it with the task-first alternative.
- The task-first preview makes the active question strongest, followed by the newest customer language, then the customer name and status.
- The comparison is preview-only and cannot silently change production hierarchy.

## Rollback and review

- Baseline: Git commit `c777bc2` on `agent/app-call-sketch` with a clean worktree before this pass.
- Visual changes ship in small named commits with before/after captures under `docs/visual-polish/2026-08-11/`.
- No schema, provider, workflow, data, or navigation changes belong in this pass.

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

## Exports

`tokens.css` is the source of truth. These portable copies exist for reuse only; update them whenever the canonical tokens change.

### 1. Canonical CSS tokens

```css
:root {
  --color-paper: #ffffff;
  --color-paper-2: #f7f8f9;
  --color-paper-3: #eceff1;
  --color-ink: #171a1d;
  --color-ink-2: #394047;
  --color-muted: #59626b;
  --color-rule: #d9dde1;
  --color-rule-2: #838c94;
  --color-accent: #b34513;
  --color-accent-ink: #ffffff;
  --color-focus: #e8611c;
  --color-attention: #b34513;
  --color-attention-surface: #fff1eb;
  --color-wall: #12100d;
  --color-wall-ink: #f1ebdc;
  --color-wall-muted: #c8bead;
  --color-positive: #287a44;
  --color-danger: #b42318;

  --font-display: var(--font-mcsw-jobs), sans-serif;
  --font-body: var(--font-mcsw-jobs), sans-serif;
  --font-outlier: var(--font-body);
  --font-weight-body: 450;
  --font-weight-label: 650;
  --font-weight-control: 680;
  --font-weight-heading: 760;
  --font-weight-display: 780;
  --tracking-body: 0;
  --tracking-utility: 0.025em;
  --tracking-heading: -0.008em;
  --tracking-display: -0.012em;

  --space-3xs: 0.25rem;
  --space-2xs: 0.5rem;
  --space-xs: 0.75rem;
  --space-sm: 1rem;
  --space-md: 1.5rem;
  --space-lg: 2rem;
  --space-xl: 3rem;
  --space-2xl: 4rem;
  --space-3xl: 6rem;

  --text-product-floor: 0.875rem;
  --text-product-body: 1rem;
  --text-product-emphasis: 1.0625rem;
  --text-product-title: 1.1875rem;
  --text-product-display: 1.375rem;
  --icon-stroke: 1.875;
  --icon-size-compact: 1rem;
  --icon-size-action: 1.125rem;
  --icon-size-prominent: 1.25rem;
  --touch-target-min: 2.75rem;
  --control-height: 3rem;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --dur-micro: 120ms;
  --dur-short: 220ms;
  --dur-long: 420ms;
  --radius-card: 0.75rem;
  --radius-pill: 999px;
  --radius-input: 0.625rem;
}
```

### 2. Tailwind v4 `@theme`

```css
@theme {
  --color-paper: #ffffff;
  --color-paper-2: #f7f8f9;
  --color-paper-3: #eceff1;
  --color-ink: #171a1d;
  --color-ink-2: #394047;
  --color-muted: #59626b;
  --color-rule: #d9dde1;
  --color-rule-2: #838c94;
  --color-accent: #b34513;
  --color-accent-ink: #ffffff;
  --color-focus: #e8611c;
  --color-attention: #b34513;
  --color-attention-surface: #fff1eb;
  --color-wall: #12100d;
  --color-wall-ink: #f1ebdc;
  --color-positive: #287a44;
  --color-danger: #b42318;

  --font-display: var(--font-mcsw-jobs), sans-serif;
  --font-body: var(--font-mcsw-jobs), sans-serif;

  --spacing-3xs: 0.25rem;
  --spacing-2xs: 0.5rem;
  --spacing-xs: 0.75rem;
  --spacing-sm: 1rem;
  --spacing-md: 1.5rem;
  --spacing-lg: 2rem;
  --spacing-xl: 3rem;
  --spacing-2xl: 4rem;
  --spacing-3xl: 6rem;

  --text-product-floor: 0.875rem;
  --text-product-body: 1rem;
  --text-product-emphasis: 1.0625rem;
  --text-product-title: 1.1875rem;
  --text-product-display: 1.375rem;
  --radius-card: 0.75rem;
  --radius-pill: 999px;
  --radius-input: 0.625rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
}
```

### 3. DTCG `tokens.json`

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "color": {
    "paper": { "$value": "#ffffff", "$type": "color" },
    "paper-2": { "$value": "#f7f8f9", "$type": "color" },
    "paper-3": { "$value": "#eceff1", "$type": "color" },
    "ink": { "$value": "#171a1d", "$type": "color" },
    "ink-2": { "$value": "#394047", "$type": "color" },
    "muted": { "$value": "#59626b", "$type": "color" },
    "rule": { "$value": "#d9dde1", "$type": "color" },
    "rule-2": { "$value": "#838c94", "$type": "color" },
    "accent": { "$value": "#b34513", "$type": "color" },
    "accent-ink": { "$value": "#ffffff", "$type": "color" },
    "focus": { "$value": "#e8611c", "$type": "color" },
    "attention": { "$value": "#b34513", "$type": "color" },
    "attention-surface": { "$value": "#fff1eb", "$type": "color" },
    "wall": { "$value": "#12100d", "$type": "color" },
    "wall-ink": { "$value": "#f1ebdc", "$type": "color" },
    "positive": { "$value": "#287a44", "$type": "color" },
    "danger": { "$value": "#b42318", "$type": "color" }
  },
  "font": {
    "product": { "$value": "Chivo, sans-serif", "$type": "fontFamily" }
  },
  "weight": {
    "body": { "$value": 450, "$type": "fontWeight" },
    "label": { "$value": 650, "$type": "fontWeight" },
    "control": { "$value": 680, "$type": "fontWeight" },
    "heading": { "$value": 760, "$type": "fontWeight" },
    "display": { "$value": 780, "$type": "fontWeight" }
  },
  "size": {
    "text-floor": { "$value": "0.875rem", "$type": "dimension" },
    "text-body": { "$value": "1rem", "$type": "dimension" },
    "text-emphasis": { "$value": "1.0625rem", "$type": "dimension" },
    "text-title": { "$value": "1.1875rem", "$type": "dimension" },
    "text-display": { "$value": "1.375rem", "$type": "dimension" },
    "icon-compact": { "$value": "1rem", "$type": "dimension" },
    "icon-action": { "$value": "1.125rem", "$type": "dimension" },
    "icon-prominent": { "$value": "1.25rem", "$type": "dimension" },
    "touch-minimum": { "$value": "2.75rem", "$type": "dimension" },
    "control-height": { "$value": "3rem", "$type": "dimension" }
  },
  "space": {
    "3xs": { "$value": "0.25rem", "$type": "dimension" },
    "2xs": { "$value": "0.5rem", "$type": "dimension" },
    "xs": { "$value": "0.75rem", "$type": "dimension" },
    "sm": { "$value": "1rem", "$type": "dimension" },
    "md": { "$value": "1.5rem", "$type": "dimension" },
    "lg": { "$value": "2rem", "$type": "dimension" },
    "xl": { "$value": "3rem", "$type": "dimension" },
    "2xl": { "$value": "4rem", "$type": "dimension" },
    "3xl": { "$value": "6rem", "$type": "dimension" }
  },
  "duration": {
    "micro": { "$value": "120ms", "$type": "duration" },
    "short": { "$value": "220ms", "$type": "duration" },
    "long": { "$value": "420ms", "$type": "duration" }
  }
}
```

### 4. shadcn/ui CSS variables

```css
:root {
  --background: 100% 0 89.9;
  --foreground: 21.59% 0.0075 248.2;
  --card: 97.87% 0.0017 247.8;
  --card-foreground: 21.59% 0.0075 248.2;
  --popover: 100% 0 89.9;
  --popover-foreground: 21.59% 0.0075 248.2;
  --primary: 53.39% 0.1542 41;
  --primary-foreground: 100% 0 89.9;
  --secondary: 95.04% 0.0042 236.5;
  --secondary-foreground: 36.77% 0.0153 248.2;
  --muted: 89.56% 0.007 247.9;
  --muted-foreground: 49.16% 0.0183 248.2;
  --accent: 53.39% 0.1542 41;
  --accent-foreground: 100% 0 89.9;
  --destructive: 50.03% 0.1821 29.5;
  --destructive-foreground: 100% 0 89.9;
  --border: 89.56% 0.007 247.9;
  --input: 63.53% 0.016 244.8;
  --ring: 65.51% 0.1831 42.8;
  --radius: 0.75rem;
}
```
