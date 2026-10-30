# Independent provider recovery review — October 30, 2026

Bounded approval of the reviewed recovery changes. No remaining blocker was
found in the final three-file product diff. This review does not establish that
the suspended Blob provider works, and it is not deployment approval.

## Reviewed changes

- `app/api/ops/transcribe/route.ts`: authenticated, operator-filtered polling
  distinguishes a persisted intent from uploaded audio. The response exposes an
  `uploadRequired` boolean, omits the private Blob path, and uses `private,
  no-store` for this recovery state. It avoids invoking transcription when no
  stored audio exists.
- `app/ops/voice-capture-button.tsx`: the existing scoped, job-bound saved
  recording can retry that intent when storage previously rejected its bytes.
  Scope and job checks remain in the upload/application paths. An HTTP upload
  failure is retried once per recovery cycle; continuing failure retains the
  device recording. Completed recovery does not upload or transcribe again.
  Intent-only state no longer counts as remotely stored audio when constructing
  the final recovery message.
- `app/ops/leads/[id]/closeout-photo-input.tsx`: failed upload retains the same
  File in the mounted page and offers Retry photo. The retry is bound to the
  original job and completion/addendum mode. A synchronous in-flight guard
  prevents overlapping clicks. Failed upload leaves the hidden receipt empty
  and does not call the success callback. The retry uses the existing closeout
  button style.

The reviewer raised two issues during implementation: the intent-only state
could still produce a misleading background-processing promise, and the first
photo retry draft did not bind the File to its job/mode. Both are addressed in
the final diff and covered by behavioral regressions.

Photo retry keeps the existing fresh-upload-attempt semantics: it creates a new
UUID/path. It does not promise exactly-once provider storage after an ambiguous
network response. The retained File is in page memory, not durable photo storage
across reloads; the UI explicitly asks the user to keep the page open.

## Independently executed checks

The final pinned Node 24 command passed **36/36 tests**:

```text
node --experimental-strip-types --test scripts/storage-recovery.behavior.test.mjs scripts/voice-outbox-scope.behavior.test.mjs scripts/voice-outbox-client.test.mjs scripts/closeout-upload-confirmation.behavior.test.mjs scripts/s03-closeout-uploads.test.mjs scripts/closeout-photo-fragment.behavior.test.mjs scripts/job-fragment.test.mjs
```

The seven storage-recovery tests execute the real route and component event/recovery functions
with fake hooks, IndexedDB, SQL and provider boundaries. They prove:

- Storage refusal followed by restoration reuses the retained recording,
  uploads once on recovery, transcribes once, and clears device bytes only after
  transcript handoff.
- Continued failure retains bytes and does not claim success.
- A 404 for a missing intent still recreates it from the retained recording,
  with one recovery POST, one upload and one transcription. The reviewer
  inspected and reran this added regression with the final suite above.
- Missing device bytes plus an empty server Blob path does not promise
  background completion or falsely claim a local recording still exists.
- A completed intent produces no new upload or transcription.
- Another operator's retained audio is not uploaded or deleted.
- A failed photo retries the identical File, does not transfer the retry to
  another job/mode, and files a receipt only after successful upload.

Existing tests additionally check stale/missing voice scope, sign-out and
offline identity behavior, job binding, delayed closeout callbacks, and refusal
to confirm another job/operator/mode/test partition's photo receipt.

These are controlled behavioral tests, not real provider delivery or native
device evidence. Root subsequently reported the full suite at 1,067 tests:
1,064 passed, three skipped, zero failed; lint, production build and both bundle
budgets passed. The independently inspected rebuilt-revision HTTP evidence now
passes 19 HTTP/auth/browser checks plus three forms, including missing-audio
recovery GET, private-path omission and cross-operator/stale-scope denial.
It records 286 real SQL requests, zero SQL errors or external connection
attempts, and successful database cleanup. See
[the current HTTP report](../../next-http-acceptance-2026-10-30.md).
Standalone typecheck also passed, as recorded with the five product source
hashes in [the final release summary](provider-recovery-release/summary.json).

## Remaining acceptance boundaries

