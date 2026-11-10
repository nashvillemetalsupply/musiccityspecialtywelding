# Assistant expert review

Review date: 2026-11-10. Branch: `assist-a1`.

## Scope and evidence

The review covers the complete customer assistant path, rather than only this change's diff:

- All modules in `lib/assistant/`: browser session state, contact and handoff rules, input limits, intake questions, knowledge, money redaction, turn processing, Postgres leases and checkpoints, follow-up, voice identity, and voice dependency wiring.
- `lib/ai.ts`, `BRAND-BRIEF.md`, `lib/service-pages.ts`, `app/services/[slug]/page.tsx`, and `app/service-areas/page.tsx` as the assistant's factual and provider boundaries.
- `components/assistant-chat.tsx`, `app/api/assist/route.ts`, `app/api/twilio/assist-voice/route.ts`, the inbound voice/fallback wiring, and `next.config.ts` deployment tracing.
- The connected handoff and notification code in `lib/notify.ts`, persisted lead intake, event receipts, and the existing customer photo follow-up path.
- `scripts/assistant-*.test.mjs` and `scripts/assistant-a4-*.mjs`, including fixture storage, no-outbound guards, failure diagnostics, replay, and the eight A4 route scripts.

Shop claims must come from the repository's published service pages, approved brand facts, and service-area source. These sources support metal fabrication and repair, including listed trailer/gate/railing work, mobile work, aluminum boat repair, and stainless countertops. They do not establish every alloy, repair method, structural approval, qualification, certification, travel commitment, price, or completion date. Gate motor/opener/electrical repair is explicitly outside the published metal-repair scope.

## Fixed findings

| Finding | Fix and regression evidence |
| --- | --- |
| A model could approve a damaged trailer for towing or prescribe an improvised repair. | Added expert prompt boundaries and application output guards. Damaged towing, lifting and structural parts require inspection; the assistant does not approve safety, load capacity, roadworthiness or DIY welding steps. Regression probes include both explicit “safe to tow” and indirect “you can tow it once it is welded.” |
| Credentials, guarantees, unsupported work and completion promises could escape ordinary price/promise checks. | Added guards for unsupported credentials, rated-load claims, repair procedures, unsupported process/service claims and completion wording such as “Ready by Friday.” Unknown work stays available for shop review and lead collection. |
| Intake did not consistently ask an actionable next question after a human/price/failure handoff. | Shared question selection continues with missing job/contact information, then material/size, location, requested timing, thickness, setting, load purpose and photos as appropriate. Callback requests and desired work timing remain separate. |
| Human routing could misread ordinary job language such as “someone hit my gate” or an equipment “operator platform.” | Narrowed deterministic person-request matching while preserving explicit human requests and Spanish person/price routing. |
| Out-of-area requests and excluded gate motor work could receive an unsupported yes or a dead end. | The assistant retains job/location evidence, asks the next intake question, states the metal-only boundary or travel-confirmation requirement, and supplies the existing phone/email destinations. |
| Spanish customers could receive English application fallback text. | Added Spanish contact/intake/boundary text without claiming Spanish-speaking shop staff are available. |
| Qualified chat and voice leads could produce a short alert without sending the conversation to the Sales inbox. | Both qualified-lead notifications now enter the same durable transcript handoff outbox as explicit handoffs. Explicit handoffs do not also send a duplicate qualified-lead alert. |
| A later handoff could reuse an earlier immutable snapshot and omit newly supplied contact/details. | Later turn snapshots use deterministic delivery identities; retries reuse their original snapshot, while new turn evidence gets its own delivery intent. |
| Transcript email failure or ambiguous acceptance could remain invisible to the shop phone. | Shared delivery uses the existing owner-cell SMS notification path. Failed, unavailable or unconfirmed transcript email produces a durable phone alert for shop review; provider ambiguity is never represented as confirmed delivery. |
| A definitive transcript-email rejection had no bounded recovery send. | Recovery permits at most three immutable attempts after definitive provider rejection, each with its own send claim. An accepted or ambiguous attempt is never blindly replayed. |
| An assistant transcript bounce or delay without a customer lead could miss the shop phone. | The signed Resend webhook routes assistant inbox delivery problems to the existing owner-cell alert path even when the transcript has no linked lead; sticky test rows remain suppressed. |
| Voice provider effects could delay the TwiML response. | Voice turns persist handoff intent first, then deliver/recover and project photo follow-up after returning TwiML. Timeout, missing-callback and turn-limit exits preserve the handoff evidence. |
| A restored browser session could become permanently stuck on an invalid read-only retry. | Browser restore now uses the API's v4 UUID constraint and validates lengths after money redaction. Corrupt/oversized restored state starts a usable session. Both cases were reproduced with failing tests before the fix. |
| Static browser failure text promised an unconditional callback. | Changed the contact-form link to a callback request; no callback time or completion is promised. Call remains the primary action. |
| The voice deployment bundle did not explicitly include filesystem-backed knowledge sources. | Added source tracing for `/api/twilio/assist-voice` alongside chat. An executable configuration regression verifies both bundles include the brand and service-area files. |
| The A4 call fixture bypassed the shared denormalized test-row classifier. | A4 call insertion now uses `mcsw_is_test_row` with its explicit test detail and marker, keeping the fixture in the test partition. |
| A4 expected an old exact response prefix after pressure-vessel replies gained safety language. | Updated the assertion to require inspection/confirmation plus an intake question, while retaining handoff, no-price, no-promise, test-partition and no-outbound assertions. Owner-cell SMS interception is also asserted explicitly. |

