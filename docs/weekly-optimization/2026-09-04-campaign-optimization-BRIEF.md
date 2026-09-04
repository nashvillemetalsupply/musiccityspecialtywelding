# Campaign optimization brief — MCSW Google Ads

**Written 2026-09-04, immediately after the conversion-tracking repair.**
Measurement is fixed. This brief covers the work that repair did *not* touch:
making the campaign itself earn more per dollar.

Read this whole file before changing anything in the account.

---

## Account facts you need

| | |
|---|---|
| Ads account | `747-818-3137` |
| Login | `sales@musiccityspecialtywelding.com` |
| Deep link | `https://ads.google.com/aw/overview?__u=7478183137` (then pick that identity; it resolves to `authuser=2`) |
| Browser | The Chrome profile named **WELDING**. The other connected Chromes are signed into different identities and **cannot see this account** — you will waste twenty minutes finding that out. |
| Live campaign | **MCW General Fab-Ad**, `campaignId=23382574524`, Search, $40.00/day, Maximize conversions, status *Limited by budget*, optimization score 64.5% |
| Paused campaigns | `Welding Services near me` (PMax, $11.50/day), `ornamental` (Search, $75.77/day) |
| Targeting | 50 mi around Nashville TN, English, started 2025-12-21 |
| Networks | Google Search Network only. **No Display.** Verified. |
| Match types | Broad match keywords **off** ("use keyword match types"). AI Max present. Dynamic Search Ads setting present. |
| Campaign URL options | None set |
| Landing page | `https://musiccityspecialtywelding.com/` — the homepage, for every ad |
| GA4 | property `a403159229p548153838`, measurement id `G-CNSPDW74CJ` |
| Database | Neon, `DATABASE_URL` in `.env.local`. The `leads` table is the truth about what actually came in. |

---

## Already done — do not redo

Measurement was broken from 2026-08-24 to 2026-09-04 and is now repaired. Full
detail in `2026-09-04-google-ads-optimization-HANDOFF.md`. In short:

- The website silently dropped every conversion when Google's tag had not defined
  itself yet. Fixed (`57ced62`), verified live by deleting `window.gtag` and
  submitting the form.
- `Submit lead form (FIXED)` reads *Awaiting conversions*, All conv. 1.00.
- **`Call tap on website`** created (`AW-17817632790/0aSACPS5ue4cEJaAjrBC`), shipped,
  verified firing on a real tel: tap. The account has **4** conversion actions.
- All four old `615-810-4910` call assets deleted. One call asset remains:
  `6157033296`, Eligible, serving. The ads have a call button again after eight
  months without one.
- Enhanced conversions **turned off** on purpose — it was auto-scraping the quote
  form's contact fields while `/privacy` discloses only device/browser/page/
  conversion-event data to Google. Leave it off unless the owner updates that page.
- Budget deliberately left at $40/day.
- `/api/health` now fails the monitor after 96h with no web quote.

**Two things will look wrong and are not:** conversions read low for a few days
while the new phone action gathers data, and bidding wobbles while Smart Bidding
relearns after eleven days blind. Do not react to either before 2026-09-11.

---

## The baseline you are improving on

Whole account, **2026-08-05 → 2026-09-03**: 2,696 impressions · 225 clicks ·
8.35% CTR · $4.15 CPC · **$934.85** · 16 conversions · $58.43 CPA.

Split at the break, because mixing the two windows will mislead you:

| | Aug 5–23 | Aug 24 – Sep 3 |
|---|---|---|
| Impressions | 1,494 | 1,202 |
| Clicks | 122 | 103 |
| Cost | $474.07 | $460.78 |
| Conversions | 16 | 0 *(measurement was broken — not a performance signal)* |

**Only the Aug 5–23 conversion numbers are real.**

### Ad groups, Aug 5 – Sep 3

| Ad group | Impr | Clicks | CTR | Cost | Conv | CPA | id |
|---|---|---|---|---|---|---|---|
| Mobile Welding | 1,282 | 136 | 10.61% | $561.15 | 9.5 | $59.07 | — |
| Architectural | 1,142 | 75 | 6.57% | $315.99 | 5.5 | $57.45 | `190434711333` |
| Trailer / Truck Repair | 248 | 7 | **2.82%** | $30.24 | 1.0 | $30.24 | `191293470140` |
| Boat Welding | 17 | 5 | **29.41%** | $20.07 | 0 | — | — |
| Custom Mailboxes | 7 | 2 | **28.57%** | $7.40 | 0 | — | — |
| Street Scape | 0 | 0 | — | $0 | 0 | — | — |
| Manifold | paused | | | | | | |
| Stainless Steel | paused | | | | | | |

Mobile Welding + Architectural = 94% of spend and every conversion.

### Search terms, Aug 24 – Sep 3

- Visible: 54 clicks · 570 impr · 9.47% CTR · $4.16 CPC · **$224.57**
- **"Other search terms" (privacy-thresholded, invisible): 49 clicks · 632 impr · 7.75% CTR · $4.82 CPC · $236.21**
- 251 distinct terms

Top visible spend: `welders near me` (6 clicks, $22.28) · `custom metal fabrication`
($14.12) · `welding shops near my location` ($9.58) · `welder` — AI Max ($9.32) ·
`metal shops near me` ($9.25) · `local welders near me` ($8.61) ·
`welding shops near me` ($8.47) · `aluminum welding` — AI Max ($7.92) ·
`mobile welder repair near me` ($7.54) · `weld shop near me` ($7.18)

