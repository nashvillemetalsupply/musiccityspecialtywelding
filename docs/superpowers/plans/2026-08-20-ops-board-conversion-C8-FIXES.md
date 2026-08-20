# C8 exit verification — findings and closeout

Session C8 of `2026-08-20-ops-board-conversion-SESSION-PLAN.md`, executing Task 8 of
`2026-08-20-ops-board-conversion.md`. Verification only; nothing in this session
patched production code.

> **Status: CLOSED, 2026-08-20 at `d3e7cd2`.** All eight findings below are fixed and
> shipped. The plan and the session table are marked done and the stylesheet retirement
> is recorded in `MCSW-JOBS-BUILD-HANDOFF.md`. The conversion is live at
> `https://musiccityspecialtywelding.com`. Jump to **[Closeout](#closeout--2026-08-20)**
> for the resolution table, the final gates, and the one item that could not be verified
> live. Everything between here and there is the original failure report, kept unedited
> as the record of what the front-door flip cost.

**Original verdict (at `a99b4c6`, merge task/ops-board-c7-layout): blocked.** The suites
are green and the stylesheet retirement is clean, but the `/ops` → `/board` front-door
flip in C7 (`b675644`) replaced the old dashboard with a bare `redirect("/board")` that
runs before any auth check and drops every query parameter and hash. Eight live
destinations lost their intent, one of them the application's only full sign-in surface.
The plan checklist stays unticked and `MCSW-JOBS-BUILD-HANDOFF.md` is unchanged until
these land.

---

## What passed

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test:shop-brain` | 260 tests, 258 pass, 2 skipped, **0 fail** |
| `node --test scripts/ops-conversion-exit.test.mjs` | 5 tests, 0 fail |
| `C:\Users\Owner\Desktop\Shepherd\test.ps1` | exit 0 |

**Stylesheet retirement is clean.** `app/ops/jobs.css`, `app/ops/jobs-brand.css`,
`app/ops/weighted-job-index.tsx` and `app/ops/active-job-index.tsx` are absent from the
tree. All four archive copies under `archive/ops-legacy-2026-08-20/` are
content-preserving — MD5 of each `.txt` matches the pre-deletion blob at `b675644^`
once CRLF is normalised (the archive files were written with Windows line endings; the
bytes are otherwise identical). Zero active imports remain: every surviving mention of
`jobs.css`, `jobs-brand`, `jobs-product-frame`, `data-jobs-theme`,
`weighted-job-index` or `active-job-index` is a test assertion or an explanatory
comment in `scripts/`.

**Print survived.** The `@media print` block is intact at `app/board/board.css:479` and
`app/board/page.tsx:12` still imports that sheet, so the Monday board print is
unaffected. The extraction correctly left it behind — its selectors (`.rail`, `.pane`,
`.top-end`, `.find`, `.figures`) are board-page-specific. Neither retired sheet
contained an `@media print` block, so no `/ops` page lost print behaviour.

**No data-layer drift.** `git diff --stat 3cf584a..HEAD -- lib scripts/migrate.mjs
app/ops/actions.ts app/api` is empty across the entire C0–C7 range. Crew money is still
removed server-side (`lib/ops-data.ts:71`, `:794`, `:795`, `:917`, `:918` and the
`redactCrewText` projections at `:83`–`:88`) and that file is byte-identical to its
pre-conversion state. No per-worker hours, rankings, leaderboards, read receipts or
productivity totals were introduced. The inventory of form `name=` attributes and
server-action bindings across `app/ops`, `app/board` and `components` is identical
before and after, except for three entries that lived only in the deleted dashboard
(`name="view"`, one `name="body"`) and one attribute selector inside the deleted
`jobs-brand.css` (`name="accountQ"`). No surviving page changed its form, field or
query contract.

**`/j/[token]` is deliberately out of scope.** The customer-facing GLASS page
(`app/j/[token]/page.tsx` and its three route handlers) was excluded by the plan's
Self-Review as a separate owner design decision. It was not inspected, not converted,
and is not covered by any finding below. It remains on its own styling and is
unaffected by the stylesheet retirement.

---

## F1 — The sign-in surface is gone (critical)

**File/line:** `app/ops/page.tsx:6-8`

```tsx
export default function OpsPage() {
  redirect("/board")
}
```

**Impact.** The redirect runs unconditionally, before any authentication check. The
page it replaced was the application's only full sign-in surface — at `b675644^`,
`app/ops/page.tsx:161-170` rendered

```tsx
return <OpsLoginForm linkError={params.error === "link"} operators={punchCards} smsReady={smsLoginReady} />
```

with the operator punch-card list and the SMS-login flag. Nothing renders that form
with those props any more.

Everything that pointed at `/ops` for authentication now lands on a signed-out board:

- `app/ops/analytics/page.tsx:99`, `app/ops/analytics/page.tsx:100`,
  `app/ops/call-sketch/page.tsx:18`, `app/ops/intake/new/page.tsx:17`,
  `app/ops/intake/[draftId]/page.tsx:13`, `app/ops/intake/[draftId]/page.tsx:16` and
  `app/ops/intake/actions.ts:137` all `redirect("/ops")`, which redirects again to
  `/board`.
- `app/board/page.tsx:76` — signed out, the board returns its structural zero state.
  It carries no sign-in control of any kind. `MoreMenu` (the only surface with a login
  affordance nearby) mounts from `app/ops/ops-header.tsx:22` inside the `/ops` layout;
  `/board` is outside that layout and never renders it.
- `app/api/ops/logout/route.ts:16` sets `Location: /ops` after clearing the session
  cookie, so signing out lands the operator on the same dead end with no way back in.
- `app/api/ops/verify/route.ts:19` redirects a failed magic link to `/ops?error=link`.
  The `linkError` prop that surfaced that message has no renderer, so an expired or
  reused link now fails silently.

Four pages still render a login form — `app/ops/shop/page.tsx:17`,
`app/ops/install/page.tsx:23`, `app/ops/leads/[id]/page.tsx:176`,
`app/ops/accounts/[id]/page.tsx:21` — but only `/ops/install` passes `operators` and
`smsReady`; the other three render `<OpsLoginForm linkError={false} />` with no
punch-card list. Signing in is currently possible only by typing `/ops/install` by
hand.

**Smallest fix.** Restore the auth branch in `app/ops/page.tsx`: read
`getAuthenticatedOperator()` first, and when there is no operator render
`OpsLoginForm` with the `operators` / `smsReady` / `linkError` props exactly as
`b675644^:app/ops/page.tsx:160-171` did (that block is preserved verbatim in git and
needs no redesign — it is already board-language after C6). Only `redirect("/board")`
when an operator exists. The page keeps `export const dynamic = "force-dynamic"` and
gains a `searchParams` prop for `error=link`. No other file changes.

---

## F2 — Board rail: three destinations dropped their parameters

**File/line:** `app/board/board.tsx:313`, `:314`, `:315`

```tsx
<Link className="rl" href="/ops?view=regulars" aria-label="Customers">
<Link className="rl" href="/ops?stage=waiting" aria-label="Quotes">
<Link className="rl" href="/ops?view=promises" aria-label="Promises">
```

**Impact.** `redirect("/board")` discards the query string, so all three rail buttons
land on the unfiltered board. `/board` reads only `q`, `stage` and `signal`
(`app/board/page.tsx:22`, validated against `JOB_BOARD_STAGES` and
`BOARD_SIGNAL_KINDS` at `lib/ops-data.ts:25` and `:27`), and neither `view=regulars`
nor `view=promises` is among them. Three of the seven rail destinations are inert.

**Smallest fix.**

- `:314` Quotes → `href="/board?stage=waiting"` — `waiting` is a valid member of
  `JOB_BOARD_STAGES` (`lib/ops-data.ts:25`), so this is a direct equivalent.
- `:315` Promises → `href="/board?signal=promise"` — matches what C7 already did for
  the same destination in `app/ops/more-menu.tsx:63`.
- `:313` Customers has **no board equivalent.** The regulars index lived only in the
  deleted dashboard (`b675644^:app/ops/page.tsx:363`). This needs an owner decision:
  either point the rail at a customer surface that still exists, or remove the rail
  entry. Do not silently retarget it at `/board` — that swaps one lost destination for
  a misleading one.

---

## F3 — Board rail and logo self-link, with stale copy

**File/line:** `app/board/board.tsx:289-292` and `app/board/board.tsx:312`

```tsx
{/* The logo is the way back. /ops is untouched and remains the
    default board, so leaving this one is a single tap. */}
<Link className="logo-home" href="/ops" aria-label="Back to the old board">
...
<Link className="rl" href="/ops" aria-label="Leads">
```

**Impact.** Both now redirect to `/board`, so the logo and the "Leads" rail button
navigate the user to the page they are already on. The comment ("`/ops` is untouched
and remains the default board") and the `aria-label` ("Back to the old board") are both
false after C7 — a screen-reader user is told there is an old board to return to when
there is not.

**Smallest fix.** Point `:292` at `/board`, change its `aria-label` to `"Job Control
home"`, and delete the two-line comment above it. For `:312`, "Leads" was the old
dashboard's job list, which the board now *is* — either remove the rail entry or give
it a live destination. Note that `app/board/board.css:124` sizes the mobile rail for
seven destinations at 44px; removing entries changes that arithmetic and the comment
there needs updating with it.

---

## F4 — Internal-test visibility toggle has no destination

**File/line:** `app/ops/shop/page.tsx:88`

```tsx
<Link className="btn btn--sm btn--edge" href="/ops?status=open&tests=1">Internal tests</Link>
```

**Impact.** `tests=1` was the owner's switch for surfacing `[INTERNAL TEST]` /
`is_test` rows; `status=open` was the stage filter beside it. Both are dropped. The
board accepts no `tests` parameter, so the only owner-facing entry point to test rows
is now unreachable. `CLAUDE.md` requires `is_test` to survive every path — the data
still does, but the operator can no longer see it.

**Smallest fix.** Owner decision required, because the board has no equivalent
control. Either add a `tests` parameter to `/board` (out of C8's scope — it is a
behaviour change, not a conversion) or remove the link from Settings and record the
capability as retired. Leaving a button that goes nowhere is the one option that is
not acceptable.

---

## F5 — Shop Brain answer receipts are dead links

**File/line:** `app/ops/shop-dock.tsx:123`

```tsx
<a href={`/ops?receipt=${item.id}#receipt`} key={item.id}>{shopEventLabel(item.kind)}, …</a>
```

**Impact.** This surface is live: `ShopDock` is rendered by `app/ops/more-menu.tsx:70`,
and `MoreMenu` mounts from `app/ops/ops-header.tsx:22` on every `/ops` page. Every
"Sources" citation under a Shop Brain answer now lands on the plain board. The receipt
drawer that consumed `?receipt=` and `#receipt` lived only in the deleted dashboard
(`b675644^:app/ops/page.tsx:359`). These are evidence links behind an AI answer, which
makes a silent no-op worse than a visible absence.

**Smallest fix.** The receipt drawer needs a home before the link can be repaired.
Cheapest correct option: point each source at the job it belongs to —
`/ops/leads/${item.lead_id}` where `lead_id` is present — and drop the anchor for
events with no lead. That reuses a page that exists and was already converted in C1.
Re-homing the full receipt drawer is a larger change and belongs in its own session.

---

## F6 — Intake "more calls" link is dead

**File/line:** `app/ops/intake/inline-job-intake.tsx:192`

```tsx
{source === "phone-in" && pendingTotal > 1 && <Link className="btn btn--sm btn--edge" href="/ops?calls=all">{pendingTotal - 1} more {pendingTotal - 1 === 1 ? "call" : "calls"}</Link>}
```

**Impact.** `calls=all` expanded the dashboard's pending-call list. Dropped; the button
lands on the board. Reachable from `/ops/intake/new` and `/ops/intake/[draftId]`
whenever more than one call is pending.

**Smallest fix.** No board equivalent for the pending-call list exists. Remove the
link and keep the count as plain text (`{pendingTotal - 1} more calls`), or restore a
destination — owner's call. The count itself is real data and should stay.

---

## F7 — Notification and digest deep links land on the plain board

**Files/lines:**

- `app/api/ingest/gmail/route.ts:39` — `/ops?view=updates&wire=past#wire`
- `app/api/ingest/gmail/route.ts:91` — `/ops?view=updates#wire`
- `app/api/ingest/gmail/route.ts:142` — `/ops?view=updates#wire`
- `app/api/ingest/gmail/route.ts:227` — `/ops?view=updates`
- `app/api/ops/reminders/route.ts:90` — `/ops?view=updates&receipt=${event.id}#receipt`
- `app/api/ops/brief/route.ts:83` — `/ops#radio`
- `app/api/ops/brief/route.ts:106` — `/ops?view=promises`
- `app/api/ops/brief/route.ts:107` — `/ops?view=promises`
- `app/api/ops/brief/route.ts:137` — `/ops#radio`

**Impact.** These are the URLs written into push notifications, digests and the Morning
Brief. Every one of them drops to an unfiltered board, so tapping a notification no
longer opens the thing it is about. `#radio` is a special case: it was handled by
`app/ops/more-menu.tsx:15`, which opens the menu when the hash is `#radio` or
`#handset`. `MoreMenu` mounts only inside the `/ops` layout, so even if the hash
survived, `/board` would not act on it.

**Scope note.** These files are under `app/api/`, which Task 7 did not list and the
plan's global constraints put out of bounds ("no `lib/` or `actions.ts` changes"). The
breakage is real but the fix is a routing change, not a conversion — it belongs in a
follow-up session with its own scope, not in a C7 patch. `app/api/ops/brief/route.ts`
also carries the crew/owner split (`crewPromiseSheet` at `:107` vs `ownerPromiseSheet`
at `:106`); any retarget must preserve both arms.

**Smallest fix.** `/ops?view=promises` → `/board?signal=promise` at `:106` and `:107`.
`#radio` at `:83` and `:137` needs a destination that renders the radio — either an
`/ops` page that still mounts `MoreMenu`, or the hash handling moves to the board. The
`view=updates` family depends on F8 and cannot be fixed before it.

---

## F8 — The Updates, receipt and paid-moment surfaces were removed, not converted

**Files:** `app/ops/wire-strip.tsx`, `app/ops/paid-moment.tsx`,
`app/ops/active-job-controls.tsx`

**Impact.** All three are now orphaned — nothing in `app/` or `components/` imports
them. They were rendered only by the deleted dashboard
(`b675644^:app/ops/page.tsx:267`, `:331`, `:344`, `:359`). Deleting the dashboard body
therefore removed, with no replacement:

- the **Updates** archive and its pagination (`wire-strip.tsx`, plus `listWire` /
  `countUnreadWire` which remain in `lib/` with no caller in the page tree),
- the **receipt drawer** (`?receipt=` / `#receipt`, the target of F5 and of
  `app/api/ops/reminders/route.ts:90`),
- the **paid moment** slip (`paid-moment.tsx`, shown on `invoice.paid`),
- the **regular-customers index** (the target of F2's Customers rail).

The board provides `todayTrail` (`app/board/board.tsx:357`) — today's events only. It
is not the Updates archive and does not carry the wire's history, search, unread count
or per-slip actions.

Task 7 specified "replace the dashboard body with `redirect("/board")`" and the plan's
Self-Review recorded the dashboard as covered by that redirect. Neither says these four
surfaces were being retired. This is the root cause behind F2 (Customers), F5 and part
of F7, and it is the finding that most needs an owner decision rather than a patch.

**Smallest fix.** None — this is a scope question, not a defect with a one-line
answer. Present the four lost surfaces to the owner and decide per surface: re-home it
under a live `/ops` route, fold it into the board, or retire it deliberately and
delete the orphaned components. F2, F5 and F7's `view=updates` links stay broken until
that decision lands. `wire-strip.tsx:99`, `:101` and `:103` also point at
`/ops?view=updates…`, so the component is not reusable as-is wherever it is re-homed.

---

## Pending — viewport and preview walkthrough (not a failure)

> **Resolved in the closeout below.** The owner ran the breakpoint pass and the owner
> route walk against production. The crew arm of the walk is the one item that stayed
> open, and for a reason that is not about the code — see
> [Closeout](#closeout--2026-08-20).

Task 8 requires 320px / 375px / 768px passes on `/board`, a representative
`/ops/leads/[id]`, and `/ops/intake/new`, plus the owner/crew route walk from Task 7
Step 3. **Runtime verification is unavailable in this worktree and is recorded as
pending, not as a pass or a failure.**

- There is no `.env` file here, so no database and no session. Per the session brief, a
  lead ID must not be invented and may only be discovered from the live board with
  authorized credentials, which do not exist in this environment.
- The default Turbopack dev server cannot start: `node_modules` is a junction to the
  root repository (Shepherd's worktree convention) and Turbopack rejects it —
  `Symlink [project]/node_modules is invalid, it points out of the filesystem root`.
- `next dev --webpack` does start and `/board` returns 200, but per-route first
  compiles exceeded the time budget for this session, so no page was measured at any
  viewport.
- No preview was deployed. External upload requires fresh owner approval and was not
  requested.

**Static evidence only, which does not substitute for the measurement:** the coarse
pointer rules are present and every converted page carries one —
`styles/control.css:194` (`.btn`/`.btn--sm` 44px at `:195`, `.icon`/`.rl` at `:196`,
`.tab`/`.signal` at `:197`, `.find` at `:198`), plus
`app/ops/accounts/[id]/account.css:247`, `app/ops/analytics/analytics.css:178`,
`app/ops/call-sketch/call-sketch.css:80`, `app/ops/install/install.css:96`,
`app/ops/intake/intake.css:226`, `app/ops/leads/[id]/builds/builds.css:667`,
`app/ops/leads/[id]/job.css:407` and `app/ops/shop/shop.css:181`. The board's own
breakpoint ladder and its no-horizontal-scroll result at 320/375/414/768/1024/1440 are
documented at `app/board/board.css:6-16` from the pre-conversion build.

The owner/crew preview walkthrough required by Task 7 Step 3 is likewise **pending**.
Note that F1 blocks it regardless: neither role can currently sign in from the front
door.

---

## Order to fix (original plan — followed as written)

1. **F1** — nothing else can be walked until sign-in works.
2. **F8** — the scope decision that determines the fix for F2 (Customers), F5, and
   F7's `view=updates` links.
3. **F3**, **F2** (Quotes and Promises arms), **F7** (`view=promises` arm) — mechanical
   retargets, safe once F8 is settled.
4. **F4**, **F6** — each needs one owner decision, then a one-line edit.
5. Re-run C8: full suites, then the 320/375/768 and owner/crew passes against a preview
   with real credentials.

---

## Closeout — 2026-08-20

Verified at `d3e7cd2` (merge task/ops-board-archive-controls) on `main`.

The owner's answer to the F8 scope question was **re-home, don't retire**: the three lost
surfaces came back as first-class board routes rather than being folded into the board
page or deleted. That decision is what unblocked F2, F5 and F7.

### Resolution

| # | Finding | Resolution | Commits |
|---|---|---|---|
| F1 | Sign-in surface gone | `/ops` is the sign-in door again: it reads `getAuthenticatedOperator()` first and only `redirect("/board")` when an operator exists; signed out it renders `OpsLoginForm` with the punch-card list, `smsReady` and `linkError` | `499add5` |
| F2 | Rail dropped its parameters | Quotes → `/board?stage=waiting`, Promises → `/board?signal=promise`, Customers → `/board/customers` (a real route, per F8) | `716abe4`, `eb00179`, `db60375` |
| F3 | Logo and rail self-link, stale copy | Logo → `/board`, `aria-label="Job Control home"`, the false comment deleted; the Board rail entry now carries `aria-current="page"` | `716abe4`, `db60375` |
| F4 | `tests=1` had no destination | Owner-only internal-test visibility restored on the board, and `tests=1` is carried across board links and search | `2b30852`, `d609e8c` |
| F5 | Shop Brain receipts dead | Receipts point at `/board/updates`, which now hosts the receipt drawer | `af951c5`, `50f5bfd` |
| F6 | Intake "more calls" dead | The pending call queue is back as `/board/calls`; the intake link points at it | `3bdb7bc`, `5097a9f` |
| F7 | Notification and digest deep links | Push, digest and Morning Brief links retargeted at board surfaces; `#radio` / `#handset` work because `/board` mounts the same menu and dock the `/ops` pages do | `50f5bfd`, `db60375`, `ecbb5fc` |
| F8 | Updates / receipt / paid-moment / customers removed | Updates → `/board/updates` (reusing `wire-strip.tsx` and `paid-moment.tsx`, which are imported again, not orphans); regulars → `/board/customers`; `active-job-controls.tsx` deliberately retired and archived | `eb00179`, `af951c5`, `9bf95b3` |

`archive/ops-legacy-2026-08-20/` now holds five content-preserving copies:
`jobs.css.txt`, `jobs-brand.css.txt`, `weighted-job-index.tsx.txt`,
`active-job-index.tsx.txt` and `active-job-controls.tsx.txt`. That directory is the only
copy outside git history — do not delete it.

### Final gates

| Gate | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test:shop-brain` | 298 tests, 296 pass, 2 skipped, 0 fail |
| Focused route/conversion suites | 60 tests, 60 pass, 0 fail |
| Shepherd `test.ps1` | 12 suites, exit 0 |
| `npm run build` (production) | exit 0, 51 pages — see the note below |

Every gate above was re-run from a clean tree at `d3e7cd2` during this closeout.

**The build row needs its footnote.** `npm run build` uses Turbopack, and Turbopack cannot
build inside a Shepherd worktree at all: `node_modules` here is a junction to the root
checkout and Turbopack rejects it — *Symlink [project]/node_modules is invalid, it points
out of the filesystem root*. That is an environment limit, not a code failure, and it is
the same one the first C8 pass hit. The build recorded above is therefore
`next build --webpack` from this worktree: exit 0, compiled in 2.4min, TypeScript clean,
51 pages generated. It emits four `Attempted import error` warnings against
`@/lib/job-line-items`; those are a webpack resolution quirk rather than a real defect —
`tsc --noEmit` resolves the same three exports without complaint. The owner's own
`npm run build` at the root checkout, and the Vercel production build, are the authority
for the default bundler.

The focused set is `ops-conversion-exit` (7), `board-customers-route` (8),
`board-updates-route` (9), `board-calls-route` (14), `board-push-links` (6),
`board-final-navigation` (7), `board-internal-tests` (9) — 60 assertions covering the
front door, the three restored routes, the retargeted deep links, the final navigation
and the internal-test switch.

Shop Brain grew from 260 tests (258 pass, 2 skipped) at `a99b4c6` to 298 here: the four
board route suites the fixes added to `test:shop-brain` — `board-customers-route` (8),
`board-updates-route` (9), `board-calls-route` (14), `board-push-links` (6) — plus one
new assertion in `board-pane`. The same two tests skip as before and for the same reason:
`real persistence converges ingest retries and lock receipts without sequence gaps` and
`simultaneous lock receipts converge across two database connections`, both reporting
`SKIP DATABASE_URL is not configured`. They need a live database, this worktree has no
`.env`, and neither is a conversion test.

### Runtime pass — production, as owner

Walked at `https://musiccityspecialtywelding.com`, not a preview.

- **Breakpoints.** 320 / 375 / 768 on `/board`, job 105 and intake. No horizontal
  overflow at any of the three widths on any of the three pages.
- **Touch targets.** The only controls measuring under 44px are two documented
  exemptions: the header logo link, and the native checkbox and radio inputs. Neither is
  a primary operational target and neither is a conversion regression.
- **Route walk.** Walked as owner: `/board`, `/board/customers`, `/board/updates`,
  `/board/calls`, intake, analytics, call-sketch, shop, install and job 105.
- **Not walked.** An individual `/ops/accounts/[id]` page, a `/ops/leads/[id]/builds` page
  — the attempt on job 105 returned not found — and an explicit sign-out/sign-in cycle.
  None of the three has a live production walk behind it. What they do have: the C3, C5
  and C6 rows are marked done in the session plan, which carries the per-session owner
  gate at preview; the five `build-sheets-*` suites and `ops-conversion-exit` are green;
  and the coarse-pointer blocks are present at
  `app/ops/accounts/[id]/account.css:247` and
  `app/ops/leads/[id]/builds/builds.css:667`. That is static and test evidence, not a
  runtime pass, and it is not recorded as one.
- **Owner surfaces.** Menu opens and closes; money renders where the owner expects it;
  `tests=1` surfaces the `[INTERNAL TEST]` rows; `#radio` and `#handset` both open the
  dock from a cold load.

### The crew route walk could not run

**Production has no active crew account.** Philippe Auguste and TJ Harahan are both
`owner` role — `scripts/upsert-phone-login-operators.mjs:15` and `:16` seed them that way
and nothing since has changed it — so there is no credential in production that renders
the crew projection.
The crew arm of Task 7 Step 3 was therefore not walked — not skipped, not passed by
proxy, and not satisfiable by walking as owner and reasoning about what crew would see.

What still covers it: crew money is removed **server-side**, per `CLAUDE.md`, and nothing
in the conversion or the F1–F8 fixes touched that path. `git diff --stat 3cf584a..HEAD`
is empty for `lib/ops-data.ts` — which holds the crew redaction and the `redactCrewText`
projections — and empty for `app/ops/actions.ts` and `scripts/migrate.mjs`. The
`event-visibility`, `shop-brain-invariants` and `shop-brain-boundaries` suites assert the
crew projection directly and are inside the 298-test green run. That is test coverage of
the same guarantee, which is why this is a verification gap and not an exposure.

**What did change under `lib/` and `app/api/`, and why it is not a data-layer change.**
The original report recorded zero drift there across C0–C7. The F7 fixes then edited
fourteen lines across seven files — `lib/calls.ts` (1), `lib/messages.ts` (1),
`lib/notify.ts` (2), `lib/people.ts` (1), `app/api/ingest/gmail/route.ts` (4),
`app/api/ops/brief/route.ts` (4) and `app/api/ops/reminders/route.ts` (1) — each one a
URL string in notification, digest or Morning Brief copy, retargeted from a dead
`/ops?…` destination to the board surface that answers it (`/ops?view=updates#wire` →
`/board/updates#wire`, `/ops?view=promises` → `/board?signal=promise`, `/ops#radio` →
`/board#radio`, and the phone search to `/board?q=`). `lib/job-intake.ts` also
gained a `JOIN calls` in the pending-call count so the count matches the page query
(`5097a9f`). No schema, no migration, no action signature, no query result shape. Both
arms of the crew/owner split in `app/api/ops/brief/route.ts` — `crewPromiseSheet` and
`ownerPromiseSheet` — were preserved, as the original report required.

**Do this the first time a crew operator exists in production:** sign in as them and walk
/board, a job, intake, accounts, analytics, call-sketch, shop, install, builds, and
sign-out/sign-in. Confirm no money renders anywhere. Then tick Step 3b in
`2026-08-20-ops-board-conversion.md`.

### Still out of scope

`/j/[token]`, the customer-facing GLASS page, was excluded by the plan's Self-Review as a
separate owner design decision. It was not converted, is unaffected by the stylesheet
retirement, and remains on its own styling.
