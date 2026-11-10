# Shop Assistant plan (owner 2026-11-10)

Owner: "https://besttruckparking.com/ it looks like this company fully built out this chatbot. id like to
do something very similar to our services, starting with welding. an automated chat/voice bot ? its
called Aria on the site. get codex on the job. make it 10x then theirs."

## What theirs does (read 2026-11-10, homepage and /for-drivers)

Aria: an "Ask Aria" chat bubble on the site, a voice copilot in their app, and a phone line
("Book by phone in under a minute"). The pages do not say what it handles, when it hands to a person,
or whether calls are recorded.

## What ours does (the 10x)

One brain, two doors (site chat and phone), built on what this repo already has:

1. **Knows the shop.** Answers from the repo's own service and service-area pages and BRAND-BRIEF.md only.
   It never invents a capability, price, or date. It gives no prices; a quote is the owner's call.
2. **Turns a question into a job.** It collects name, callback number, what needs welding, material and size,
   where, and when. The result lands as a real lead in the CRM through the existing intake path
   (`lib/job-intake`), so the board and brief see it like any call.
3. **Photos.** It sends an upload link so the customer can send a picture of the broken part. The crew
   sees the photo on the lead.
4. **A person is always one step away.** "Call precedes Text": chat offers tap-to-call at every step.
   On the phone, "talk to a person" dials the shop at once.
5. **Honest about being automated.** It says so in its first line on both doors. The phone door also
   discloses recording before anything is recorded.
6. **Answers 24/7, where theirs is silent.** The phone door is used only when the shop does not answer
   (no-answer or after hours), never in place of a ringing shop line.
7. **Leaves a record.** Every turn is persisted before the model call (repo invariant). `is_test` survives
   every path. A one-line summary goes on the lead.

## Hard rules

- Repo invariants in CLAUDE.md bind: casts, persist-first, idempotent by external ID, signed Twilio only,
  no money to crew, no worker surveillance.
- Models: through `lib/ai` only, using the direct Anthropic Claude Messages API with `ANTHROPIC_API_KEY`.
- Goes live only on the owner's word. Both doors ship behind flags that are off by default. Turning on
  the chat widget or routing a real call is a docket row in Mirror `iris/docket.json` with hand owner.
- No new vendor account. Voice is Twilio `<Gather input="speech">` plus `<Say>` on the existing number.

## Sessions

See [ASSISTANT-SESSION-PLAN.md](ASSISTANT-SESSION-PLAN.md).
