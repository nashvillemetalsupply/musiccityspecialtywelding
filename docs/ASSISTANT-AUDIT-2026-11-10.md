# Assistant audit — November 10, 2026

Branch: `chat-audit`. No push or deployment. `ASSISTANT_VOICE` stays off.

## Scope and limits

The owner requested an expert customer-question audit with a human route whenever the assistant cannot substantiate an answer. This audit tests the real chat POST handler and its knowledge, reply guards, session storage, intake and handoff code. It does not certify that the model can answer every possible welding question, approve a repair remotely, or confirm provider delivery from a queued intent.

There is no `.env*` file in this checkout. `ANTHROPIC_API_KEY` and `DATABASE_URL` are absent from the process. The local question-bank evaluation therefore uses the repository A4 harness's database/provider fixture approach. Scripted model candidates include sourced answers, uncertainty, deliberately false assertions and provider failures. These results establish application behavior for those candidates, not an independent live-model accuracy score. The ten production questions are separate observations of the existing deployment, which does not contain this unpushed branch's fixes.

## Assistant map

- Entry: `app/api/assist/route.ts`, enabled only by `NEXT_PUBLIC_ASSISTANT_CHAT=1`. `readAssistantInput` validates a v4 session UUID, turn index, JSON size and customer message. The route supplies the real `handleAssistantTurn` to `processAssistantTurn`.
- Persistence and limits: `lib/assistant/store.ts` stores inbound evidence before the model, fences concurrent turns with a lease, retains replay results, and makes the session test marker sticky. `service.ts` enforces IP/session limits, validates contact before filing a lead, records receipts and dispatches handoffs.
- Knowledge: `lib/assistant/knowledge.ts` builds versioned repository evidence from all seven records in `lib/service-pages.ts`, `app/service-areas/page.tsx`, and approved facts/contact details in `BRAND-BRIEF.md`. This audit adds extraction of the existing homepage FAQ, actual process/customer-page explanatory copy, and quote-form requirements from `app/page.tsx` and `components/mainstreet-contact.tsx`. Both assistant route deployment bundles explicitly trace the added files. The seven service slugs are `mobile-welding`, `trailer-welding-repair`, `gate-repair`, `equipment-repair`, `architectural-welding`, `custom-fabrication`, and `custom-metal-products`. There is one service-area page, listing Lebanon, Nashville, Franklin, Murfreesboro, Gallatin, Hendersonville, Clarksville and Antioch; there are no separate city pages.
- Prompt and model: `ASSISTANT_SYSTEM_PROMPT` in `lib/assistant/turn.ts`; `jsonWithClaude` in `lib/ai.ts` uses the Anthropic Claude API. Customer conversation is untrusted evidence. Extracted fields must be customer excerpts. Prices, dates, availability, licenses, certifications, guarantees and unsupported capabilities cannot be invented.
- Expertise boundaries: questions about damaged load-bearing parts require inspection, sometimes engineering. No safety-to-tow/use approval, restored load rating, code certification, weld procedure, filler selection or DIY fuel/pressure-vessel repair. Gate motor/electrical work belongs with the installer. Urgent jobs and travel require current shop confirmation. Cast iron is not established by the wrought-iron/mailbox facts.
- Customer route: call the public shop number `(615) 703-3296` (`tel:+16157033296`), use the existing `/#contact` quote form, or email `Sales@musiccityspecialtywelding.com`. No booking, callback time or completed send is promised by the model. The quote form is handled by `components/mainstreet-contact.tsx` and `/api/quote`; it is not submitted by an assistant reply.
- Owner route: `lib/assistant/handoff.ts::deliverAssistantHandoff` persists `assistant.handoff-request` with a money-stripped transcript before intake or delivery. It can file a partial lead when a phone/email is present, then records `assistant.handoff`. Non-test handoffs invoke the existing transcript email to **Sales@musiccityspecialtywelding.com**, owner-only SMS to the operator matched by **OWNER_CELL_PHONE**, and `notifyAll` operator alerts linking to the lead or saved receipt. The code does not expose the owner cell to the customer. SMS requires a configured owner-role recipient and the existing provider gates; email requires `RESEND_API_KEY` and `QUOTE_FROM_EMAIL`. This audit does not establish that those production credentials or delivery channels are working.
- Recovery: immutable per-session/reason/turn identities prevent replay from resending. The existing recovery sweep handles pending handoff projection and idle contact after 15 minutes. Failed or ambiguous transcript email raises the existing owner-cell status alert; ambiguous email acceptance is not blindly resent.
- Error route: model failure, throttling and persistence/API errors offer direct contact; the browser has a static fallback independent of the API. A failed persistence operation must not be described as an owner notification.

