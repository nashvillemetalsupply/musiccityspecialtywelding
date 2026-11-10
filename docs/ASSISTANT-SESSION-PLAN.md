# Shop Assistant session plan

Rules: one row = one fresh chat or one Codex exec = one bounded mission. Code runs on Codex exec
(`gpt-6.1-sol`, xhigh) from the task worktree, and the Claude session reviews and merges. One session at a time.
Tests run under node 22 (`C:/Users/Owner/AppData/Local/hermes/node/node.exe --experimental-strip-types --test`).

| ID | Mission | Model | Effort | Size | Depends | Status |
|---|---|---|---|---|---|---|
| A1 | Brain and chat door: `lib/assistant` (knowledge from service pages, turn handling, lead capture through job-intake, persist-first), `POST /api/assist` (rate limit, is_test), chat widget behind `NEXT_PUBLIC_ASSISTANT_CHAT` (off), tests | Codex gpt-6.1-sol | xhigh | L | none | built 11-10, f66dd62, flag off |
| A2 | Phone door: signed `/api/twilio/assist-voice` Gather/Say loop on the same brain, reached only from no-answer/after-hours when `ASSISTANT_VOICE` is on, "person" dials the shop, recording disclosure, fixture tests | Codex gpt-6.1-sol | xhigh | M | A1 | built 11-10, 244f0f9; missed-call alert fix 2889102, flag off |
| A3 | Photos and callback: SMS upload link onto the lead, callback-window capture on the lead, tests | Codex gpt-6.1-sol | high | M | A1 | built 11-10, b539497, flag off |
| A3b | Never leave the customer hanging: call/email/callback fallbacks, partial-contact intake, durable handoff and idle transcripts, missed voice handoff text, replay/test suppression | Codex gpt-6.1-sol | xhigh | M | A1-A3 | built 11-10, 66aa66d, flag off |
| A4 | Preview deploy, scripted chat and voice runs on preview marked `[INTERNAL TEST]`, owner demo link, owner go-live docket row | Claude Opus 5.5 | medium | S | A1-A3b | done 11-10: live 8/8 PASS 74d8dcc (Claude Haiku, 0 outbound); preview https://music-city-speciality-welding-chty3sr1k.vercel.app chat flag on for that deploy only, preview chat read back; go-live waits on owner yes (Mirror docket) |
| A5 | Exit check: flags state as the owner ruled, live readback, plan rows ticked | Sonnet 5.5 | low | S | A4 | done 2026-11-10: prod 935a452, NEXT_PUBLIC_ASSISTANT_CHAT on, ASSISTANT_VOICE unset (off), live 2-turn readback answered |

Order: A1, then A2 and A3 (either order), then A3b, A4 and A5. Top-tier spend sits in A1 and A2 (Codex xhigh);
the Claude work is the review and the merge.

Going live is the owner's word (A4 files the row). The chat bubble and the call routing stay off until then.

## A2 local verification (11-10)

Implementation: `244f0f9`. No deployment, provider configuration, environment configuration,
schema changes, database migrations, or live calls were performed.

The first prompt says: "I'm an automated assistant for Music City Specialty Welding. Your answers
are saved for job notes. Say person or press zero at any time. What needs welding or repair?"
Gather does not start an audio recording; the existing voice route records only an answered Dial
leg. The assistant and fallback handoffs are unrecorded. Existing optional live transcription can
continue saving job notes. Carrier voicemail remains the existing fallback; there is no app voicemail recorder.

The following PowerShell selection matches every edited production basename and the session plan
in `scripts/`, then adds all assistant suites. There is no `tests/` directory. Result: **805 passed,
0 failed, 0 skipped across 80 files**, including A1 and the 24 new phone tests. These use local
fixtures, with no live provider or database access.

```powershell
$changedNames = @('route.ts','service.ts','store.ts','turn.ts','voice.ts','voice-store.ts','job-intake.ts','ASSISTANT-SESSION-PLAN.md')
$patterns = $changedNames | ForEach-Object { '-e'; $_ }
$matched = @(rg -l -F @patterns scripts -g '*.test.mjs')
$a1 = @(rg --files scripts -g 'assistant-*.test.mjs')
$testFiles = @($matched + $a1 | Sort-Object -Unique)
& 'C:/Users/Owner/AppData/Local/hermes/node/node.exe' --experimental-strip-types --test --test-concurrency=4 @testFiles
```

