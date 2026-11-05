# Email intake acknowledgement intent

Owner approved on 2026-11-05 (Fable 11-05 NEXT-FOCUS item 9, “3. sure”).

Implement on `feat/email-in-auto-ack`, based on local `main` at `61c44de`.
Reuse the form acknowledgement wording and existing Resend provider-truth path,
asking for a phone number so the shop can call. Persist a unique
`email-in:<gmail thread id or message id>:ack` email intent before the provider handoff.
Only the first inbound email of a newly created conversation is eligible;
exclude existing threads, outbound mail, internal tests, shop addresses and
messages rejected by the existing spam/automated-mail filters.

Use mocked, offline tests only. Never read environment values, connect to the
shared Neon database, run migrations, send real messages, push, merge, run
Vercel or deploy. Run focused tests, the full test script, typecheck and lint.
The owner controls deployment through the route documented in README.md.

## Repository findings and decisions

- At this base commit the form sends a Resend email with key
  `quote-customer:<intake key>`, not `form:%:ack`. Use email for this acknowledgement
  even if a customer phone number is available.
- `MCSW_EMAIL_IN_ACK=1` enables the new acknowledgement. It defaults OFF, using
  the same opt-in shape as `MCSW_TEXT_IN_ACK`; the form receipt itself has no flag.
- Form acknowledgements record system `email.out` and provider receipt events.
  They do not set `first_response_at`: `countsAsHumanResponse` deliberately
  excludes system replies. Preserve that behavior rather than count an automatic
  message as a human response.
- Prefer the Gmail thread ID in the durable acknowledgement key, falling back to
  its message ID; this also converges competing messages in one thread. Use the
  RFC Message-ID in reply headers. Reject existing mapped threads and reply headers,
  including replies whose thread mapping is unavailable.
- A conflicting durable acknowledgement intent never calls the provider again,
  even after an ambiguous handoff. Failed/unknown receipts remain available for
  owner review through the existing email delivery journal.

## Exact acknowledgement

Channel: reply email through the existing Resend provider-truth adapter. The
greeting uses the customer's first name and the phone uses `getShopPhone()`.

```text
Hey {firstName},

Your email request just hit our board. Reply with a phone number so a real person from the shop can call you.

If it can't wait, call {shopPhone.display}.

Music City Specialty Welding
533 W Baddour Pkwy, Lebanon, TN 37087
```

## Owner deployment

The documented production route is a push to `main` (README.md, Deployment).
The owner must review/merge this branch and push, and set `MCSW_EMAIL_IN_ACK=1`
in the intended runtime to activate acknowledgements. Existing `RESEND_API_KEY`
and `QUOTE_FROM_EMAIL` configuration is required. No schema migration is needed.
This task does not merge, push, deploy, run Vercel or send any real messages.

## Verification

- Node 22 focused mocked tests: 33 passed, zero failures.
- Full `npm test`: 1,159 tests; 1,156 passed, zero failures, three skipped.
  The opt-in AI evaluation and both real-database persistence tests were skipped.
- `npm run typecheck`: passed.
- `npm run lint`: passed with zero errors or warnings.
- Full tests ran with an ignored local preload that removes database/provider
  credentials, hides environment files, disables paid AI evals, and adds the
  owner's required arguments to the suite's internal read-only Git invocation.
  No migration, real database operation or external provider call was made.
