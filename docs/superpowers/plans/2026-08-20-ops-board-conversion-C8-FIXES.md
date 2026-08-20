# C8 exit verification — failures

Session C8 of `2026-08-20-ops-board-conversion-SESSION-PLAN.md`, executing Task 8 of
`2026-08-20-ops-board-conversion.md`. Verification only; nothing in this session
patched production code.

**Verdict: blocked.** The suites are green and the stylesheet retirement is clean, but
the `/ops` → `/board` front-door flip in C7 (`b675644`) replaced the old dashboard with
a bare `redirect("/board")` that runs before any auth check and drops every query
parameter and hash. Eight live destinations lost their intent, one of them the
application's only full sign-in surface. The plan checklist stays unticked and
`MCSW-JOBS-BUILD-HANDOFF.md` is unchanged until these land.

Verified at `a99b4c6` (merge task/ops-board-c7-layout).

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

## Order to fix

1. **F1** — nothing else can be walked until sign-in works.
2. **F8** — the scope decision that determines the fix for F2 (Customers), F5, and
   F7's `view=updates` links.
3. **F3**, **F2** (Quotes and Promises arms), **F7** (`view=promises` arm) — mechanical
   retargets, safe once F8 is settled.
4. **F4**, **F6** — each needs one owner decision, then a one-line edit.
5. Re-run C8: full suites, then the 320/375/768 and owner/crew passes against a preview
   with real credentials.