Both checks below passed with exit code zero:

```powershell
npx tsc --noEmit
npx eslint app/api/twilio/assist-voice/route.ts app/api/twilio/voice-status/route.ts lib/assistant/service.ts lib/assistant/store.ts lib/assistant/turn.ts lib/assistant/voice.ts lib/assistant/voice-store.ts lib/job-intake.ts scripts/assistant-brain.test.mjs scripts/assistant-voice.test.mjs scripts/assistant-voice-wiring.test.mjs
```

## A3 local verification (11-10)

Implementation: `b539497`. A2 correction: `2889102` preserves the missed-call event and crew
notification before the assistant redirect; only the customer auto-reply is skipped. Regression
fixtures also verify unchanged flag-off TwiML and SMS, test suppression, and retry identity.

Chat and voice reuse the existing `/j/[token]` Customer Page and private Blob upload flow. The
per-lead link uses the existing signed token, expiry, upload size/type limits, and lead attachment
path; it grants no access to ops pages. The photo SMS uses `sendSmsPersisted` with one durable
`assistant-photo:<leadId>` key per lead, including retries. Test leads never receive it. Existing
SMS configuration, customer consent, and Glass secret gates still apply: unconfigured SMS,
unknown or revoked consent, or a missing Glass secret sends no link. No new environment
requirement was added.

`callback_window` is extracted from customer evidence separately from job timing and stripped
of money before persistence. Initial intake includes it in the lead message; later details update
the labelled callback line in `notes` and `crew_notes`, using the existing ops notes surfaces.

The existing `ASSISTANT_VOICE` and `NEXT_PUBLIC_ASSISTANT_CHAT` flags remain off by default;
no production environment state was changed or claimed to have been checked. No deployment,
push, provider configuration, environment configuration, schema change, migration, database
operation, or live call/SMS/upload was performed. Verification used local fixtures only.

The required basename selection below matched **80 test files: 799 passed, 0 failed, 0 skipped**.
It includes every existing script test naming an edited file and all assistant suites.

```powershell
$changedNames = @('route.ts','service.ts','turn.ts','voice-store.ts','followup.ts','glass.ts','job-intake.ts','assistant-api.test.mjs','assistant-brain.test.mjs','assistant-followup.test.mjs','assistant-voice-wiring.test.mjs','ASSISTANT-SESSION-PLAN.md')
$patterns = $changedNames | ForEach-Object { '-e'; $_ }
$matched = @(rg -l -F @patterns scripts -g '*.test.mjs')
$assistant = @(rg --files scripts -g 'assistant-*.test.mjs')
$testFiles = @($matched + $assistant | Sort-Object -Unique)
& 'C:/Users/Owner/AppData/Local/hermes/node/node.exe' --experimental-strip-types --test --test-concurrency=4 @testFiles
```

Both checks below passed with exit code zero:

```powershell
npx tsc --noEmit
npx eslint app/api/assist/route.ts app/api/twilio/voice-status/route.ts lib/assistant/followup.ts lib/assistant/service.ts lib/assistant/turn.ts lib/assistant/voice-store.ts lib/glass.ts lib/job-intake.ts scripts/assistant-api.test.mjs scripts/assistant-brain.test.mjs scripts/assistant-followup.test.mjs scripts/assistant-voice-wiring.test.mjs
```

The final followup-suite recheck also passed: **12 passed, 0 failed**.

```powershell
& 'C:/Users/Owner/AppData/Local/hermes/node/node.exe' --experimental-strip-types --test scripts/assistant-followup.test.mjs
```

## A3b local verification (11-10)

Implementation: `66aa66d`. Both existing flags remain off by default. No environment state
was changed or claimed to have been checked in production.

Human requests, unknown price/date/capability answers, model failures, throttling and server errors
offer the public shop phone first, the existing callback fields/form second, and
`Sales@musiccityspecialtywelding.com` third. The static browser fallback needs no API response,
preserves pending retry identity, and links to the existing `/#contact` form.

