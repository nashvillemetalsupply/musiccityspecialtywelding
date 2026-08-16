# Call Sketch production runbook

## What ships

Call Sketch is an owner-only, phone-first workspace embedded in an active inbound call draft in MCSW Jobs. Twilio starts a managed Real-Time Transcription session on both call tracks. Signed callbacks land at `/api/twilio/live-transcript`, where partial and final utterances are stored idempotently and converted into a conservative gate or rectangular-frame sketch.

The MCSW Jobs home screen also gives the owner a permanent **Call Sketch** launcher. It opens a clearly labeled practice workspace inside the installed app so the interaction can be rehearsed before provider activation. The practice workspace uses example data, stays in the browser, and never changes production calls or jobs.

The system distinguishes four fact states: unknown, uncertain, stated on the call, and owner-confirmed. It never promotes speech recognition output to confirmed geometry. DXF export remains locked until the owner reviews and confirms the relevant geometry: width, height, stock, and rails for a rectangular frame, plus hinge side and latch side for a gate. Frame exports never invent gate hardware.

The existing dual-track recording and post-call Deepgram route remain in place as a separate fallback. Call Sketch uses Twilio's managed `<Start><Transcription>` integration rather than maintaining a raw Media Streams WebSocket on Vercel. Twilio owns the live audio fork and sends near-real-time HTTPS callbacks; the application owns durable state, drawing, review, and export.

## Runtime switches

These production environment values are intentionally independent:

- `TWILIO_PHONE_NUMBER`: purchased E.164 shop number.
- `OWNER_CELL_PHONE`: private E.164 forwarding destination. Never use the public Twilio number here.
- `TWILIO_LIVE_TRANSCRIPTION_ENABLED=true`: starts Twilio Real-Time Transcription on Voice calls.
- `TWILIO_PUBLIC_NUMBER_ENABLED=true`: lets the site and structured data replace the established fallback number with the tested Twilio number.
- `CALL_SKETCH_PUBLIC_ENABLED=true`: publishes the homepage Call Sketch showcase after the phone path is proven.
- `TWILIO_SMS_ENABLED=true`: customer messaging is enabled after A2P registration, the real-device matrix, and owner approval.

The public phone, structured data, header, mobile action, contact section, and footer all resolve through `getShopPhone()`. Do not hand-edit phone strings on the homepage.

## Provider activation order

1. In Twilio Trust Hub, submit the Primary Customer Profile and wait for an **Approved** status. This is an owner identity/KYC action; automation must not accept its declarations or terms.
2. Search current inventory with `node scripts/search-twilio-numbers.mjs`. The hard preference is a 615 Lebanon number; a 615 Nashville number is the only fallback. Inventory cannot be reserved.
3. Purchase the selected Voice-capable local number. Keep SMS launch disabled.
4. Set the number's incoming Voice webhook to `https://musiccityspecialtywelding.com/api/twilio/voice` using `POST`.
5. Create a provider-hosted TwiML fallback that directly dials the private owner cell, then set that TwiML Bin URL as the number's Voice fallback. This keeps calls ringing through a full website/database outage.
6. Add `TWILIO_PHONE_NUMBER` and `OWNER_CELL_PHONE` as sensitive Production values in Vercel. Enable `TWILIO_LIVE_TRANSCRIPTION_ENABLED`, but leave both public launch switches off.
7. Deploy, then verify `/api/health`: number found, Voice-capable, webhook matched, provider-hosted fallback present, Voice ready, and live transcription configured.
8. With the owner's explicit test-call approval, place one designated internal test call. Prove configuration, Twilio transport, phone receipt, signed transcript callbacks, database utterances, live drawing, owner confirmation, and DXF download separately.
9. Enable `TWILIO_PUBLIC_NUMBER_ENABLED` and `CALL_SKETCH_PUBLIC_ENABLED`, deploy the exact pushed commit, and verify every public phone surface plus structured data.
10. In the exact **Music City Specialty Welding** Google Ads account, change only the call-forwarding destination to the verified Twilio number. Do not change campaign state, budgets, bidding, targeting, keywords, ads, assets, or conversion settings. Capture the account/customer ID and before/after destination. Google may display a Google forwarding number while routing calls to Twilio.

## Current activation state — 2026-08-15

