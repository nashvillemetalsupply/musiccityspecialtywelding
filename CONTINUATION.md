# Music City Specialty Welding — continuation handoff

Checkpoint date: August 2, 2026

This repository is being committed, pushed, and deployed as a stable work-in-progress checkpoint. The redesign is intentionally **not marked final**. Resume from this file next session rather than restarting the project.

## Locked direction

- Character: unmistakably Middle Tennessee, blue-collar, loud, capable, and specific to a real welding shop.
- Core message: “We get it” — from the way the work is presented to the work itself.
- Primary conversion: call first, short quote form second.
- Availability: 24/7.
- Palette: near-black, warm workwear neutrals, and restrained Tennessee orange (`#FF8200`).
- Imagery: real owner-supplied work only. Preserve documentary realism; do not replace it with generated welding imagery.
- Logo: retain the established logo because it is already used in proven Google Ads. Only presentation-level refinements are allowed.
- Motion: no moving marquee/banner. Motion must support hierarchy and never compete with readability.

## Completed in this checkpoint

- Rebuilt the homepage around a rugged editorial direction and real shop/mobile-welding proof.
- Reworked the service pages and service-area page into the same visual system.
- Replaced the generated mobile-welding visual with real owner-supplied photography.
- Expanded the work proof with distinct real projects instead of repeating similar trailer-hinge images.
- Added responsive mobile actions with scroll-aware behavior so sticky controls do not stack over the hero CTA.
- Corrected headline sizing, wrapping, clipping, contrast, touch targets, and horizontal overflow at 320, 390, 768, and 1440 pixels during local QA.
- Removed moving banners and much of the generic AI-landing-page vocabulary: arbitrary numbering, decorative rules, eyebrow labels, repeated card rhythms, and unexplained accents.
- Preserved the verified Google Ads service language and conversion paths already represented in the project.

## Required next-session work

1. Do a final section-by-section visual inspection of every route after this checkpoint deploy: homepage, all service pages, service areas, privacy, and terms. Check real devices as well as 320 / 390 / 768 / 1440 emulation.
2. Run production Lighthouse and accessibility checks on the canonical deployment. Fix any remaining LCP, CLS, INP, contrast, keyboard, semantic-heading, or reduced-motion failure.
3. Verify production lead delivery and tracking end-to-end with the deployed environment. Local health checks did not have email, Google Analytics, or Google review configuration available; confirm the Vercel environment before treating the form and attribution as launch-final.
4. Compare the production result visually—not only structurally—against the strongest local welding/fabrication competitors and current Awwwards/CSS Design Awards service-business work. Record concrete gaps and make only changes that add character, clarity, proof, or conversion value.
5. Perform the final anti-slop pass. Every line, accent, label, animation, card, and section must earn its place. Remove anything that reads like a reusable AI landing-page pattern.
6. Update and validate the installed MAINSTREET skill at `C:\Users\Owner\.agents\skills\mainstreet\` with the lessons from this build: exact-width overflow testing, sticky-CTA collision testing, real-photo archive review, anti-slop deletion rules, and a mandatory final production verification gate. This update is still outstanding.
7. Remove any remaining QA-only artifacts, confirm a clean Git status, then make the true locked release commit.

## Verification commands

```powershell
npm install
npm run lint
npm run build
npm run dev
```

Production readiness is not complete until the deployed form, tracking, responsive layouts, and final MAINSTREET skill update all pass.