## Production safety check

Code was checked **before** authorizing any production POST. `input.ts` derives `is_test` from the `[INTERNAL TEST]` prefix; the store ORs it into the session; `service.ts` excludes test sessions from qualified-lead notifications. `handoff.ts` also derives test status from input, session, linked lead/person and transcript, then returns before transcript email, owner SMS or operator notification. `followup.ts` suppresses photo SMS for test input/lead/person. `notify.ts::emailAssistantTranscript` independently suppresses test markers and checks source evidence. Production probes use a fresh UUID each, prefix every message, set `is_test:true`, provide no customer contact, and do not invoke voice. They may persist test evidence and incur model usage. No production delivery is intentionally exercised.

## Findings and verification

The original handoff branches offered a call link and email but omitted the required quote form. The widget also allowed only telephone/email anchors. All written handoffs now offer call, quote form and email; only the exact local form destination is additionally allowed, and selecting it closes the modal so the form is usable. Voice replies retain their spoken person/zero route.

The original non-job close could discard a genuine unsupported request or a model's uncertainty. Genuine customer questions retain the human route, while explicit sales pitches, wrong numbers and goodbyes can still close. Sanitized empty or excessive-length responses also route to a person instead of replacing the answer with a bare intake question.

Adversarial provider outputs exposed missing deterministic guards for invented insurance, licenses, payment policies, opening hours, unsupported engine/intercom/control work and unsafe DIY instructions. Those cases are checked separately from the model's own handoff metadata. New knowledge is extracted from versioned site copy, rather than invented: homepage answers and process, private customer-page description, form fields and optional photo limits. Example job statuses are excluded. The owner fallback line is removed from model knowledge; the public shop number remains.

The fixture is `scripts/assistant-audit-bank.mjs`; `scripts/assistant-audit-run.mjs` runs it through the real `/api/assist` POST using the existing A4 SQL/provider fixture and network/sender interception. Each record carries the customer question, source evidence, supplied provider candidate, expected behavior and actual reply/grade. The grading is deliberately stricter than a generic conversational dead end: **DEAD END includes an uncertain answer with an incomplete required handoff, even when a telephone/email link was offered**. A clean handoff requires both the approved telephone and quote-form links, routing metadata and a durable handoff intent. The dry evaluation does not prove unseen model outputs are grounded.

Production: all ten requested prefixed questions returned HTTP 200, including the explicit person and pricing handoffs. Three answers were supported by site facts: custom planters, Lebanon/Franklin coverage, and aluminum boat repair. Seven handoff replies lacked the quote-form link and fail the stricter complete-handoff criterion. The unchanged production deployment therefore still has the form-link gap; a later deployment is needed to apply this branch. No further live questions were sent after these ten. Notification suppression is established by inspected code and offline regression checks, not a production provider-delivery readback.

There is an existing owner-notification implementation, so no new email sender was built. The remaining operational gap is **delivery verification**: without production credentials/provider readback this audit cannot confirm Sales inbox receipt, owner-role phone configuration, SMS delivery or operator push delivery. Published prices, payment methods/terms, operating hours, licenses, insurance, warranties and current availability remain unverified business facts and route to the shop. No facts were invented to fill those gaps.

## Score table

