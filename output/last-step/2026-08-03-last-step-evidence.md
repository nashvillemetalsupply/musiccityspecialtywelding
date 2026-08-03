# Last Step evidence — August 3, 2026

Decision: **READY FOR TRAFFIC** (one monitoring WARNING, owner exclusions documented below).

Deployed commit: `ce18a977e71a0be99743d6d8305f687d726d5915` on `main`, served by
`https://musiccityspecialtywelding.com` through the now-connected GitHub → Vercel
integration (pushes to `main` auto-deploy from this session forward).

## What was built and shipped today

A complete custom CRM ("Lead Operations") wired into the production website:

- **Persistence-first intake.** Every quote submission is written to Neon Postgres
  before the notification email is attempted. A lead now survives an email-provider
  outage; the daily digest flags any lead that exists only in the dashboard.
- **First-touch attribution.** gclid, UTM parameters, landing page, and referrer are
  captured on the landing page, survive cross-page navigation, and are stored on the
  lead (`source` derives google-ads / organic / referral / direct).
- **Owner dashboard at `/ops`.** Magic-link sign-in (no passwords), pipeline stages
  (new → contacted → qualified → quoted → won/lost/spam) with auto-timestamps,
  first-response tracking (speed-to-lead median on the board), estimate + revenue
  capture, interaction log, follow-up reminders with quick picks, instant search,
  pagination, counted filters, CSV export, and a Google Ads offline-conversion export.
- **Manual lead entry** for phone-in / walk-in / referral / repeat customers, so the
  pipeline reflects the whole business, not just the website.
- **Photo persistence.** Job photos upload to a private Vercel Blob store and render
  in the dashboard through an authenticated streaming route; they also still ride on
  the notification email.
- **Automation.** Daily digest (Vercel cron, 12:00 UTC) of unanswered leads, due
  follow-ups, stale quotes, and failed deliveries; hourly follow-up reminder sweep
  (GitHub Actions) so an "in 4 hours" reminder fires the same day.
- **External monitoring.** A 5-minute GitHub Actions health monitor asserts
  `/api/health` ok + leadsAccepted from outside the deployment platform.
- **Security.** Hashed one-time and session tokens, canonical-origin magic links,
  uniform login responses, timing-safe cron auth, CSV formula-injection guard,
  private-by-default photos, `/ops` noindexed and robots-disallowed.

## Gate results

Full machine-readable results: `2026-08-03-last-step-evidence.json`. Summary:

| Area | Result |
|---|---|
| Typecheck / lint / build / npm audit | PASS (all clean at ce18a97) |
| Deployment identity | PASS — git-integrated deploy of ce18a97 aliased to apex |
| robots / sitemap / canonical / schema / GA + Ads tags | PASS (fresh curl evidence) |
| `/api/health` launch gate | PASS — `ok:true`, live Resend credential probe, DB connected, 0 failed deliveries |
| Website lead journey (390 px, with photo) | PASS — persisted with google-ads attribution, email in business inbox |
| Email-failure survival | PASS — lead persisted with `email_delivery_status=failed`, API still ok |
| Magic-link auth + protected APIs | PASS — live email link redeemed; 401s without session |
| Pipeline loop (respond → quote → win) | PASS — full `lead_events` audit trail with operator identity |
| Manual lead / interaction log / follow-ups / exports | PASS — exercised live |
| Digest + reminders automation | PASS — production runs ok, heartbeats recorded, 401 unauthenticated |
| External monitor | **WARNING** — manual runs green; first *scheduled* execution pending GitHub cron registration (check Actions tab within 24 h) |
| Synthetic-data cleanup | PASS — leads 0, events 0, blobs 0 |
| DNS / SPF / DKIM / DMARC / MX | PASS — matches Aug 1–2 audit, no drift |
| Growth-gaps public audit | PASS — 0 high; 1 medium = owner-gated review URL |

## Independent judge (folk.app benchmark)

Three adversarial rounds by an independent reviewer (full code read + live
folk.app fetch each round):

- **Round 1: 7/10** — 8 ranked gaps + a bug list. All remediated same session.
- **Round 2: 9/10, "YES — now unambiguously better than folk"** — 6 further
  items. All software-only items implemented same session, including a full
  Web Push alert channel (new-lead and follow-up notifications to the owner's
  phone, independent of the email provider).
- **Round 3 (final): 9.5/10, "decisively better than folk.app for this
  business."** Every item verified in code. The remaining half point is
  owner-action-bound (tap "Enable phone alerts" on at least one device;
  best-effort GitHub cron vs a paid scheduler/Twilio), not software.

Note: the requested verifier "sol 5.6 ultra" does not exist as an available model;
the judge is an independent Fable-powered reviewer agent with no stake in the code.

## Owner-only actions (unchanged from the Aug 1–2 growth audit unless noted)

1. Google Business Profile video verification → then supply the review link.
2. DMARC hardening decision (currently `p=none`).
3. Approve/decline a dedicated Twilio number for SMS lead alerts (new option).
4. Confirm GitHub Actions scheduled runs show green within 24 h (new).
5. Ads keyword decisions ($409 zero-conversion keywords) remain open.

## How the owner and workers sign in to the CRM

1. Go to **https://musiccityspecialtywelding.com/ops** on any phone or computer.
2. Enter the shop email: **sales@musiccityspecialtywelding.com**.
3. Open the "operations sign-in link" email in the shop inbox and tap the link.
   It works once and expires in 15 minutes; the session then stays signed in for
   30 days on that device.
4. Workers use the same shop mailbox today. To give a worker their own address
   later, set the `OPS_LOGIN_EMAIL` environment variable in Vercel to that address
   (one operator address is supported by design; sessions are per-device).
5. Sign out from the button on the board. Lost link? Just request a new one.

## QuickBooks and the CRM

QuickBooks stays your invoicing/payment system; the CRM is where the job's story
lives. The working loop: when a QuickBooks payment lands, open the lead in `/ops`,
enter the final amount in **Final revenue** (marks it won), tick **job completed**,
and paste the QuickBooks invoice number into Notes. The "Ads conversions" export
then turns those won, ad-attributed jobs into a Google Ads offline-conversion CSV.
There is no magic-link connection between QuickBooks and the CRM — QuickBooks
sign-in is unchanged. A future upgrade could sync QuickBooks invoices via the
Intuit API, but that needs owner-approved Intuit developer credentials.
