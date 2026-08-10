# MCSW "SHOP BRAIN" — Future CRM Plan (v-next of /ops)

## Context

Music City Specialty Welding runs a live custom CRM at `/ops` (shipped 2026-08-03): lead board, work orders, magic-link auth, Neon Postgres, push, digest crons. Solid but conventional — every fact in it was typed by a human.

Goal: a CRM **5-10 years ahead**, for rugged shop guys (owner Philippe + 2-5 crew, mid-30s, gloves on, hate typing). It keeps itself up to date by observing (calls, texts, emails, voice), interrupts max 3×/day, is mostly invisible, and answers questions with receipts.

**Owner decisions (2026-08-08):**
- Quality over speed; evolve live `/ops` deeply (additive), never break it.
- All four pillars: ask-anything, voice/hands-dirty, GLASS customer page, promise tracker — plus whatever Claude maps.
- Owner + crew day one → per-person identity, **zero worker surveillance**.
- Twilio yes (number bought in days). Shop number (615) 810-4910 **is the owner's cell** → buy NEW local 615 tracking number, forward to cell, advertise it everywhere going forward.
- Crew sign-in: **both** email magic-link AND phone-number SMS-code (via Twilio).
- Gmail: **full read access approved** (inbound + sent) on sales@ (Google Workspace).
- GLASS scope: full trust — status + promised date, progress photos, quote/invoice amount, text-the-shop button.
- Implementation happens in a separate session/tool — this plan is the self-contained handoff.
- **Crew is phone-over-email, talk-over-text** ("old school dudes, but not old school yet"). Voice-first everywhere: Call is the primary action above Text on every surface, audio brief is the default (day sheet is the fallback), hold-to-talk beats typing, Twilio VOICE ships day one (A2P registration wait blocks SMS only, not calls).

**Hard design constraints:**
- **Shop Wall design language** (approved, loved): every new UI element = physical shop object. NO candy colors, NO hazard stripes, NO section numbering, NO faint text, NO editorial polish, steel > wood. Extend the existing `THE SHOP WALL` layer in `app/globals.css`; never add a flat design system.
- Neon single DB shared dev/preview/prod: **additive-only idempotent migrations** in `scripts/migrate.mjs` array pattern; no renames/drops/type changes; `[INTERNAL TEST]`/`is_test` respected end-to-end; always cast params (`::bigint`, `::boolean`, `::text`, `::timestamptz`) — untyped params in CASE/boolean contexts throw 42P18.
- Persistence-first doctrine (DB row before any side effect), as in `app/api/quote/route.ts`.

## Verified current state (repo, 2026-08-08)

- Next.js 16.2 App Router, React 19, TS; hand-written `app/globals.css` (3,938 lines, Shop Wall layers). Vercel hosting, auto-deploy `main`.
- `/ops` = 2 pages: `app/ops/page.tsx` (lead board: NEEDS YOU NOW strip, speed gauge, stat tiles, paper job tickets with rubber-ink stamps), `app/ops/leads/[id]/page.tsx` (work order). All mutations = server actions in `app/ops/actions.ts`, gated by `requireOperator()`, all writing `lead_events`.
- Tables (`scripts/migrate.mjs`): `leads` (pipeline new→contacted→qualified→quoted→won|lost|spam, money cents, invoice fields, gclid/UTM attribution, photos JSONB), `lead_events` (append-only, `lead_id NOT NULL`), `rate_limits`, `ops_tokens` (sha256 magic-link, 15min login/30day session), `push_subscriptions`, `automation_runs`.
- Intake: public `POST /api/quote` (persistence-first, private Blob `mcsw-lead-photos`), manual write-up form. Phone calls = manual write-up only. **No Twilio, no AI code, no email ingestion.**
- Auth: ONE shared operator email (`sales@musiccityspecialtywelding.com`) — all crew are the same principal; `lead_events.actor` identical for everyone.
- Notifications: Resend (5 branded flows via `lib/email-templates.ts`), web push (`lib/push.ts`, `public/ops-sw.js`), Vercel cron daily digest 12:00 UTC, GitHub Actions hourly reminders + 5-min health. `CRON_SECRET` bearer auth.
- Google Ads offline conversions = manual CSV export. QuickBooks invoices re-keyed by hand.

## Ground truth from real sales@ inbox (read 2026-08-08; gmail was down ~1 month, fixed — last week is representative)

0. **Majority of leads arrive by PHONE** (owner-stated) — email is thin for lead flow. Twilio call capture is the #1 ingestion channel; gmail's value is the money loop (QB) + commercial RFQ threads, not lead intake.
1. **QuickBooks is the money spine, invisible to CRM**: invoices #1326–1338 paid in one week ($75–$4,485/job). "Payment received"/"Money on the way" emails land in gmail; board tracking is manual. → Parsing QB emails auto-closes invoices.
2. **Quoting happens in email replies**: Philip prices jobs by replying to quote-notification emails ("$300 to weld the ornamental bracket back on -Philip"); commercial RFQs (DXF attachments, per-piece pricing 96 pcs @ $5.99ea) run as long gmail threads that never touch /ops. → Sent-mail ingestion is where promises live.
3. **Champion-left signal exists**: auto-reply "no longer with Real Floors as of July 31… contact Stacey Muhs or Gabe Stephenson" from a repeat commercial customer's contact. → Extraction must classify auto-replies, emit contact-churn with successor names.
4. **Repeat commercial customers are the revenue core** (Real Floors, PepsiCo, sister co. NEVERLIFT) — but there's no customers concept; every job is a fresh row.
5. **Recurring toil**: W-9 + insurance-cert threads → one-tap "send the usual paperwork" action (pre-attached W-9 + COI PDFs), zero AI needed.

---

# PART A — ARCHITECTURE

Stance: existing `/ops` stays the walking skeleton. Everything is **additive** — new tables, routes, lib modules.

## A1. Data substrate

