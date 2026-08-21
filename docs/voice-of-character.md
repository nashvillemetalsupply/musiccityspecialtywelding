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

## Next

1. **Grow the corpus.** Eight lines is the floor, not a target. Press *Learn from
   every call* once to sweep history, then paste in anything he has written that
   sounds like him.
2. **Convert the copy.** Website, ads, and email templates are hand-written today
   and nothing AI-drafts customer copy yet. Converting them is a separate pass:
   read the current copy, redraft it through `ownerVoiceGuide()`, and have him
   approve each page — his voice is the input to a rewrite, never an excuse to
   ship one unread.
3. **An AI that answers the phone** is a further step and needs two things this
   does not have: an audio clone of his actual voice, built from call recordings
   with his explicit say-so, and a disclosure to the caller that they are talking
   to a machine. What ships today is his *language*, read by a stock speech
   voice.
