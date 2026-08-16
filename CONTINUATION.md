# Music City Specialty Welding - release record

Release date: August 2, 2026 · CRM platform release: August 3, 2026

Status: live at `https://musiccityspecialtywelding.com`, committed to `main`, and deployed through Vercel. GitHub → Vercel auto-deploy is now connected (pushes to `main` deploy production). Resume from this record instead of restarting the project.

Follow-up — August 15, 2026: the owner approved production customer SMS, recorded/transcribed calls, and publication of `(615) 703-3296` plus Call Sketch. The public site and Shop Brain launch gate are green; Google Ads remains unchanged pending separate post-launch verification. The final human acceptance action is recorded in [`docs/mcsw-final-call-acceptance-2026-08-16.md`](docs/mcsw-final-call-acceptance-2026-08-16.md). Current provider and activation truth lives in `SHOP-BRAIN-SETUP.md` and `docs/call-sketch-production.md`.

## August 3, 2026 — custom CRM platform (Lead Operations)

- Neon Postgres provisioned via Vercel Marketplace (one database across environments); private Vercel Blob store `mcsw-lead-photos` for job photos.
- Quote intake is persistence-first: lead row (with gclid/UTM/landing/referrer attribution) and photos are stored before the Resend email is attempted; leads survive provider outages.
- Owner dashboard at `/ops`: magic-link sign-in to the shop mailbox, pipeline stages with auto-timestamps, first-response/speed-to-lead tracking, interaction log, follow-up reminders (hourly sweep), estimate/revenue capture, manual phone-in/walk-in entry, instant search, pagination, CSV export, and Google Ads offline-conversion export (`?format=google-oci`).
- Automation: daily digest (Vercel cron 12:00 UTC) and hourly reminder sweep + 5-minute health monitor (GitHub Actions, CRON_SECRET repo secret). `/api/health` now proves database, delivery failures, ops auth, scheduler secret, and automation heartbeat.
- Evidence bundle: `output/last-step/2026-08-03-last-step-evidence.{md,json}` — decision READY FOR TRAFFIC with one monitoring warning (first scheduled GitHub cron run pending) and the owner-gated exclusions (GBP verification/review URL, DMARC hardening, SMS number decision).
- The public site design is locked pending the owner's new reference designs; only the footer call row and sticky-bar visibility were refined.

## Locked direction

- Character: unmistakably Middle Tennessee, blue-collar, loud, capable, and specific to a real welding shop.
- Core message: "We get it" from the presentation through the work itself.
- Primary conversion: call first, short quote form second.
- Availability: 24/7.
- Palette: near-black, workwear neutrals, and restrained Tennessee orange (`#FF8200`) with accessible ink variants on light surfaces.
- Imagery: real owner-supplied work only. Preserve documentary realism and never replace proof with generated welding imagery.
- Logo: retain the established Google Ads logo. Only presentation-level refinements are allowed.
- Motion: no moving marquee. Motion must support hierarchy and must never hide, dim, or delay essential content.

## Verified release

- Rebuilt the homepage, service pages, and service-area page into one rugged editorial system.
- Replaced generated welding imagery with real owner-supplied shop and road-work photography.
- Removed arbitrary numbering, decorative rules, repeated eyebrows, moving banners, and generic AI landing-page patterns.
- Verified every production route at 320, 390, 768, and 1440 pixels. No page-level horizontal overflow remains, including the long Architectural Welding heading.
- Verified below-fold content stays fully readable before and during motion.
- Verified the mobile sticky call/quote bar is hidden over the hero, appears after scrolling, and does not stack over the hero actions.
- Repaired production quote delivery: rotated the invalid Resend key, corrected sender and recipient addresses, and confirmed the labeled test email was delivered to `sales@musiccityspecialtywelding.com`.
- Hardened `/api/health` so it validates the live Resend credential instead of treating environment-variable presence as proof.
- Production health passes for lead delivery, Google Ads conversion configuration, and Google Analytics configuration.
- Final mobile Lighthouse samples: median performance about 91, accessibility 100, best practices 100, SEO 100, CLS 0. Simulated LCP varied from 2.7 to 3.2 seconds and TBT from 80 to 250 milliseconds across runs.
- Lint, TypeScript, static generation, and the Vercel production build pass.
- MAINSTREET now requires 320 / 390 / 768 / 1440 proof, visible first-frame content, real credential validation, labeled owner-authorized delivery testing, and honest reporting of synthetic performance variance. The skill validates successfully.

## Remaining owner decisions

- The Google review URL is not configured. Add only the verified Google Business Profile review link when the owner supplies or confirms it.
- Monitor real-user Core Web Vitals after traffic accumulates. Do not trade hero proof quality or conversion tracking for one synthetic Lighthouse outlier.
- Award recognition is subjective and cannot be guaranteed. Judge future changes by character, clarity, proof, conversion, accessibility, and measured performance.

## Rollback

Every redesign and final-pass checkpoint is preserved in Git history. Use the parent of the desired release commit to restore an earlier version; do not overwrite the repository with an untracked copy.