### `events` — NEW table (do not widen `lead_events`; its `lead_id NOT NULL` FK can't hold person-level/unknown-caller/system events)
```sql
CREATE TABLE IF NOT EXISTS events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL,          -- 'sms.in','sms.out','call.in','call.missed','call.transcript',
                               -- 'email.in','email.out','email.payment','form.quote','photo.added',
                               -- 'status.changed','note.text','note.voice','glass.view',
                               -- 'glass.correction','commitment.made','contact.churn','brief.morning'
  actor_type TEXT NOT NULL DEFAULT 'system',   -- operator|customer|system|ai
  actor_id TEXT NOT NULL DEFAULT '',
  lead_id BIGINT REFERENCES leads(id),          -- nullable on purpose
  person_id BIGINT,
  external_id TEXT NOT NULL DEFAULT '',         -- Twilio SID / Gmail message id / Resend id
  body TEXT NOT NULL DEFAULT '',
  detail JSONB,
  processed_at TIMESTAMPTZ                      -- AI extraction marker
);
CREATE INDEX IF NOT EXISTS events_lead_idx ON events(lead_id, occurred_at);
CREATE INDEX IF NOT EXISTS events_person_idx ON events(person_id, occurred_at);
CREATE INDEX IF NOT EXISTS events_kind_idx ON events(kind, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS events_external_idx ON events(kind, external_id) WHERE external_id <> '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', body)) STORED;
CREATE INDEX IF NOT EXISTS events_tsv_idx ON events USING GIN(tsv);
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```
- Append-only by convention: `lib/events.ts` exports only `recordEvent()` + readers. `(kind, external_id)` unique partial index makes webhook retries idempotent (`ON CONFLICT DO NOTHING`).
- Backfill `scripts/backfill-events.mjs` copies `lead_events` history in. Later, lead timeline reads `events`; `recordLeadEvent` dual-writes; `lead_events` frozen, never dropped.
- **No pgvector yet** (deliberate): FTS GIN + pg_trgm covers this scale; ask-anything is agentic (iterative search), forgiving of imperfect recall. Trigger to add: demonstrable misses or >50k events.

### `people` — customers persist across jobs
```sql
CREATE TABLE IF NOT EXISTS people (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  display_name TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  phones TEXT[] NOT NULL DEFAULT '{}',   -- E.164
  emails TEXT[] NOT NULL DEFAULT '{}',
  merged_into BIGINT REFERENCES people(id),   -- dedupe by supersede, never delete
  is_test BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS people_phones_idx ON people USING GIN(phones);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS person_id BIGINT REFERENCES people(id);
```
`lib/people.ts`: `normalizePhone()` (E.164 US), `findOrCreatePersonByPhone/Email()`, `attachLeadToPerson()`. Every intake path (quote form, manual, Twilio, gmail) stamps `person_id`. Backfill `scripts/backfill-people.mjs` groups existing leads by normalized phone (re-runnable, `WHERE person_id IS NULL`). Board shows "Repeat — 3 prior jobs".

### `claims` — facts with provenance + confidence, superseded not edited
```sql
CREATE TABLE IF NOT EXISTS claims (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  subject_type TEXT NOT NULL,           -- 'lead'|'person'
  subject_id BIGINT NOT NULL,
  predicate TEXT NOT NULL,              -- 'deadline','gate_code','material','address','contact_successor',...
  value JSONB NOT NULL,
  confidence REAL NOT NULL,             -- operator-stated = 1.0
  source_event_id BIGINT NOT NULL REFERENCES events(id),   -- provenance mandatory
  extracted_by TEXT NOT NULL,
  superseded_by BIGINT REFERENCES claims(id)
);
CREATE INDEX IF NOT EXISTS claims_subject_idx ON claims(subject_type, subject_id) WHERE superseded_by IS NULL;
```
Correction = insert new + set `superseded_by` (the single permitted UPDATE, via `supersedeClaim()` in `lib/claims.ts`).

### `commitments` — promises first-class
```sql
CREATE TABLE IF NOT EXISTS commitments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lead_id BIGINT REFERENCES leads(id),
  person_id BIGINT REFERENCES people(id),
  direction TEXT NOT NULL,              -- 'we_promised'|'they_promised'
  operator_id BIGINT,                   -- provenance, never aggregated per-worker
  summary TEXT NOT NULL,
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open',  -- open|kept|broken|canceled|superseded
  status_changed_at TIMESTAMPTZ,
  status_source_event_id BIGINT REFERENCES events(id),
  source_event_id BIGINT NOT NULL REFERENCES events(id),
  confidence REAL NOT NULL,
  confirmed_by BIGINT,
  visible_on_glass BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS commitments_open_idx ON commitments(status, due_at) WHERE status = 'open';
```

### `operators`, Twilio raw, GLASS, notifications
```sql
CREATE TABLE IF NOT EXISTS operators (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'crew',    -- 'owner'|'crew'
  cell_phone TEXT NOT NULL DEFAULT '',  -- E.164; forwarding + SMS-code sign-in + alerts
  active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,             -- powers The Wire diff
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE ops_tokens ADD COLUMN IF NOT EXISTS operator_id BIGINT;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS operator_id BIGINT;

CREATE TABLE IF NOT EXISTS calls (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  twilio_sid TEXT UNIQUE NOT NULL,
  direction TEXT NOT NULL, from_phone TEXT NOT NULL, to_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_sec INT, recording_sid TEXT NOT NULL DEFAULT '', recording_url TEXT NOT NULL DEFAULT '',
  transcript TEXT NOT NULL DEFAULT '', transcript_status TEXT NOT NULL DEFAULT 'none',
  lead_id BIGINT REFERENCES leads(id), person_id BIGINT REFERENCES people(id), detail JSONB
);
CREATE TABLE IF NOT EXISTS messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  twilio_sid TEXT UNIQUE NOT NULL,
  direction TEXT NOT NULL, from_phone TEXT NOT NULL, to_phone TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '', media JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT '', sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lead_id BIGINT REFERENCES leads(id), person_id BIGINT REFERENCES people(id), operator_id BIGINT
);
CREATE TABLE IF NOT EXISTS glass_links (
  token_hash TEXT PRIMARY KEY,          -- sha256, same as ops_tokens discipline
  lead_id BIGINT NOT NULL REFERENCES leads(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by BIGINT, revoked_at TIMESTAMPTZ,
  last_viewed_at TIMESTAMPTZ, view_count INT NOT NULL DEFAULT 0,
  show_quote BOOLEAN NOT NULL DEFAULT true    -- owner chose full-trust default
);
CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  operator_id BIGINT,                   -- null = all
  priority TEXT NOT NULL,               -- 'interrupt'|'digest'
  title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
  sent_at TIMESTAMPTZ, coalesced BOOLEAN NOT NULL DEFAULT false,
  source_event_id BIGINT
);
```
Raw Twilio tables exist because provider truth mutates (status callbacks); every call/message ALSO emits an immutable `events` row.

