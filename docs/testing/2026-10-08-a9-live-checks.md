# A9 live checks against production (main 356ca96, dpl_G1SjP9swYmprJ2M2BcD3qYbt68Bk)

Read-only HTTP GETs against https://musiccityspecialtywelding.com on 2026-10-08. No form posts, no writes.

## Verdicts

- **S11 fingerprint: PASS (with a stated limit).** See below.
- **S12 structured data: FAIL on one item** — `/favicon.ico` returns 404. Fixed in this commit (`app/favicon.ico`, test added). Needs a deploy to show live.

## S11 fingerprint

`scripts/qa/fingerprint-diff.mjs` takes two Playwright-produced JSON files of computed styles of `.ops-*` classes on signed-in `/ops` routes. It takes no URL and needs an owner session plus a pre-S11 build, so it cannot run read-only against production. **The computed-style fingerprint diff was not run.**

What the repo's other baseline defines is `scripts/qa/baseline/pre-s11-public-css.css` (pre-S11 `app/globals.css`). I compared it with the CSS shipped live (the 3 stylesheets linked from the home page, 116,884 bytes), by `.ops-/.ms-/.glass-` class set and by per-selector declarations (colors/zeros/time units normalised, because the production minifier rewrites them).

Class-set diff (baseline 134 classes, live 126):

| Difference | Classification |
|---|---|
| Absent live: `ms-accent-line ms-flash ms-hero-kicker ms-hero-outline ms-hero-title ms-kerf ms-rule ms-slab ms-stripe` (19 selectors) | Expected: exactly the list retired by 6b46fcb (S11 dead-CSS retirement) |
| New live: `ms-home` | Expected: from `app/homepage-polish.css`, which is unchanged since before S11 and was never part of the globals baseline |
| `.ms-mobile-cta a:first-child / :last-child` gain `var(--sw-neon, #ffb46b)` etc. fallbacks | Expected: 693a0cb (P01, mobile call bar) |
| `.ms-area-cities > div strong` becomes `> div > a` (+ `:nth-child(2n)`, responsive rule) | Expected: d990d2c (P02, clickable city tiles) |
| Declarations present in baseline but absent live: `.ms-work-statement-accent` color, `.ms-contact-call:hover` background, `.ms-faq-list summary:hover` color, `.ms-territory-map strong span:last-child` color | Expected, not regressions: source `app/globals.css` still has both the old and a later overriding rule; the minifier drops the overridden declaration. Live values are the later rule's (e.g. `--sw-fire`, `--sw-red`) |
| `content-visibility:auto` and Fraunces/display `font-family` on some sections | Expected: from `app/homepage-polish.css`, pre-S11 |
| Remaining ~60 selector "changes" | Minifier noise only (`:before` vs `::before`, `[href^=tel\:]` quoting, `0.5`→`.5`, `rgba`→hex, shorthand merge); no value differences after normalisation |

Source cross-check: `git diff 6b46fcb^ HEAD -- app/globals.css` is 5 insertions, 81 deletions, all accounted for by the three commits above. No regression found. The visual claim ("renders identically at 320/375/768/1440") is still not proven by a screenshot/computed-style run.

## S12 structured data and site checks

Pages: the home page plus every URL in `/sitemap.xml` (10 URLs: `/`, `/service-areas`, `/privacy`, `/terms`, 6 service pages — 9 distinct besides home). **There are no city pages**: the sitemap lists none, and `/service-areas/[city]` is plan row P7, blocked on owner content. City names on `/service-areas` are not separate pages.

| Page | HTTP | h1 | ld+json types | Result |
|---|---|---|---|---|
| / | 200 | 1 | LocalBusiness/ProfessionalService, FAQPage | pass |
| /service-areas | 200 | 1 | LocalBusiness/ProfessionalService | pass |
| /privacy | 200 | 1 | LocalBusiness/ProfessionalService | pass |
| /terms | 200 | 1 | LocalBusiness/ProfessionalService | pass |
| /services/mobile-welding | 200 | 1 | LocalBusiness, Service, BreadcrumbList, FAQPage | pass |
| /services/trailer-welding-repair | 200 | 1 | LocalBusiness, Service, BreadcrumbList, FAQPage | pass |
| /services/equipment-repair | 200 | 1 | LocalBusiness, Service, BreadcrumbList, FAQPage | pass |
| /services/architectural-welding | 200 | 1 | LocalBusiness, Service, BreadcrumbList, FAQPage | pass |
| /services/custom-fabrication | 200 | 1 | LocalBusiness, Service, BreadcrumbList, FAQPage | pass |
| /services/custom-metal-products | 200 | 1 | LocalBusiness, Service, BreadcrumbList, FAQPage | pass |

On all ten: every ld+json block parses; LocalBusiness has name, address, telephone, geo (lat/long), priceRange, url; every FAQPage entry has name and acceptedAnswer.text; every BreadcrumbList has positions 1..n with absolute item URLs on https://musiccityspecialtywelding.com.

Site checks:

| Check | Result |
|---|---|
| Unknown path `/this-path-does-not-exist-a9` | 404 pass |
| `/404` | 404 pass |
| `/robots.txt` | 200, contains `Sitemap: https://musiccityspecialtywelding.com/sitemap.xml` pass |
| `/favicon.ico` | **404 FAIL** (`/icon.svg` is 200 and is the `<link rel=icon>`, but crawlers that ask for `/favicon.ico` get 404) |

### Failure and fix

- URL `https://musiccityspecialtywelding.com/favicon.ico`, expected 200, got 404. Cause: S12 shipped only `app/icon.svg`. Fix: added `app/favicon.ico` (32x32 PNG from `public/icon-dark-32x32.png` in an ICO container) and a test in `scripts/s12-public-site.test.mjs` that fails when the file is absent. Not live until deployed; the owner or a landing train must deploy.

## Not run

`node_modules` is absent in this worktree, so lint, typecheck and `npm test` were not run, including the new test. The new test only reads the file header and was not executed; the ICO was built by a script and the header bytes were written per the ICO spec (1 image, 32x32, PNG payload at offset 22).
