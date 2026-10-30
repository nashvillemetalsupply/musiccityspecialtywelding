# Synthetic browser preview acceptance — October 30, 2026

This is automated browser evidence, **not physical Android or iPhone acceptance**.
The user has Android, has no iPhone/Safari, and declined a manual phone checklist.
No manual device result is required from the user to continue this audit; the
unavailable native checks remain explicitly unverified.

A temporary credential-free production fixture copy used the existing archived
CRM fixtures and actual application components. Its original source baseline was
`d320f71`. The final copy rebuild included the Photo prerequisite correction in
`DoneStamp` and reviewed-closeout layout/label corrections in `job.css`; it did not include the concurrent voice/photo storage-recovery
changes. Those changes have separate tests and require final-build coverage.
No fixture guard exception or active QA route was added to the application being
released. The temporary synthetic HTTPS tunnel was separate from Vercel hosting
and production deployment. The public tunnel and owned local fixture/gateway
were stopped after automated testing. Their listener ports were confirmed
closed. Ignored copy files remain locally; no dependency-junction deletion was
attempted.

## Gateway and initial smoke

- Three HTTP security tests passed: private entry/cookie and credential stripping;
  rejection of mutations, APIs, live routes, debug/HMR, maps, unexpected queries
  and traversal; and session expiration.
- All four primary screens hydrated through the gateway. Menu interaction, form
  input, checklist persistence across navigation, and copy-to-clipboard passed.
- A public HTTPS smoke passed all four primary screens, rejected unauthenticated
  access with 403, set a Secure session cookie, and recorded no browser errors.
- Only synthetic fixture/static GET/HEAD traffic was exposed. No database or
  provider credentials were present; saving, uploads, microphones, provider
  delivery and live navigation were intentionally unavailable. Expected 403s
  for blocked live-route prefetch requests are protection evidence, not product
  failures.

## Automated checklist

The [initial results](../visual-polish/2026-10-29/android-preview/results.json)
record 57 passes, six failures and two explicitly untested groups, with zero
browser JavaScript errors. This preserves the failing evidence rather than
rewriting it as a successful original run.

| Item | Initial result | Scope |
| --- | --- | --- |
| 17 exposed screens/states | 51 passed | Each at 390×844 portrait, 844×390 landscape, and portrait with doubled root/product typography tokens; hydrated and no horizontal page overflow. |
| More menu | Three passed | All 17 focusable controls reached; focused controls remained in view, Tab stayed inside the modal, Escape closed it and restored opener focus. Destinations deliberately blocked. |
| Form focus/draft | Passed | Name, phone and needs fields accepted focus/input; text survived orientation change. This does not simulate an Android keyboard. |
| Job Price/Photo and bottom rail | Two passed, six failed initially | Completed jobs passed. Normal/error/pending owner review-mode jobs had no Photo fragment before closeout review, at both orientations. |
| Native device/assistive technology | Untested | Physical touch, Android keyboard, OS text scaling, TalkBack, iPhone and Safari. |
| Live/provider workflows in this fixture | Untested by design | Actual auth/form persistence has separate [real Next HTTP evidence](../next-http-acceptance-2026-10-30.md); Blob acceptance is separately [blocked](2026-10-30-blob-provider-acceptance.md). |

The enlarged-text cases double root size and product type tokens. Fixed-pixel
text is unaffected. This is neither OS scaling nor actual browser zoom; the
earlier four actual Chromium 200% zoom checks remain the zoom evidence.

The Photo failure was a real restricted product state: owner internal-test jobs
with reviewed closeout enabled intentionally hide completion photo upload until
completed work is reviewed, while the action rail still linked to that absent
field. The correction provides a focusable explanation and a full-size action
to the closeout text while review is absent/partial. Completed review restores
the existing photo input; partial work never gains a completion upload.

Three new behavior tests passed for prerequisite-to-complete transition, partial
review, and unchanged ordinary closeout. Together with scoped fragment and
storage-recovery tests, the independent reviewer recorded 19 passing tests.
Focused ESLint passed with zero warnings.

## Final compiled-copy results

The [Photo interaction retest](../visual-polish/2026-10-29/android-preview/photo-retest.json)
passed eight of eight cases with zero browser errors. It covers all four job
states in both orientations, including the six original failures. Repeated
Photo activation focuses the intended target; the prerequisite action is at
least 44px tall and focuses the closeout textarea. Complete review shows the
real file input, partial review restores prerequisite content without a
completion upload, and switching back to complete restores the file input.
The target remains above the action rail. An earlier retest used an
over-specific label selector; correcting that harness selector established the
transitions without another product change.

Manual screenshot review then found an expanded-form problem that the fragment
checks did not detect: inherited legacy two-column grids compressed the review
controls into a narrow track. Resetting the reviewed bench/form columns and
using responsive review-field tracks corrected it. A fixed-pixel track minimum
still clipped the longest select option at doubled text size, so the final
minimum scales with the product text size. A separate legacy dark photo-label
color was replaced with the current job-page text color.

The [final expanded-layout sweep](../visual-polish/2026-10-29/android-preview/review-layout.json)
passed **16 of 16 cases on the compiled copy, with no style overlay**:
complete/partial review at 320, 390, 768, 844, 1024 and 1440px, plus doubled
root/product text at 390 and 844px. It checks the source textarea, full sheet,
all six review controls, longest select-option text, minimum control height and
font size, and horizontal overflow. At 390px, the source is 324px wide and review
controls are 298px. At 844px, normal short fields form two 366px columns;
doubled text produces one 744px column. Viewport and section screenshots were
visually inspected, including normal landscape and enlarged phone text.
The earlier failing matrix and intermediate overlay evidence remain archived
and are not substituted for this compiled-build result.

Three focused axe color-contrast scans of expanded closeout detected zero
violations. Their incomplete legend/label/decorative-arrow findings received
[12 additional per-node checks](../visual-polish/2026-10-29/android-preview/contrast-review.json):
each node was scrolled into view and tested with focused axe plus computed
foreground/background alpha composition. All 12 exceeded 4.5:1; the lowest
computed ratio was 5.57:1. The photo label is visibly readable with foreground
`rgb(207, 198, 181)`. This scoped contrast review does not establish native
screen-reader acceptance.

The original checklist now has 63 accepted automated cases: 57 original passes
plus six corrected Photo failures. The eight-case Photo retest also repeats
the two previously passing completed-job cases. The 16 expanded-layout cases
and 12 contrast checks are recorded separately. The native/provider groups
remain untested by this fixture. The [source hashes](../visual-polish/2026-10-29/android-preview/source-hashes.json)
confirm that the compiled copy's `DoneStamp` and `job.css` match the final task
source while documenting the three storage-recovery files it does not cover.

Private entry tokens, external origins, process identifiers, customer records,
credentials and native-device claims are intentionally excluded from this report.