Terms that actually converted, Aug 5–23: `a welder near me` (2 clicks, 50%) ·
`mobile welders near me` (4 clicks, 25%) · `welders near me` (4 clicks, 25%) ·
`welding shop near my location` (1 click, 50%).

**The intent is excellent and unchanged across both windows.** Do not go hunting
for junk traffic to blame; it is not the story.

---

## The five things worth money

Ordered by expected return, not by ease.

### 1. Trailer / Truck Repair is buying impressions nobody clicks
248 impressions, 7 clicks, **2.82% CTR** against an 8.35% account average. A low
CTR at high impressions drags the campaign's quality signals down and eats budget
in a campaign already flagged *Limited by budget*.

Decide between: rewrite the ads to match the query intent, tighten the keywords,
or pause the group and give the budget to what converts. Read its search terms
first — the mismatch is usually obvious at a glance.

### 2. Boat Welding and Custom Mailboxes are the best ads in the account and are starved
29.41% and 28.57% CTR. Seventeen and seven impressions. Something is throttling
them — most likely keyword volume or bid, in a budget-limited campaign where
Smart Bidding is pushing money at the two large groups.

These are also high-margin, low-competition jobs for this shop. Establish whether
the constraint is search volume (nothing to be done — small market) or bid/budget
starvation (fixable). The impression-share columns — "Search impr. share",
"lost IS (budget)", "lost IS (rank)" — answer this in one report.

### 3. Half the spend is invisible
$236.21 of $460.78 sits in "Other search terms" Google will not name, so negative
keywords cannot reach it. Structural, not directly fixable. What *is* available:
tighter match types, a real negative list on what you can see, and measuring
whether AI Max is where the invisible spend concentrates. Two visible terms
(`welder`, `aluminum welding`) are AI Max matches — broad, cheap-intent, and worth
segmenting before trusting.

### 4. There is no negative keyword list
Check `Audiences, keywords and content → Negative keywords`. Nothing observed
suggests one exists. At minimum this shop should block: jobs, hiring, careers,
salary, school, training, courses, certification, "how to", DIY, free, cheap,
rental, rent, buy welder, welding machine, welding helmet, welding rod, supplies,
apprentice, union. Each of those is a click that can never become a job.

### 5. Every ad lands on the homepage
`/` is a long page and the quote form sits at the bottom. An ad for
"trailer welding repair near me" drops the visitor at the top of a general
welding homepage and asks them to scroll.

The repo already has service pages — `/services/mobile-welding`,
`/services/trailer-welding-repair`, `/services/equipment-repair` and three more
(see `app/services/[slug]`). Matching each ad group's final URL to its service
page is the biggest landing-page lever available and needs no design work.

**Design constraint:** the site's visual design is locked. See the memory note
`mcsw-design-review-method` — a redesign was abandoned after seven rejections.
Routing ads to existing pages is fine. Restyling pages is not, unless the owner
asks for it.

---

## The one genuinely open question

**GA4 `form_start` has been 0 every day since 2026-08-29.**

Users per day on the welding property:

| | Aug 1–23 | Aug 25 / 27 / 28 | Aug 29 – Sep 3 |
|---|---|---|---|
| `form_start` | 21 | 3 | **0** |
| `generate_lead` | 15 | 0 | 0 |

`form_start` is Google's own enhanced measurement — it fires when a visitor starts
typing in a form, independent of our code. Zero for six straight days, on roughly
nine ad clicks a day, is unusual for a period that previously saw a form start on
14 of 23 days.

It may be nothing (low traffic, small numbers). It may be that people stopped
reaching the form. **Check this before spending money on anything else** — if
visitors cannot or will not reach the form, every other optimization is water
into a bucket with a hole. The `/api/health` watchdog also flags 96 hours of
quote-form silence, so it will show up there too.

---

## Traps that cost an hour each

- **`utm_source=internal-verify` and `utm_medium=e2e` switch the analytics tag off by
  design.** Test through those and you will "confirm" a broken tag that is fine.
- **Never submit a fake lead on production.** To exercise the form end to end,
  stub `/api/quote` in the browser console to return `{"ok":true,"accepted":true}`
  and submit normally. To test the server without writing a row, send a valid
  payload with a deliberately invalid `intakeKey` — it is rejected before any write.
- **The Ads UI refuses scripted clicks on destructive controls** (Remove, Save).
  Use a real mouse click through the `computer` tool.
- **The conversion-action wizard duplicates rows** when you pick a category whose
  only data sources are phone. Pick the category first, then choose the website
  data source from the "+ Create conversion" menu.
- **Vercel preview and production deployment URLs sit behind SSO** and cannot be
  loaded for comparison.
- **Run `npx next build` before pushing** anything touching a `"use client"` file —
  `tsc` and the suite both pass while the real build fails.
- Neon has a free compute budget; do not add polling cron jobs casually.

---

## What "done" looks like

1. Every ad group either earns its spend or is paused, with the reasoning written down.
2. A negative keyword list exists and is populated.
3. Each ad group's final URL points at the page matching its service.
4. The `form_start` question is answered — cause found, or ruled out with data.
5. Impression-share numbers explain Boat Welding and Custom Mailboxes, and the
   constraint is either fixed or named as unfixable.
6. Ad copy for the worst-CTR ad group is rewritten, or the group is retired.
7. Every change is written into a dated file in `docs/weekly-optimization/`, the
   way this one is, so the next session does not start from zero.

Do not change the budget or the bidding strategy before 2026-09-11. The account
needs one clean week of real conversion data first, and it has not had one since
2026-08-23.
