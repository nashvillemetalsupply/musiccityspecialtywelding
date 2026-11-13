# Vercel bandwidth prevention — 2026-11-13

Branch: `mcsw-bandwidth-1113`. Do not merge to production while the shared team is blocked.

`next.config.ts` now sets a one-day browser cache for `/images/` and `/brand/`, followed by mandatory revalidation. These directories use mutable filenames, so a year of immutable caching would conceal replacements. The rule does not apply to private customer photos, call recordings, API responses, service workers, or HTML.

Image delivery already uses AVIF/WebP negotiation, responsive device widths, and qualities 60/75. `CriticalImage` uses approved static AVIF variants with Next Image fallbacks. `DeferredWorkImage` waits for intersection before mounting quality-60 gallery images; no-script photos load lazily. No global `unoptimized` mode is set. No additional image conversion was needed.

`scripts/next.config-bandwidth.test.mjs` executes the actual header configuration, verifies its public-only cache scope and image negotiation, and scans public assets to reject video/audio and files above 2 MB. Authenticated media is outside that public asset budget and retains private caching.

`package.json` now runs the shared `scripts/public-asset-budget.mjs` guard through npm's `prebuild` lifecycle, so the existing `npm run build` deployment route fails before Next builds when large media is introduced. The guard is plain JavaScript and does not import TypeScript or require Node 24. `scripts/public-asset-budget.test.mjs` verifies the package route and rejection cases; the config test uses the same guard rather than a second implementation.

The incident evidence attributes only 2.70 GB to MCSW during its audit window, versus 150.93 GB to the separate wr-media project. Browser caching reduces repeat downloads but cannot eliminate CDN transfer to new visitors. Production header readback remains blocked by the team's 402 response; validate it after the owner upgrade and branch merge.

Validation: Node 24.21.0 `--experimental-strip-types --test --test-isolation=none scripts/next.config-bandwidth.test.mjs scripts/csp-policy.test.mjs` passed 8/8. Changed-file ESLint (`next.config.ts`, `scripts/next.config-bandwidth.test.mjs`) and `git diff --check` passed. Test isolation is disabled only because the sandbox rejects spawning test worker processes (`EPERM`); the tests still execute the real config.

Build integration validation: `npm run prebuild` passed against all 48 public files using the installed Node 20.17.0. `node scripts/public-asset-budget.test.mjs` passed 2/2 on that runtime. The combined config, CSP, and budget suite passed 10/10 on the CI-pinned Node 24.21.0, with changed-file ESLint and diff checks passing. Existing CI runs `npm test`, which includes the new budget test. No production build or deployment was initiated.
