# Round 9 build receipt

Branch `form-p2-r4-1127`, based on `f3fe4a7`.

| Round-8 finding | Fix | Regression test |
| --- | --- | --- |
| An MMS changed a legacy lead's photo count, causing an unchanged quote to offer a restart. | Intake writes `leads.quote_form_photo_count` once. Legacy retries use the frozen owner email's photo list when available and accept missing count evidence. Reserved photo bytes are preserved. The MMS and attachment paths continue updating `leads.photo_count`. The replay retains one lead and one customer receipt. | `legacy MMS after an interrupted owner email leaves one lead and one customer receipt`, `a legacy retry with fewer photos preserves staged originals and never offers a restart`, and `a legacy zero-photo quote ignores extra photos when its original fingerprints are saved` |
| A lowercase `[internal test]` missed-call event could reclaim a notification key and resend. | PostgreSQL classifies the candidate once for persistence, production-key reclamation, and the send gate. The replay makes one provider send total, from the live control. | `a lowercase [internal test] missed-call replay shares a production key without sending` |
| A configured preview POST sent the owner and customer emails. | Preview saves the intake and returns 200 with zero provider sends. | `configured preview quote saves with no provider sends` |
| An older production worker could recover mail frozen by a new preview intake. | Preview leaves no frozen provider intent eligible for the older worker. The old-worker replay makes zero sends. | `an old production worker finds no mail to send for a newly saved preview quote` |
| Preview could freeze its sender payload on a production intake key. | Preview leaves the production email intents alone. Each new frozen intent saves its environment. Recovery matches that environment, and only production can send eligible legacy intents with an unset environment. The preview replay makes zero sends. | `a preview retry cannot freeze preview sender payloads for an existing production intake` and `only production recovers untagged legacy mail and skips a mismatched frozen intent` |
| Intake health stayed green with the rollout schema missing. | Both health paths plan writes that reference the intake environment and immutable photo count. The named additive photo-count migration is idempotent. | `quote intake health stays red until both rollout columns exist` and `the quote form photo count migration is recorded once across two runs` |
| Older recovery 422s never filed lead-specific alerts. | The sweep derives definitive rejections from linked attempt and failure receipts. It repairs stale lead status independently and files warnings for active owners who missed them. | `production sweep repairs legacy recovery 422 receipts without a recovery marker or another send` and `a filed direct rejection warning leaves projection repair and other owners eligible` |
| Pre-upgrade terminal callbacks left the lead projection accepted with a blank error. | The sweep restores the failed state and provider reason from signed failure receipts while preserving operator-resolved cases. | `production sweep repairs the lead projection from saved failed and suppressed callbacks` |
| Twenty fresh reviews could indefinitely defer an overdue retry. | Five of each 20 quote recovery slots are reserved for eligible overdue retries. Either queue can fill unused slots. | `five overdue quote review retries get a slot alongside twenty fresh reviews` |
| A live bounce acknowledged only by preview never filed an alert. | The production sweep files the missing alert from the saved signed receipt using the webhook's existing dedupe key. | `production sweep files one alert for a signed bounce received only by preview` |
| Preview could mark a live inbound call handled after filing test notifications. | Preview saves the receipt and leaves the live alert eligible for production. Production also reopens legacy calls with only preview alerts. | `inbound Twilio call receipts inherit the linked lead test partition` and `production recovers a live call that an old preview marked handled` |

Apply `npm run migrate` to the shared database before either environment serves the new code. The migration and SQL checks here used isolated PostgreSQL 17 with synthetic data. The legacy-worker replay models its intake selection in the test harness.

Verification passed with Node 22. `npm run typecheck` succeeded, `npm test` passed 1,764 tests with 3 skipped, and `git diff --check` succeeded.

BUILD: PASS
