# Assistant A4 scripted runs

Mode: **LIVE — real model and shared Neon DB**.
Result: **8/8 PASS**. Live verification attempted in-process; see each script result.

Each inbound contains [INTERNAL TEST]. Outbound senders are blocked in both modes; returned Dial instructions are never submitted to Twilio.
Assistant replies below preserve returned text, with phone numbers other than 615-555-0100 and environment values redacted. OWNER_CELL_PHONE is ***.
The partial-email script advances only its own test session's idle timestamp and runs recovery scoped to that session. Replay seeds its own session and reuses its original turn indexes.
Run `node --experimental-strip-types scripts/assistant-a4-run.mjs .env.local --preflight` for environment names and a read-only DB check; preflight makes no model calls or file/database writes.
Sanitized failure details are also saved to `.tmp/a4-diagnostic.json` (gitignored).

## Environment check

Required variable names: DATABASE_URL, ANTHROPIC_API_KEY.
Missing/empty variable names: none.
lib/assistant/turn.ts uses lib/ai.ts jsonWithClaude: ANTHROPIC_API_KEY is present (supported assistant credential).

Gateway credential names present: VERCEL_OIDC_TOKEN; missing/empty: AI_GATEWAY_API_KEY.

lib/ai.ts also supports AI_GATEWAY_API_KEY / VERCEL_OIDC_TOKEN / VERCEL for gateway calls. Gateway/OIDC credentials are not required for A4 and cannot replace ANTHROPIC_API_KEY on the assistant path.

TWILIO_ACCOUNT_SID: stubbed for A4; outbound blocked

TWILIO_AUTH_TOKEN: stubbed for A4; outbound blocked

TWILIO_PHONE_NUMBER: stubbed for A4; outbound blocked

OWNER_CELL_PHONE: stubbed for A4; outbound blocked


## 1. Chat full lead: PASS

**Customer**

```text
[INTERNAL TEST] My name is A4 Test Customer.
```

**Assistant**

```text
I'm an automated assistant for Music City Specialty Welding. I'm Music City Specialty Welding's automated shop assistant, not a person. Thanks for reaching out. What metal work do you need help with?
```

**Customer**

```text
[INTERNAL TEST] My callback phone is 615-555-0100.
```

**Assistant**

```text
Thanks, I have your name and callback number. What metal work do you need help with?
```

**Customer**

```text
[INTERNAL TEST] I need you to repair a steel gate hinge.
```

**Assistant**

```text
Got it, a steel gate hinge repair. About how big is the gate, in feet or inches?
```

Lead/handoff: 1 lead; 0 handoffs.

## 2. Chat human: PASS

**Customer**

```text
[INTERNAL TEST] I want to talk to a person
```

**Assistant**

```text
I'm an automated assistant for Music City Specialty Welding. A person at the shop can help. [Call the shop at ***](tel:***). What callback number should the shop use? [Email Sales@musiccityspecialtywelding.com](mailto:Sales@musiccityspecialtywelding.com).
```

Lead/handoff: 0 leads; durable handoff reason: human.

## 3. Chat unknown: PASS

**Customer**

```text
[INTERNAL TEST] Can you repair a hafnium reactor pressure vessel certified for lunar vacuum?
```

**Assistant**

```text
I'm an automated assistant for Music City Specialty Welding. I cannot assess safety remotely; the damaged part needs inspection before towing, loading or use. What name should the shop use? [Call the shop at ***](tel:***). [Email Sales@musiccityspecialtywelding.com](mailto:Sales@musiccityspecialtywelding.com).
```

Lead/handoff: 0 leads; durable handoff reason: unknown.

## 4. Chat price: PASS

**Customer**

```text
[INTERNAL TEST] How much does a gate repair cost?
```

**Assistant**

```text
I'm an automated assistant for Music City Specialty Welding. A person at the shop can help. [Call the shop at ***](tel:***). What callback number should the shop use? [Email Sales@musiccityspecialtywelding.com](mailto:Sales@musiccityspecialtywelding.com).
```

Lead/handoff: 0 leads; durable handoff reason: unknown.

## 5. Chat email only then leaves: PASS

**Customer**

```text
[INTERNAL TEST] test@example.com
```

**Assistant**

```text
I'm an automated assistant for Music City Specialty Welding. I'm Music City Specialty Welding's automated shop assistant. What metal job can I help you with?
```

Lead/handoff: 1 partial lead with test@example.com; durable handoff reason: idle.

## 6. Chat full-lead replay: PASS

**Customer**

```text
[INTERNAL TEST] My name is A4 Test Customer.
```

**Assistant**