The same frozen 143-question bank was replayed against the pre-change source (`69c9fc5`) and the repaired branch. All seven service pages and all eight listed cities are asserted by the runner. The bank also covers materials, mobile versus shop, trailers, gates/railings, equipment/agricultural repairs, structural work, urgent/after-hours requests, travel, prices/quote process, lead time, insurance/licensing, payment, photos/dimensions, safety, genuine off-scope requests, human requests, malformed/unavailable model output and adversarial unsupported assertions.

| Run | Questions | Answered from facts | Clean handoff | WRONG | DEAD END |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before, local dry application evaluation | 143 | 44 | 0 | 10 | 89 |
| After, local dry application evaluation | 143 | 42 | 101 | **0** | **0** |
| Existing production, real-model sample | 10 | 3 | 0 | 0 | 7 |

Before/after transcripts, supplied model candidates, evidence and per-question grades are in `docs/assistant-audit-before.json` and `docs/assistant-audit-after.json`. The separate production transcript is `docs/assistant-audit-prod.json`. Both dry runs passed the A4 sender/native-network interception checks with **zero outbound attempts**. Production outbound delivery was not read back; only code suppression was verified.

Reproduce locally with Node 22:

```powershell
$auditNode = 'C:/Users/Owner/AppData/Local/hermes/node/node.exe'
& $auditNode --experimental-strip-types scripts/assistant-audit-run.mjs --baseline
& $auditNode --experimental-strip-types scripts/assistant-audit-run.mjs
```

The baseline runner can read the retained original commit with `git show`, so it does not depend on untracked source snapshots. The production mode requires an explicit suppression-check attestation and sends exactly ten prefixed messages; it is not run by the ordinary test suite. Do not mistake the dry bank for 143 calls to Anthropic: no local model credentials were available.

## Release checks

`ASSISTANT_VOICE` was not enabled in the audit runner, build environment or any deployed configuration. Existing isolated voice regression fixtures may exercise their own flag-on scenarios; they do not change a live flag or place a call.

| Check | Result |
| --- | --- |
| Frozen question-bank replay, real chat POST with A4 fixture boundaries | 143/143 acceptable: 42 sourced answers, 101 durable handoffs; zero WRONG/DEAD END |
| Full repository suite, Node 22, `--experimental-strip-types --test --test-concurrency=4` | **1,505 passed, zero failed, three skipped** (1,508 total). Existing opt-in live-model and real-database checks were skipped. |
| Final focused brain/disclosure/turn-regression checks | 55 passed, zero failed |
| Audit grader negative-control tests | Five passed, zero failed; phone-only, missing handoff persistence, false assertions hidden behind links, nonanswers and invented prices are rejected. |
| `tsc --noEmit` | Passed, exit 0 |
| Repository-wide ESLint (`eslint . --cache --cache-location .tmp/assistant-audit-eslintcache`) | Passed, exit 0 |
| Final production build (`next build --webpack`) and `scripts/bundle-budget.mjs` | Passed, exit 0; final source compiled, typechecked and generated successfully; both bundle budgets passed. |

The initial full suite exposed three stale text/branch expectations. They now require the retained useful question and complete contact route, and the correct gate-electronics installer boundary. A focused check also caught affirmative-claim analysis being applied before HTML sanitization and to cautious “confirm whether” wording; that was corrected before the final full suite and 143-case replay. The initial ESLint run found one new-runner local named `module`; it was renamed to `senderModule` and the targeted audit-script lint passed.

The default Turbopack build failed because this worktree's `node_modules` junction points outside its filesystem root. The supported `next build --webpack` production build passed compilation, TypeScript, static generation and tracing, and the bundle budget passed: home 622,810 / 648,316 bytes; board 725,625 / 817,538 bytes. The final cached webpack replay, including the last source refinement, and repository-wide lint replay both passed. No dependency, environment, provider, migration or deployment change was made to work around the junction.

An independent review checked the question/source mapping, actual handoff persistence, link allowlist/modal close, owner/test boundaries and adversarial claims. Its findings (overbroad polite closes and declarative unsupported-service assertions) were repaired and replayed; no remaining P1/P2 finding was identified within this bounded audit. This is not a certification of unrestricted model expertise.
