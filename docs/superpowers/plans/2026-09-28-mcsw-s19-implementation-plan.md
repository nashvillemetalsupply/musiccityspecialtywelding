# MCSW S19 implementation plan

## Product thesis

A filed glass photo can save the owner a re-keying step by suggesting a few
clearly uncertain work details that only the owner can confirm.

## Anti-features

No price, no automatic confirmation, no outbound copy or send, no customer-page
display, and no crew or signed-out access to draft claims.

## Release axes

- Truth and reliability: 10/10 — retain the source photo and intent receipt;
  model output stays a draft until the owner acts.
- Time saved: 8/10 — offer up to eight details for one-tap review.
- Crew usability: 10/10 — no crew action or exposure is introduced.
- Visual clarity: 8/10 — compact job-page block, existing tokens, accessible
  controls.
- Forward invention: 9/10 — filed photos become owner-reviewable evidence.

## Implementation sequence

1. Add an OFF-by-default `MCSW_PHOTO_DRAFTS` gate and schedule draft work with
   the existing Next `after()` path only after a glass upload is stored.
2. Persist an idempotent intent event before a model call; reuse the existing
   extraction model, usage logging, claim writer, source tag, and test marker.
3. Validate a bounded zod result and reject the entire result on any price or
   money marker before writing claims. Keep customer text delimited and
   untrusted. Persist failure state on the intent; swallow draft errors at the
   post-response boundary.
4. Add owner-only accept and reject actions. Both append events and supersede
   the draft; acceptance writes a normal confirmed claim and rejection writes
   a rejection receipt claim.
5. Add a compact 375px-first job-page block with keyboard, screen-reader, and
   forced-colors support.

## Verification

Mock the model and persistence to cover upload finalization through intent,
drafts, one acceptance, one rejection, both events, injection-price rejection,
test-lead propagation, and zero outbound writes. Run `npm test`,
`npm run typecheck`, and `npm run lint`; no preview walk or real model call.