## A2. Twilio

- Buy one local 615 number → new public number on site/GBP/ads. Forwards to owner cell. **File A2P 10DLC brand+campaign registration the day the number is bought** (days of lead time; unregistered SMS gets filtered).
- No Twilio SDK — inbound webhooks return TwiML XML strings; outbound = one `fetch` to REST API. `lib/twilio.ts`: HMAC-SHA1 `X-Twilio-Signature` validation (reject unsigned), `sendSms()`.
- Routes under `app/api/twilio/` (all signature-validated, persistence-first):
  - `voice` — insert `calls` + `events('call.in')`, match person/lead by phone, interrupt-notify ("Dale Simmons calling — trailer gate job"), TwiML `<Say>` recording disclosure + `<Dial answerOnBridge record="record-from-answer-dual" recordingStatusCallback=... action=...>{ownerCell}</Dial>`.
  - `voice-status` — on no-answer/busy/failed: `events('call.missed')`, **auto-text-back** ("sorry we missed you — text what you need + a photo"), create lead (`phone-in`) if no open lead, interrupt-notify.
  - `recording` — store recording sid/url, submit to Deepgram (callback mode), 200 fast.
  - `transcript` — Deepgram callback → `calls.transcript`, `events('call.transcript')` → extraction.
  - `sms` — inbound SMS/MMS → `messages` + `events('sms.in')` idempotent on SID; MMS media re-stored to `mcsw-lead-photos` Blob (Twilio URLs expire); match/create lead; interrupt-notify; extraction.
- Outbound SMS: `sendSmsToLead` server action + thread UI → `messages` + `events('sms.out', actor=operator)`.
- Lead attachment rule: normalize phone → person → most recent lead `status NOT IN ('lost','spam') AND updated_at > now()-'90 days'` → attach; else new lead. Unknown numbers always create a lead.
- **Transcription: Deepgram nova-3 pre-recorded API** (accepts Twilio recording URL directly, diarization = who promised what, ~$0.005/min). Rejected: Twilio Voice Intelligence (10-70x price), Whisper (no diarization, re-upload dance).
- Cost: ≈ $13-15/mo at shop volume (number $1.15, voice ~$4, SMS ~$5, A2P ~$2, Deepgram ~$1).

## A3. Gmail ingestion (owner approved full read on sales@)

