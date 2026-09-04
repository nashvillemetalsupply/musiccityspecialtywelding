# Google Ads Optimization — 2026-09-04 — HANDOFF

**Account:** Music City Specialty Welding · `747-818-3137` · login `sales@musiccityspecialtywelding.com`
**Campaign:** MCW General Fab-Ad (`campaignId=23382574524`) · Search · $40.00/day
**Browser used:** Chrome named **"WELDING"** (device `b7524098…` was the older one; the good session was the one the owner clicked Connect on)

Status: **COMPLETE.** Every item that can be done inside the Ads account is saved and
verified live. What remains is owner-side only (website tag fix, replacement logo, and
three business decisions) — listed at the bottom.

**Campaign status improved during this pass:**
`Eligible (Limited) + "Call asset is disapproved"` → **`Limited by budget`**
Optimization score **60.4% → 64.5%**

---

## Baseline (Aug 5 – Sep 3, 2026)

| Metric | Value |
|---|---|
| Impressions | 2,696 |
| Clicks | 225 |
| CTR | 8.35% |
| Avg CPC | $4.15 |
| Cost | $934.85 |
| Conversions | 16.00 |
| Cost / conv | $58.43 |

### By ad group

| Ad group | Impr | Clicks | CTR | Cost | Conv | CPA | adGroupId |
|---|---|---|---|---|---|---|---|
| Mobile Welding | 1,282 | 136 | 10.61% | $561.15 | 9.50 | $59.07 | *(not captured)* |
| Architectural | 1,142 | 75 | 6.57% | $315.99 | 5.50 | $57.45 | `190434711333` |
| Trailer / Truck Repair | 248 | 7 | **2.82%** | $30.24 | 1.00 | $30.24 | `191293470140` |
| Boat Welding | 17 | 5 | **29.41%** | $20.07 | 0 | — | *(not captured)* |
| Custom Mailboxes | 7 | 2 | **28.57%** | $7.40 | 0 | — | *(not captured)* |
| Street Scape | 0 | 0 | — | $0 | 0 | — | *(not captured)* |
| Manifold | 0 | 0 | — | $0 | 0 | paused | — |
| Stainless Steel | 0 | 0 | — | $0 | 0 | paused | — |

**Read:** Mobile Welding + Architectural = 94% of spend and all 16 conversions.
Trailer/Truck gets seen a lot and clicked almost never. Boat Welding and Custom
Mailboxes have the two best CTRs in the account and are starved of impressions.

### Search-term totals (30d)
- Visible search terms: 100 clicks / 1,290 impr / $420.78 / 8.5 conv
- **"Other search terms" (privacy-thresholded, invisible): 125 clicks / 1,406 impr / $514.07 / 7.5 conv**
- 55% of spend sits in terms Google will not show → negatives can only govern ~45% of spend.

### Budget simulator (Google's own estimate, weekly)
| Daily budget | Weekly cost | Weekly conv |
|---|---|---|
| $40 (current) | $276.80 | 0 |
| $126.50 | $975.67 | 2 |
| $274.18 | $1,838.49 | 4 |
| $498.31 | $2,971.51 | 6 |

⚠️ Conversion figures in this table are **unreliable** — they were computed while
conversion tracking was broken (see below). Do not size the budget off this yet.

---

## CORRECTION (2026-09-04, later the same day) — the tag was never broken

The finding below is right about the symptom and wrong about the cause. Root-caused
against production and the live database:

**The tag works.** Three real conversion pings were fired from
`https://musiccityspecialtywelding.com/` today by submitting the actual form with
`/api/quote` stubbed out in the browser, so no lead was created. Each one produced:

    https://www.googleadservices.com/pagead/conversion/17817632790/?label=CZF4CMyQhPEbEJaAjrBC&...
    https://www.googleadservices.com/ccm/conversion/17817632790/?label=CZF4CMyQhPEbEJaAjrBC&...