Money redaction, `[INTERNAL TEST]`/`is_test` suppression, immutable event receipts, typed SQL parameters, provider signature checks, durable inbound-before-model ordering, lease fencing and idempotent replay remain required throughout. Existing exact-excerpt validation, including separately grounded material/size excerpts, remains in place. The implementation adds no dependency or outbound channel; it uses the existing Sales email, shop contact links, owner-cell SMS and operator notifications.

## Welding review criteria

The prompt and guards distinguish steel, aluminum, stainless, cast iron and unverified alloys; they do not infer metallurgy from appearance. They request material/alloy if known, thickness, dimensions, indoor/outdoor setting, load-bearing versus cosmetic purpose, damage history and relevant access conditions. Unknown answers are acceptable. Photos must go through existing contact/upload or email paths; chat/voice do not claim to receive uploads.

Trailer tongues/hitches and mounts, rails/stairs, lifting equipment and structural members need physical assessment and, where applicable, engineering. The assistant cannot certify a load path, restore a rating, approve code compliance, or authorize use of a damaged part. Fuel/propane tanks, pressure vessels and contaminated containers need specialist assessment, without advice to empty, rinse or weld them. Prices, availability, urgent dispatch and completion times remain for a person at the shop to confirm.

## Conversation tests

Scenario count: **56 conversations** (54 job/intake conversations and two non-job conversations). Customer turns: **168**, three per conversation.

`scripts/assistant-expert.test.mjs` exercises the real turn handler using realistic model responses at the `jsonWithClaude` boundary. The suite also supplies deliberately incorrect outputs to verify the application's guards, plus direct deterministic rule-path cases. Multi-turn histories retain customer evidence and test the next useful question rather than merely checking that a response exists. Existing API/storage/voice tests cover persistence, replay, lease races, signed webhooks, partial leads, provider failures, test suppression and delivery intent.