- Twilio Primary Customer Profile `NCW LLC` is **Approved**. The verified legal business is Neverlift Chassis Works, LLC and the customer-facing Brand name is Music City Specialty Welding.
- Local Voice/SMS/MMS number `(615) 703-3296` is purchased. Its primary Voice webhook is the canonical `/api/twilio/voice` POST URL, and the provider-hosted `MCSW Voice Fallback` directly dials the established owner line during a website or database outage.
- Production has the shop number, private forwarding destination, and managed live transcription enabled. The canonical health check reports the number found, Voice-capable, webhook matched, provider-hosted fallback present, Voice ready, and live transcription configured.
- Twilio Verify service `MCSW Jobs Login` is ready (`VA022c092763e0ac4ef1730dd9d03f6c40`).
- Messaging Service `MCSW Job Updates` is ready (`MG7d1539f9d6d1a80e6a07912143c54138`). The purchased number is in its sender pool, its inbound webhook is `/api/twilio/sms`, and its outbound status callback is `/api/twilio/sms-status`. Advanced Opt-Out handles STOP, START, and HELP, but its state is not exposed by the automated readiness probe, so it remains a manual provider-console acceptance item.
- The EIN-based A2P Brand is **Approved**. The Low Volume Mixed Campaign is **Verified** (approved), and the specific shop number is **Registered** and assigned to the Campaign. `TWILIO_SMS_ENABLED=true`; the owner approved customer SMS after the real-device matrix passed.
- The in-shop acceptance session proved SMS, ringing, two-way audio, signed managed live-transcript callbacks, durable utterances, live drawing, owner confirmation, and DXF download. The owner approved recorded/transcribed customer calls.
- `TWILIO_PUBLIC_NUMBER_ENABLED=true` and `CALL_SKETCH_PUBLIC_ENABLED=true`. `(615) 703-3296` and the Call Sketch showcase are published on owned website/app surfaces.
- The post-call Deepgram fallback remains a separate acceptance seam. Deepgram Production project `a953c9b4-767e-4715-a0a6-4d63a82a2164` has its key and callback secret configured in Vercel; no key is recorded here.
- Resend is configured under the **Music City Specialty Welding** team at `sales@musiccityspecialtywelding.com`. A labeled internal quote notification was delivered, and its signed delivery webhook returned HTTP `200 - OK` in one attempt.
- The live transcript success path now returns a bodyless `new Response(null, { status: 204 })`; `scripts/call-sketch-integration.test.mjs` contains the regression test.
- `AI_EXTRACTION_MODEL=google/gemini-2.5-flash-lite` in Production. This replaced an OpenAI model that rejected the extractor's flexible JSON schema.
- Production deployment `dpl_FAvRXqSdYrEFGXLPF7QXshP3su86` (`music-city-speciality-welding-l1hbkx8h9.vercel.app`) is Ready and aliased to `musiccityspecialtywelding.com` and `www.musiccityspecialtywelding.com`.
- The final pre-call `/api/health` response reported `shopBrain.ready=true`, `gateSatisfied=true`, no delivery failures or transcript backlogs, and a passed launch gate. `SHOP_BRAIN_REQUIRED` intentionally remains false.
- Google Ads remains unchanged pending separate post-launch verification. Do not change campaign state, budgets, bidding, targeting, keywords, ads, assets, conversions, or the call destination during this acceptance.

## Final post-call acceptance — 2026-08-16

The owner's only remaining action is the short call in [`mcsw-final-call-acceptance-2026-08-16.md`](mcsw-final-call-acceptance-2026-08-16.md). After the owner reports `final call done`, technical closeout must verify all five receipts before declaring the post-call fallback complete:

1. `/api/twilio/live-transcript` returns bodyless HTTP `204` with no `Invalid response status code 204` error.
2. `/api/twilio/recording` returns HTTP `200`.
3. Deepgram project usage records the asynchronous transcription request.
4. `/api/twilio/transcript` returns HTTP `200`; redact its callback token from any captured log.
5. AI extraction records no unavailable-model or invalid-schema error.

## Data and privacy

- Twilio webhooks are rejected unless the provider signature matches the canonical callback URL.
- Raw transcript and Call Sketch APIs require an authenticated owner session. Crew access is denied.
- Partial/final utterances are keyed by transcription session, sequence, and track so provider retries converge without duplicating facts.
- Sketch rebuilds are sequence-guarded, so callbacks delivered out of order cannot roll a newer drawing backward. Parsing is bounded to the 400 most recent final utterances plus the current partial on each track.
- The raw final transcript is owner data. It follows the existing `call.transcript` extraction path before any crew-safe transcript is stored; raw call text is never copied directly into `crew_transcript`.
- Customer call language is never rendered on the public site.
- The spoken call notice remains in the Voice flow. Real-Time Transcription is an AI/ML feature subject to Twilio's applicable addendum; owner review of provider terms and recording/transcription obligations remains required.
- The exported R12 ASCII DXF is labeled as a concept sketch and is not an approved fabrication drawing.

## Verification commands

```powershell
npm run lint
npm run typecheck
npm run test:shop-brain
npm run build
npm run migrate
```

Production closeout also records the commit SHA, deployment ID, canonical health response, and the provider/phone receipt when activation is no longer blocked.