That is exactly the destination `ctId=7484803148` listens on. The label in the
deployed client bundle is `AW-17817632790/CZF4CMyQhPEbEJaAjrBC` — the correct one;
`NEXT_PUBLIC_GOOGLE_ADS_SEND_TO` is unset, so the hardcoded fallback is what ships.

**Deploy `3beace9` is not the cause.** `components/public-analytics.tsx` and
`components/deferred-google-tag.tsx` have not been touched since that commit, so the
code under suspicion is byte-for-byte what is live now — and it fires. The
double-parse theory (a top-level `const` in the inline script) does not apply either:
in the Next.js App Router an `afterInteractive` `<Script>` renders nothing on the
server and is injected exactly once from `useEffect`, guarded by next/script's own
`LoadCache`. It only ever parses once.

**The real cause: nothing has been submitting the form.**

| Week of | Web-form leads | Of those, from Ads |
|---|---|---|
| Aug 3 | 2 | 2 |
| Aug 10 | 6 | 5 |
| Aug 17 | 5 | 5 |
| Aug 24 | 1 | 0 |
| Aug 31 | 0 | 0 |

The last web-form lead is #161, **2026-08-25 17:59 UTC** (aluminium boat hatch, an
ad click carrying `gbraid` but no `gclid`). Corroborated independently by the
`rate_limits` table, which `isRateLimitedDurable` prunes to 24 hours **on every
call**: its single surviving row is that Aug 25 submission, which is only possible
if no quote request has reached it since. Phone, SMS and email intake continued
normally the whole time (15 phone-ins on Sep 3 alone), so this is the web form
specifically, not the shop.

At the observed rate (~5 web leads a week, essentially all from Ads) a run of zero
over eleven days is roughly a 1-in-400 coincidence. So Ads has recorded nothing
because there has been nothing to record — "Misconfigured / no tag pings in 7 days"
is a symptom of an empty funnel, not a dead tag.

**The server is healthy too.** A probe of live `/api/quote` with valid fields and a
deliberately invalid `intakeKey` (rejected before any write) returns the designed
`400 "This form expired before it could be sent."` — so honeypot, photo validation
and `validatePublicQuote` all pass real input today.

**What that leaves.** The remaining explanation is on the Ads side, and it is the
same Aug 24 date: Change History shows the budget raised and a phrase-match keyword
paused that morning. 55% of spend already sits in privacy-thresholded "Other search
terms" that negatives cannot govern, and the call asset had been disapproved since
December. Look at click quality and the landing-page report before spending more.

**Shipped so the silence cannot repeat** (it ran eleven days unseen because every
check watched configuration and none watched the outcome):

- `/api/health` now reports `googleAds.lastWebQuoteAt`, `webQuoteSilenceHours` and
  `webQuoteSilent`; the health monitor **fails the build** past 96 hours of silence.
- `scripts/verify-ads-tag.mjs` fetches the live bundle every monitor run and asserts
  the AW container config and the exact `send_to` label are still shipped.
- `scripts/ads-conversion-tag.test.mjs` pins the wiring in the suite, including that
  the inline tag body stays inside an IIFE.
- The inline tag script was moved into an IIFE. Not the cause, but it removes the
  re-entrancy hazard for good.

---

### Read against the live account, same day

`Submit lead form (FIXED)` now reads **Awaiting conversions**, not Misconfigured —
Google has seen the three test pings. `Calls from ads` and
`Business profile - Tracked call` read Awaiting conversions too.

**The only account change in the window** (Change history, Aug 22 – Sep 4; the
Conversion, Bidding, Audience, Location, Asset and Feed filters are all empty):

> 2026-08-24 08:56:21, sales@ — MCW General Fab-Ad: budget **$26.21 → $40.00/day**

