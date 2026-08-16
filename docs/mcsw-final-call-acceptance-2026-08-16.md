# MCSW final call acceptance — August 16, 2026

Everything required before this call is saved, deployed, and documented. Google Ads must remain unchanged.

## Owner action — the only thing to do

1. From the phone ending `8197`, call `(615) 703-3296`.
2. Speak naturally for 20–30 seconds. Include one simple welding-job detail, such as: “I need a four-foot-wide steel gate with two rails and the hinges on the left.”
3. Let the shop phone ring and answer normally; confirm two-way audio.
4. Hang up.
5. Send the message `final call done` to Codex.

Do not create another quote, send another test email or SMS, change Vercel/Deepgram/Resend settings, or edit Google Ads.

## Codex verification after the owner reports completion

- Confirm the signed live-transcript callback returns bodyless HTTP `204` with no response-constructor error.
- Confirm the recording callback returns HTTP `200`.
- Confirm a post-call request appears in Deepgram project `a953c9b4-767e-4715-a0a6-4d63a82a2164`.
- Confirm the signed `/api/twilio/transcript` callback returns HTTP `200`, with any callback token redacted from evidence.
- Confirm AI extraction produces no unavailable-model or invalid-schema error under `google/gemini-2.5-flash-lite`.
- Recheck `/api/health`; it must remain green with no delivery or transcript backlog.
- Record the final result in `docs/call-sketch-production.md` and this file.

## State saved before the call

- Owner approvals: customer SMS enabled; Twilio line authorized for recorded/transcribed customer calls; `(615) 703-3296` and Call Sketch authorized and published on owned surfaces.
- Google Ads: unchanged; separate post-launch verification only.
- Shop tests passed: SMS, ringing, two-way audio, managed live transcription, drawing, owner confirmation, and DXF download.
- Resend: correct Music City Specialty Welding team; labeled internal quote delivered; signed webhook returned HTTP `200 - OK` in one attempt.
- Deepgram: correct Production project and credential configured; final post-call fallback receipt still pending this call.
- Callback hotfix: bodyless HTTP `204` deployed with a regression test.
- Production: deployment `dpl_FAvRXqSdYrEFGXLPF7QXshP3su86` is Ready and aliased to both public domains.
- Health: `shopBrain.ready=true`, `gateSatisfied=true`, launch gate passed, no reported delivery failures or transcript backlogs.

The post-call Deepgram fallback is not accepted until every Codex verification item above passes. This is the sole remaining launch acceptance item; it does not authorize a Google Ads cutover.