Handoffs persist an immutable transcript request before intake, notification or email. Full,
money-stripped transcripts go directly to Sales@ using the existing Resend credentials and
`email-provider-truth` adapter in `lib/notify.ts`; notification bodies remain bounded and link to
the journal/lead. The durable email claim is per session and reason. Replays, including ambiguous
provider outcomes, do not resend. Missing email configuration leaves the request recoverable.
Phone-only or email-only contact files through existing job intake with an explicit partial marker;
later evidenced contact fills only missing/placeholder contact fields on that lead.

The existing recovery sweep handles idle chat contact after 15 minutes, with a session lease and
independent item failures. Rate-limited requests save their transcript for bounded recovery instead
of bypassing the request budget for immediate provider work. Completion receipts keep notification
projection recoverable independently of email acceptance.

Voice still immediately dials the shop for person/zero/unknown answers and preserves `/fallback`.
Its signed missed-handoff callback uses `sendSmsPersisted` with one `assistant-no-answer:<CallSid>`
key, retaining existing SMS configuration, consent and quiet-hours gates. Transcript and SMS legs
are independent. Call, session, turn, lead and person test markers suppress all outbound work.
The existing missed-call crew alert regression remains covered.

Changed production files:

- `app/api/assist/route.ts`, `app/api/twilio/assist-voice/route.ts`
- `components/assistant-chat.tsx`
- `lib/assistant/contact.ts`, `lib/assistant/handoff.ts`, `lib/assistant/followup.ts`
- `lib/assistant/service.ts`, `lib/assistant/turn.ts`, `lib/assistant/voice-store.ts`
- `lib/job-intake.ts`, `lib/notify.ts`, `lib/recovery-sweep.ts`

Eight changed test suites: `scripts/assistant-api.test.mjs`, `scripts/assistant-brain.test.mjs`,
`scripts/assistant-email.test.mjs`, `scripts/assistant-followup.test.mjs`,
`scripts/assistant-handoff.test.mjs`, `scripts/assistant-voice.test.mjs`,
`scripts/assistant-voice-wiring.test.mjs`, and `scripts/assistant-widget.test.mjs`.
This session plan is the only documentation change.

The required basename selection matched **82 files: 850 passed, 0 failed, 0 skipped**.
All tests used local fixtures. Node worker spawning required sandbox escalation; no live database,
provider, call, SMS or email was used.

```powershell
$a3bNames = @('route.ts','assistant-chat.tsx','ASSISTANT-SESSION-PLAN.md',
  'contact.ts','handoff.ts','followup.ts','service.ts','turn.ts','voice-store.ts',
  'job-intake.ts','notify.ts','recovery-sweep.ts',
  'assistant-api.test.mjs','assistant-brain.test.mjs','assistant-email.test.mjs',
  'assistant-followup.test.mjs','assistant-handoff.test.mjs','assistant-voice.test.mjs',
  'assistant-voice-wiring.test.mjs','assistant-widget.test.mjs')
$a3bPatterns = $a3bNames | ForEach-Object { '-e'; $_ }
$a3bMatched = @(rg -l -F @a3bPatterns scripts -g '*.test.mjs')
$a3bAssistant = @(rg --files scripts -g 'assistant-*.test.mjs')
$a3bTests = @($a3bMatched + $a3bAssistant | Sort-Object -Unique)
& 'C:/Users/Owner/AppData/Local/hermes/node/node.exe' --experimental-strip-types --test --test-concurrency=4 @a3bTests
```

Both checks passed with exit code zero:

```powershell
npx tsc --noEmit
$a3bCode = @('app/api/assist/route.ts','app/api/twilio/assist-voice/route.ts',
  'components/assistant-chat.tsx',
  'lib/assistant/contact.ts','lib/assistant/handoff.ts','lib/assistant/followup.ts',
  'lib/assistant/service.ts','lib/assistant/turn.ts','lib/assistant/voice-store.ts',
  'lib/job-intake.ts','lib/notify.ts','lib/recovery-sweep.ts',
  'scripts/assistant-api.test.mjs','scripts/assistant-brain.test.mjs',
  'scripts/assistant-email.test.mjs','scripts/assistant-followup.test.mjs',
  'scripts/assistant-handoff.test.mjs','scripts/assistant-voice.test.mjs',
  'scripts/assistant-voice-wiring.test.mjs','scripts/assistant-widget.test.mjs')
npx eslint @a3bCode
```

