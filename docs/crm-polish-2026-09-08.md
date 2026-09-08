# CRM polish verification — 2026-09-08

## Scope

This pass keeps laptop intake and callback scanning primary, makes field job
checking and completion easier to reach with one hand, and adds a compact,
today-first view of the next 30 Central-time shop days. It did not change the
role model, completion persistence, payment behavior, provider integrations,
database schema, or production deployment.

## Changes

- Repaired `/board` desktop grid placement. The 1440px main/tracker grew from
  300/236px to 1384/1320px; the 1024px result is 968/920px.
- Preserved document scrolling at 375px and 390px, reserved the fixed rail's
  bottom space, made all stage tabs at least 44px high on a coarse pointer, and
  stacked voice actions without hiding the final control.
- Added a 30-day, Today+29 calendar after the active tracker. Its query is
  bounded, Central-time and DST aware, excludes test/completed/handoff/routed/
  lost/spam work, and projects no money or contact fields. Crew service text
  still passes through the established redaction boundary.
- Added a single roving calendar tab stop with day/week arrow navigation,
  selected-day agenda, and direct links to existing role-gated work orders.
- Added a Central-time schedule/reschedule control inside each job profile.
  It writes the same `leads.scheduled_at` field used by the board calendar,
  records a scheduling receipt, and revalidates both the job and Job Control
  routes; the existing status shortcut is now labeled `Schedule now`.
- Kept swipe-to-finish and its vertical-scroll behavior, while adding a
  visually secondary native button path. Keyboard, pointer, and synthesized
  assistive activation all require a separate confirmation; repeated keys do
  not submit. The existing canonical completion server action remains the only
  submit path.
- Improved closeout field size/line height and completion helper contrast on
  the real dark shop-floor token ancestry.

## Verification evidence

Commands used:

```powershell
node scripts/qa/signed-out-board.mjs
node scripts/mobile-crm-repro.mjs
node --test scripts/job-calendar.test.mjs scripts/board-pane.test.mjs scripts/job-control-tracker.test.mjs scripts/cohesion-round-qa.test.mjs
node --test scripts/job-scheduling.test.mjs
npm run typecheck
npm test
npm run build
npx eslint app/board/page.tsx app/board/board.tsx app/board/job-calendar.tsx lib/job-calendar-data.ts "app/ops/leads/[id]/done-stamp.tsx" scripts/job-calendar.test.mjs scripts/mobile-crm-repro.mjs scripts/qa/signed-out-board.mjs
git diff --check
```

The actual signed-out `http://localhost:3033/board` matrix passed at desktop
1440, laptop 1024, phone 375, and phone 390 in both light and dark themes. It
found no horizontal overflow, serious/critical axe violation, unnamed visible
control, sub-44px coarse-pointer control, page/console error, signed-in data,
or external/mutating browser request. The skip link landed on `main`; native
wheel scrolling reached the uncovered final content and the bottom-most action
in every case. Theme controls changed and restored actual rendered colors.

The temporary populated fixture proved calendar day selection and work-order
linking, one arrow-navigable day tab stop, readable closeout controls, helper
contrast of at least 4.5:1, fixed-rail clearance, wheel and emulated vertical
touch movement over the completion control, keyboard Enter, synthesized
assistive click, repeat-key suppression, and one submit after two activations.
It blocked all non-GET/HEAD and external browser requests, refused to overwrite
an existing route, and removed its temporary app route in `finally`.

Focused calendar/source checks cover Today+29 cardinality, year rollover,
Central midnight boundaries, spring/fall DST spans, Date-to-ISO normalization,
active/test filtering, stable schedule ordering, selection fallback, roving
navigation bounds, narrow server projection, and work-order links. A read-only
database smoke check verified the 11 selected columns and query result shape.
The focused schedule/calendar tests passed 11/11, type checking passed, and
the production build completed all 47 pages with no temporary mobile fixture
route. The earlier repository suite passed 542/542 tests before this final
job-profile scheduling addition.

`npm run lint` is not a clean repository-wide signal: the unchanged baseline
still fails `lib/measurement.ts:38` on `prefer-rest-params`. Task-file ESLint
passes; advertising/measurement code was deliberately left untouched.

## Screenshots

- Baseline: `.backups/crm-desktop-before.png`
- Final populated views: `.backups/crm-desktop-after.png`,
  `.backups/crm-mobile-375-after.png`, `.backups/crm-mobile-390-after.png`
- Final field controls: `.backups/crm-voice-375-after.png`,
  `.backups/crm-voice-390-after.png`,
  `.backups/crm-completion-375-after.png`, and
  `.backups/crm-completion-390-after.png`
- Actual signed-out route, top and bottom:
  `scripts/qa/report/signed-out-board/desktop-light-top.png`,
  `scripts/qa/report/signed-out-board/desktop-dark-top.png`,
  `scripts/qa/report/signed-out-board/phone-375-light-top.png`, and
  `scripts/qa/report/signed-out-board/phone-375-light-bottom.png`
- Machine-readable matrix: `scripts/qa/report/signed-out-board/results.json`

The screenshot/report directories are intentionally ignored local QA
artifacts; the reusable harnesses and fixture source are kept in the repo.

## Honest task-scoped release axes

| Axis | Score | Evidence boundary |
| --- | ---: | --- |
| Truth and reliability | 9/10 | Role/test/date/completion boundaries passed source and deterministic checks; the signed-in production dataset was not mutated through the UI. |
| Time saved | 9/10 | Today+29 selection links directly to the work order and the completion fallback removes gesture dependence; field adoption time is not yet measured. |
| Crew usability | 9/10 | Width, 44px targets, native scrolling, focus, keyboard and completion paths passed; touch was Chromium/CDP emulation, not physical shop hardware. |
| Visual distinction | 9/10 | Desktop/phone and light/dark screenshots preserve the existing MCSW control language; authenticated populated production states were not photographed. |
| Forward invention | 8/10 | The schedule glimpse and safer dual completion path are useful additions to the existing flow, but no live usage telemetry yet proves their value. |

This is not a 10/10+ claim. No axis is allowed to average away the explicit
physical-device, authenticated-state, adoption, or deployment limitations.

## Remaining activation and verification boundary

No operator account was created, no real job was written or completed, no
email/SMS/call/AI provider was invoked, and nothing was deployed. A physical
375–390px iPhone/Android pass remains necessary for Safari/Chrome gesture,
pinch, virtual-keyboard, speech, vibration, and safe-area behavior. A signed-in
owner/crew smoke check against representative populated production data also
remains before calling the broader CRM release complete.