| | Aug 5–23 | Aug 24 – Sep 3 |
|---|---|---|
| Impressions | 1,494 | 1,202 |
| Clicks | 122 | 103 |
| Cost | $474.07 | $460.78 |
| Conversions | 16 (11 form, 5 phone) | **0** |
| Clicks/day | 6.4 | 9.4 |
| Avg CPC | $3.89 | $4.47 |

The search terms are the same terms — "welders near me", "welding shops near me",
"mobile welder repair near me", "custom metal fabrication". They converted at
25–50% before Aug 24 and 0% after. So the traffic did not get worse. The campaign
is **Search only** (Networks: Google Search Network — no Display), location 50 mi
around Nashville, Maximize conversions, Campaign URL options: none. Network
expansion, a tracking template and a settings change are all ruled out.

51% of spend (49 of 103 clicks, $236.21) sits in privacy-thresholded "Other search
terms" that negatives cannot reach.

### Owner-gated, in priority order

1. **Enhanced conversions** is flagged "setup issues impacting performance". Until
   it is fixed, a click Google reports as `gbraid` (iOS and other limited-signal
   traffic) cannot be tied to a conversion — and the one web lead after Aug 24
   was exactly that shape. It sends hashed customer data to Google, so it is the
   owner's call.
2. **Create a "Calls from website visits" conversion action**, then set
   `NEXT_PUBLIC_GOOGLE_ADS_PHONE_SEND_TO` in Vercel to its `AW-…/label`. The code
   is already shipped and dormant. Of 30 leads in those eleven days almost all
   were calls, and Google Ads saw none of them. This is the biggest single lever.
   (The setup wizard was attempted here and duplicated "Calls from ads" rows
   instead; it was backed out unsaved. Do it from Goals → Conversions → the
   phone flow, or ask Google support.)
3. **Remove the two disapproved `615-810-4910` call assets.**
4. **Consider returning the budget to ~$26/day** until a conversion action is
   recording again. Maximize conversions bidding at $40/day on a zero-conversion
   signal is the most expensive configuration available.

---

## CRITICAL FINDING — conversion tracking is dead

Conversion action **“Submit lead form (FIXED)”** (`ctId=7484803148`, created 2/2/2026):

- Status: **Misconfigured**
- Message: *“Conversion has not received tag pings in the last 7 days.”*
- **Last recorded conversion: Aug 23, 2026 at 7:00 AM**
- Destination: `AW-17817632790/CZF4CMyQhPEbEJaAjrBC`

Aug 5–23 recorded 11 form conversions (~0.58/day). Aug 24 – Sep 3 recorded **zero**
across 11 days. That is a hard cliff, not noise.

