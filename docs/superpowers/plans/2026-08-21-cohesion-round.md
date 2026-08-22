# Cohesion Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four real gaps left after the board conversion — retire the `lead_events` dual-write, let the owner record cash/check payments so "still out" stops lying, put the coming week's dues on the board, and make stage overflow reachable — with no further optimization round planned for a while.

**Architecture:** All changes ride the existing spine: `events` becomes the only journal (the `lead_events` table stays as frozen history — never dropped), payments become idempotent `invoice.*` events plus the existing `leads` rollup columns, the week strip is one new read function in `lib/ops-data.ts` rendered as a pane card in the approved board language, and the pager reuses `listBoardJobs`' existing `page`/`hasNext` machinery.

**Tech Stack:** Next.js 16 App Router, Neon Postgres via `@neondatabase/serverless` tagged templates, plain CSS in the board vocabulary (`styles/control.css` tokens), `node --test` suites in `scripts/`.

**Session split:** `2026-08-21-cohesion-round-SESSION-PLAN.md` (K1–K5) — execute from there, one session per chat.

**Spec:** This plan is its own spec; context is the shipped board (`app/board/board.tsx` + `app/board/board.css`), the C0–C8 conversion record (`docs/superpowers/plans/2026-08-20-ops-board-conversion.md`), and the invariants in `CLAUDE.md`.

## Global Constraints

- All `CLAUDE.md` invariants hold: live schema evolved **additively** (never rename/drop/retype a live column or table); migrations in `scripts/migrate.mjs` idempotent; **every SQL interpolation carries an explicit Postgres cast**; `[INTERNAL TEST]`/`is_test` never alert crew or count as business; `events` is immutable; crew money removed **server-side**; roles are exactly `owner` and `crew`; no worker surveillance; persist intent before side effects.
- Board language only: tokens/classes from `styles/control.css` and `app/board/board.css`; square corners; no component names a hex; no invented numbers — an empty slot states its absence.
- Every task green on `npm run typecheck`, `npm run lint`, `npm run test:shop-brain` before commit.
- Central time is `America/Chicago` everywhere a day boundary matters, matching `getPromiseSummary` / `getOutTheDoorWeek`.
- New test files are wired into the `test:shop-brain` script in `package.json` in the task that creates them, not deferred — `tests/Test-NodeSuites.ps1` discovery exists because hand-maintained lists rot, but this repo's `package.json` list is the runner and must name them.

## Acceptance Criteria

- **Given** any operator action that used to write `lead_events`, **when** it runs, **then** exactly one `events` row is written and zero `lead_events` rows are written; the frozen table still holds its history.
- **Given** a customer hands the owner $500 cash on a $1,860 invoice, **when** the owner records it on the job page, **then** the job shows "Paid $500 of $1,860 · $1,360 still out", the board's Out-the-door "still out" figure drops by $500, and an `invoice.payment-received` event appears in the trail. **When** the remaining $1,360 is recorded, **then** `paid_at` is set and the event is `invoice.paid`.
- **Given** a crew session, **when** any page renders, **then** no payment amount, invoice figure, or week-strip invoice item reaches the client.
- **Given** open promises, unpaid invoice dues, and follow-ups dated inside the next seven days, **when** the owner opens `/board`, **then** a "The week" card lists them under weekday headings, each linking to its job; **given** none, **then** the card says so honestly.
- **Given** a stage with more jobs than one page holds, **when** the owner reaches the bottom of the tracker, **then** a link shows the next page and the count it holds; **given** a stage that fits, **then** no pager renders.
- **Given** an `[INTERNAL TEST]` job with a due promise, payment, or invoice, **then** it appears nowhere unless the owner is in `?tests=1` mode, per the existing predicate conventions.

## QA Procedure

1. Sign in as owner at `/board`. Confirm "The week" card sits in the pane and lists real dues (or the honest empty line) under weekday headings; click one item and land on that job.
2. On a job with a QB invoice recorded, record a partial cash payment. Confirm the balance line under the payment form, the event in the job trail, and the board's "still out" drop.
3. Record the remaining balance. Confirm "squared up", `paid_at` visible in the Paid stage cell, and an `invoice.paid` event.
4. On a job with no invoice, record a payment with "this squares the job" ticked. Confirm `paid_at` set.
5. Change a job's status, log an interaction, and complete a job; confirm each lands in the job trail (events journal) exactly once.
6. Run `SELECT max(created_at) FROM lead_events` in Neon: confirm no row newer than this round's deploy.
7. With more than one tracker page in a stage (use `?tests=1` and internal-test rows if production is small), walk "Show the next N" forward and "Back to the newest" back.
8. Confirm `/board` signed out still renders the structural zero state, and crew (when a crew login exists) sees no money anywhere new.

---

### Task 1: Retire the `lead_events` dual-write