No deployment, push, environment change, Twilio configuration, dependency, schema change, live
column change, migration or database operation was performed. Live provider verification remains
for the authorized preview/go-live sessions; A3b verification is local only.

## A4 harness verification (11-10)

Implementation: `60c3808`. This session's authorized deliverable is an in-process harness:
`scripts/assistant-a4-run.mjs`, its dry SQL/model fixture, regression tests, and
`docs/ASSISTANT-A4-RUNS.md`. **Live run pending.** The owner has already applied the additive
assistant-session migration to the shared Neon database; this session ran no migration.

The harness loads the operator's env file from `process.argv[2]`, enables both assistant flags
only in its own process, and imports the real chat and voice POST handlers using the test suites'
TS transpilation/import-hook approach. Live mode uses the real database, model, intake, people,
events, store and handoff paths. Outbound notify/email/SMS modules are spies in both modes;
unexpected fetch destinations and redirects are blocked. Twilio signatures are generated locally,
and returned Dial instructions are inspected without placing a call.

All inbound customer text is marked `[INTERNAL TEST]`. The report contains verbatim assistant
replies with required privacy redactions, lead/handoff results, and per-script PASS/FAIL. Only the
current email-only test session is aged and passed to scoped idle recovery. Replay resubmits the
original session/turn identities and checks unchanged lead, turn, journal and model-call counts.

Dry verification exposed and fixed first-reply disclosure being lost on handoffs, test handoff
evidence/partial intake being skipped, and signed internal-test CallSids being rejected. Test
handoffs now persist their reason and test lead while returning before any delivery. Existing
real linked leads cannot be relabelled by a new test marker. Default recovery still excludes
test sessions; an explicit session ID scopes both recovery selections.

Results: **8/8 dry scripts passed**, **130 tests passed, 0 failed, 0 skipped across 9 assistant
suites**. This includes negative probes that attempt notify/email/SMS and unexpected network
traffic, verify nonzero exit, and confirm provider diagnostic text is withheld. TypeScript and
ESLint on all 13 changed code/test files passed. The fixture report records zero outbound attempts.
The Node test runner needed sandbox escalation for local worker subprocesses. Verification made
no live DB/model/provider request, deployment, push, persistent environment change or migration.

```powershell
$assistantA4Node = 'C:/Users/Owner/AppData/Local/hermes/node/node.exe'
& $assistantA4Node --experimental-strip-types scripts/assistant-a4-run.mjs --dry
$assistantA4Tests = @(rg --files scripts -g 'assistant-*.test.mjs')
& $assistantA4Node --experimental-strip-types --test --test-concurrency=4 @assistantA4Tests
npx tsc --noEmit
$assistantA4Code = @('app/api/twilio/assist-voice/route.ts',
  'lib/assistant/handoff.ts','lib/assistant/service.ts','lib/assistant/turn.ts','lib/job-intake.ts',
  'scripts/assistant-a4-run.mjs','scripts/assistant-a4-fixture.mjs','scripts/assistant-a4.test.mjs',
  'scripts/assistant-api.test.mjs','scripts/assistant-brain.test.mjs',
  'scripts/assistant-handoff.test.mjs','scripts/assistant-voice-wiring.test.mjs',
  'scripts/assistant-voice.test.mjs')
npx eslint @assistantA4Code
```

The operator runs this exact live-mode command, supplying the env-file path at the local prompt:

```powershell
& 'C:/Users/Owner/AppData/Local/hermes/node/node.exe' --experimental-strip-types 'C:/Users/Owner/Desktop/MCSW-assist/scripts/assistant-a4-run.mjs' (Read-Host 'Absolute env-file path without quotes')
```

Live mode writes test records to the shared database and replaces `docs/ASSISTANT-A4-RUNS.md`
with its actual live transcripts/results. It exits zero only when all eight scripts pass and no
outbound sender or unexpected diagnostic was observed. The report's DRY/LIVE label distinguishes
fixture verification from the pending operator run; production go-live remains the owner's ruling.
