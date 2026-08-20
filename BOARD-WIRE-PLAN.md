# /board — finish the wiring

The redesign shipped the frame. The mockup (`3db03ad`) had an expanded job row
and a full chrome of controls; `b29a743` dropped 353 lines when it wired the
tracker to real data, and the expand panel went with them. The CSS for it is
still in `board.css` — only the markup is gone.

This is the map of every control on `/board`, what backs it, and what does not.

Session split: `BOARD-WIRE-SESSION-PLAN.md` — six sessions, W1–W6.

## 1. What is dead right now

| # | Control | State | Real destination / data |
|---|---------|-------|--------------------------|
| 1 | `Monday, Aug 19` in the header | hardcoded string | today's date, Central |
| 2 | Search box | no wiring | `listBoardJobs({ query })` already exists → GET form to `?q=` |
| 3 | "New job" button | dead | `/ops/intake/new` |
| 4 | Theme toggle | **works** | — |
| 5 | `who-dot` "P" | hardcoded | operator's first initial |
| 6 | Rail · Board | dead | `/board` (current) |
| 7 | Rail · Leads | dead | `/ops` |
| 8 | Rail · Customers | dead | `/ops?view=regulars` |
| 9 | Rail · Quotes | dead | `/ops?stage=waiting` |
| 10 | Rail · Promises | dead | `/ops?view=promises` |
| 11 | Rail · Money | dead | `/ops/analytics` (owner only — hide for crew) |
| 12 | Rail · Help | dead | `/ops/install` |
| 13 | Pane signal buttons ×5 | dead | filter the tracker: `?signal=<kind>` — **needs a new filter in `listBoardJobs`** |
| 14 | "Work the N that need you" | dead | `?stage=attention` |
| 15 | Call sketch "Open the job" | dead | **needs `leadId` added to `BoardCallSketch`** (`calls.lead_id` is already joined) |
| 16 | "Text him the three" | dead | `/ops/leads/<id>#message` — the composer already lives there |
| 17 | **Tracker row expand** | **absent entirely** | see §2 |
| 18 | Sort chip | honest label, not a button | leave |

## 2. The expand panel

Mockup layout, three blocks. What each one can honestly say:

### A — "The part"
- Header line: real photo count and the date of the newest photo, or "No photos yet".
- Drawing: the mockup's stair-stringer plan was drawn by hand for one fixture and
  cannot be regenerated per job. Honest substitute: the customer's own photo when
  there is one, falling back to the row's `serviceMark` at plan size — that mark is
  already keyed on the real service.
- Spec chips: one per active claim (`listActiveClaims("lead", id)`), labelled with
  `shopClaimLabel` / `shopClaimText`.
- Caption: how many facts are still open, from the same claim set.

### B — Stage rail (Asked → Measured → Priced → Booked → Paid)
Every cell is a column that already exists:

| Stage | Fact 1 | Fact 2 |
|-------|--------|--------|
| Asked | `created_at`, `shopSourceLabel(source)` | first reply = `first_response_at − created_at`, else "none yet" |
| Measured | newest photo date, `photo_count` | active claim count |
| Priced | `quoted_at`, `estimate_value_cents` | days since `quoted_at` |
| Booked | commitment due date or `scheduled_at` | `won_at ? "Booked" : "Not booked"` |
| Paid | `invoice_due_at` terms, else "On pickup" | `person_job_count` prior jobs |

Knot state (done / now / off) comes from which timestamps exist — no guessing.

### C — Why it needs you
- Left: the money sentence from the real fields plus `status_reason` / `notes` when
  present, then the real broken-promise line from `listCommitments`. Actions:
  **Open job** (`/ops/leads/<id>`), **Call** (`tel:`), **Text** (`sms:`) — all real links.
- Right: **"What is in it" stays.** Nothing stored per-line material, hours or
  delivery cost today, so the table gets a real store rather than a cut — the
  owner enters the costs. New `job_line_items` table, one row per line:

  | column | holds | mockup example |
  |--------|-------|----------------|
  | `label` | what it is | `Steel` |
  | `note` | the qualifier in grey | `10 ga galv, 18 pcs` |
  | `amount_cents` | the money | `$1,860` |
  | `position` | display order | 1 |

  The footer row is the job's quoted price (`estimate_value_cents`), not the sum —
  and when the lines do not add up to it, the panel says so instead of hiding the
  gap. A job with no lines yet shows an honest empty state and the link to add
  them; it never shows a number nobody typed.

  Entry is owner-only and lives on `/ops/leads/<id>` beside `saveEstimate`, which
  is already where money is entered. The panel's "Change the price" button links
  there. Crew never receives line items — stripped server-side in
  `getBoardJobDetails`, the same way `projectLeadForRole` nulls every other money
  field.

### Interaction
One row open at a time, `useState` in the existing client component — matches the
mockup's `[data-open]` CSS and costs no round trip. A URL param would refetch the
whole page on every toggle, and Neon compute is metered.

### Query cost
The panel needs claims, commitments and events per row. Fetched **batched by page**
— one query each over the visible ids, not one per row. New
`getBoardJobDetails(ids, role)` in `lib/ops-data.ts` returning a map.

## 3. Invariants this must not break

- [x] Crew rows arrive with every money field nulled. The panel shows "no price",
  never a hidden-in-CSS number.
- [x] `[INTERNAL TEST]` / `is_test` rows stay excluded, as they already are.
- [x] No hand-typed fixture survives onto the page. `job-control-tracker.test.mjs`
  already asserts the mockup names are gone — extend it to the panel.
- [x] No per-worker anything. Operator attribution stays a byline.