The journal is `events`; `lead_events` becomes frozen history. Six write sites, two read gates, one dead export.

**Files:**
- Modify: `lib/leads.ts` (`recordLeadEvent` ~line 375–423, prior-created gate ~line 320)
- Modify: `app/ops/actions.ts` (three `legacy_receipt` CTEs: `contact_captured` ~778, `completed` ~964, `completion_undone` ~1291)
- Modify: `app/ops/leads/[id]/handoff-actions.ts` (two `legacy_receipt` CTEs ~54, ~174)
- Modify: `lib/job-intake.ts` (creator gate ~423)
- Modify: `lib/ops-data.ts` (delete dead `getLeadEvents` ~721 and, if nothing else imports it, the `LeadEventRow` type)
- Modify: `scripts/migrate.mjs` (append one idempotent `COMMENT ON TABLE`)
- Modify: `CLAUDE.md` (the `lead_events` invariant line) and `AGENTS.md` if it mirrors it
- Create: `scripts/lead-events-retirement.test.mjs`
- Modify: `package.json` (add the new test file to `test:shop-brain`)

**Interfaces:**
- Consumes: `recordEvent(input: RecordEventInput): Promise<number | null>` from `lib/events.ts` (idempotent by `(kind, external_id)` when `externalId` non-empty).
- Produces: `recordLeadEvent(leadId: number, type: string, actor: string, detail?: Record<string, unknown> | null): Promise<number | null>` — same signature, now returns the `events` id it already returned (callers like `app/api/quote/route.ts:433` feed it to `processEvent`; unchanged).

- [ ] **Step 1: Write the failing test** — `scripts/lead-events-retirement.test.mjs`:

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

function sourceFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx|mjs)$/.test(entry.name))
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name))
}

test("nothing writes lead_events any more", () => {
  const offenders = [...sourceFiles("app"), ...sourceFiles("lib")]
    .filter((file) => readFileSync(file, "utf8").includes("INSERT INTO lead_events"))
  assert.deepEqual(offenders, [])
})

test("the creation gates read the events journal", () => {
  const leads = readFileSync("lib/leads.ts", "utf8")
  assert.doesNotMatch(leads, /FROM lead_events/)
  const intake = readFileSync("lib/job-intake.ts", "utf8")
  assert.doesNotMatch(intake, /FROM lead_events/)
  assert.match(intake, /'form\.quote','lead\.intake\.restored'/)
})

test("the dead lead_events reader is gone", () => {
  assert.doesNotMatch(readFileSync("lib/ops-data.ts", "utf8"), /FROM lead_events/)
})

