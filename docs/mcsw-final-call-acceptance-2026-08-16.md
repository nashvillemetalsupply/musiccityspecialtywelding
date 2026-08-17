# MCSW final call acceptance — August 16, 2026

Status: **complete**. The owner placed the final acceptance call on August 16, 2026, technical verification passed, and primary production acceptance is closed. **No further owner action is required.**

## Verified call evidence

- The final inbound call started `2026-08-16T22:13:24.882Z` from the caller ending `8197` to `(615) 703-3296`, completed with duration 42 seconds.
- Many signed `/api/twilio/live-transcript` callbacks returned bodyless HTTP `204` with no response-constructor error.
- The `/api/twilio/recording` callback returned HTTP `200`.
- Durable recording and transcript events exist for the call; `transcript_status=ready` with no transcript error.
- The Twilio-live-transcription event processed at `2026-08-16T22:14:24Z`: `extraction_status=done`, `attempts=0`, no extraction error, and an extraction result present under `google/gemini-2.5-flash-lite`.
- `/api/health` remained green with no delivery or transcript backlog.

## Why no Deepgram request appears (corrected checklist)

The earlier checklist expected a post-call request in Deepgram project usage and Vercel. That expectation was wrong for a successfully live-transcribed call: the recording route preserves an already-ready live transcript, and `submitCallRecording` only claims calls that are queued, failed, or stale. On this call the post-call Deepgram path was intentionally suppressed to avoid duplicating an already-ready transcript. **A Deepgram request is not expected on a successful live-transcribed call**; its absence is duplicate suppression, not a provider failure.

Corrected post-call expectations, all verified:

1. Signed `/api/twilio/live-transcript` callbacks return bodyless HTTP `204` with no response-constructor error — verified.
2. The `/api/twilio/recording` callback returns HTTP `200` — verified.
3. No post-call Deepgram request is expected when the live transcript is already ready — verified (intentional duplicate suppression).
4. AI extraction records no unavailable-model or invalid-schema error — verified (`extraction_status=done`, `attempts=0`, result present under `google/gemini-2.5-flash-lite`).
5. `/api/health` remains green with no delivery or transcript backlog — verified.

## Known limitation (not a launch blocker)

The post-call Deepgram fallback is configured and covered by recovery tests, but it was not force-exercised against the live provider: this call's live transcript was already ready, so the fallback was intentionally suppressed. A future controlled failure-injection drill that forces a queued/failed/stale transcript state to exercise the fallback end-to-end would be separate work and is **not** a launch blocker.

## Unchanged

- Google Ads remains unchanged; it stays separate pending post-launch verification. Do not change campaign state, budgets, bidding, targeting, keywords, ads, assets, conversions, or the call destination.
- `SHOP_BRAIN_REQUIRED` remains `false`.

## State accepted with this call

- Owner approvals: customer SMS enabled; Twilio line authorized for recorded/transcribed customer calls; `(615) 703-3296` and Call Sketch authorized and published on owned surfaces.
- Shop tests passed: SMS, ringing, two-way audio, managed live transcription, drawing, owner confirmation, and DXF download.
- Resend: correct Music City Specialty Welding team; labeled internal quote delivered; signed webhook returned HTTP `200 - OK` in one attempt.
- Deepgram: correct Production project and credential configured; this live-transcribed call was accepted without invoking the post-call fallback (see the limitation above).
- Callback hotfix: bodyless HTTP `204` deployed with a regression test.
- Production: deployment `dpl_FAvRXqSdYrEFGXLPF7QXshP3su86` is Ready and aliased to both public domains.
- Health: `shopBrain.ready=true`, `gateSatisfied=true`, launch gate passed, no reported delivery failures or transcript backlogs.

This closes the sole remaining launch acceptance item. It does not authorize a Google Ads cutover.