The provider probe is explicitly failed in
[the Blob acceptance report](../../testing/2026-10-30-blob-provider-acceptance.md)
because the configured private store reports a usage-limit suspension. This
code fix cannot remove that provider limitation; a successful controlled
upload/read/delete check remains necessary after service is restored. No billing
or account changes were reviewed or made here.

Physical Android results, native TalkBack, iPhone/Safari, real microphone and
camera behavior, signed live callback delivery, and production infrastructure
are not established by these tests. No production records, customer sends,
paid AI calls, or deployments were performed for this review.

## Photo fragment follow-up

**Layout approval restored for the corrected, tested states.** Root visual
inspection of `android-preview/fixed-844-failed-photo.png` found the expanded
review form compressed into an approximately 100px column. The reviewer
independently inspected that image and confirmed unusably narrow controls.
The eight fragment tests below establish targeting/focus and gate transitions;
they did not adequately validate usable form widths. The subsequent correction
gives reviewed closeout a full-width single-column form, responsive review
columns with a font-relative minimum, and full-width narrative fields. It also
replaces the invisible legacy dark photo label with the secondary text token.

The reviewer inspected final compiled screenshots at 844px and at 390px with
doubled text, following earlier visual inspection at 768px and ordinary 390px.
Fields are visibly usable and the photo label is readable. The final
[layout results](android-preview/review-layout.json) pass **16/16 cases**, with
zero errors, for complete/partial review at 320, 390, 768, 844, 1024 and 1440px,
plus doubled text at 390 and 844px. Assertions measure individual control
widths, source width, overflow and option-text fit. The final results use no CSS
overlay, and [source hashes](android-preview/source-hashes.json) match the
reviewed DoneStamp and job.css revisions.

Computed photo-label text is `rgb(207,198,181)` over an 82%-opaque
`rgb(26,25,23)` layer. Independent contrast calculation is approximately 10.37:1
over the opaque dark color, and still at least 5.89:1 if that layer were placed
over white. The focused automated contrast checks reported zero violations;
some other controls remain manual/incomplete checks, so this is not a claim of
universal contrast compliance. The native file-picker text can truncate at
390px with doubled text; its visible label and full-width reachable field
remain usable in the inspected browser. Native hardware is not established.

Root completed final production validation after this style revision: build
`4OoUmdCuqfSBDDV2j-Voz`, full suite (1,064 passed, three skipped, zero failed),
lint, standalone typecheck and bundle budgets all passed. The reviewer inspected
the final source-hash summary and the fresh
[22-check HTTP run](next-http/final-revision/summary.json), completed at
`2026-10-30T07:21:44.677Z`, with 286 SQL requests, zero SQL/external-traffic
errors and successful cleanup. No remaining blocker was found in this reviewed
code/layout scope; the provider and hardware boundaries above remain open.

The reviewer also inspected the narrow `DoneStamp` change after six automated
browser cases exposed a missing Photo target while reviewed closeout had not
yet completed. The fix adds a focusable `finish-photo` prerequisite target with
plain guidance and a full-size action leading to the closeout textarea. The
existing scoped fragment resolver handles both links. Completed review replaces
the prerequisite with the actual photo input; partial review keeps photo upload
gated and preserves the partial-update action. Ordinary closeout is unchanged.

Initial independent execution passed **19/19 tests** across
`closeout-photo-fragment.behavior.test.mjs`, `job-fragment.test.mjs`, and
`storage-recovery.behavior.test.mjs`. Focused ESLint passed. The new behavioral
tests execute the component's review transitions and cover prerequisite focus
support, complete/partial gating, and ordinary closeout. The reviewer inspected
the corrected portrait screenshot showing the prerequisite and action within
the page. No blocker was found in this code diff. The final
[browser retest](android-preview/photo-retest.json) passed **8/8 cases with zero
errors**, resolving all six original missing-target failures at 390px and
844px. It covers repeated Photo focus, at least 44px prerequisite action height,
source-link focus, complete/partial/complete transitions, and normal, failed,
pending and completed states. The reviewer inspected that evidence; its source
hash binds the DoneStamp fix, while its other storage components remain the
earlier fixture baseline. It does not establish browser coverage of those
storage fixes, native-device behavior or screen-reader verification.
