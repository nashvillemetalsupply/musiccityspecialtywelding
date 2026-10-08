# MCSW production reads (A9), 2026-10-08

Read-only GETs against live https://musiccityspecialtywelding.com (production dpl_7ccFxCnycJPLP6LM7TRHGsCZtYYr, main 871fc16). Closes the S11 and S12 reads that the preview deploy (EACCES) blocked.

## 1. Lighthouse (S11), median of 3 runs
Lighthouse 12.8.2, Playwright chromium-1243 via CHROME_PATH, headless, desktop uses `--preset=desktop`. Service page = /services/mobile-welding.

| Run | Perf | A11y | Best-practices | SEO | LCP | CLS | TBT |
|---|---|---|---|---|---|---|---|
| mobile home | 94 | 100 | 100 | 100 | 3,033 ms | 0 | 69 ms |
| mobile service | 96 | 100 | 100 | 100 | 2,507 ms | 0 | 85 ms |
| desktop home | 99 | 100 | 100 | 100 | 643 ms | 0 | 0 ms |
| desktop service | 100 | 100 | 100 | 100 | 530 ms | 0 | 0 ms |

S11 baseline (scripts/qa/baseline/lighthouse-2026-09-27-before.json, mobile home): perf 55, a11y 100, best-practices 79, SEO 100, LCP 5.1 s, CLS 0, TBT 1,360 ms.
Mobile home change: perf 55 to 94, best-practices 79 to 100, LCP 5.1 s to 3.0 s, TBT 1,360 ms to 69 ms. The baseline has no service-page or desktop row, so those have no comparison. Caveat: baseline and this run used different machines and Chrome builds; lab numbers, not field data.

## 2. Fingerprint diff (S11)
Not run. `scripts/qa/fingerprint-diff.mjs <before.json> <after.json>` compares per-route computed-style fingerprints of `.ops-*` classes, produced by the Playwright run (`scripts/qa/run.mjs` and `report.mjs`) on signed-in /ops routes. It does not accept a URL. Production needs an authenticated owner session (auth.setup.mjs) plus a before fingerprint from a pre-S11 build; none was available read-only. The other proof, byte-equality of `app/globals.css` with `baseline/pre-s11-public-css.css`, is a source check (`retire-ops-css.mjs`), not a production one. Still open.

## 3. Rich results (S12), live JSON-LD
All blocks parsed with JSON.parse.

| Page | Blocks | Result |
|---|---|---|
| / | 2, all parse | LocalBusiness+ProfessionalService: name, url, telephone, address, geo (36.21646, -86.3035), areaServed, image present. FAQPage: 7 questions, each Question with acceptedAnswer Answer text. No BreadcrumbList (none expected on home). |
| /services/mobile-welding | 4, all parse | LocalBusiness+ProfessionalService same as home. Service block present. BreadcrumbList: 3 items, positions 1-3, all absolute https URLs (Home /, Services /#services, Mobile Welding /services/mobile-welding). FAQPage: 3 valid questions. |

Finding: `priceRange` is the string "Pricing is not listed" on both pages. Present, but free text rather than the usual "$$" style value; Google's Rich Results Test may not like it. Not changed here.
Not run: Google's hosted Rich Results Test (not a plain GET); checks above are structural against schema.org fields.

## 4. Still open
- AI evals (needs a model key; not run).
- Neon (not touched).
- Fingerprint diff against production (section 2).
- S22 not marked.