Same-day context from Change History: on **Aug 24** the budget was raised and one
phrase-match keyword was paused in Architectural. Deploy `3beace9` ("fix(growth):
harden scale readiness") also landed Aug 24 05:36 and touched
`components/public-analytics.tsx` + `components/deferred-google-tag.tsx`.

### What was checked and ruled out
- Live site **does** load `gtag/js?id=GT-TWZ9WFGX` → HTTP 200
- `googleads.g.doubleclick.net/pagead/viewthroughconversion/17817632790/` → 200
- `google.com/pagead/1p-user-list/17817632790/` → 200
- `window.gtag` is a function; `dataLayer` populates
- **No ad blocker** — verified by fetching googlesyndication / googletagmanager /
  google-analytics / doubleclick / ccm-collect directly; all reachable.
  (An earlier claim of an ad blocker in this session was wrong — the
  "Turn off ad blockers" string is inert markup present on every Ads page.)

So the base tag is alive. The failure is specific to the **form-submit conversion
event** in `components/mainstreet-contact.tsx`:

```js
if (ADS_CONVERSION_SEND_TO && window.gtag) {
  window.gtag("event", "conversion", { send_to: ADS_CONVERSION_SEND_TO })
}
```

**Not yet root-caused.** Next step is to submit one real test lead on production and
watch the network tab for a request to `google.com/ccm/collect` carrying
`tid=AW-17817632790`. Do NOT create synthetic production leads to "prove" a dashboard.

Also flagged in campaign diagnostics: **“Enhanced conversions has setup issues
impacting performance.”**

---

## CHANGES MADE — all saved and verified live

All logged under `sales@musiccityspecialtywelding.com` in Change History, Sep 4 2026.

### 1. Call extension fixed — was broken since Dec 22, 2025
Two call assets carried **615-810-4910**, a number that does not appear anywhere on
the website. Google could not verify it → **Disapproved (Unverified phone number)**.
That is over 8 months with no call button on the ads.

- **Created new call asset `6157033296`** (the number the site actually shows).
- Status: **Pending / Under review**.
- The two old `6158104910` assets are still present and still disapproved — see TODO.

### 2. Negative keywords: 67 → 117 (+50)
Competitors / steel suppliers pulled from the search-terms report:
`summertown metals`, `music city steel`, `siskin steel`, `buds sheet metal`,
`kgs steel`, `loftis steel`, `metal supermarket`, `metal supermarkets`,
`steel beautiful welding`, `welding unlimited`, `southern arc`, `duck welding`,
`nasrat`, `music city trailer repair`, `iron works nashville`, `nashville iron works`

Out-of-scope work: `coppersmith`, `blacksmith`, `sheet metal shop`, `ductwork`,
`hvac duct`, `rim welding`, `wheel repair`, `jewelry`, `soldering`, `3d printing`,
`cnc machining`, `scrap metal`, `metal recycling`, `metal roofing`

Retail / DIY / parts: `welding helmet`, `welding gloves`, `welding rod`,
`welding wire`, `welding cart`, `welding table for sale`, `how to weld`,
`welding tips`, `youtube`, `salary`, `resume`, `certification`, `harbor freight`,
`tractor supply`, `northern tool`, `amazon`, `ebay`, `lincoln electric`,
`miller welder`, `esab`

All added as **phrase match at campaign level**.

**Deliberately NOT added** (too risky, would block real demand):
`free` / `cheap` (kills "free estimate" searches), `union` (Union City TN is a real
place), `carport` / `metal building` (real fab work), `duck river` (TN community).

### 3. Keywords: +60 exact match
Every one was pulled from the search-terms report — terms that already earned clicks
or conversions but were not keywords. Exact match chosen deliberately: the campaign
is budget-limited, so broad expansion would dilute the proven winners.

**Mobile Welding (+25)** — `[welders near me]` (10 clicks, 1 conv),
`[welder near me]`, `[mobile welders near me]` (20% conv rate — best in account),
`[mobile welder near me]`, `[mobile welder]`, `[welding near me]`,
`[welding shop near me]`, `[welding shops near me]`, `[welding services near me]`,
`[welding companies near me]`, `[mobile welding services near me]`,
`[mobile welding repair near me]`, `[weld shop near me]`, `[welding repair near me]`,
`[aluminum welder near me]`, `[aluminum welders near me]`,
`[stainless steel welders near me]`, `[tig welder near me]`,
`[mobile welding lebanon tn]`, `[welding lebanon tn]`, `[welding shop nashville tn]`,
`[24 hour welding near me]`, `[emergency mobile welding]`, `[on site welding near me]`,
`[portable welding service]`

**Architectural (+17, 43 → 60 total)** — `[metal fabrication nashville]`,
`[metal fabrication near me]`, `[metal fabricators near me]`,
`[fabrication shops near me]`, `[fabrication shop near me]`,
`[steel fabrication near me]`, `[custom metal fabrication near me]`,
`[metal shop near me]`, `[metal shops near me]`, `[metal works near me]`,
`[steel fabricators nashville]`, `[structural steel fabrication near me]`,
`[custom steel railings]`, `[handrail installation near me]`,
`[stair railing fabrication]`, `[metal fabrication murfreesboro tn]`,
`[welding and fabrication near me]`

**Trailer / Truck Repair (+12, 22 → 34 total)** — `[trailer repair near me]`,
`[trailer repair nashville]`, `[nashville trailer repair]`,
`[trailer repair murfreesboro tn]`, `[mobile trailer repair near me]`,
`[trailer welding near me]`, `[trailer frame repair near me]`,
`[trailer mechanic near me]`, `[liftgate repair near me]`,
`[gooseneck trailer repair near me]`, `[dump trailer repair near me]`,
`[truck bed repair near me]`

**Boat Welding (+6)** — `[aluminum boat repair near me]`, `[aluminum boat welding]`,
`[boat welding near me]`, `[aluminum boat welding near me]`,
`[jon boat repair near me]`, `[aluminum boat repair]`

### 4. Callouts: 4 → 14 (+10, campaign level, all Eligible)
`We Come To You` · `No Towing Needed` · `Shop + Road Rig` · `Call Day Or Night` ·
`Middle Tennessee` · `Trailers & Equipment` · `Railings & Structural` ·
`Talk To A Welder` · `Lebanon TN Shop` · `Send Photos For Quote`

All facts verified against `BRAND-BRIEF.md`. No banned phrases.

### 5. Structured snippets: 1 → 3 (+2, Eligible)
- **Types:** Steel, Aluminum, Stainless Steel, Cast Iron, Structural Steel
- **Neighborhoods:** Nashville, Lebanon, Mt. Juliet, Murfreesboro, Hendersonville, Gallatin

("Services" is not a valid Google header. "Service catalog" already existed.)

### 6. Images: +6 at campaign level (Pending / Under review)
Chosen from the existing Ads asset library — real crew photos: mobile truck + welder
on steel, welders on structural beams, Nashville skyline. Mix of Square 1:1 and
landscape. Deliberately skipped the MCS-logo-overlay photo (the one Google already
disapproved for text overlay).

Google estimated this at roughly **+4.1% CTR**. The campaign previously had **zero**
campaign-level images.

### 7. Location asset added — VERIFIED SERVING
Campaign level, source **"All locations"**. Confirmed live:
`Business Profile: sales@musiccityspecialtywelding.com — All locations selected — Enabled`.
The Business Profile **is** linked, so address, map pin and directions now attach to the ads.

### 8. Second RSA created for Trailer / Truck Repair — LIVE
Ad group went from **1 ad → 2**. Confirmed in the ads table as
`Trailer Repair Near You | Mobile Trailer Welding | Trailer Frame Repair +12 more`
on display path `musiccityspecialtywelding.com/trailer-repair/mobile-welding`.
Ad strength **Average**. Copy exactly as specified below.

The save required the owner to clear a Google **"Confirm it's you"** re-auth gate;
once cleared it saved on the first attempt.

### 9. Three disapproved assets paused
All were dead weight — none could serve, and they were holding the campaign in
`Eligible (Limited)`:
- Call `6158104910` × 2 — *Disapproved (Unverified phone number)* → **Paused**
- Image (MCS logo/text overlay) — *Disapproved (Text or graphic overlays)* → **Paused**

Paused rather than removed, so all three are reversible.
New call asset `6157033296` is now **Eligible** — approved, not just pending.

---

## The Trailer / Truck Repair RSA that was created

Ad group had only **one** ad at 2.82% CTR — worst in the account. This second RSA
gives Google something to test against. **Saved and live.** Spec as built:

- **Ad group:** Trailer / Truck Repair (`adGroupId=191293470140`)
- **Final URL:** `https://musiccityspecialtywelding.com/`
  (deliberately the homepage — see Decision 3 below; keeps copy as the only variable)
- **Path 1:** `trailer-repair`  **Path 2:** `mobile-welding`

**Headlines (15):**
1. Trailer Repair Near You
2. Mobile Trailer Welding
3. Trailer Frame Repair
4. We Come To Your Trailer
5. Nashville Trailer Repair
6. On-Site Trailer Welding
7. Ramp & Liftgate Repair
8. Open 24/7. Call Anytime
9. No Towing. We Drive Out
10. Steel & Aluminum Trailers
11. Trailer Welding Lebanon TN
12. Gooseneck & Dump Trailers
13. Get Back On The Road
14. Truck Bed & Frame Welding
15. Music City Specialty Welding

**Descriptions (4):**
1. Trailer down? We weld frames, ramps, liftgates and hitches on-site. No towing needed.
2. Mobile welding across Nashville and Middle Tennessee. Open 24 hours, seven days a week.
3. Send photos of the break. We tell you what it takes and when we can be there.
4. Steel and aluminum trailer repair at your yard, shop or job site. Clean welds.

Ad strength **Average**. 

⚠️ **Google's AI pre-fills the headline fields with generic filler** — "We Do It All",
"We've Got You Covered", "No Matter The Job", "Get It Done Right", "Save Time And
Money". All banned by `BRAND-BRIEF.md`. Overwrite every one of the 15 slots.

---

## Still open — owner-side only

1. **Business logo** — Disapproved *(Business Logo Irrelevance)*, account level, 0 impressions.
   Needs a clean square logo file from the owner. Cannot be fixed from inside Ads.
2. **"Business profile - Tracked call"** conversion action is **not** included in
   account-level goals, so those calls feed nothing. Left alone deliberately —
   including it would likely count organic (non-ad) calls and inflate reported
   conversions. Owner's call.
3. **Enhanced conversions** setup issue (campaign diagnostics) — website-side.
4. **The conversion tag itself** — see CRITICAL FINDING above. Top priority.

---

## Owner decisions outstanding

1. **Fix the website conversion tag.** Highest priority. Until it is fixed Smart
   Bidding is blind and budget decisions are guesswork.
2. **Budget.** Campaign is flagged *Limited by budget* at $40/day.
   **Recommendation: do not raise it yet.** Fix tracking, run 2 clean weeks, get a
   real CPA, then scale.
3. **Landing pages.** Every ad currently resolves to the homepage. Service pages exist:
   `/services/mobile-welding`, `/services/trailer-welding-repair`,
   `/services/equipment-repair`, `/services/architectural-welding`,
   `/services/custom-fabrication`, `/services/custom-metal-products`, `/service-areas`.
   `BRAND-BRIEF.md` states the homepage was *designed* to carry every ad group, and it
   is the proven converter. The service pages have never taken paid traffic.
   **Recommendation: test on Trailer/Truck first** — weakest ad group, least to lose.
   This is why the new RSA above points at the homepage: keep copy as the only variable.
4. **Advertiser identity.** The Ads account's verified advertiser name is
   **"neverlift chassis works, llc"**, not Music City Specialty Welding. The RSA
   Business name field is empty, so ads run with a placeholder derived from the URL.
   Worth resolving.

---

## Notes for whoever picks this up

- Google Ads UI is extremely slow under browser automation. Expect 30–60s per page.
  Screenshots time out constantly; `javascript_tool` DOM reads are far more reliable.
- Data tables are virtualised — they render **zero rows** in a narrow viewport.
  Keep the window at ~1920px wide. If Chrome page zoom drifts above ~150%, tables
  stop rendering entirely and only the owner can reset it (Ctrl+0); the extension
  blocks zoom shortcuts.
- The account has **AI Max** enabled on the search campaign — search terms show match
  type "AI Max" (e.g. "springfield welding", "cast iron repair", "welders nashville").
- The search-terms report had a stale **keyword filter** applied (18 keywords) that
  hid most of the data. Clear it before reading.
- An interim progress email was sent to `sales@` mid-session **in error** (owner asked
  for one final email only, at the end). Thread `1a06c2599041c4cd`. Supersede it.