| Coverage | Scenario IDs in the test source |
| --- | --- |
| Trailer damage and towing/load boundaries | `trailer-hitch`, `trailer-frame`, `trailer-ramp`, `trailer-hanger`, `safe-towing`, `capacity-change` |
| Gates, railings and stairs | `sagging-gate`, `gate-hinge`, `gate-motor`, `railing`, `stair-fabrication`, `someone-hit-gate` |
| Aluminum, stainless, cast iron and unverified alloy | `aluminum-boat`, `aluminum-bracket`, `aluminum-thin`, `stainless-counter`, `stainless-table`, `food-grade`, `cast-iron-stove`, `cast-iron-block`, `titanium` |
| Equipment, agricultural work and site conditions | `ag-bucket`, `mower-deck`, `repeated-crack`, `lifting-fork`, `indoor-hot-work`, `operator-platform` |
| Mobile work, urgency and travel | `mobile-on-site`, `roadside-urgent`, `out-of-area-tn`, `out-of-area-ky` |
| Price, deposit and timing promises | `price-request`, `deposit-request`, `timing-request`, `invented-deadline` |
| Person requests and frustration | `human-request`, `angry-customer` |
| Spanish continuity and safety | `spanish-gate`, `spanish-price`, `spanish-person`, `spanish-towing`, `spanish-opener` |
| Voice callers | `voice-human`, `voice-equipment` |
| Specialist/unsupported scope and credentials | `pressure-vessel`, `propane-tank`, `gas-manifold`, `mailbox`, `planter`, `underwater`, `credentials`, `unsupported-coating` |
| Adversarial input and unavailable evidence | `prompt-injection`, `photos-unavailable` |
| Non-job closure | `spam`, `wrong-number` |

## Validation results

All validation is offline. No production model, shared database, email, SMS, push, Twilio call or other network delivery is invoked.

| Check | Result |
| --- | --- |
| Assistant tests: requested Node executable, `--experimental-strip-types --test scripts/assistant-*.test.mjs` | **250 passed, 0 failed, 0 skipped** |
| Full repository test suite | **1,424 passed, 0 failed, 3 skipped** (1,427 total) |
| `npx --offline tsc --noEmit` | **PASS**, exit 0 |
| ESLint, whole repository | **PASS**, exit 0, no warnings |
| A4 `--dry` | **8/8 passed**, safety interception passed, **0 outbound attempts** |

The full suite ran with `--experimental-strip-types --test --test-concurrency=4 scripts/**/*.test.mjs`. Live AI evaluation was disabled and database URL environment variables were cleared; no `.env.local` exists in this checkout. The three skips were the opt-in live AI evaluation and the two real database persistence tests. Local HTTP fixture tests ran against loopback only; no external network or live provider was used.

The expert test file passes **69/69**: the 56 matrix conversations and 13 targeted regressions/rule checks. Initial unsafe-output tests failed before fixes, including towing approval, false gate motor capability, fabricated credentials, and Spanish routing. Further adversarial review reproduced indirect transport instructions, food approval and dispatch promises, which now pass their regressions.

The A4 dry harness runs real route/storage/intake/person/event/handoff logic against fixture database and model boundaries. It separately intercepts exported outbound senders and native network entry points, verifies the interception before running scripts, checks zero outbound attempts, and preserves `[INTERNAL TEST]` through readback. Its report is `docs/ASSISTANT-A4-RUNS.md`; sanitized diagnostic output is gitignored at `.tmp/a4-diagnostic.json`.

## Not fixed / verification limits

- **Live configuration and actual delivery were not verified.** The request prohibits network access. Offline passing tests establish routing, durable intent, guards and retry behavior; they cannot establish current provider credentials, live model quality, Sales inbox receipt, handset delivery, carrier availability or staff response. No live configuration was changed.
- **Ambiguous transcript email acceptance requires shop review.** A lost provider acceptance receipt is quarantined to avoid sending a potentially duplicate transcript. Definitive rejection retries are bounded to three persisted attempts. Ambiguous acceptance or exhausted retries raise a durable phone alert for operator attention. This is an intentional provider-truth boundary.
- **No automatic system can certify a physical weld from a chat.** Inspection, material verification, repair design, code/engineering responsibility and job acceptance remain with the shop. These are explicit conversation boundaries, not promised services.
- **Mocked conversations do not prove every possible future model utterance is correct.** They verify realistic workflows and specific unsafe-output regressions through production turn logic. The prompt remains evidence-limited and deterministic guards cover the reviewed risk patterns.

Remaining known code defects after final verification: **none identified**. Live provider and delivery verification remains unperformed because this review was explicitly offline.