- **Auth**: GCP project, enable Gmail API, OAuth consent screen set to **Internal** (Workspace-only → refresh tokens don't expire like consumer test-mode). One-time local script `scripts/gmail-auth.mjs` runs the flow for sales@, scope `gmail.readonly`, prints refresh token → Vercel env `GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN`. No service account / domain-wide delegation (ceremony, zero benefit for one mailbox).
- **Sync: polling, not watch+Pub/Sub** (watch needs a Pub/Sub topic + endpoint verification + 7-day renewals = three failure modes to buy latency the shop doesn't need; urgent inbound arrives via Twilio). New Vercel cron `/api/ingest/gmail` on `*/5 * * * *` (add to `vercel.json`, guard with existing `isAuthorizedCron`). `lastHistoryId` in new `sync_state` table (`key TEXT PRIMARY KEY, value JSONB, updated_at`); `users.history.list(startHistoryId)`, on 404 fall back to `messages.list` last 7 days. Dedupe via `events(kind, external_id)` unique index on Gmail message id.
- Also add: `ALTER TABLE leads ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ; ADD COLUMN IF NOT EXISTS paid_amount_cents BIGINT;` and `people.status TEXT DEFAULT 'active'` ('active'|'departed').
- Per message, route in order (`lib/gmail.ts` MIME/sync + `lib/ingest-email.ts` routing):
  1. **QB payment parser (deterministic regex, no AI)**: sender `*.intuit.com`, subject `Payment received: Invoice #(\d+)` (+ "Money on the way" deposits) → match `leads.invoice_number` → set `paid_at`/`paid_amount_cents`, fill `revenue_cents` if empty, transition won if not already, `events('invoice.paid')`, cancel overdue chase. No match → digest notification "Payment for invoice #1327 — no matching lead" (one-tap attach later).
  2. Skip noise: own CRM notification mails, denylist senders (LinkedIn/TikTok/Alibaba/Google), Gmail category labels.
  3. Inbound customer mail → `findOrCreatePersonByEmail` → attach per the standard recency rule → `events('email.in')`, body = plaintext with quoted reply-chain stripped; attachments (DXF/PDF/photos) uploaded to Blob under `email-attachments/`, referenced in `detail.attachments`.
  4. **Owner's SENT replies** (same history feed, SENT label, from sales@) → `events('email.out', actor_type='operator')` — prime extraction targets: "$300 to weld the bracket" becomes a `we_promised` commitment + `quoted_price` claim with the sent email as provenance. Feeds **invisible quote capture** (Wire slip: "Looks like you quoted Dale $300 — stamp it QUOTED? [✓][✗]").
  5. Extraction also classifies auto-replies: out-of-office vs **contact-departed** → `events('contact.churn')`, `people.status='departed'`, `successor_contact` claims, Wire people-slip with pre-drafted intro text to the successor.

## A4. AI layer

Stack: Vercel AI SDK v6 (`ai` package) via **Vercel AI Gateway** (`AI_GATEWAY_API_KEY`), model strings in one place (`lib/ai.ts`):
- Extraction: `anthropic/claude-haiku-4-5` ($1/$5 MTok)
- Ask-anything + brief: `anthropic/claude-sonnet-5` ($3/$15; intro $2/$10 thru 2026-08-31)

### Ask-anything — `POST /api/ops/ask` (streaming, operator-gated)
Agentic tool-loop (`streamText` + `stopWhen: stepCountIs(8)`), NOT single-shot RAG:
- `search_events({query, lead_id?, person_id?, kinds?, since?, limit})` — FTS `websearch_to_tsquery` + ts_rank + recency, trigram fallback for names/phones.
- `get_lead({id})` — lead + open commitments + active claims (crew: money redacted server-side).
- `get_person_history({person_id})`, `list_commitments({...})`, `search_leads({...})`.
- **Receipts contract**: every factual sentence cites `[e:1234]`; client renders chips ("SMS from Dale · Jul 12 · 2:41p") deep-linking to `/ops/leads/47#e1234`. Prompt hard rules: uncited = don't say it; "I don't know — here's what I do have" is a first-class answer; never invent dates/dollars.

### Extraction pipeline — `lib/extract.ts` `processEvent(eventId)`
Called via `waitUntil()` from every text-bearing event insert. Haiku + `generateObject` (zod):
```
{ commitments: [{direction, summary, due_at_iso|null, confidence,
                 matches_existing_commitment_id|null, marks_existing_as:'kept'|'superseded'|null}],
  facts: [{predicate, value, confidence}],
  contact_churn: {left_name, successors[]}|null,
  urgency: 'interrupt'|'normal'|null }
```
Context includes lead snapshot + current open commitments (so "sent that quote over" marks existing as kept, no duplicates). Confidence < 0.6 → commitment flagged unconfirmed (one-tap YEP/NAH; the tap is itself an event, sets `confirmed_by`). Retry sweep in hourly reminders cron: `processed_at IS NULL AND recorded_at < now()-'10 min'`. Extraction failure never blocks delivery.

### Morning brief — `app/api/ops/brief/route.ts`, Vercel cron 11:30 UTC (6:30a Central)
Deterministic SQL gather (commitments due/overdue → uncalled leads → stale quotes ≥ day 4 / overdue invoices → yesterday's wins with crew credit → weather line only if outdoor job) → Sonnet writes ≤200-word foreman-voice script → `events('brief.morning')` → push. TTS v1.1: `experimental_generateSpeech` via same gateway, stored once as Blob, `<audio>` in the Radio.

**AI cost ceiling ≈ $35-40/mo; realistic $15-25.** Gateway gives per-model spend visibility, model swap = string change.

## A5. Multi-user auth (evolve, don't replace)

- Seed migration: current `OPS_LOGIN_EMAIL` → `operators(role='owner')` `ON CONFLICT DO NOTHING`. Owner adds crew (name, email, cell) at `/ops/shop` (owner-only).
- `login` route: replace single-email `safeEmailMatch` with lookup `operators WHERE active AND lower(email)=lower($1)` (keep uniform no-enumeration response).
- **SMS-code sign-in** (crew without email habits): enter cell number → 6-digit code via Twilio SMS → verify → same session token. Reuses `ops_tokens` (purpose `sms-login`), rate-limited via `rate_limits`.
- `lib/ops-auth.ts`: tokens carry `operator_id`; `getAuthenticatedOperator()` returns `{id,email,name,role}`; old sessions fall back email→operators (nobody logged out on deploy).
- Roles, exactly two: `owner` = everything; `crew` = everything EXCEPT delete-type actions, team management, money (estimate/revenue/invoice omitted server-side in `lib/ops-data.ts` + ask tools). Plain `if (operator.role !== 'owner')` guards — no permission framework.
- **Anti-surveillance invariant (stated in CLAUDE.md + code comments)**: no query/page/brief ever aggregates events/calls/messages per operator. Attribution = bylines for provenance only.

## A6. Notifications — one gate, 3-interrupt budget

`lib/notify.ts` is the ONLY alert path (`sendPushToAll` becomes internal). Every notification written to `notifications` first, then routed.
- **Class A interrupts** (push now; SMS-to-cell fallback for A1 if no push registered): (1) new lead any channel — ALWAYS sends, exempt from cap; (2) inbound customer msg/call on active lead unanswered; (3) GLASS correction; (4) extraction `urgency:'interrupt'`.
- **Class B digest**: payments, photos, stamps, GLASS views, stale-quote nudges → Wire + brief. Never dropped, just filed.
- Budget: before A2-A4, count today's sent interrupts per operator (Central time). At 3+: store, don't push; first suppressed → one coalesced push "3 more things happened. They're in The Wire." Quiet hours 7:00p–6:30a (brief exempt).
- Copy: shop voice, ≤12 words, name + stake. "Dale texted 40 minutes ago. He's waiting."

---

# PART B — PRODUCT/UX ("The Shop Wall, Wired")

Thesis: nothing becomes an app screen that could be an object on the wall. **2 internal screens + 1 public page + login. No inbox/conversations/promises/reports/settings screens.**

- `/ops` THE WALL (home, 90% of life) — top to bottom: **THE WIRE** (collapsed strip: "THE WIRE — 6 slips since Thursday 4:12p"; slips on binder clips on a stretched steel cable, diffed vs YOUR `last_seen_at`; clips snap open as read — no badges); NEEDS YOU NOW (now fed by unanswered texts >30min, overdue promises, missed calls); gauge + tiles (money tiles owner-only — that's the whole permission UI); **THE PROMISE RACK** (manila inspection tags on pegboard hooks — only due-today/overdue on the wall, expandable); ticket wall (cards gain "Dale texted — 40m, no reply" line + hanging mini-tag when promise due); docked: **THE HANDSET** + **THE JOBSITE RADIO**.
- `/ops/leads/[id]` THE WORK ORDER — customer bar (Text opens in-CRM thread); details + polaroids (inbound MMS auto-develop); job's promise tags; GLASS clipboard control ("Hang their clipboard"); money; **THE SPIKE**; **DONE stamp**.
- `/j/[token]` GLASS. `/ops/shop` hidden owner one-pager (crew, tracking number, review link, W-9/COI files — the only settings that exist).

### The props (build these exactly)
- **THE HANDSET (ask-anything)**: coiled-cord radio handset on a steel hook, bottom-right thumb zone, every internal screen. **Hold to talk** (tap = type). Answer prints as a **thermal-printer slip** (Plex Mono on aged bone, torn edge, feeds line-by-line — streaming text IS the printing animation). **Receipts = stapled stubs** under the answer ("pulled from: Call w/ Dale, Tue 2:14p ▶") tapping to source. `SPEAK/PRINT` switch on the base = TTS readback toggle. Recent slips crumple into a basket. No chat bubbles, no persona, no name.
- **THE SPIKE (unified thread)**: bill spike of paper. Customer texts = white "WHILE YOU WERE OUT" memo slips (left, name stamped); shop replies = **yellow carbon copies** (right, MCSW stamp) — white-original/yellow-copy IS the chat metaphor; calls = microcassette rows `▶ CALL — Tue 2:14p — 4 min — Dale`, transcript folded under; emails = typed letter sheets on the same spike; voice notes = slips with cassette corner (marker-font transcript, tap to hear). Reply bar pinned: **big mic first**, keyboard second, context chips (`On it 👍` · `What's the address?` · `Can swing by tomorrow AM` · `Send a photo of it`).
- **THE PROMISE RACK**: manila tags, string through eyelet, marker text "Told Dale — gate ready FRIDAY" + stamped source line ("from your call, Tue 2:14p ▶" → plays the moment). High confidence = ink; low = **pencil** + `THIS A PROMISE?` stamp (YEP inks / NAH bins). Due today = red DUE stamp; overdue = hangs **crooked**, red edge, joins NEEDS YOU NOW. Kept = **hole-punch bite** (auto when detectable: DONE before due, quote text sent; else one tap). `HANDLE IT` = pre-drafted honest text ("Running behind on your gate — Monday morning, guaranteed") → re-dates tag + strikes date on GLASS.
- **THE JOBSITE RADIO (brief)**: paint-spattered roll-cage radio on a steel shelf by the neon. One knob: tap → dial lights, needle sweeps, 90-sec brief plays. Foreman voice, no music. **Day Sheet** clipboard under it = same content as marker lines, each tappable. 6:30a push "Morning. 3 things on the radio. ▶ 90 sec".
- **THE PUNCH RACK (login)**: steel time-card rack; tap your stamped name card → magic link or SMS code → 90-day session. No passwords ever.
- **DONE flow (crew, gloves on)**: hold-to-slam DONE stamp (haptic + mottled ink) → radio clicks "Say what you did" → hold-talk one breath → auto: Spike slip w/ byline, promise tag if promised, drafted GLASS caption (owner one-tap approve; after 10 clean approvals owner can flip auto-post), Wire slip "✔ Cody closed Dale's gate". Optional one-tap polaroid. Undo = 10-sec peel-back, no confirm modals.
- **THE REGULARS' RAIL + THE ACCOUNT (`/ops/accounts/[id]`)**: repeat accounts (2+ jobs same company domain/phone, or owner taps "make 'em a regular") get **stamped steel dog-tags** on a rail under the board header (`REAL FLOORS` · `PEPSICO`), dot when something's live. Tap → same ticket wall filtered to that customer, topped by the **account clipboard**: company in stencil, running total this year (owner-only), open invoices + NET terms, **their people** in pencil-and-pen (auto-maintained from signatures/auto-replies — Stacey Muhs flow writes here, old name struck through), paperwork on file (W-9 ✓, COI ✓ exp date), their open tags, every job ever as tickets. No profile forms — the account assembles itself from traffic.
- **THE PAID MOMENT**: QB payment email lands → invoice matches itself → the **PAID stamp slams itself** on ticket + work order (raise, slam, ink splat, haptic if watching live), one brass counter-bell "ding" (app open only, once), green money slip clips to the Wire ("$4,485 landed — Real Floors, INV #1332. PAID."), "won this month" tile **rolls like an odometer**. NO push — money landing is a pleasure, not an interruption; belongs to Wire + brief ("Money in: Real Floors paid $4,485 overnight").
- **THE MANILA ENVELOPE ("THE USUAL PAPERWORK")**: string-tie envelope button on work orders + account clipboards. One tap emails stored W-9 + current COI, shop voice ("Attached: W-9 and current certificate of insurance. Holler if you need anything else. -Philip"), logs `email.out`. Inbound emails smelling like W-9/COI requests get a manila Wire slip with the envelope ON it: "PepsiCo wants the usual paperwork. [Send it]" — one tap from the Wire, job never opened. COI expiry: red-edged Wire slip 2 weeks out. Setup: owner drops 2 PDFs + expiry on `/ops/shop`. Zero AI.
- **Reply channel stamp**: reply box replies on whichever channel the customer last used; small stamp says `GOES BY TEXT` / `GOES BY EMAIL` (tap to flip). Email replies auto-sign "-Philip" (or logged-in crew name) — that's verifiably how he writes. Emails render on the Spike as **folded letters on letterhead** (quoted tails trimmed behind "…the older pages" fold); DXF/drawings as **rolled blueprints** with rubber band, stencil label.
- **Wire slip stocks**: white = activity, **green = money**, manila = pencil confirmations (quote capture, promise confirm), red-edged = trouble (failed email, expiring COI), people slips = contact churn with `[Text Stacey]` pre-drafted intro.
- **Invisible quote capture**: outgoing email/text containing a dollar figure → penciled estimate + manila Wire slip "Looks like you quoted Dale $300 — stamp it QUOTED? [✓][✗]". Philip changes nothing about how he works; the board keeps up with him.
- **Voice-first ordering (crew are phone-over-email, talk-over-text)**: Call button before Text on every surface; audio brief default, day sheet fallback; hold-to-talk primary on handset and reply box.

### GLASS — `/j/[token]` (full-trust scope, per owner)
Daylight front-of-house: aluminum contractor's clipboard, same stamps/fonts, no night wall. Content top-to-bottom: masthead (licensed & insured + tracking number big: "Call or text us"); job in marker ("Dale's driveway gate — Hartsville Pike"); **THE PROMISE hero** — big stamped `READY FRIDAY, AUG 15`; moved dates stay struck-through with plain reason ("Waiting on hinge stock — pushed to Tue. Sorry for the holdup."); job traveler stations `WROTE IT UP → QUOTED → ON THE SCHEDULE → ON THE JOB → DONE` (fixed dictionary mapping from pipeline status — never raw internal status); dated progress polaroids (only `shared:true` photos; captions auto-drafted from crew voice notes, owner-approved); "Cody's running your job" (first names); **money**: approved quote amount, then invoice number/amount/due/pay-link when invoiced; `Something look wrong?` stubs on each fact → prefilled SMS to shop number (correction → event + interrupt); review card ONLY after DONE + paid, once; footer "We answer our phone. If we miss you, text this number with photos of what's broke."
Never shown: internal notes, transcripts, margins, attribution, other customers, raw events. Token 32-byte hex stored sha256, revocable/regenerable, `robots noindex`, no lead ids anywhere. Link sent once with the quote SMS; token dies 90 days after DONE (friendly closed card). Views update `view_count`/`last_viewed_at` (+throttled event — "customer checked the page 3× today" is a buying signal).

### Anti-features (will NOT build)
No dashboards/charts/date-pickers beyond existing gauge+tiles. No required fields anywhere. No settings maze (one owner page). No worker surveillance (no hours, activity feeds, read receipts, leaderboards — not even behind a flag). No generic chat UI/avatars/AI persona. No confirmation modals (10-sec undo instead). No unread badges/counters. No email drip/marketing. No kanban/custom fields/tags/views. No customer-facing AI text without shop voice + owner approval until trust earned. No onboarding tour (one taped "HOLD TO TALK" note, once). Nothing that fails a gloved thumb in a truck.

### Adoption
Owner seeds crew on `/ops/shop` (2 min) → invite is a text from the shop number in owner's voice → magic link → "NAIL IT TO YOUR WALL" add-to-home-screen card → zero tour. Demo = owner bragging with the Handset in front of crew/customers. One habit: DONE stamp + say-what-you-did, reinforced by haptics and radio credit by name ("Cody closed the Hartsville gate — Dale already left five stars"). Non-adoption is graceful: system captures calls/texts regardless; the day a guy needs a gate code, he asks the handset — converted.

---

# PART C — BUILD ORDER (each phase ships; live system never breaks)

Feature-gating by env presence (`TWILIO_AUTH_TOKEN` absent → routes 503, like `dbConfigured()` today). New deps: `ai` only. New env: `TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER`, `DEEPGRAM_API_KEY`, `AI_GATEWAY_API_KEY`, `GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN`.

| Phase | Contents | Size |
|---|---|---|
| **0 Identity** | `operators` + seed, `ops_tokens.operator_id`, auth returns object, actor attribution, `/ops/shop` panel (crew, W-9/COI uploads), Punch Rack login UI, SMS-code sign-in (stub until Twilio, email-only first), crew money redaction | S (2-3d) |
| **1 Substrate** | `events`, `people`, pg_trgm, `lib/events.ts`, `lib/people.ts`, backfills, intake dual-write + `person_id`, "Repeat — N jobs" badge | M (3-5d) |
| **2 Twilio** | 2a: buy number + **file A2P day one** (A2P wait blocks SMS ONLY — voice forwarding, recording, whisper, missed-call flow all ship immediately; leads are mostly phone, so this is the #1 ROI phase). 2b: recording + Deepgram transcripts. 2c (after A2P approval): two-way SMS Spike UI, MMS→Blob, auto-text-back, SMS-code sign-in live | L (1.5-2wk) |
| **3 Gmail + money loop** | Internal OAuth + `scripts/gmail-auth.mjs`, `sync_state`, 5-min polling cron, QB payment parser → PAID moment (self-slamming stamp, bell, odometer tile, green Wire slips), `paid_at` columns, email.in/out events + folded-letter Spike rendering, sender rules, manila envelope action + inbound-request detection + COI expiry slip | M (4-6d) |
| **4 Extraction + Promise Rack + Regulars** | `claims`, `commitments`, `lib/ai.ts`, `lib/extract.ts` (incl. contact-churn + auto-reply classing), retry sweep, Rack UI + per-job tags, YEP/NAH, HANDLE IT, invisible quote capture, Regulars' Rail + `/ops/accounts/[id]` account clipboard | L (1.5wk) |
| **5 Ask-anything (Handset)** | `/api/ops/ask` tool-loop, FTS tools, Handset UI + printed-slip stream + stapled receipts, hold-to-talk (MediaRecorder→Deepgram) | M (1wk) |
| **6 Notifications + Wire + Radio** | `notifications`, `lib/notify.ts` gate + 3-budget, Wire strip, brief cron (text) + Radio UI, TTS audio | M (1wk) |
| **7 GLASS** | `glass_links`, `/j/[token]` clipboard page, photo `shared` flag + token-keyed photo proxy, share-via-SMS, corrections, review card | M (1wk) |
| **8 Voice polish** | Crew DONE-stamp voice flow, voice notes everywhere, SPEAK readback on Handset | S-M (3-4d) |

Sequencing: 0 first (every event needs a real actor) → 1 foundation → 2a early (external lead times, instant ROI) → 3 early (money loop = daily owner value, no Twilio dependency) → 4→5 the brain → 6 discipline → 7 outward → 8 delight.

### Critical files
- `scripts/migrate.mjs` — all schema additions (idempotent array pattern)
- `lib/ops-auth.ts` — multi-user pivot
- `lib/leads.ts` — intake person-matching + dual-write shim
- `app/ops/actions.ts` — SMS send, GLASS share, promises, role guards, paperwork
- `app/api/quote/route.ts` — persistence-first reference every webhook copies
- `app/ops/page.tsx`, `app/ops/leads/[id]/page.tsx`, `app/globals.css` (extend SHOP WALL layer)
- New: `lib/{events,people,twilio,ai,extract,notify,claims,gmail}.ts`, `app/api/twilio/{voice,voice-status,recording,transcript,sms}/route.ts`, `app/api/ops/{ask,brief,voice-note}/route.ts`, `app/api/glass/correction/route.ts`, `app/j/[token]/page.tsx`, `app/ops/{shop/page.tsx,wire.tsx,voice-note.tsx}`, `scripts/backfill-{people,events}.mjs`, `.github/workflows/gmail-poll.yml`

# PART D — VERIFICATION

- Per phase: `npm run migrate` against live DB (idempotent — run twice, second run no-ops). `[INTERNAL TEST]` leads for all flow tests; delete via dashboard after.
- Twilio: call the tracking number from a test cell → verify forward, recording, transcript event, missed-call text-back (decline the call). SMS in/out with photo → Spike renders, Blob stored.
- Gmail: send test QB-format email → invoice auto-matches. Reply from sales@ to a test thread → `email.out` event + promise extracted.
- Ask-anything: "where's the [test] job" → answer with tappable receipt chips resolving to real events; ask something unknowable → "I don't know" behavior.
- Notifications: trigger 4 interrupts same day → 4th coalesces. Quiet hours respected.
- GLASS: mint link, open logged-out + incognito → correct scope; revoke → dead; correction → interrupt + event.
- Crew role: sign in as crew test operator → money invisible on board, work order, ask answers.
- `/api/health` extended with twilio/gmail/ai config checks; existing 5-min monitor covers regressions.
- Owner reviews UI phases live at localhost:3100 in Chrome (his standing rule); checkpoint-commit rejected iterations.

# PART E — SESSION PLAN (/phase-plan output)

> On approval, copy this Part into `SESSION-PLAN.md` at repo root; sessions update their own status row as they close.

**Rules:** one row = one fresh chat = one bounded mission (≤ ~1hr where possible; big phases are split at natural seams). Open each chat with the paste-ready prompt, session model set FIRST. One session at a time, in order (gap-fillers may slot anywhere their deps allow). Design-heavy (L, top-tier) sessions present their in-session plan for owner sign-off BEFORE writing code. Every session starts by reading this plan file; ends with commit + its own verification only. Never mix sessions in one chat. If long, stop at a shippable commit; continue in a fresh chat.

**Standing notes (ride along, don't own a session):**
- Owner buys Twilio number + files A2P the day S4 opens (external lead time; voice unblocked immediately, SMS waits on approval).
- Owner runs `scripts/gmail-auth.mjs` consent once when S6 opens.
- Owner reviews every UI session live at localhost:3100 (standing rule); checkpoint-commit rejected iterations.
- `[INTERNAL TEST]` convention on all test data; single shared prod DB.

| ID | Mission | Model | Effort | Size | Depends | Status |
|---|---|---|---|---|---|---|
| S1 | Phase 0: operators, roles, Punch Rack login, /ops/shop | **top-tier** (auth/schema) | high | M | — | pending |
| S2 | Phase 1: events+people substrate, backfills, dual-write | **top-tier** (data model) | high | M | S1 | pending |
| S3 | Phase 2a+2b: Twilio voice — forward, whisper, record, missed-call flow, Deepgram | **top-tier** (telephony/money path) | high | M | S2 | pending |
| S4 | Phase 2c: the Spike SMS UI, MMS→Blob, auto-text-back, SMS-code sign-in | mid (Sonnet-class; UI from spec) | high | M | S3 + A2P approved | pending |
| S5 | Phase 3: gmail ingestion + QB PAID moment + envelope | mid | high | M | S2 (not S3/S4 — gap-filler while A2P pends) | pending |
| S6 | Phase 4a: extraction pipeline (claims, commitments, churn, quote capture) | **top-tier**, **xhigh** (prompt quality is the product) | xhigh | L | S3 or S5 (needs a text feed) | pending |
| S7 | Phase 4b: Promise Rack UI + Regulars' Rail + account page | mid (props from spec) | high | M | S6 | pending |
| S8 | Phase 5: the Handset — ask tool-loop + printed-slip UI + hold-to-talk | **top-tier**, xhigh | xhigh | L | S6 | pending |
| S9 | Phase 6: notify gate + 3-budget, the Wire, Radio brief (text→TTS) | mid | high | M | S6 (brief needs commitments) | pending |
| S10 | Phase 7: GLASS clipboard page + corrections + review card | **top-tier** (customer-facing design + token security) | xhigh | L | S4 (SMS delivery), S6 (promises) | pending |
| S11 | Phase 8 + closeout: DONE-stamp voice flow, SPEAK readback, health checks, CLAUDE.md invariants, memory | mid | medium | S | S8, S9 | pending |
| S12 | Exit verification: run PART D end-to-end, real call + real QB email + crew-role sweep, tick checklist | mid | medium | S | all | pending |

**Recommended order:** S1 → S2 → S3 → (S5 fills the A2P wait) → S4 → S6 → S7 → S8 → S9 → S10 → S11 → S12.
**Top-tier spend concentrated in:** S1-S3 (auth/schema/telephony foundations), S6 (extraction prompts), S8 (handset), S10 (GLASS) — everything else executes from spec on mid-tier. Inside every session: cheap subagents for code-location, mechanical edits, running migrations/tests, closing notes; main model keeps judgment work.

### Per-session boundaries + paste-ready prompts

**S1** — Scope: Part A5 whole (operators table+seed, ops_tokens.operator_id, auth object, actor attribution, /ops/shop, Punch Rack UI, crew money redaction). Not-touched: events/people tables, any Twilio/gmail/AI. Routing: top-tier main; explorer subagent maps auth call sites first.
> S1 of SESSION-PLAN (plan: this-is-a-plan-federated-rabbit.md). Implement Phase 0 / Part A5 only: multi-operator auth + Punch Rack + /ops/shop. Do not touch substrate/Twilio/gmail/AI. Present your implementation plan for sign-off before code. Exit: crew email login works, roles enforced, bylines on timeline, migrate idempotent×2.

**S2** — Scope: A1 (events, people, claims/commitments TABLES ONLY — no extraction), backfills, intake dual-write, repeat badge. Not-touched: UI beyond the badge, AI. Routing: top-tier; mechanic subagent for dual-write call-site edits.
> S2: Phase 1 / Part A1. Substrate tables + lib/events.ts + lib/people.ts + backfills + dual-write from all intake paths + "Repeat — N jobs" badge. No AI, no new UI otherwise. Plan sign-off before code. Exit: backfills rerunnable, /ops visually unchanged except badge.

**S3** — Scope: A2 voice half (lib/twilio.ts signature validation, voice/voice-status/recording/transcript routes, Deepgram, whisper, interrupt notify stub via existing push). Not-touched: SMS UI, notify budget (stub direct push). Routing: top-tier (security-sensitive webhooks).
> S3: Phase 2a+2b / Part A2 voice only. Number is bought, A2P filed. Voice forward+whisper+recording+Deepgram transcript→events, missed-call handling (text-back stub logs until A2P). Plan sign-off before code. Exit: real test call recorded + transcribed into events; unsigned webhook rejected.

**S4** — Scope: A2 SMS half + B Spike props (memo slips, carbons, cassettes, reply bar w/ mic+chips, channel stamp), MMS→Blob, SMS-code sign-in. Not-touched: email letters (S5), extraction. Routing: mid; owner reviews props at localhost.
> S4: Phase 2c. Two-way SMS in Spike props per Part B spec, MMS→Blob, auto-text-back live, SMS-code sign-in. Match Shop Wall CSS language exactly; owner reviews live. Exit: full text conversation from work order; photo in → polaroid.

**S5** — Scope: A3 whole + PAID moment + envelope + COI slip + folded-letter Spike rendering. Not-touched: extraction (events recorded, processed later). Routing: mid; QB parser is regex, no AI.
> S5: Phase 3 / Part A3. Gmail internal-OAuth ingestion, QB payment parser → PAID moment (self-slam stamp, bell, odometer, green slip), email letters on Spike, manila envelope, COI expiry slip. Exit: test QB-format email marks invoice paid end-to-end.

**S6** — Scope: A4 extraction (lib/ai.ts, lib/extract.ts, zod schema, churn, quote capture, retry sweep, YEP/NAH data paths). Not-touched: Rack/Rail UI (S7). Routing: top-tier xhigh — prompt+schema quality is the product; verifier subagent runs fixture suite (incl. real Real Floors auto-reply text).
> S6: Phase 4a / Part A4 extraction. claims+commitments live, haiku pipeline over all text events, churn + quote capture, retry sweep, confirm/reject actions. Plan + prompt drafts for sign-off before code. Exit: promises auto-extracted from a real transcript fixture; churn fires on Real Floors auto-reply fixture; no dupes on re-run.

**S7** — Scope: B Promise Rack + Regulars' Rail + /ops/accounts/[id] props. Not-touched: extraction logic. Routing: mid.
> S7: Phase 4b UI. Tag rail (pencil/ink, DUE, crooked overdue, hole-punch, HANDLE IT), Regulars' Rail dog-tags, account clipboard page per Part B. Owner reviews live. Exit: real extracted promise hangs, punches, pushes with customer text offer.

**S8** — Scope: A4a ask endpoint + tools + B Handset (hold-to-talk MediaRecorder→Deepgram, printed slip stream, stapled receipts, SPEAK switch stub). Routing: top-tier xhigh.
> S8: Phase 5. /api/ops/ask agentic tool-loop with receipts contract + Handset UI per spec. Plan sign-off before code. Exit: spoken "where's the [test] job" → printed answer with working staple deep-links; unanswerable → honest "I don't know".

**S9** — Scope: A6 notify gate + budget + Wire strip + Radio/day-sheet + brief cron + TTS. Not-touched: handset. Routing: mid.
> S9: Phase 6. lib/notify.ts single gate, 3-interrupt budget + coalesce, quiet hours, Wire per-operator diff with slip stocks, 6:30a brief (SQL gather → sonnet script → push, TTS audio in Radio). Exit: 4th interrupt coalesces; Wire diffs per login; brief plays.

**S10** — Scope: A/B GLASS whole (glass_links, /j/[token], shared-photo flag + token photo proxy, share-via-SMS, corrections, review card, commercial variant). Routing: top-tier xhigh (public surface, token security, customer-facing design).
> S10: Phase 7 GLASS per Part B spec. Plan + visual direction sign-off before code. Exit: minted link shows correct scope logged-out; revoke kills; correction → interrupt; nothing internal leaks (verify with view-source).

**S11** — Scope: DONE-stamp voice flow, voice notes everywhere, SPEAK readback live, health checks for twilio/gmail/ai config, CLAUDE.md anti-surveillance + append-only invariants, project memory update. Routing: mid.
> S11: Phase 8 + closeout. DONE stamp → "say what you did" → slip/tag/GLASS-draft/Wire per spec; health extended; invariants documented. Exit: one voice note produces all four artifacts; /api/health green.

**S12** — Scope: PART D verification sweep only; fix nothing big — file issues back into this plan. Routing: mid; verifier subagents run checks in parallel.
> S12: Exit verification. Execute PART D checklist end-to-end with real call, real QB-format email, crew-role sweep, GLASS incognito audit, budget coalesce test. Mark session rows done; report gaps as new plan items, don't fix in-session.
