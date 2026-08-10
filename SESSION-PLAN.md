> Extracted from SHOP-BRAIN-PLAN.md Part E. One row = one fresh chat. Sessions mark their own status row as they close.

# PART E â€” SESSION PLAN (/phase-plan output)

> On approval, copy this Part into `SESSION-PLAN.md` at repo root; sessions update their own status row as they close.

**Rules:** one row = one fresh chat = one bounded mission (â‰¤ ~1hr where possible; big phases are split at natural seams). Open each chat with the paste-ready prompt, session model set FIRST. One session at a time, in order (gap-fillers may slot anywhere their deps allow). Design-heavy (L, top-tier) sessions present their in-session plan for owner sign-off BEFORE writing code. Every session starts by reading this plan file; ends with commit + its own verification only. Never mix sessions in one chat. If long, stop at a shippable commit; continue in a fresh chat.

**Standing notes (ride along, don't own a session):**
- Owner buys Twilio number + files A2P the day S4 opens (external lead time; voice unblocked immediately, SMS waits on approval).
- Owner runs `scripts/gmail-auth.mjs` consent once when S6 opens.
- Owner reviews every UI session live at localhost:3100 (standing rule); checkpoint-commit rejected iterations.
- `[INTERNAL TEST]` convention on all test data; single shared prod DB.

| ID | Mission | Model | Effort | Size | Depends | Status |
|---|---|---|---|---|---|---|
| S1 | Phase 0: operators, roles, Punch Rack login, /ops/shop | **top-tier** (auth/schema) | high | M | â€” | pending |
| S2 | Phase 1: events+people substrate, backfills, dual-write | **top-tier** (data model) | high | M | S1 | pending |
| S3 | Phase 2a+2b: Twilio voice â€” forward, whisper, record, missed-call flow, Deepgram | **top-tier** (telephony/money path) | high | M | S2 | pending |
| S4 | Phase 2c: the Spike SMS UI, MMSâ†’Blob, auto-text-back, SMS-code sign-in | mid (Sonnet-class; UI from spec) | high | M | S3 + A2P approved | pending |
| S5 | Phase 3: gmail ingestion + QB PAID moment + envelope | mid | high | M | S2 (not S3/S4 â€” gap-filler while A2P pends) | pending |
| S6 | Phase 4a: extraction pipeline (claims, commitments, churn, quote capture) | **top-tier**, **xhigh** (prompt quality is the product) | xhigh | L | S3 or S5 (needs a text feed) | pending |
| S7 | Phase 4b: Promise Rack UI + Regulars' Rail + account page | mid (props from spec) | high | M | S6 | pending |
| S8 | Phase 5: the Handset â€” ask tool-loop + printed-slip UI + hold-to-talk | **top-tier**, xhigh | xhigh | L | S6 | pending |
| S9 | Phase 6: notify gate + 3-budget, the Wire, Radio brief (textâ†’TTS) | mid | high | M | S6 (brief needs commitments) | pending |
| S10 | Phase 7: GLASS clipboard page + corrections + review card | **top-tier** (customer-facing design + token security) | xhigh | L | S4 (SMS delivery), S6 (promises) | pending |
| S11 | Phase 8 + closeout: DONE-stamp voice flow, SPEAK readback, health checks, CLAUDE.md invariants, memory | mid | medium | S | S8, S9 | pending |
| S12 | Exit verification: run PART D end-to-end, real call + real QB email + crew-role sweep, tick checklist | mid | medium | S | all | pending |

**Recommended order:** S1 â†’ S2 â†’ S3 â†’ (S5 fills the A2P wait) â†’ S4 â†’ S6 â†’ S7 â†’ S8 â†’ S9 â†’ S10 â†’ S11 â†’ S12.
**Top-tier spend concentrated in:** S1-S3 (auth/schema/telephony foundations), S6 (extraction prompts), S8 (handset), S10 (GLASS) â€” everything else executes from spec on mid-tier. Inside every session: cheap subagents for code-location, mechanical edits, running migrations/tests, closing notes; main model keeps judgment work.

### Per-session boundaries + paste-ready prompts

**S1** â€” Scope: Part A5 whole (operators table+seed, ops_tokens.operator_id, auth object, actor attribution, /ops/shop, Punch Rack UI, crew money redaction). Not-touched: events/people tables, any Twilio/gmail/AI. Routing: top-tier main; explorer subagent maps auth call sites first.
> S1 of SESSION-PLAN (plan: this-is-a-plan-federated-rabbit.md). Implement Phase 0 / Part A5 only: multi-operator auth + Punch Rack + /ops/shop. Do not touch substrate/Twilio/gmail/AI. Present your implementation plan for sign-off before code. Exit: crew email login works, roles enforced, bylines on timeline, migrate idempotentÃ—2.

**S2** â€” Scope: A1 (events, people, claims/commitments TABLES ONLY â€” no extraction), backfills, intake dual-write, repeat badge. Not-touched: UI beyond the badge, AI. Routing: top-tier; mechanic subagent for dual-write call-site edits.
> S2: Phase 1 / Part A1. Substrate tables + lib/events.ts + lib/people.ts + backfills + dual-write from all intake paths + "Repeat â€” N jobs" badge. No AI, no new UI otherwise. Plan sign-off before code. Exit: backfills rerunnable, /ops visually unchanged except badge.

**S3** â€” Scope: A2 voice half (lib/twilio.ts signature validation, voice/voice-status/recording/transcript routes, Deepgram, whisper, interrupt notify stub via existing push). Not-touched: SMS UI, notify budget (stub direct push). Routing: top-tier (security-sensitive webhooks).
> S3: Phase 2a+2b / Part A2 voice only. Number is bought, A2P filed. Voice forward+whisper+recording+Deepgram transcriptâ†’events, missed-call handling (text-back stub logs until A2P). Plan sign-off before code. Exit: real test call recorded + transcribed into events; unsigned webhook rejected.

**S4** â€” Scope: A2 SMS half + B Spike props (memo slips, carbons, cassettes, reply bar w/ mic+chips, channel stamp), MMSâ†’Blob, SMS-code sign-in. Not-touched: email letters (S5), extraction. Routing: mid; owner reviews props at localhost.
> S4: Phase 2c. Two-way SMS in Spike props per Part B spec, MMSâ†’Blob, auto-text-back live, SMS-code sign-in. Match Shop Wall CSS language exactly; owner reviews live. Exit: full text conversation from work order; photo in â†’ polaroid.

**S5** â€” Scope: A3 whole + PAID moment + envelope + COI slip + folded-letter Spike rendering. Not-touched: extraction (events recorded, processed later). Routing: mid; QB parser is regex, no AI.
> S5: Phase 3 / Part A3. Gmail internal-OAuth ingestion, QB payment parser â†’ PAID moment (self-slam stamp, bell, odometer, green slip), email letters on Spike, manila envelope, COI expiry slip. Exit: test QB-format email marks invoice paid end-to-end.

**S6** â€” Scope: A4 extraction (lib/ai.ts, lib/extract.ts, zod schema, churn, quote capture, retry sweep, YEP/NAH data paths). Not-touched: Rack/Rail UI (S7). Routing: top-tier xhigh â€” prompt+schema quality is the product; verifier subagent runs fixture suite (incl. real Real Floors auto-reply text).
> S6: Phase 4a / Part A4 extraction. claims+commitments live, haiku pipeline over all text events, churn + quote capture, retry sweep, confirm/reject actions. Plan + prompt drafts for sign-off before code. Exit: promises auto-extracted from a real transcript fixture; churn fires on Real Floors auto-reply fixture; no dupes on re-run.

**S7** â€” Scope: B Promise Rack + Regulars' Rail + /ops/accounts/[id] props. Not-touched: extraction logic. Routing: mid.
> S7: Phase 4b UI. Tag rail (pencil/ink, DUE, crooked overdue, hole-punch, HANDLE IT), Regulars' Rail dog-tags, account clipboard page per Part B. Owner reviews live. Exit: real extracted promise hangs, punches, pushes with customer text offer.

**S8** â€” Scope: A4a ask endpoint + tools + B Handset (hold-to-talk MediaRecorderâ†’Deepgram, printed slip stream, stapled receipts, SPEAK switch stub). Routing: top-tier xhigh.
> S8: Phase 5. /api/ops/ask agentic tool-loop with receipts contract + Handset UI per spec. Plan sign-off before code. Exit: spoken "where's the [test] job" â†’ printed answer with working staple deep-links; unanswerable â†’ honest "I don't know".

**S9** â€” Scope: A6 notify gate + budget + Wire strip + Radio/day-sheet + brief cron + TTS. Not-touched: handset. Routing: mid.
> S9: Phase 6. lib/notify.ts single gate, 3-interrupt budget + coalesce, quiet hours, Wire per-operator diff with slip stocks, 6:30a brief (SQL gather â†’ sonnet script â†’ push, TTS audio in Radio). Exit: 4th interrupt coalesces; Wire diffs per login; brief plays.

**S10** â€” Scope: A/B GLASS whole (glass_links, /j/[token], shared-photo flag + token photo proxy, share-via-SMS, corrections, review card, commercial variant). Routing: top-tier xhigh (public surface, token security, customer-facing design).
> S10: Phase 7 GLASS per Part B spec. Plan + visual direction sign-off before code. Exit: minted link shows correct scope logged-out; revoke kills; correction â†’ interrupt; nothing internal leaks (verify with view-source).

**S11** â€” Scope: DONE-stamp voice flow, voice notes everywhere, SPEAK readback live, health checks for twilio/gmail/ai config, CLAUDE.md anti-surveillance + append-only invariants, project memory update. Routing: mid.
> S11: Phase 8 + closeout. DONE stamp â†’ "say what you did" â†’ slip/tag/GLASS-draft/Wire per spec; health extended; invariants documented. Exit: one voice note produces all four artifacts; /api/health green.

**S12** â€” Scope: PART D verification sweep only; fix nothing big â€” file issues back into this plan. Routing: mid; verifier subagents run checks in parallel.
> S12: Exit verification. Execute PART D checklist end-to-end with real call, real QB-format email, crew-role sweep, GLASS incognito audit, budget coalesce test. Mark session rows done; report gaps as new plan items, don't fix in-session.
