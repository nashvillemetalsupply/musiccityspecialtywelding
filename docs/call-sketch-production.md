# Call Sketch production runbook

## What ships

Call Sketch is an owner-only, phone-first workspace embedded in an active inbound call draft in MCSW Jobs. Twilio starts a managed Real-Time Transcription session on both call tracks. Signed callbacks land at `/api/twilio/live-transcript`, where partial and final utterances are stored idempotently and converted into a conservative gate or rectangular-frame sketch.

The system distinguishes four fact states: unknown, uncertain, stated on the call, and owner-confirmed. It never promotes speech recognition output to confirmed geometry. DXF export remains locked until the owner reviews and confirms the relevant geometry: width, height, stock, and rails for a rectangular frame, plus hinge side and latch side for a gate. Frame exports never invent gate hardware.

The existing dual-track recording and post-call Deepgram route remain in place as a separate fallback. Call Sketch uses Twilio's managed `<Start><Transcription>` integration rather than maintaining a raw Media Streams WebSocket on Vercel. Twilio owns the live audio fork and sends near-real-time HTTPS callbacks; the application owns durable state, drawing, review, and export.

## Runtime switches

These production environment values are intentionally independent:

- `TWILIO_PHONE_NUMBER`: purchased E.164 shop number.
- `OWNER_CELL_PHONE`: private E.164 forwarding destination. Never use the public Twilio number here.
- `TWILIO_LIVE_TRANSCRIPTION_ENABLED=true`: starts Twilio Real-Time Transcription on Voice calls.
- `TWILIO_PUBLIC_NUMBER_ENABLED=true`: lets the site and structured data replace the established fallback number with the tested Twilio number.
- `CALL_SKETCH_PUBLIC_ENABLED=true`: publishes the homepage Call Sketch showcase after the phone path is proven.
- `TWILIO_SMS_ENABLED`: leave `false` until messaging registration, consent, and sender configuration are separately approved.

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

## Current external blockers — 2026-08-11

- Twilio rejected local-number purchase with: `Primary compliance profile is not approved.` No number was purchased and no charge was made.
- The CRM does not currently contain one unambiguous private owner forwarding number. `OWNER_CELL_PHONE` must be supplied or deliberately saved before Voice can be activated.
- Because no tested Twilio line exists, the established public number and Google Ads forwarding destination must remain unchanged. The homepage Call Sketch showcase stays behind its launch gate.

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
