# Vercel bandwidth prevention — 2026-11-13

Branch: `mcsw-bandwidth-1113`. Do not merge to production while the shared team is blocked.

`next.config.ts` now sets a one-day browser cache for `/images/` and `/brand/`, followed by mandatory revalidation. These directories use mutable filenames, so a year of immutable caching would conceal replacements. The rule does not apply to private customer photos, call recordings, API responses, service workers, or HTML.

Image delivery already uses AVIF/WebP negotiation, responsive device widths, and qualities 60/75. `CriticalImage` uses approved static AVIF variants with Next Image fallbacks. `DeferredWorkImage` waits for intersection before mounting quality-60 gallery images; no-script photos load lazily. No global `unoptimized` mode is set. No additional image conversion was needed.

`scripts/next.config-bandwidth.test.mjs` executes the actual header configuration, verifies its public-only cache scope and image negotiation, and scans public assets to reject video/audio and files above 2 MB. Authenticated media is outside that public asset budget and retains private caching.

The incident evidence attributes only 2.70 GB to MCSW during its audit window, versus 150.93 GB to the separate wr-media project. Browser caching reduces repeat downloads but cannot eliminate CDN transfer to new visitors. Production header readback remains blocked by the team's 402 response; validate it after the owner upgrade and branch merge.

Validation: Node 24.21.0 `--experimental-strip-types --test --test-isolation=none scripts/next.config-bandwidth.test.mjs scripts/csp-policy.test.mjs` passed 8/8. Changed-file ESLint (`next.config.ts`, `scripts/next.config-bandwidth.test.mjs`) and `git diff --check` passed. Test isolation is disabled only because the sandbox rejects spawning test worker processes (`EPERM`); the tests still execute the real config.
