# Fable final ruling: Music City Specialty Welding site, 2026-11-10

VERDICT: FAIL

Ruled against the live site (https://musiccityspecialtywelding.com, main at `c7827bc`) and the code on main. The site is sound, safe and shippable as a working lead page. It is not yet "nothing could make it better". The verdict stands on the confirmed defects alone: 1, 3, 4, 5, 10, 12 and 13. Codex's `docs/FINAL-REVIEW-2026-11-10.md` "ship yes" is overruled on design finish and chat coverage, not on safety.

Evidence labels: **CONFIRMED** = read in code or measured in the rendered page. **OBSERVED** = seen in my screenshots only, no measurement.

Viewports: M = 390x844, D = 1440x900.

## Defects

### Typography

1. **Body and label fonts are system fallbacks, off-brief.** All 12 routes, M and D. HIGH. CONFIRMED.
   Rendered fonts on every capture are `Arial`, `Barlow Condensed`, `Cascadia Mono`. `app/globals.css` `:root` sets `--font-ms-sans: Arial, Helvetica, sans-serif` and `--font-ms-mono: "Cascadia Mono", "SFMono-Regular", Consolas, monospace`. `app/layout.tsx` loads only `Barlow_Condensed` and `Permanent_Marker`. BRAND-BRIEF.md specifies IBM Plex Sans body and IBM Plex Mono labels, and the services plan bans a system body font. Arial is the single loudest "template" tell on the page. Cascadia Mono exists only on Windows, so labels render in a different face on iPhone, Android and Mac: the brand is not the same on the devices customers use.
   Fix: in `app/layout.tsx` add `IBM_Plex_Sans({ weight: ["400","500","600"], variable: "--font-ms-sans", display: "swap", subsets: ["latin"] })` and `IBM_Plex_Mono({ weight: ["500","600"], variable: "--font-ms-mono", display: "swap", subsets: ["latin"] })` from `next/font/google`, add both `.variable` classes to `<html>`, and delete the two literal `--font-ms-sans` / `--font-ms-mono` declarations in `app/globals.css` `:root`. Re-measure LCP and CLS after (see 14).

2. **Display face disagrees with the brief.** All routes. MEDIUM. CONFIRMED.
   Brief says Archivo 700 to 900. Live is Barlow Condensed 900. Barlow Condensed looks right for a shop wall and I would keep it.
   Fix: amend BRAND-BRIEF.md typography section to "Display: Barlow Condensed 900" so code and brief agree. No code change. Needs owner nod because it edits the brief.

3. **Label sizes too small, type scale undisciplined.** All routes, worst on D. MEDIUM. CONFIRMED.
   About 33 distinct font sizes on home. Mono labels render at 8.96px to 10.24px. `app/globals.css` has 25+ label rules between `0.5rem` and `0.68rem`, including `.ms-mobile-cta small` (0.5rem), `.ms-nav-call small` (0.52rem), `.ms-contact-call small` (0.58rem), `.ms-subclose a[href^="tel:"] small` (0.58rem), the footer meta row, form field labels, breadcrumb, and the service-page "Other work" strip. A 9px uppercase tracked label is unreadable for a 55-year-old trailer owner on a phone.
   Fix: add `--ms-label: 0.75rem` to `:root` in `app/page-cohesion.css` and set every mono label rule to `font-size: var(--ms-label)` (12px floor, 13px for form field labels). Collapse body sizes to one scale: 12 / 14 / 16 / 18 / 20, plus the display clamps.

### Layout and spacing

4. **Two different left edges on desktop home.** `/`, D. MEDIUM. CONFIRMED.
   `#work` and later sections start at x=48 (the `--ms-gutter`). "What needs welded?" and "More from the shop" start at x=176 because `app/page-cohesion.css` has `.ms-site .ms-services-heading, .ms-site .ms-service-list, .ms-site .ms-capability-board { max-width: 68rem; margin-inline: auto; }`. Scrolling the page, the left margin jumps in and back out. That breaks the "one cohesive page" read.
   Fix: introduce one `--ms-container: 76rem` and apply `max-width: var(--ms-container); margin-inline: auto` to the inner wrapper of every section (work, services, get-it, process, job-glass, territory, faq, contact, footer), and remove the 68rem override. One edge, top to bottom.

5. **Mobile menu looks broken when open.** All routes, M. HIGH. CONFIRMED (code) and OBSERVED (render).
   `.ms-menu-panel` is `position: absolute; right: 0; min-width: 15rem` with no backdrop. Open, it is a 240px box hanging off the right that covers part of the hero headline and leaves fragments showing beside it ("MUSIC CI", "SPEC", "WELI"). First tap on the site and it looks unfinished.
   Fix in `app/page-cohesion.css`: `@media (max-width: 979px) { .ms-site .ms-menu { position: static; } .ms-site .ms-menu-panel { position: fixed; left: 0; right: 0; top: var(--ms-header-height, 72px); min-width: 0; padding: 0.5rem var(--ms-gutter) 1rem; border-width: 1px 0; } .ms-site .ms-menu[open]::before { content: ""; position: fixed; inset: 0; top: var(--ms-header-height, 72px); background: rgb(16 12 8 / 0.72); } }`. The call button inside becomes full width.

6. **Desktop chat launcher sits on content.** All routes, D. MEDIUM. CONFIRMED by Codex's own measurement (launcher intersects the bottom 7.95px of two footer link boxes at 1440x1000); OBSERVED at 1440x900: it crowds the Privacy / Terms / Facebook row and sits on the third FAQ row's "+" toggle on home. Codex accepted it; I do not. A fixed control must never touch content.
   Fix: in `app/globals.css` change the desktop `.ms-footer` rule from `padding-bottom: 4rem` to `padding-bottom: 6.5rem` so the footer meta row ends above the launcher. In `app/page-cohesion.css` at `min-width: 980px` cap the FAQ list inside `.ms-site .ms-faq` at `max-width: calc(100vw - var(--ms-gutter) - 13rem)` so no toggle can reach the launcher's column. Re-measure with bounding boxes: zero intersection with any link or toggle at 1440x900 and 1280x720.

7. **Mobile footer dead space.** All routes, M. LOW. OBSERVED.
   About 200px of empty dark below the footer links before the sticky bar.
   Fix: set the mobile `.ms-footer` bottom padding to `calc(var(--ms-mobile-cta-height, 56px) + 1.5rem + env(safe-area-inset-bottom))`, nothing more.

8. **Service pages close twice.** All seven `/services/<slug>`, M and D. MEDIUM. CONFIRMED (code and render).
   `app/services/[slug]/page.tsx` renders `<section className="ms-subclose">` ("Tell us what the metal is doing." with Call / Ask) and directly under it `<MainstreetContact showActions={false} />`, whose lead says "Show us the job. Call the shop or send the details below." and prints the phone number again. Two closing headlines back to back, same pitch twice.
   Fix: delete the `.ms-subclose` section from `app/services/[slug]/page.tsx` and drop `showActions={false}` so `MainstreetContact` renders its own Call / Ask row, the same closing block home uses. One closing section, still one closing CTA.

9. **Service-areas content stops two thirds across.** `/service-areas`, D. LOW. OBSERVED.
   "What makes a road call work" list ends near x=985, right third empty.
   Fix: two-column grid for that list at `min-width: 980px`, or let it span the shared container from defect 4.

### Quote form

10. **Consent checkbox is a big white square.** `/` and services, M and D. MEDIUM. CONFIRMED.
    In `app/page-cohesion.css`, `.ms-site .ms-text-consent { grid-template-columns: 44px minmax(0, 1fr); }` and `.ms-site .ms-text-consent > input { width: 44px !important; height: 44px; margin: 0; accent-color: var(--ms-ink); }` turn the native checkbox into a 44px pure-white box on cream paper. It is the brightest thing in the form and it is an optional field.
    Fix in `app/page-cohesion.css`: `.ms-site .ms-text-consent { grid-template-columns: 1.5rem minmax(0,1fr); } .ms-site .ms-text-consent > input { width: 1.25rem !important; height: 1.25rem; margin-top: .2rem; accent-color: var(--ms-copper); }`. The whole label stays the 44px tap target.

11. **Consent and fallback copy have stray spaces and a ragged last line.** Same pages. LOW. CONFIRMED.
    `.ms-text-consent a` and the fallback phone link are `display: inline-flex; min-width: 44px; min-height: 44px`, which pushes the following period away ("terms ." and "(615) 703-3296 .") and opens a gap above the last consent line.
    Fix: `.ms-site .ms-text-consent a, .ms-site .ms-form-fallback a { display: inline; min-width: 0; min-height: 0; padding-block: .6rem; }`.

12. **The form's main action is styled as the secondary button.** Same pages. MEDIUM. CONFIRMED.
    `components/mainstreet-contact.tsx` renders the submit as `ms-submit ms-button ms-button-secondary`: a thin outline, the weakest button on the page, on the one action the form exists for. On desktop it also sits left-aligned at content width under a full-width form.
    Fix: change the class to `ms-submit ms-button ms-button-primary` and set `.ms-site .ms-submit { width: 100%; }` below 600px. Also on desktop let `#quote-service` span both columns (`.ms-field:has(#quote-service) { grid-column: 1 / -1; }`) so it does not leave an empty half row, and style the select with `appearance: none` plus a chevron so it matches the inputs.

### Chat

13. **Chat hands off questions the site already answers, and its answer quality on the live model is unproven.** Chat, all routes. HIGH. CONFIRMED from `docs/assistant-audit-after.json` and `docs/assistant-audit-prod.json`.
    The owner asked for "a full database of answers" that "handles everything". What exists: no curated answer database. The model answers only from text scraped out of the service pages, service-areas page, brand brief, home FAQ and form. In the 143-question bank, 42 are answered and 101 hand off. The 42/101 split comes from scripted fixture replies, not the live model, so real answer quality is unverified; I could not verify it either, because no message may be sent to production. That alone blocks a chat PASS.
    Confirmed guard defect: in these bank rows the scripted model reply was a correct answer taken from site copy, and the application threw it away and substituted a person route (`branch` field in the audit file):
    - "Can you repair a trailer where it sits?" and "Can you weld a cracked trailer frame?" (`expert-safety-intake`)
    - "Can you repair a gate where it hangs?", "Can you repair equipment at our facility?", "Can you fabricate gas meter manifolds?", "Do you need close-up and full-item photos?", "Can I upload a picture directly in this chat?" (`expert-claim-intake`)
    - "What do you need to know about a broken gate hinge?" (`unknown-capability-intake`)
    - "What photos help with a trailer quote?", "What photos help with a gate quote?", "What photos should I send for a mobile welding quote?", "What measurements help with a custom fabrication quote?" (`contact-handoff`)
    So the guards in `lib/assistant/turn.ts` are tuned so tight that a right answer about the shop's core work is replaced by "A person at the shop will confirm that job." Of the 101 handoffs, 63 open with that exact sentence, 22 with "A person at the shop can help.", 12 with the safety line, and 4 with the gate-motor boundary line (that last one is a real answer and is fine).
    Unverified on the live model: "Can you repair my farm tractor's broken loader attachment?" (the fixture reply was itself uncertain), and the one live sample that matters most. Production, real model, question P1: "Do you offer on-site mobile welding in Nashville?" returned "A person at the shop will confirm that job." That is the core service on the home page and the chat did not say yes. That sample predates the chat-audit deploy; nobody has re-sampled since.
    Fix:
    a. Add `lib/assistant/answers.ts`: a curated, owner-approvable list of `{ id, patterns, answer, source }` covering every topic in the coverage table below that the repo can answer, in shop voice, two sentences max. `turn.ts` checks it before calling the model and the model receives it as knowledge. This is the "database of answers" the owner asked for.
    b. In `lib/assistant/turn.ts` let a reply through when every claim in it matches the curated answers or the service-page knowledge: the `expert-claim-intake`, `expert-safety-intake`, `contact-handoff` and `unknown-capability-intake` branches must not fire on the twelve rows above. Change those twelve to `expected: "answer"` in the bank so the replay fails if a guard eats a sourced answer again. Keep every safety refusal (tow it, load rating, DIY) as is.
    c. Vary the handoff sentence. There are four handoff openings across 101 handoffs, and one of them covers 63. Give each concern (price, timing, credentials, safety, out of area, off topic) its own first sentence that says why a person is needed.
    d. Run the opt-in live-model eval over the full bank against a preview with the `[INTERNAL TEST]` prefix and file the transcript. Until that exists, nobody can say the chat is good.
    e. Prove delivery once: one `[INTERNAL TEST]`-free handoff, sent by the owner from his own phone, read back in the Sales inbox and on the owner cell. Both audits say delivery was never read back.

    Coverage against the task's list:

    | Topic | State |
    | --- | --- |
    | Services offered (7 pages) | Answered from site copy, with the gaps above |
    | Metals: steel, aluminum, stainless | Answered. Cast iron, titanium, magnesium: graceful handoff |
    | Aluminum / boats | Answered |
    | Mobile / job site | Answered in fixtures; live sample handed off (defect) |
    | Service cities (8) | Answered |
    | Travel radius beyond the list | Graceful handoff; fact needed |
    | Pricing stance | Graceful handoff, 12 of 12; no stance sentence beyond "a person will quote"; fact needed |
    | Timelines / lead time | Graceful handoff; fact needed |
    | How to get a quote, photos | Partly answered; photo guidance hands off (defect) |
    | Hours | Graceful handoff; fact needed |
    | Contact | Answered (phone, form, email, address) |
    | Insurance / license / certs / warranty | Graceful handoff; fact needed |
    | Payment methods | Graceful handoff; fact needed |
    | Gates, railings, trailers, equipment repair | Mixed: sourced yes/no answers get replaced by a handoff (defect) |
    | Safety (tow it, keep using it) | Correct refusal plus person route. Keep |
    | Off-topic, spam, prompt injection | Polite close or person route. PASS |
    | Human request | Person route with phone, form, email. PASS |
    | Spanish | Handled. PASS |

### Performance

14. **The Lighthouse mobile >= 98 bar is unproven and probably missed.** `/`, M. MEDIUM. UNPROVEN (not a measured fail; does not carry the verdict).
    The five `lighthouse-mobile*.json` files in the repo root are from 2026-08-02 (performance 0.82 to 0.91, best-practices 0.79) and say nothing about today's build. The only current number is Codex's own: LCP 1.70 to 3.17s, median 2.43s, crossing the 2.5s line in one of four runs. I did not run Lighthouse.
    Fix: run Lighthouse mobile three times against production after the font change, commit the JSONs under `docs/perf/2026-11-xx/`, delete the five August files from the repo root (move them to `docs/perf/archive/`), and hold the release to performance >= 98 and LCP under 2.5s in all three. If the hero image is the LCP element, confirm it has `priority` and `fetchPriority="high"` and that the 9KB hero is not waiting on CSS.

### Content and consistency

15. **Two different city lists in two different styles.** `/` `#area` vs `/service-areas`. LOW. CONFIRMED.
    Home lists seven cities as inline spans in `app/page.tsx` (no Antioch). `/service-areas` lists eight from `const areas` in its own style.
    Fix: export `serviceAreas` from one module (for example `lib/service-areas.ts`), import in both pages and in the assistant knowledge, and use one chip component.

16. **Weak photo matches on the pages that sell hardest.** `/services/mobile-welding` hero (a balcony railing with a ladder leaning on it), home service rows for Mobile Welding and Equipment Repair, `/services/trailer-welding-repair` hero (bare trailer deck shot from above). M and D. MEDIUM. OBSERVED.
    The brief says the work is the proof. A mobile welding page needs the rig or a weld in progress on site. This is an asset gap, listed again under facts needed.
    Fix now: swap the mobile-welding hero to the strongest on-site photo already in `public/` and the equipment row to an equipment photo. Fix properly when the shop sends photos.

17. **404 page uses a different button style.** `/<anything missing>`. LOW. OBSERVED.
    CONFIRMED in code: the two actions are bare anchors styled by `.ms-lost-actions a`, not the shared `.ms-button` every other page uses; they render display-face uppercase ("BACK TO THE SHOP"). "We still answer the phone." also leans on an availability claim the brief does not allow.
    Fix: in `app/not-found.tsx` give the phone anchor `className="ms-button ms-button-primary"` and the home link `className="ms-button ms-button-secondary"`, delete the `.ms-lost-actions a` rules in `app/globals.css` and `app/page-cohesion.css`, and change the line to "The page may have moved. The shop has not."

18. **Voice-bar slips in live copy.** LOW. CONFIRMED.
    - `components/mainstreet-contact.tsx` success message: "If it cannot wait, call now." Change to "If it can't wait, call now."
    - `lib/assistant/turn.ts` safety line: "I cannot assess safety remotely; the damaged part needs inspection before towing, loading or use." Change to "Nobody can call that safe from a chat. Have it looked at before you tow it, load it or use it."
    - `lib/assistant/input.ts`: "Keep each message under 2,001 characters." Change to "Keep each message to 2,000 characters or less."
    - Chat helper line "No prices or scheduling promises. Share job details and a callback number." reads defensive. Change to "Tell us the job and a number to call. The shop gives prices and dates."

19. **Awkward line breaks.** LOW. OBSERVED.
    Home, D: Mobile Welding blurb ends "... No / towing required." Home, M: "... the steel carrying the / load." `/service-areas`, D: "SHOP WORK COMES FIRST WHEN / IT SHOULD." Footer, D: "... Neverlift Chassis Works, / LLC."
    Fix: `text-wrap: balance` on `.ms-site :is(h1, h2, h3)` and `text-wrap: pretty` on `.ms-site p` in `app/page-cohesion.css`; a non-breaking space before "LLC" in `components/footer.tsx`.

20. **Sitemap dates are stale.** `/sitemap.xml`. LOW. CONFIRMED.
    `app/sitemap.ts` hardcodes `2026-09-27` for home, service areas and every service page; the pages changed on 11-10. Terms shows "Last updated: August 11, 2026" on the page and `2026-08-29` in the sitemap.
    Fix: set the real dates, and make the terms page and sitemap agree.

Defect count: 20 (3 high, 9 medium, 8 low).

## Owner confirmation (not counted as a defect)

**Does the base color read brown enough?** The owner said on 11-10: "I liked the old brownish color that looked more southern rather than straight black." The brief's palette ruling is marked owner-approved, was committed the same day (`67e71fa`, 14:14 Central), and names night canvas `#100c08` for body, hero, header and footer. I cannot prove which of the two came last. The live site matches the brief exactly: `body` computes to `rgb(16, 12, 8)` on all 12 routes, and the plank sections are properly brown. So the code is right by the written ruling. My read: on a phone `#100c08` is black, and the first screen (header and hero) is the black one with a bright orange button on it. If the owner looks at the live hero on his phone and says "still black", the change is one token, `--ms-carbon: #16100b` in `app/page-cohesion.css` `:root`, plus the matching brief row and palette test value. If he says it is right, nothing changes.

## Facts needed

Only the shop owner knows these. None is a code defect. The chat does not invent any of them; each routes to phone, form and email, which is graceful. But each one is a common first question, so every missing fact is a customer the chat sends away to wait for a call.

1. **Legal entity. HIGH.** The footer, privacy page, terms page and the `legalName` in the site's JSON-LD (`app/layout.tsx`) all say "operated by Neverlift Chassis Works, LLC". On 2026-10-27 the Tennessee Secretary of State record showed that LLC as administratively dissolved; the shop owner's CPA said the annual report was filed and the record had not caught up. Someone must re-read the SOS record and confirm the entity name the site should carry. I am not saying which name is right. Chat is not affected.
2. Hours, and whether after-hours or weekend calls are taken. Chat: graceful handoff.
3. Pricing stance: free estimates or not, any minimum or call-out charge, mileage. Even "estimates are free, the price comes after we see photos" would let the chat answer 5 of the 12 price questions. Chat: graceful handoff.
4. Insurance (and whether a certificate can be sent), licenses, welder certifications. Chat: graceful handoff, never claims any.
5. Warranty or workmanship stance. Chat: graceful handoff.
6. Payment methods, deposits, commercial terms. Chat: graceful handoff.
7. Travel limit beyond the eight listed cities, and any travel charge. Chat: graceful handoff.
8. Typical lead time, or a sentence the shop is willing to stand behind. Chat: graceful handoff.
9. Whether drop-offs need an appointment. Chat: graceful handoff.
10. Cast iron, and other metals the shop will or will not take. Chat: graceful handoff.
11. Photos: on-site rig / weld-in-progress, equipment repair, a finished trailer repair (see defect 16).
12. Proof the brief already lists as pending: named projects, years in business, reviews, crew.

## What passes

No horizontal overflow on any route at either width. No broken images. All routes 200 (404 route returns the 404 page). Unique title, description and canonical per route; one H1 each. JSON-LD present and typed correctly (business schema everywhere, FAQ on home, Service + Breadcrumb + FAQ on service pages). CTA count matches the owner's rule: hero, mid, closing on home, plus header and sticky bar. Mobile sticky Call / Ask bar. Chat dialog layout, automated-assistant disclosure, safety refusals, off-topic and human routes, Spanish. Quote form field set, client validation, idempotent retry key, honeypot, photo limits, and a 429 path that gives the phone number (per-instance counter in `app/api/quote/route.ts`; its comment says a durable Postgres layer backs it, which I did not trace). Legal pages sit in the same paper-on-dark frame as the rest. The seven service pages share one clean template. The Southern shop character is there without costume. Console errors: none except the two analytics requests my capture blocked.

## What I checked, and what I did not

Checked:
- Live production, read-only, with a headless browser: `/`, `/service-areas`, all seven `/services/<slug>`, `/privacy`, `/terms`, and a missing URL, each at 390x844 and 1440x900 (24 captures). Computed fonts, sizes, colors, backgrounds, overflow, image status, metadata, JSON-LD, CTA placement, small tap targets, console and network errors.
- By eye: home top to bottom at both widths; mobile menu open; chat open at both widths; sticky bar; form at both widths; FAQ; footer; `/services/gate-repair` and `/services/mobile-welding` in full on desktop; `/services/trailer-welding-repair` mobile fold; `/service-areas` desktop; privacy desktop fold; terms mobile fold; 404 desktop. The other four service pages share the template (identical section metrics) and were checked by metrics, not read line by line.
- Code: `app/layout.tsx`, `app/globals.css`, `app/page-cohesion.css`, `app/page.tsx`, `app/sitemap.ts`, `app/not-found.tsx`, `components/mainstreet-contact.tsx`, `components/navbar.tsx`, `components/mainstreet-menu.tsx`, `components/footer.tsx`, `components/assistant-chat.module.css`, `lib/public-quote.ts`, `app/api/quote/route.ts` (validation and rate-limit paths), `lib/assistant/turn.ts`, `input.ts`, `intake.ts`, `handoff.ts`, `knowledge.ts`.
- Docs: `BRAND-BRIEF.md`, `AGENTS.md`, `CLAUDE.md`, `docs/FINAL-REVIEW-2026-11-10.md`, `docs/ASSISTANT-AUDIT-2026-11-10.md`, `docs/ASSISTANT-EXPERT-REVIEW.md`, `docs/assistant-audit-after.json` (all 143 rows, grouped by category), `docs/assistant-audit-prod.json`, the services brand plan.

Not done, and why:
- No form submitted and no chat message sent to production (forbidden; production database, inbox and Resend are live). So the quote path is verified by code and rendered form only, and live chat answers are not verified at all.
- No Lighthouse run. Defect 14 is "unproven", not "measured fail".
- Test suite not run: this checkout's `node_modules` is empty. Codex reports 1,517 passing; I did not reproduce it.
- Launcher overlap (defect 6) and the wraps in defect 19 are from screenshots, not bounding-box measurements.
- No real-device check. Font fallback on iOS and Android (defect 1) is from the font stack, not from a phone.
- No code edited, nothing committed, nothing pushed.

## Codex round 1

Implemented locally on `fix/fable-final-r1`, November 10, 2026. This records
remediation evidence, not a replacement Fable verdict. No push, deployment,
merge, production message, live model request, or provider delivery test was made.
`ASSISTANT_VOICE` stayed off. Business facts and the legal entity are unchanged.
The active palette from `67e71fa`, including `--ms-carbon: #100c08`, is unchanged.

| # | Status | Change and evidence |
| --- | --- | --- |
| 1 | FIXED | `app/layout.tsx` loads IBM Plex Sans as one variable face covering 400/500/600, and IBM Plex Mono 500/600, with swap; removed literal fallback variables. Browser computes both Plex families on all three checked routes. Display and body fonts preload; Mono loads when used. |
| 2 | EXCLUDED / brief corrected | Kept Barlow Condensed 900 as instructed. `BRAND-BRIEF.md` now says Barlow Condensed and carries `Fable 2026-11-10 #2`. |
| 3 | FIXED | Added `--ms-label: .75rem`, normalized public small/body type, and set form labels to 13px. Browser finds no Plex Mono label below 12px. Chat small type follows the same floor. |
| 4 | FIXED | Shared 76rem container and responsive inner insets replace the 68rem service exception. Desktop section content edges measure x=112 throughout home at 1440px, including footer. |
| 5 | FIXED | Mobile menu spans x=0 through 390px below the 73px header, with a working dismissible backdrop and full-width actions. Escape closes it. Before/after open-menu captures are in `docs/design-shots/`. |
| 6 | FIXED | Desktop footer gets 6.5rem bottom clearance; FAQ leaves the launcher column clear. Bounding-box checks find zero launcher intersections with FAQ toggles/footer links at 1280x720 and 1440x900. |
| 7 | FIXED | Mobile footer uses sticky-bar height + 1.5rem + safe area; removed extra body padding. Full-page captures show the compact ending. |
| 8 | FIXED | Removed the service template's duplicate `.ms-subclose`; the server contact section owns the single closing headline, Call/Ask row and deferred real quote form. CTA tests pass on all seven services. |
| 9 | FIXED | Service-area road-call list spans the common container in two desktop columns. See desktop service-area capture. |
| 10 | FIXED | Native consent checkbox is 20px, with copper accent and a full-label target above 44px. Measured on home and the service page at both widths. |
| 11 | FIXED | Consent and fallback links are inline, with no forced 44px inline boxes. The phone remains one unbroken unit. Inspected both full forms; punctuation remains attached. |
| 12 | FIXED | Submit uses shared primary styling and fills the form's inner width; service selector spans both desktop columns and uses a matching chevron. Browser confirms appearance:none, and quote error/retry/success fixtures pass. |
| 13 | FIXED within offline scope / live proof EXCLUDED | Added 69 curated sourced entries in `lib/assistant/answers.ts`, shared with model knowledge. Complete-question matches answer without a provider, including repeat FAQ/intake turns with grounded persisted fields. Only complete sourced replies bypass the four guards; unknown clauses, unsafe followups, DIY/towing/load ratings and unverified facts retain refusal/handoff. All twelve named rows require `answer`. Offline bank improves 42 answers/101 handoffs to 61/82, with 0 wrong, 0 dead ends and 0 outbound attempts. Largest opening is 11/82 (13.4%). Full-bank live preview evaluation and owner-phone delivery/readback are excluded by the no-deploy/no-production/offline instructions; no live quality or delivery claim is made. |
| 14 | UNRESOLVED / measured FAIL | Final Lighthouse 13.6.0 mobile runs with chat enabled score home 90/91/91 and mobile welding 92/91/91; LCP remains 3.27–3.38s. The required 98 / under-2.5s bar is not met. Reports and settings are in `docs/lighthouse-2026-11-10.json` and `docs/perf/2026-11-10/`. Remaining startup/render delay persists after the measured optimizations below. No August `lighthouse-mobile*.json` files existed in this worktree to archive. |
| 15 | FIXED | `lib/service-areas.ts` is the shared eight-city source. Both pages render `ServiceAreaChips`; assistant knowledge and LocalBusiness schema use the same list. Antioch appears on both pages. |
| 16 | FIXED mobile / remaining asset changes EXCLUDED | Mobile service hero and home mobile row now use the existing on-site commercial-work photo `IMG_3994.webp`. Inspected existing public assets; no better permitted equipment/trailer match exists. Kept those images and corrected equipment alt text to what the image actually shows. The axle image is explicitly owner-rejected in `public-discovery-regressions.test.mjs` and remains unused. No image was generated or fetched. A dedicated rig/welding-in-progress or machinery/finished-trailer repair photo remains an owner asset gap. |
| 17 | FIXED | 404 actions use shared primary/secondary buttons, bespoke anchor rules were removed, and copy is “The page may have moved. The shop has not.” Three unused old 404 color aliases were removed; active palette values are unchanged. |
| 18 | FIXED | Updated quote success contraction, safety refusal, 2,000-character message limit and chat helper to the ruling's wording. Assistant tests enforce the new copy. |
| 19 | FIXED | Headlines balance, paragraphs/list copy use pretty wrapping, and footer keeps the nonbreaking space before LLC. Legal entity text remains the same. Inspected complete before/after captures. |
| 20 | FIXED | Home, service-area and service sitemap dates are 2026-11-10. Terms sitemap date is 2026-08-11 to match the unchanged terms page. |

Verification:

- Required `npm ci` completed in this worktree with Node 22 and legacy peer
  resolution; no dependency junction, lockfile change or main-checkout modules.
- `npm run build` passes, including TypeScript, static generation and bundle
  budgets (home 535,990 / 648,316 bytes; board 631,042 / 817,538 bytes).
- Node 22 `npm test`: **1,558 passed, 0 failed, 3 skipped**, 57.2 seconds.
  Skips are the opt-in live extraction evaluation and two live database
  persistence checks without a configured database.
- Basename search found **99 test files**; all ran separately under the specified
  Node 22 test command: **940 passed, 0 failed**, 42.1 seconds.
- Edited TypeScript/TSX files pass ESLint with zero warnings.
  After the final phone-wrap correction, all 20 checks in test files naming
  `page-cohesion.css` passed again.
- Offline assistant audit: `assistant-audit-fable-r1-before.json` and
  `assistant-audit-fable-r1-after.json`; 143 rows each. A4 dry harness: 8/8 pass,
  with outbound senders intercepted. The before replay uses the branch's actual
  starting commit `c7827bcef7ca902500d1780c0d67cb072ba5d140`, its original bank,
  assistant guards and versioned knowledge-copy files. No production delivery
  is inferred.
  `scripts/qa/fable-r1-assistant-before.mjs` reproduces that pinned baseline
  offline into ignored `.tmp`, with no production mode.
- Before/after Playwright captures cover home, mobile welding and service areas
  at 390x844 and 1440x900, plus the open mobile menu. Added 320px/768px home,
  chat, 404, and intercepted quote error/success captures. All were inspected.
  Browser metrics are in `design-shots/fable-r1-{before,after}-metrics.json`.
  The original committed source was served from an ignored local snapshot for
  complete baseline captures; it resolves the worktree's npm-ci dependencies
  normally, without a junction. Full-page capture alone temporarily renders
  deferred sections; viewport checks and Lighthouse use normal production CSS.
- Browser quote fixtures block missing-field submissions, exercise the label's
  checkbox target, show a 429 error then success, and preserve the retry identity.
  Both POSTs were intercepted in Playwright; zero reached the server.
- Chat draft survives navigation and a full reload; zero chat messages sent.
- Browser reports no horizontal overflow, missing images or page errors on the
  three main captured routes; no launcher collisions at the requested desktop
  sizes. The remaining six service pages, privacy, terms and 404 also pass local
  status, overflow and browser-error checks at both requested widths.
- Independent source review found and resolved one multi-turn safety-context
  regression, then reported no further actionable findings. Unrelated sourced
  topics answer after a prior safety refusal; same-job safety boundaries remain.

Performance work preserves the visible page and production integrations:

- Consolidated the public stylesheet imports without changing their order.
- Removed only decorations already hidden by the existing CSS. Real proof,
  service copy, photographs and visible weld seams remain server-rendered.
- The six proof-wall images load as they approach the viewport; the two hero
  images preload existing optimized AVIF bytes copied from the local image
  cache. Provenance hashes document the unchanged original photographs.
- Quote-form code loads at the first idle opportunity or near the contact
  section; editable fields mount once, with the existing validation, intake
  identity and conversion behavior. Chat code loads on first open and stays
  mounted, with retry/focus recovery and draft persistence across reloads.
- Non-suspending React boundaries split below-hero hydration; differential SSR
  tests retain every element and attribute on home and all seven service pages.
  Service sections use the same near-viewport layout containment as home.
- Reverted experimental full CSS inlining, synchronous image decoding,
  Webpack output, and native navigation after they showed no reliable benefit.
  The normal Next build and navigation remain in place.

Final Lighthouse mobile results (default simulated throttling, fresh Chrome and
storage reset per run, sequential, local `next start`, warm server after browser
QA, public chat enabled and verified in server HTML):

| Page | Run 1 performance / LCP | Run 2 performance / LCP | Run 3 performance / LCP |
| --- | --- | --- | --- |
| Home | 90 / 3,356ms | 91 / 3,377ms | 91 / 3,377ms |
| Mobile welding | 92 / 3,273ms | 91 / 3,364ms | 91 / 3,338ms |

Accessibility, best practices and SEO are **100 in all six**; runtime errors are
absent. These final runs are a measured failure of defect 14, not a pass or a
release recommendation. The canonical JSON links every complete raw report.

Initial Lighthouse 12.8.2 results were home 80/87/86 with LCP
4.00/3.83/3.89s, and mobile welding 91/91/91 with LCP 3.31/3.31/3.32s.
Intermediate probes preserve their actual tool versions and settings. Some
intermediate local builds omitted the public-chat build flag; those probes are
diagnostic only. The final six explicitly verify chat is enabled. A failed
browser run exposed the missing flag; the site was rebuilt and the entire
browser verification rerun successfully before the final six audits.

The remaining bottleneck is initial stylesheet/native layout plus Next/React
startup and root reconciliation. The hero is eager, high priority and preloaded;
the six proof-wall image requests and full chat/form code are outside the initial
critical path. A diagnostic CPU profile finds framework module instantiation and
React root work dominate, with no comparable app-specific hot callback. Its
profiler startup overhead means it is used only to identify stacks, never as a
Lighthouse result. The mobile bar's forced geometry read was checked separately:
it causes a 5.2ms post-paint flush, not the large initial layout, so it was left
unchanged. No further verified fix for the remaining delay was established in
this round. Performance still needs work before the requested bar can pass.

Resource-blocked and alternate-throttling diagnostic probes are labeled and
never count toward acceptance. No throttling, scoring or visible content was
changed to obtain a passing number.

For a fresh local audit, install isolated tooling with
`npm install --prefix .tmp/lighthouse136 --no-save lighthouse@13.6.0`, then run
`node scripts/qa/fable-r1-lighthouse.mjs final all 13.6.0` against the local
production server with chat enabled. `docs/fable-r1-verification.json` records
the checked source hashes, matched test files and evidence paths.

## Codex round 2 (perf)

Defect 14 remains **UNRESOLVED / measured FAIL**. The production-build measurements
below include a detached build of main before any round-2 experiment. Main already
misses the target; the evidence does not establish IBM Plex or round 1 as the cause
of the overall failure. No behavior-preserving performance change showed a reliable
gain, so no experimental product change was retained. The approved appearance,
fonts, photographs, interactions and integrations remain unchanged.

The actual deliverable is reproducible audit tooling and the measured evidence for
the remaining cost. No push, deployment, merge, production form/chat submission,
live model request, provider send, or database migration was performed. Public chat
was enabled in every acceptance build; voice stayed off.

### Matching baseline and acceptance measurements

All matching batches use Lighthouse 13.6.0 mobile defaults with explicit
`--throttling-method=simulate`, fresh Chrome/profile and browser storage reset per
run, no request blocking, sequential runs, and a real production build served by
`next start`. Before each page's three runs, the page and all image-optimizer URLs
in its initial HTML are warmed with Chrome's image Accept header including AVIF,
and response bodies are consumed. The sources use Node 22, with
`NEXT_PUBLIC_ASSISTANT_CHAT=1` and `ASSISTANT_VOICE=0`; no credentials or `.env`
files were copied into the main worktree.

| Build / page | Run 1 performance / LCP | Run 2 performance / LCP | Run 3 performance / LCP | Median performance / LCP |
| --- | --- | --- | --- | --- |
| Main `c7827bc` / home | 90 / 3,511ms | 91 / 3,403ms | 98 / 2,135ms | 91 / 3,403ms |
| Main `c7827bc` / mobile welding | 95 / 2,871ms | 94 / 2,908ms | 95 / 2,876ms | 95 / 2,876ms |
| Round 1 `ca3d856`, fresh / home | 91 / 3,369ms | 92 / 3,326ms | 87 / 3,457ms | 91 / 3,369ms |
| Round 1 `ca3d856`, fresh / mobile welding | 91 / 3,333ms | 91 / 3,339ms | 92 / 3,326ms | 91 / 3,333ms |
| Round 2 final / home | 91 / 3,387ms | 91 / 3,352ms | 91 / 3,381ms | 91 / 3,381ms |
| Round 2 final / mobile welding | 91 / 3,341ms | 85 / 3,420ms | 84 / 3,470ms | 85 / 3,420ms |

The historical round-1 six (home 90/91/91, mobile welding 92/91/91) remain in
`docs/lighthouse-2026-11-10.json`; they were not overwritten or relabeled as fresh
measurements. That file links every matching raw report and records exact metrics,
CPU benchmark indices, observed LCP subparts, and final acceptance. The target is
performance >=98 and LCP <2,500ms on all three runs of each page.

The freshly measured round-1 median is 34ms faster than main on home and 457ms
slower on mobile welding. The service difference is reported rather than hidden;
the preload experiments below do not establish its cause. The overall performance
failure existed before round 1.

Laptop variation is visible even with simulated throttling: main home spans
90-98 and 2.14-3.51s; one isolated passing run is not a passing batch. Browser
benchmark indices and all runs are retained, with no selection of favorable runs.
The first main batch warmed optimizer URLs with the default `*/*` Accept header,
which can leave AVIF encoding cold. Those six are preserved separately as
`round2-main-cold-optimizer`, excluded from the matching comparison, and followed
by the corrected complete main batch above.

### Diagnosis and rejected experiments

`docs/perf/2026-11-10/round2-diagnostic-analysis.json` records the complete
investigation. Both LCP elements are the hero image: home
`div.ms-hero-media > figure.ms-hero-image > picture > img` and the service page
`section#service > figure.ms-subhero-media > picture > img`. They are already
eager, high priority, preloaded, responsive, and served as existing AVIF assets;
the image itself needs about 14-17ms observed transfer in the representative
round-1 reports. Native trace image decoding takes 15-23ms off the main thread.

Representative observed LCP subparts are TTFB / load delay / load time / render
delay = **18.8 / 69.9 / 16.6 / 192.2ms** on home and
**8.4 / 89.2 / 14.4 / 185.4ms** on mobile welding. These are measured localhost
trace durations, not simulated mobile subparts. The separate simulated model
allocates approximately 463 / 551 / 178 / 2,177ms on home and
457 / 645 / 152 / 2,079ms on the service page; the render remainder is arithmetic
from rounded model timings, not a directly measured callback.

The initial two stylesheet responses transfer 35,631 bytes and decode to
163,648 bytes. The public CSS accounts for 149,504 decoded bytes; font CSS and
chat styles account for the rest. Coverage estimates about 17.6KB/19.4KB of
compressed transfer savings from unused CSS for the two routes. The initial
layout/style portion is only about
63ms/71ms in the native trace. The tested CSS reduction below improves FCP without
fixing the later LCP presentation.

Four Latin WOFF2 faces actually download, totaling 74,360 font-resource bytes:
Barlow Condensed 900, one variable IBM Plex Sans face for body weights, and IBM
Plex Mono 500/600. Display and body preload, Mono loads when used, and the active
faces use swap. The marker face is optional and does not download in these audits.
Extra language declarations in the 7,444-byte generated font stylesheet do not
cause extra language font downloads; removing them would save only a fraction of
1KB compressed. Removing only the Sans preload, while retaining the display
preload, repeats at median
3,338ms/3,331ms versus 3,369ms/3,333ms for the fresh real-server baseline, without
a reliable gain; the original fonts and preload behavior were retained.

Audited script transfer is about 181KB/198KB, including modules loaded after LCP.
Lighthouse identifies roughly
27KB of unused code in the 71KB compressed framework chunk, not a standalone
unused app feature. Next/React startup dominates script work; no large avoidable
app callback was found before LCP. The full quote
form import occurs after observed LCP, and the full chat module loads on first
open. Source inspection confirms `PublicAnalytics` runs only the small inline
queue/configuration bootstrap at `afterInteractive`; external Google loading
waits for pointer, keyboard, touch or scroll interaction, or an eight-second
fallback. Meta waits for that same insertion via its observer. Production-host
gating suppresses those provider requests on localhost, so these local audits
cannot measure live-provider transfer cost. The early conversion queue, DNI and
listeners remain intact. No analytics change was retained because the expensive
requests are already deferred, while moving configuration later can race early
conversions.

The external-script-blocked probe measures simulated LCP of 2.34s on home and
2.26s on mobile welding, with TBT zero, versus 3.36s/3.35s in the unmodified
response-proxy control. Blocking `*.js` requests is applied to the actual local
server origin; inline scripts still execute. The roughly 1.02s/1.10s difference
estimates the aggregate startup-script/network effect in this diagnostic comparison;
it is not an exact removable cost. The probe removes behavior and is diagnostic
evidence only. It is not a shippable fix or an acceptance result. Measured trace
subparts are reported separately from simulated scored LCP: adding TTFB, resource
delay, transfer time and render delay does not reproduce Lighthouse's simulated
metric.

Critical CSS inlining reduces FCP to about 947ms/925ms, but worsens LCP to
3,836ms/3,468ms and performance to 84/90. The repeated Sans-preload-removal and
critical-CSS variants do not establish a reliable gain. These probes, including
the delayed-critical variant, are preserved with their actual settings, excluded
from acceptance, and rejected without product source changes.

The final retained build measures **3,352-3,387ms / performance 91** on home
and **3,341-3,470ms / performance 84-91** on mobile welding. Its median LCPs are
3,381ms and 3,420ms: reaching strictly below 2,500ms still needs more than
881ms/920ms reduction at those medians. This is the measured current-build
range/median, not a universal floor or proof that a future architecture cannot
meet the target. Lighthouse's estimated 150ms LCP saving for unused framework JS
would be insufficient alone even if it were safely recoverable.

The final service batch's TBT rises from 106.5ms to 297.0ms/336.0ms while its CPU
benchmark index falls into 823.5-1,063.5, so runtime/load drift is visible. The
unchanged product source rules out a retained round-2 implementation regression;
it does not prove every LCP difference is CPU alone. Even the first service run,
with 106.5ms TBT, still has 3,341ms LCP and fails. No favorable rerun replaces the
recorded batch.

The same final production build was also run three times per page with
`--throttling-method=devtools`. These apply throttling in Chrome rather than using
the default simulation and are **alternate diagnostics only**; they do not replace
or improve the acceptance batch above.

| Devtools diagnostic / page | Run 1 performance / LCP | Run 2 performance / LCP | Run 3 performance / LCP | Median performance / LCP |
| --- | --- | --- | --- | --- |
| Home | 83 / 2,396ms | 83 / 2,519ms | 85 / 2,468ms | 83 / 2,468ms |
| Mobile welding | 82 / 2,503ms | 83 / 2,575ms | 85 / 2,394ms | 83 / 2,503ms |

Devtools TBT is 375-473ms on home and 417-470ms on mobile welding. All twelve
final runs across both throttling methods have no runtime error; neither batch
meets the combined performance/LCP target. Complete reports and exact settings
are under `round2-final` and `round2-final-devtools`.

### Verification and cleanup

- Node 22.23.2 `npm test`: **1,558 passed, 0 failed, 3 skipped** in
  54.7 seconds (1,561 total). Skips remain the opt-in live AI extraction evaluation
  and two live database persistence checks without `DATABASE_URL`.
- The final Node 22 `npm run build` passes TypeScript, static generation and
  bundle budgets: home 535,990 / 648,316 bytes; board 631,042 / 817,538 bytes.
  The public pages remain static. The rebuilt output was served by real
  `next start` for all twelve final Lighthouse runs and all final screenshots.
- Both new QA scripts pass ESLint with `--max-warnings=0` and zero warnings.
- The four requested full-page captures and four fold captures are in
  `docs/design-shots/` as `fable-r2-after-{home,mobile-welding}-{390x844,1440x900}*.png`.
  The root agent opened and inspected all eight: typography, palette, photographs,
  forms, footer and layout match approved round 1. All four cases have no
  horizontal overflow, missing images, browser/console errors or API submissions.
- `design-shots/fable-r2-visual-comparison.json` records exact matches to the
  committed round-1 font families, 12px labels, `#100c08`, section edges, checkbox,
  consent targets, inline links, submit/form widths and select appearance.
  Seven of eight PNGs are pixel-identical. The mobile-home full-page image has
  one 390-pixel raster row difference at y=906, identical 14,358px height, and
  mean absolute channel difference 0.000197/255; its fold is pixel-identical.
  No layout or content difference was observed.
- Full-page capture first scrolls the real deferred content and decodes images,
  then makes those sections visible only for screenshot rasterization. Lighthouse
  uses normal production CSS. Form/chat submissions and remote requests are
  blocked only in visual QA, never in acceptance Lighthouse.
- The owned final `next start` process (PID 6336) was stopped, and all owned
  headless Chrome processes were closed. User applications were left alone.

The new `scripts/qa/fable-r2-lighthouse.mjs` requires loopback HTTP and public
chat in initial HTML, preserves method/configuration/provenance and every raw
report, and exits 1 if any run misses either target. It keeps alternate throttling
diagnostic-only. With the isolated Lighthouse 13.6.0 tooling installed as above
and the production server running, reproduce the default audit with:

```powershell
& "C:/Users/Owner/AppData/Local/hermes/node/node.exe" scripts/qa/fable-r2-lighthouse.mjs --label=round2-recheck --origin=http://localhost:3100 --runs=3 --throttling-method=simulate
```

The new `scripts/qa/fable-r2-visual.mjs` captures the requested two routes and
viewports, waits for the real deferred form, and intercepts form/chat submissions.

The detached main baseline used isolated `npm ci` dependencies in
`C:/Users/Owner/Desktop/Shepherd/mcsw-fable-r2-main`, with no dependency junction
and no changes to main. Its recorded `next start :3101` process was verified and
stopped. `git -c core.longpaths=true worktree remove --force` succeeded; the path
is absent and the worktree is unregistered. Main remains `c7827bc`.
