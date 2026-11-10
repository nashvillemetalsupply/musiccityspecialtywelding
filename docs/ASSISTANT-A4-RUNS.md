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
I'm an automated assistant for Music City Specialty Welding. Hi, I'm Music City Specialty Welding's automated shop assistant. Thanks for reaching out, A4 Test Customer. What metal work do you need help with?
```

**Customer**

```text
[INTERNAL TEST] My callback phone is 615-555-0100.
```

**Assistant**

```text
Thanks, I have your callback number. What metal work do you need help with?
```

**Customer**

```text
[INTERNAL TEST] I need you to repair a steel gate hinge.
```

**Assistant**

```text
Thanks, I have the steel gate hinge repair and your callback number. What is the approximate size of the gate?
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
I'm an automated assistant for Music City Specialty Welding. Hi, I'm Music City Specialty Welding's automated shop assistant, not a person. What metal welding or repair do you need help with?
```

Lead/handoff: 1 partial lead with test@example.com; durable handoff reason: idle.

## 6. Chat full-lead replay: PASS

**Customer**

```text
[INTERNAL TEST] My name is A4 Test Customer.
```

**Assistant**

```text
I'm an automated assistant for Music City Specialty Welding. Hi, I'm the automated shop assistant for Music City Specialty Welding, not a person. What metal work do you need help with?
```

**Customer**

```text
[INTERNAL TEST] My callback phone is 615-555-0100.
```

**Assistant**

```text
I'm an automated shop assistant for Music City Specialty Welding, not a person. Thanks, I have your callback number. What metal work do you need help with?
```

**Customer**

```text
[INTERNAL TEST] I need you to repair a steel gate hinge.
```

**Assistant**

```text
Thanks, I have the steel gate hinge repair and your callback number. What is the approximate size of the gate?
```

**Customer**

```text
[INTERNAL TEST] My name is A4 Test Customer.
```

**Assistant**

```text
I'm an automated assistant for Music City Specialty Welding. Hi, I'm the automated shop assistant for Music City Specialty Welding, not a person. What metal work do you need help with?
```

**Customer**

```text
[INTERNAL TEST] My callback phone is 615-555-0100.
```

**Assistant**

```text
I'm an automated shop assistant for Music City Specialty Welding, not a person. Thanks, I have your callback number. What metal work do you need help with?
```

**Customer**

```text
[INTERNAL TEST] I need you to repair a steel gate hinge.
```

**Assistant**

```text
Thanks, I have the steel gate hinge repair and your callback number. What is the approximate size of the gate?
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
I'm an automated assistant for Music City Specialty Welding. I'm an automated shop assistant for Music City Specialty Welding. May I have your name?
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
Thanks, A4 Test Customer. About how big is the steel gate, and where is the hinge?
```

**Assistant (no-input fallback)**

```text
I'll try the shop now.
```

Lead/handoff: 1 lead; verified caller number; call linked; assistant.voice receipt; no handoff.

Outbound attempts blocked: 0 (notify/SMS/email must each remain zero).
Model HTTP requests: 12.
Suppressed diagnostic messages: 0.