test("the frozen table is documented, not dropped", () => {
  const migrate = readFileSync("scripts/migrate.mjs", "utf8")
  assert.match(migrate, /CREATE TABLE IF NOT EXISTS lead_events/)
  assert.match(migrate, /COMMENT ON TABLE lead_events/)
  assert.doesNotMatch(migrate, /DROP TABLE[^`]*lead_events/)
})
```

- [ ] **Step 2: Run it** — `node --test scripts/lead-events-retirement.test.mjs` — expect FAIL (writes still present).
- [ ] **Step 3: Rewrite `recordLeadEvent`** in `lib/leads.ts` — drop the `lead_events` INSERT; keep the `kindMap`, the person lookup, and the body derivation byte-for-byte; `occurredAt` defaults to now (omit it), `externalId: ""`:

```ts
export async function recordLeadEvent(
  leadId: number,
  type: string,
  actor: string,
  detail: Record<string, unknown> | null = null
): Promise<number | null> {
  const sql = getSql()
  const people = (await sql`
    SELECT person_id FROM leads WHERE id = ${leadId}::bigint LIMIT 1`) as {
    person_id: number | null
  }[]
  const body =
    typeof detail?.note === "string"
      ? detail.note
      : typeof detail?.message === "string"
        ? detail.message
        : typeof detail?.reason === "string"
          ? detail.reason
          : ""
  // kindMap stays exactly as it is today
  return recordEvent({
    kind: kindMap[type] ?? `lead.${type.replace(/_/g, ".")}`,
    actorType: actor === "system" ? "system" : "operator",
    actorId: actor === "system" ? "" : actor,
    leadId,
    personId: people[0]?.person_id ?? null,
    externalId: "",
    body,
    detail: { ...(detail ?? {}), legacyType: type },
  })
}
```

The old code's `external_id` was `lead_event:<freshly-inserted id>` — unique per call, so it never deduplicated anything; `""` preserves those semantics exactly. Keep `legacyType` in detail — readers filter on it.

- [ ] **Step 4: Port the prior-created gate** in `lib/leads.ts` (~line 320):

```ts
const priorCreated = reused ? (await sql`
  SELECT id FROM events WHERE lead_id = ${id!}::bigint AND kind = 'form.quote' LIMIT 1`) as { id: number }[] : []
```

(`'created'` maps to `'form.quote'` in both the `kindMap` and `scripts/backfill-events.mjs`, so history answers this query too.)

- [ ] **Step 5: Rewrite the five CTE sites.** In each, delete the `legacy_receipt` CTE and make the `events` INSERT select straight from `target`, using `now()` for `occurred_at` and `''::text` for `external_id`. Pattern, shown for `contact_captured` (`app/ops/actions.ts` ~778) — apply the same surgery to `completed`, `completion_undone`, and both handoff sites, keeping each site's own kind, body, detail, and `RETURNING` clause (the completion site returns the event id it stores in `undoDetail`; keep that via `RETURNING id` on the events INSERT):

```sql
    ), receipt AS (
      INSERT INTO events (
        occurred_at, kind, actor_type, actor_id, lead_id, person_id,
        external_id, body, crew_body, detail
      )
      SELECT now(), 'contact.captured'::text, 'operator'::text,
        ${String(operator.id)}::text, t.id, t.person_id,
        ''::text, 'Customer contact caught'::text, 'Customer contact caught'::text,
        ${JSON.stringify({ ...detail, legacyType: "contact_captured" })}::jsonb
      FROM target t
      RETURNING id
    )
```

The gating semantics are unchanged: the INSERT fires only when `target` matched, exactly as `legacy_receipt` did. The `handoff_undone` 10-second receipt check already reads `events`; leave it alone.

- [ ] **Step 6: Port the intake creator gate** in `lib/job-intake.ts` (~423):

```sql
${input.operatorRole === "owner"}::boolean OR EXISTS (
  SELECT 1 FROM events created
  WHERE created.lead_id = l.id
    AND created.kind = ANY(ARRAY['form.quote','lead.intake.restored']::text[])
    AND created.actor_id = ${String(input.operatorId)}::text
)
```

- [ ] **Step 7: Delete the dead reader** — `getLeadEvents` in `lib/ops-data.ts` has zero callers (verified: `grep -rn "getLeadEvents" app lib` matches only its definition). Remove it; remove `LeadEventRow` too if `grep -rn "LeadEventRow" app lib scripts` then matches nothing else.
- [ ] **Step 8: Freeze the table in the schema** — append to the statements array in `scripts/migrate.mjs` (idempotent, additive):

```js
  `COMMENT ON TABLE lead_events IS 'Frozen 2026-08-21. The journal is events; this table is retained history only. Do not write.'`,
```

- [ ] **Step 9: Update the invariant** — in this repo's `CLAUDE.md`, change the `events` bullet's tail from "`lead_events` remains only as a compatibility journal while the app dual-writes" to "`lead_events` is frozen history — never written, never dropped; `events` is the only journal." Mirror in `AGENTS.md` if that file carries the same line.
- [ ] **Step 10: Wire the suite** — add `scripts/lead-events-retirement.test.mjs` to the `test:shop-brain` list in `package.json`.
- [ ] **Step 11: Verify** — `node --test scripts/lead-events-retirement.test.mjs` PASS, then `npm run typecheck && npm run lint && npm run test:shop-brain` all green (the existing 298-test suite pins the behaviors these sites gate).
- [ ] **Step 12: Commit** — `git commit -m "feat(events): retire the lead_events dual-write; events is the only journal"`

### Task 2: Record money in hand

Cash and checks never reach the Gmail/QuickBooks ingest, so `paid_at` never sets and "still out" lies. One owner-only action, one form on the job page, one pure helper.

**Files:**
- Create: `lib/payments.mjs` (pure rollup math) + `lib/payments.d.mts` (typing, matching the repo's `.mjs`+`.d.mts` pattern)
- Modify: `app/ops/actions.ts` (new `recordPayment` beside `recordInvoice` ~line 518)
- Modify: `app/ops/leads/[id]/page.tsx` (payment form + balance line after the invoice form ~line 704)
- Create: `scripts/payments.test.mjs`
- Modify: `package.json` (wire the test)

**Interfaces:**
- Consumes: `requireOperator()`, `requireOwner(operator)`, `parseLeadId`, `parseDollarsToCents` (all already in `app/ops/actions.ts`); `recordEvent` from `lib/events.ts`; `SafeSubmitButton` and `money(cents)` already on the job page.
- Produces: `paymentRollup({ currentPaidCents, amountCents, invoiceTotalCents, settles }): { paidTotalCents: number, fullyPaid: boolean }` in `lib/payments.mjs`; server action `recordPayment(formData: FormData): Promise<void>`.

- [ ] **Step 1: Write the failing test** — `scripts/payments.test.mjs`:

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { paymentRollup } from "../lib/payments.mjs"

test("partial payment accrues and does not settle", () => {
  assert.deepEqual(
    paymentRollup({ currentPaidCents: 0, amountCents: 50000, invoiceTotalCents: 186000, settles: false }),
    { paidTotalCents: 50000, fullyPaid: false })
})

test("reaching the invoice total settles", () => {
  assert.deepEqual(
    paymentRollup({ currentPaidCents: 50000, amountCents: 136000, invoiceTotalCents: 186000, settles: false }),
    { paidTotalCents: 186000, fullyPaid: true })
})

test("overpayment still settles and keeps the real total", () => {
  assert.deepEqual(
    paymentRollup({ currentPaidCents: 0, amountCents: 200000, invoiceTotalCents: 186000, settles: false }),
    { paidTotalCents: 200000, fullyPaid: true })
})

test("no invoice: only the owner's word settles", () => {
  assert.equal(paymentRollup({ currentPaidCents: 0, amountCents: 40000, invoiceTotalCents: null, settles: false }).fullyPaid, false)
  assert.equal(paymentRollup({ currentPaidCents: 0, amountCents: 40000, invoiceTotalCents: null, settles: true }).fullyPaid, true)
})

test("null current rollup reads as zero", () => {
  assert.equal(paymentRollup({ currentPaidCents: null, amountCents: 100, invoiceTotalCents: null, settles: false }).paidTotalCents, 100)
})

test("the action is owner-gated and persists the receipt before the rollup", () => {
  const src = readFileSync("app/ops/actions.ts", "utf8")
  const action = src.slice(src.indexOf("export async function recordPayment"))
  assert.notEqual(action.length, src.length, "recordPayment exists")
  assert.match(action.slice(0, 400), /requireOwner\(operator\)/)
  // event first, leads UPDATE second — intent persists before the side effect
  assert.ok(action.indexOf("recordEvent") < action.indexOf("UPDATE leads"))
})
```

- [ ] **Step 2: Run it** — `node --test scripts/payments.test.mjs` — expect FAIL (module missing).
- [ ] **Step 3: Write `lib/payments.mjs`:**

```js
// Rollup math for money in hand. QuickBooks payments arrive with their own
// running total (GREATEST semantics in the ingest); manual payments increment.
export function paymentRollup({ currentPaidCents, amountCents, invoiceTotalCents, settles }) {
  const paidTotalCents = Math.max(0, Math.trunc(Number(currentPaidCents ?? 0))) + Math.trunc(Number(amountCents))
  const fullyPaid = settles === true ||
    (invoiceTotalCents !== null && invoiceTotalCents !== undefined &&
      Number(invoiceTotalCents) > 0 && paidTotalCents >= Number(invoiceTotalCents))
  return { paidTotalCents, fullyPaid }
}
```

And `lib/payments.d.mts`:

```ts
export function paymentRollup(input: {
  currentPaidCents: number | null | undefined
  amountCents: number
  invoiceTotalCents: number | null | undefined
  settles: boolean
}): { paidTotalCents: number; fullyPaid: boolean }
```

- [ ] **Step 4: Write `recordPayment`** in `app/ops/actions.ts`, directly after `recordInvoice`, importing `paymentRollup` from `@/lib/payments.mjs`:

```ts
// Money in hand. Cash and checks never reach the QuickBooks ingest, so without
// this the job stays "still out" forever. The event is the receipt and lands
// first; the rollup on leads follows. DONE and PAID stay separate truths.
export async function recordPayment(formData: FormData) {
  const operator = await requireOperator()
  requireOwner(operator)
  const leadId = parseLeadId(formData.get("leadId"))
  const amountCents = parseDollarsToCents(formData.get("paymentAmount"))
  if (!amountCents || amountCents <= 0) throw new Error("Enter the amount that changed hands.")
  const methodRaw = String(formData.get("paymentMethod") ?? "")
  const method = ["cash", "check", "card", "other"].includes(methodRaw) ? methodRaw : "other"
  const settles = String(formData.get("settles") ?? "") === "1"
  const receiptKey = String(formData.get("receiptKey") ?? "").trim().slice(0, 80)

  const sql = getSql()
  const current = (await sql`
    SELECT person_id, paid_amount_cents, invoice_total_cents, invoice_number
    FROM leads WHERE id = ${leadId}::bigint LIMIT 1`) as Array<{
    person_id: number | null
    paid_amount_cents: number | null
    invoice_total_cents: number | null
    invoice_number: string
  }>
  if (!current[0]) throw new Error("Work order not found.")

  const { paidTotalCents, fullyPaid } = paymentRollup({
    currentPaidCents: current[0].paid_amount_cents === null ? null : Number(current[0].paid_amount_cents),
    amountCents,
    invoiceTotalCents: current[0].invoice_total_cents === null ? null : Number(current[0].invoice_total_cents),
    settles,
  })

  const eventId = await recordEvent({
    kind: fullyPaid ? "invoice.paid" : "invoice.payment-received",
    actorType: "operator",
    actorId: operator.id,
    leadId,
    personId: current[0].person_id,
    externalId: receiptKey ? `manual-payment:${receiptKey}` : "",
    body: `$${(amountCents / 100).toLocaleString("en-US")} ${method} in hand${current[0].invoice_number ? ` — INV #${current[0].invoice_number}` : ""}${fullyPaid ? ", squared up" : ""}`,
    detail: { amountCents, method, paidTotalCents, fullyPaid, manual: true },
  })
  // A duplicate receiptKey means this exact payment already landed (double
  // submit); do not add it twice. ponytail: a crash between receipt and rollup
  // needs the owner to re-enter with a fresh page load — visible, not silent.
  if (eventId === null && receiptKey) {
    revalidatePath(`/ops/leads/${leadId}`)
    revalidatePath("/board")
    return
  }

  await sql`
    UPDATE leads SET
      paid_amount_cents = ${paidTotalCents}::bigint,
      paid_at = CASE WHEN ${fullyPaid}::boolean THEN COALESCE(paid_at, now()) ELSE paid_at END,
      updated_at = now()
    WHERE id = ${leadId}::bigint`

  revalidatePath(`/ops/leads/${leadId}`)
  revalidatePath("/board")
}
```

(If `recordEvent` is not yet imported in `actions.ts`, add it to the existing `@/lib/events` import.)

- [ ] **Step 5: Add the form** to `app/ops/leads/[id]/page.tsx`, immediately after the `recordInvoice` form's closing tag, **inside the same owner-only block that form sits in** (verify the enclosing conditional before placing; the server action re-checks regardless). `randomUUID` is already imported in this file:

```tsx
          <form action={recordPayment} className="job-form">
            <input type="hidden" name="leadId" value={lead.id} />
            <input type="hidden" name="receiptKey" value={randomUUID()} />
            <label htmlFor="payment-amount">
              Money in hand. Cash and checks never hit QuickBooks on their own.
            </label>
            <input id="payment-amount" name="paymentAmount" inputMode="decimal" placeholder="Amount received" aria-label="Payment amount" />
            <select name="paymentMethod" defaultValue="cash" aria-label="How it was paid">
              <option value="cash">cash</option>
              <option value="check">check</option>
              <option value="card">card</option>
              <option value="other">other</option>
            </select>
            {!lead.invoice_total_cents && (
              <label className="job-check">
                <input type="checkbox" name="settles" value="1" />
                this squares the job
              </label>
            )}
            <SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Recording...">Record payment</SafeSubmitButton>
            {Number(lead.paid_amount_cents ?? 0) > 0 && (
              <span className="job-current t-caption">
                Paid {money(lead.paid_amount_cents)}
                {lead.invoice_total_cents ? ` of ${money(lead.invoice_total_cents)}` : ""}
                {lead.paid_at
                  ? " · squared up"
                  : lead.invoice_total_cents
                    ? ` · ${money(Math.max(0, Number(lead.invoice_total_cents) - Number(lead.paid_amount_cents ?? 0)))} still out`
                    : ""}
              </span>
            )}
          </form>
```

Add `recordPayment` to the existing `../../actions` import list in the page.

- [ ] **Step 6: Wire the suite** — add `scripts/payments.test.mjs` to `test:shop-brain` in `package.json`.
- [ ] **Step 7: Verify** — `node --test scripts/payments.test.mjs` PASS; `npm run typecheck && npm run lint && npm run test:shop-brain` green. Crew safety needs no new code: `projectLeadForRole` already nulls `paid_amount_cents`, `invoice_total_cents`, and `paid_at` reaches crew only as presence — confirm the crew projection list in `lib/ops-data.ts:70` covers `paid_amount_cents` and `invoice_total_cents`; if either is missing from the nulled set, add it there (server-side), and note it in the commit.
- [ ] **Step 8: Commit** — `git commit -m "feat(money): record cash and check payments so still-out tells the truth"`

### Task 3: "The week" on the board

Day-by-day dues for the next seven days: open promises (both roles), follow-ups (both roles), unpaid invoice dues (owner only, stripped server-side by never being queried for crew).

**Files:**
- Modify: `lib/ops-data.ts` (new `getWeekAhead` + types, near `getOutTheDoorWeek` ~900)
- Modify: `app/board/page.tsx` (fetch in the existing `Promise.all`; pass through)
- Modify: `app/board/board.tsx` (add to `BoardPaneData`; render the card in the pane after the promises card ~line 419)
- Modify: `app/board/board.css` (`.week` rules from existing tokens)
- Create: `scripts/week-ahead.test.mjs`
- Modify: `package.json` (wire the test)

**Interfaces:**
- Consumes: `getSql` from `@/lib/db`, `OperatorRole` from `@/lib/operators`.
- Produces:

```ts
export type WeekAheadItem = { leadId: number | null; label: string; customer: string }
export type WeekAheadDay = {
  date: string       // YYYY-MM-DD, Central
  dow: string        // "Mon", "Tue", ... "Today" for the first entry
  promises: WeekAheadItem[]
  invoices: WeekAheadItem[]  // always [] for crew
  followUps: WeekAheadItem[]
}
export async function getWeekAhead(role: OperatorRole, includeTests?: boolean): Promise<WeekAheadDay[]>
```

- [ ] **Step 1: Write the failing test** — `scripts/week-ahead.test.mjs` (static pins; the repo's DB-less suites assert source shape):

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const opsData = readFileSync("lib/ops-data.ts", "utf8")
const fn = opsData.slice(opsData.indexOf("export async function getWeekAhead"))

test("getWeekAhead exists and works in Central time", () => {
  assert.notEqual(fn.length, opsData.length)
  assert.match(fn, /America\/Chicago/)
})

test("crew never queries the invoice lane", () => {
  // the invoice query must be gated on role before it runs, not filtered after
  const invoiceIdx = fn.indexOf("invoice_due_at")
  assert.ok(invoiceIdx > -1, "invoice lane exists")
  assert.match(fn.slice(0, invoiceIdx), /role === "owner"/)
})

test("test rows stay out of the week", () => {
  assert.match(fn, /is_test/)
})

test("the board renders the week card honestly", () => {
  const board = readFileSync("app/board/board.tsx", "utf8")
  assert.match(board, /card week/)
  assert.match(board, /Nothing due in the next seven days\./)
})
```

- [ ] **Step 2: Run it** — `node --test scripts/week-ahead.test.mjs` — FAIL.
- [ ] **Step 3: Write `getWeekAhead`** in `lib/ops-data.ts`:

```ts
export type WeekAheadItem = { leadId: number | null; label: string; customer: string }

export type WeekAheadDay = {
  date: string
  dow: string
  promises: WeekAheadItem[]
  invoices: WeekAheadItem[]
  followUps: WeekAheadItem[]
}

const WEEK_DOW = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" })
const WEEK_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }) // YYYY-MM-DD

// The coming seven days, day by day: promises we made, invoices coming due,
// follow-ups on the calendar. Crew never gets the invoice lane — it is not
// queried for them at all, the same server-side rule as every other money path.
export async function getWeekAhead(role: OperatorRole, includeTests = false): Promise<WeekAheadDay[]> {
  const sql = getSql()
  const dues = (await sql`
    SELECT 'promise'::text AS lane,
      to_char(c.due_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') AS day,
      c.lead_id::bigint AS lead_id,
      c.summary, c.crew_summary,
      btrim(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')) AS customer
    FROM commitments c
    LEFT JOIN leads l ON l.id = c.lead_id
    WHERE c.status = 'open' AND c.direction = 'we_promised' AND c.due_at IS NOT NULL
      AND c.due_at >= now() AND c.due_at < now() + interval '7 days'
      AND (l.id IS NULL OR l.is_test = false OR ${includeTests}::boolean)
    UNION ALL
    SELECT 'followup'::text AS lane,
      to_char(l.next_follow_up_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') AS day,
      l.id::bigint AS lead_id,
      ('Follow up — ' || l.service)::text AS summary, NULL::text AS crew_summary,
      btrim(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')) AS customer
    FROM leads l
    WHERE l.next_follow_up_at IS NOT NULL
      AND l.next_follow_up_at >= now() AND l.next_follow_up_at < now() + interval '7 days'
      AND l.status NOT IN ('lost', 'spam') AND l.completed_at IS NULL
      AND (l.is_test = false OR ${includeTests}::boolean)
    ORDER BY day ASC`) as Array<{
      lane: string; day: string; lead_id: number | null
      summary: string; crew_summary: string | null; customer: string
    }>

  const invoiceDues = role === "owner" ? (await sql`
    SELECT to_char(l.invoice_due_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') AS day,
      l.id::bigint AS lead_id,
      ('INV #' || l.invoice_number || ' due')::text AS summary,
      btrim(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')) AS customer
    FROM leads l
    WHERE l.invoice_due_at IS NOT NULL AND l.paid_at IS NULL
      AND l.invoice_due_at >= now() AND l.invoice_due_at < now() + interval '7 days'
      AND (l.is_test = false OR ${includeTests}::boolean)
    ORDER BY day ASC`) as Array<{ day: string; lead_id: number; summary: string; customer: string }> : []

  const days: WeekAheadDay[] = []
  const byDate = new Map<string, WeekAheadDay>()
  for (let i = 0; i < 7; i++) {
    const at = new Date(Date.now() + i * 86_400_000)
    const day: WeekAheadDay = {
      date: WEEK_DAY.format(at),
      dow: i === 0 ? "Today" : WEEK_DOW.format(at),
      promises: [], invoices: [], followUps: [],
    }
    days.push(day)
    byDate.set(day.date, day)
  }
  for (const row of dues) {
    const day = byDate.get(row.day)
    if (!day) continue
    const label = role === "owner"
      ? row.summary
      : (row.crew_summary?.trim() || (row.lane === "promise" ? "A promise on the books" : row.summary))
    const item = { leadId: row.lead_id === null ? null : Number(row.lead_id), label, customer: row.customer || "Unknown" }
    if (row.lane === "promise") day.promises.push(item)
    else day.followUps.push(item)
  }
  for (const row of invoiceDues) {
    const day = byDate.get(row.day)
    if (!day) continue
    day.invoices.push({ leadId: Number(row.lead_id), label: row.summary, customer: row.customer || "Unknown" })
  }
  return days
}
```

- [ ] **Step 4: Fetch on the board** — `app/board/page.tsx`: add `getWeekAhead` to the imports from `@/lib/ops-data`, add `getWeekAhead(role, includeTests)` into the existing `Promise.all` array, add the result to the `board={{ ... }}` props as `week`.
- [ ] **Step 5: Render the card** — `app/board/board.tsx`: add `week: WeekAheadDay[]` to `BoardPaneData` (and `WeekAheadDay` to the type imports from `@/lib/ops-data`; `EMPTY_BOARD` in `page.tsx` gets `week: []`). In the pane, after the promises card's closing tag:

```tsx
        <section className="card week">
          <h4>The week</h4>
          {board.week.every((d) => !d.promises.length && !d.invoices.length && !d.followUps.length)
            ? <p className="t-caption">Nothing due in the next seven days.</p>
            : board.week
                .filter((d) => d.promises.length || d.invoices.length || d.followUps.length)
                .map((d) => (
                  <div key={d.date} className="week-day">
                    <span className="week-dow t-caption">{d.dow}</span>
                    <ul>
                      {[...d.promises, ...d.invoices, ...d.followUps].map((item, i) => (
                        <li key={`${d.date}-${i}`}>
                          {item.leadId
                            ? <Link href={`/ops/leads/${item.leadId}`}>{item.label}</Link>
                            : <span>{item.label}</span>}
                          <span className="t-caption"> · {item.customer}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
        </section>
```

- [ ] **Step 6: Style it** — `app/board/board.css`, beside the existing pane card rules, tokens only (no hex): `.week-day` as a grid row (`auto 1fr`), `.week-dow` right-aligned in the label column, `ul` unstyled with the pane's existing row spacing, links inheriting the pane's link treatment. Match the promises card's paddings exactly — same card, same rhythm.
- [ ] **Step 7: Wire the suite** — add `scripts/week-ahead.test.mjs` to `test:shop-brain` in `package.json`.
- [ ] **Step 8: Verify** — new suite PASS; `npm run typecheck && npm run lint && npm run test:shop-brain` green; eyeball `/board` locally with a due commitment (or the honest empty line) at 320px and desktop.
- [ ] **Step 9: Commit** — `git commit -m "feat(board): put the coming week's dues on the pane"`

### Task 4: Stage overflow pager + board fetch tidy-up

`listBoardJobs` holds a whole stage on one page (cap 100) and already computes `page` and `hasNext`; nothing reads them. Beyond 100, jobs are unreachable. Also: the voice snapshot fetch runs serially after the `Promise.all` for no reason.

**Files:**
- Modify: `app/board/page.tsx` (parse `?p=`, pass `page`; move `getOwnerVoiceSnapshot` into the `Promise.all`)
- Modify: `app/board/board.tsx` (`page`/`hasNext` in `BoardPaneData`, `boardHref` page param, pager markup)
- Modify: `app/board/board.css` (`.pager` rules)
- Test: extend `scripts/job-control-tracker.test.mjs`

**Interfaces:**
- Consumes: `listBoardJobs` (`options.page`, returns `{ page, hasNext, resultTotal, pageSize }` — it already clamps a too-large `page` back to the last real page); `normalizePage` from `@/lib/pagination`.
- Produces: `?p=<n>` as the board's only paging parameter; `boardHref({ page })`.

- [ ] **Step 1: Write the failing test** — append to `scripts/job-control-tracker.test.mjs`:

```js
test("the tracker paginates honestly past a full page", () => {
  const board = readFileSync("app/board/board.tsx", "utf8")
  assert.match(board, /hasNext/)
  assert.match(board, /Show the next/)
  const page = readFileSync("app/board/page.tsx", "utf8")
  assert.match(page, /params\.p\b/)
})

test("the voice snapshot rides the parallel fetch", () => {
  const page = readFileSync("app/board/page.tsx", "utf8")
  const all = page.slice(page.indexOf("Promise.all"), page.indexOf("])", page.indexOf("Promise.all")))
  assert.match(all, /getOwnerVoiceSnapshot/)
})
```

- [ ] **Step 2: Run it** — FAIL.
- [ ] **Step 3: Parse and pass the page** — `app/board/page.tsx`: extend `SearchParams` with `p?: string`; `const page = normalizePage(params.p)` (match `normalizePage`'s actual signature — it is already used by the job page for the same purpose); pass `page` into `listBoardJobs({ stage, signal, order: "oldest", query, includeTests, page }, role)`; pass `page: pageResult.page` and `hasNext: pageResult.hasNext` through the `board={{ ... }}` props (`EMPTY_BOARD` gets `page: 1, hasNext: false`). Replace the serial voice fetch: inside the `Promise.all` array add `role === "owner" ? getOwnerVoiceSnapshot() : Promise.resolve(null)` and delete the standalone `await` line.
- [ ] **Step 4: Render the pager** — `app/board/board.tsx`: add `page: number` and `hasNext: boolean` to `BoardPaneData`; extend `boardHref` to accept `page` and set `p` only when `page > 1`; after the tracker's row list (below the `countLine` rendering), when the stage overflows:

```tsx
      {(board.hasNext || board.page > 1) && (
        <nav className="pager" aria-label="More jobs">
          {board.page > 1 && (
            <Link className="btn btn--sm" href={boardHref({ page: board.page - 1 })}>Back</Link>
          )}
          {board.hasNext && (
            <Link className="btn btn--sm btn--edge" href={boardHref({ page: board.page + 1 })}>
              Show the next {Math.min(board.pageSize, board.resultTotal - board.page * board.pageSize)}
            </Link>
          )}
        </nav>
      )}
```

Stage tab and signal links keep resetting to page 1 — `boardHref` sets `p` only when a `page` argument is passed, so existing call sites need no change.

- [ ] **Step 5: Style it** — `.pager` in `board.css`: a flex row, existing button classes do the rest; margin matching the tracker's row gap.
- [ ] **Step 6: Verify** — extended suite PASS; `npm run typecheck && npm run lint && npm run test:shop-brain` green; locally force `pageSize` small once by hand (temporary `pageSize: 2` in the `listBoardJobs` call, walk forward and back, then revert — do not commit the override).
- [ ] **Step 7: Commit** — `git commit -m "feat(board): reach past a full page, and fetch the voice snapshot in parallel"`

### Task 5: Exit verification

Nothing in this task changes behavior; a real failure gets reported, not patched around.

**Files:**
- Modify: `docs/superpowers/plans/2026-08-21-cohesion-round.md` (tick every box)
- Modify: `MCSW-JOBS-BUILD-HANDOFF.md` (one dated paragraph: journal unified on `events`, manual payments live, week card live, tracker pager live)

- [ ] **Step 1: Full gates** — `npm run typecheck && npm run lint && npm run test:shop-brain` — paste output verbatim into the session log.
- [ ] **Step 2: Migration dry-run** — `npm run migrate` against the shared database (idempotent; the only new statement is the `COMMENT ON TABLE`). Confirm exit 0 twice in a row.
- [ ] **Step 3: Owner QA** — run the QA Procedure above against the deployed preview; record which steps ran and which are blocked (step 8's crew half stays blocked until a crew operator exists — same standing deferral as the conversion plan's Step 3b).
- [ ] **Step 4: Docs** — tick this plan; add the handoff paragraph; confirm `CLAUDE.md`'s events bullet reads the frozen-history wording from Task 1.
- [ ] **Step 5: Commit** — `git commit -m "docs: close out the cohesion round"`

## Self-Review

- **Coverage:** dual-write retirement (T1: all six write sites, both read gates, dead reader, schema comment, invariant doc), manual payments (T2: helper, action, form, crew projection check), week strip (T3: query, pane card, CSS, role gating), overflow + fetch tidy (T4), verification (T5). The restore drill is explicitly excluded by the owner. No seam task: the C0–C8 conversion already shipped the one design language.
- **Placeholders:** none — every step carries its code or the exact grep that decides it.
- **Type consistency:** `recordLeadEvent` keeps its public signature; `WeekAheadDay`/`WeekAheadItem` defined once in T3 and consumed by name in T3's board steps; `paymentRollup` shape identical in `.mjs`, `.d.mts`, tests, and the action; `boardHref({ page })` matches the `BoardPaneData.page: number` added in T4.
- **Known ceilings, stated:** payment double-entry protection is per-page-load (`receiptKey`); a crash between receipt and rollup surfaces as a visible mismatch the owner re-enters — commented `ponytail:` in the action. Week strip buckets by calendar day and ignores time-of-day ordering within a day — fine at shop volume.
