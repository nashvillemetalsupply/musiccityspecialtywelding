# Voice of character

The shop has one voice and it belongs to the owner. Everything the business
sends outward — a voicemail, a text, a quote email, a line on the website, an ad
headline — should read like the man who answers the phone. This is where that
voice is kept.

## What it is

Two tables and one derivation.

- `voice_samples` — the corpus. One row per line he said or wrote, keyed by
  where it came from (`source_kind`, `source_ref`, `sequence_id`), so the same
  call can be captured twice and land once. `is_test` rides every row and a
  flagged row never reaches the profile.
- `voice_profiles` — the derived profile for `speaker_key = 'owner'`: how he
  opens, how he signs off, the phrases he reuses, his habits, sentence length,
  question and contraction rates, and up to twelve verbatim sentences.
- `lib/voice-of-character.mjs` — the derivation. No model is called: it is a
  frequency count over real sentences, so it is cheap, exact, and reviewable.
  `voiceStyleGuide(profile)` renders the block a drafting prompt pastes in.

`ownerVoiceGuide()` in `lib/voice-of-character.ts` is the one function every
future drafting path should call. It returns an empty string until there are at
least eight of his own lines on record, and an empty string means **draft in the
plain shop voice** — never invent cadence and put his name on it.

## Where the words come from

| Source | How it lands |
| --- | --- |
| Calls | The shop's own track of every ended call, captured in `handleLiveTranscriptionEvent` right after the transcript receipt is written. |
| Voice and typed notes | Owner-authored `note.voice` / `note.text` events, swept by `backfillOwnerVoiceSamples()`. |
| Paste | `addManualVoiceSample()` — he pastes something he wrote and it is stored sentence by sentence. This is the fast way to make the corpus long. |

Outbound texts and emails are deliberately **not** swept. `sendSmsPersisted`
stamps an operator id on app-composed messages as well as typed ones, and the
email paths run through templates; feeding either back in would teach the
machine to imitate its own copy and call it his voice. Add them once a message
records whether a human typed it.

No crew voice is collected. One profile exists, it is the owner's, and it holds
language, never activity — a per-person language corpus is worker measurement
wearing a costume.

## Using it

- `GET /api/ops/voice` — owner only. Profile, per-source counts, and the guide.
- `POST /api/ops/voice` `{ action: "rebuild" }` — sweeps every call and note the
  shop already holds and rebuilds. Safe to run any number of times.
- `POST /api/ops/voice` `{ action: "add", text, label }` — paste his writing in.
- `POST /api/ops/voice/preview` — drafts one short piece of copy in his voice and
  returns it with mp3 audio. The scenario comes from a fixed list in the route,
  so the button cannot be turned into a way to make the shop say an arbitrary
  sentence under his name. Intent is recorded as a `voice.preview` event before
  either provider call.

The board shows the strip under the live call sketch: how many of his lines are
on record, **Learn from every call**, and **Hear it now**. The count going up
after a call is the point — the preview is drawn from whatever the corpus says
today, so it moves closer to him as the shop keeps working.

## Two layers, and only one of them evolves

Keeping these apart prevents the confusion that cost an afternoon.

- **The words** — the corpus above. It grows with every call, the profile
  rebuilds, and copy written in his name reads more like him each month. This is
  the layer that "moves closer" and the layer the website, ads and emails need.
- **The sound** — a voice clone. Static by nature: a timbre, not a skill. Cloned
  once and reused forever, and only re-done if the sample was poor. It matters
  for spoken output only: voicemail, a phone greeting, an AI answering the line.

## Who drafts the words

`draftWithDeepSeek` in `lib/ai.ts` is preferred whenever `DEEPSEEK_API_KEY` is
set, and the AI Gateway is the fallback. Two reasons: the gateway refuses every
paid model on the shop's plan — *"Free tier users do not have access to this
model"*, a 403 that produced three silent 500s before the error was surfaced —
and the shop already pays DeepSeek for a key it uses elsewhere. DeepSeek speaks
the OpenAI chat format, so one `fetch` reaches it: no provider package, no Vercel
credit, no second bill. `DEEPSEEK_MODEL` defaults to `deepseek-chat`.

The gateway stays the path for anything needing tools, streaming or structured
output — extraction, Ask Jobs and the morning brief still run through it, and
they are all still behind the same plan wall.

Speech degrades in three steps, and the board always says which one it got:

1. The gateway's speech model, when the plan allows it.
2. No provider — his newly drafted words, read by the browser's own voice,
   labelled as the browser's so a stock voice is never taken for a bought one.
3. No draft at all — one of his own recorded sentences, rotating.

## The clone

Made 2026-08-21 at Higgsfield from a 27-second mono 16 kHz voice memo.

```
voice_id   daa7e1dd-a8de-4638-8d9a-82abeb5a0968
voice_type element
name       Phil
```

It is **not wired into the app**, and cannot be as things stand:

- The MCP session that made it is an OAuth login, not a server credential.
- Higgsfield does issue server keys (`Authorization: Key ${HF_API_KEY_ID}:${HF_API_KEY_SECRET}`,
  from Higgsfield Cloud) and claims audio generation, but **no speech or voice
  endpoint appears anywhere in their documentation index**, and nothing states
  that a browser-made clone is addressable from a server key. Untested, not
  impossible.
- ElevenLabs is the dependable route for live cloned speech: documented TTS,
  server keys, voices addressable by id. The same 27-second file re-clones there.

Sample quality caveat: 16 kHz at 29 kbps is narrowband. The clone sounds like him
*over a phone* — fine for voicemail and phone answering, thin for a website
video. A clean 90-second recording would fix that without changing anything else.

## Open, for whoever picks this up

1. **Make *Hear it now* play his real voice.** Three routes: pre-render a dozen
   lines through the Higgsfield MCP session and rotate them (works today, no key,
   ~1 credit per line); an ElevenLabs key (live, reliable); or probe the
   Higgsfield Cloud API to see whether the clone is reachable server-side (~20
   minutes, may be a dead end). The fallback chain is already built, so any of
   them is a small change at one call site.
2. **Grow the corpus.** Eight lines is the floor, not a target. 301 lines across
   23 calls and notes as of 2026-08-21. Pasting in anything he has written is the
   fastest way to lengthen it.
3. **Convert the copy.** Website, ads and email templates are hand-written and
   nothing AI-drafts customer copy yet. That pass is: read the current copy,
   redraft through `ownerVoiceGuide()`, and have him approve each page — his
   voice is the input to a rewrite, never an excuse to ship one unread.
4. **An AI that answers the phone** needs the clone wired, plus a disclosure to
   the caller that they are talking to a machine. Call recordings are already
   dual-channel (`record-from-answer-dual`), so his audio is separable if a
   better training sample is ever wanted.