```text
I'm an automated assistant for Music City Specialty Welding. Hi, I'm Music City Specialty Welding's automated shop assistant, not a person. Thanks, A4 Test Customer. What metal job do you need help with?
```

**Customer**

```text
[INTERNAL TEST] My callback phone is 615-555-0100.
```

**Assistant**

```text
Thanks, A4 Test Customer. I have your callback number. What metal job do you need help with?
```

**Customer**

```text
[INTERNAL TEST] I need you to repair a steel gate hinge.
```

**Assistant**

```text
Got it. A steel gate hinge is metal work we can look at. About how big is the gate?
```

**Customer**

```text
[INTERNAL TEST] My name is A4 Test Customer.
```

**Assistant**

```text
I'm an automated assistant for Music City Specialty Welding. Hi, I'm Music City Specialty Welding's automated shop assistant, not a person. Thanks, A4 Test Customer. What metal job do you need help with?
```

**Customer**

```text
[INTERNAL TEST] My callback phone is 615-555-0100.
```

**Assistant**

```text
Thanks, A4 Test Customer. I have your callback number. What metal job do you need help with?
```

**Customer**

```text
[INTERNAL TEST] I need you to repair a steel gate hinge.
```

**Assistant**

```text
Got it. A steel gate hinge is metal work we can look at. About how big is the gate?
```

Lead/handoff: 0 new leads, turns, journal entries or model calls; original lead retained.

## 7. Voice human: PASS

**Customer**

```text
[INTERNAL TEST] Call connected; no speech yet.
```

**Assistant**

```text
I'm an automated assistant for Music City Specialty Welding. Your answers are saved for job notes. Say person or press zero at any time. What needs welding or repair?
```

**Assistant (no-input fallback)**

```text
I'll try the shop now.
```

**Customer**

```text
[INTERNAL TEST] I want to talk to a person
```

**Assistant**

```text
I'll try the shop now.
```

Lead/handoff: 1 partial lead; human handoff recorded; Dial OWNER_CELL_PHONE=***, action=/api/twilio/assist-voice?handoff=1 (not executed).

## 8. Voice normal intake: PASS

**Customer**

```text
[INTERNAL TEST] Call connected; no speech yet.
```

**Assistant**

```text
I'm an automated assistant for Music City Specialty Welding. Your answers are saved for job notes. Say person or press zero at any time. What needs welding or repair?
```

**Assistant (no-input fallback)**

```text
I'll try the shop now.
```

**Customer**

```text
[INTERNAL TEST] I need you to repair a steel gate hinge.
```

**Assistant**

```text
I'm an automated assistant for Music City Specialty Welding. What name should we put on this gate hinge repair request?
```

**Assistant (no-input fallback)**

```text
I'll try the shop now.
```

**Customer**

```text
[INTERNAL TEST] My name is A4 Test Customer.
```

**Assistant**

```text
Thanks, A4 Test Customer. What is the approximate size of the steel gate hinge?
```

**Assistant (no-input fallback)**

```text
I'll try the shop now.
```

Lead/handoff: 1 lead; verified caller number; call linked; assistant.voice receipt; no handoff.

Outbound attempts blocked: 0 (notify/SMS/email must each remain zero).
Model HTTP requests: 12.
Suppressed diagnostic messages: 0.

## Handoff regression live checks — 2026-11-10

The price-to-railing failure reproduced with `raw_model_handoff_reason=null`, `customerHandoff=null`, `unsupportedCapability=false`, `concern=null`, `currentRepairDetails=false`, and `assistantHandoffReason=unknown`: the reply guard selected `contact-handoff`. After the fix, the same decision trace selects `expert-claim-intake` with `continue_intake=true` and no price.

| Live scenario | Verified result |
| --- | --- |
| Unsupported ladder, then gate repair | `unknown-capability-intake` → `model-answer` |
| Person request, then cracked trailer | Human `contact-handoff` → `expert-safety-intake` |
| Price request, then railing details | Unknown `contact-handoff` → `expert-claim-intake`; no price |
| Trailer repair → Lebanon → Sam → reserved test phone | Four `expert-safety-intake` turns; final `lead_saved=true`; no price, work, or callback promises |

All four requested live scenarios passed. Final full live A4 passed **8/8** using **12** Claude HTTP requests. Total real Claude requests: **32** (10 baseline + 10 final scenario turns + 12 full A4), below the 40-call limit. Outbound attempts: **0**.

Full suite: **1,463 passed, 3 skipped, 0 failed**. TypeScript and ESLint passed; dry A4 passed **8/8**. Independent review found no remaining issues.
