# MCSW Jobs · production setup

The additive `/ops` system includes identity, immutable event/claim provenance, repeat customers, Twilio voice/SMS/MMS, Gmail and QuickBooks ingestion, promises, Ask Jobs, Morning Brief, per-operator Updates, Customer Pages, private customer uploads, and atomic job completion.

## Database

Run each additive migration safely, then the resumable backfills:

```powershell
npm run migrate
npm run migrate
node scripts/backfill-people.mjs
node scripts/backfill-events.mjs
node scripts/reconcile-placeholder-people.mjs
node scripts/backfill-account-keys.mjs
```

Never run a production migration from an unreviewed commit. The migration must remain explicitly cast and idempotent on the shared Neon database.

## Production variables

Install secrets directly in Vercel, never in chat or source control:

```text
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_VERIFY_SERVICE_SID (Verify service used only for operator sign-in)
TWILIO_PHONE_NUMBER
TWILIO_MESSAGING_SERVICE_SID
TWILIO_WEBHOOK_BASE_URL
TWILIO_PUBLIC_NUMBER_ENABLED (false through private voice acceptance)
TWILIO_SMS_ENABLED (false through A2P approval and messaging smoke tests)
OWNER_CELL_PHONE
SHOP_BRAIN_REQUIRED (true only after every readiness check is green)
DEEPGRAM_API_KEY
DEEPGRAM_CALLBACK_SECRET (32+ random bytes)
AI_GATEWAY_API_KEY
AI_SPEECH_MODEL (optional; defaults to openai/tts-1)
AI_SPEECH_VOICE (optional; defaults to onyx)
GMAIL_CLIENT_ID
GMAIL_CLIENT_SECRET
GMAIL_REFRESH_TOKEN
NEXT_PUBLIC_SITE_URL
BLOB_READ_WRITE_TOKEN
GOOGLE_REVIEW_URL
RESEND_API_KEY
RESEND_WEBHOOK_SECRET
GLASS_TOKEN_SECRET (32+ random bytes; signs resumable Customer Page links)
OPS_PUNCH_SECRET (32+ random bytes; signs crew quick-login cards)
CRON_SECRET (32+ random bytes; authorizes scheduled recovery routes)
QUOTE_FROM_EMAIL
```

Upgrade the Vercel project to Pro before commercial cutover.

## Twilio owner steps

The owner must create the Primary Compliance Profile with the exact legal name from the IRS CP 575/147C letter, EIN, business address, business details, website, and authorized-representative information. The owner completes email/2FA verification and approves any paid Brand, Campaign, number, or billing action.

### Plain checklist to send Philippe

Trust Hub has been submitted. There is nothing else to approve until Twilio finishes that review.

Please have these ready:

- The IRS CP 575 or 147C letter showing the legal business name and EIN.
- The business street address, website, business email, and best owner cell number.
- The name, title, email, and mobile number of the person authorized to act for the company.
- A Twilio payment method for the phone number, Brand, Campaign, and monthly messaging charges.

Philippe must personally do only these steps:

1. Open any Trust Hub verification email and complete its email or two-factor check.
2. Confirm the legal business details if Twilio asks for a correction.
3. Review the available 615 numbers and explicitly approve one before it is purchased.
4. Approve the paid Low-Volume Standard Brand and Campaign submission.
5. Make and receive the final real-phone test calls and approve the Moto G experience.

The technical setup—webhooks, Messaging Service, Advanced Opt-Out, Vercel secrets, retry behavior, and test matrix—does not require Philippe to click through alone. Keep the existing Google call-ad number active and do not edit the campaigns; the private Twilio number stays separate until cutover testing is accepted.

Register an EIN-based Low-Volume Standard Brand and the approved low-volume job-update/customer-care Campaign. Keep customer Text hidden while the Campaign is pending. Operator phone login may run independently through Twilio Verify's managed sender pool.

### Operator phone login

Create a Twilio Verify service named `MCSW Jobs Login`, store its `VA...` SID as `TWILIO_VERIFY_SERVICE_SID`, and deploy. Verify login remains separate from customer SMS: it must not enable `TWILIO_SMS_ENABLED`, customer Text controls, the public number, or voice. Active operators with unique E.164 cell numbers receive six-digit codes; successful login creates the same 90-day device session as email. Phone-only operators use a reserved `.invalid` address so email login is never offered for a mailbox that does not exist.

Twilio's labels are separate gates; do not treat an earlier approval as final activation:

1. The Primary Customer Profile must show **Twilio Approved**.
2. The A2P Brand must show **APPROVED** (identity verified).
3. The Campaign must show **VERIFIED**.
4. The specific shop number must separately show **REGISTERED** on that Campaign. Number registration is asynchronous even after the Campaign is verified.

Prepare the Campaign submission from the actual product flow: describe one-to-one estimate/job/customer-care messages, provide the exact checkbox disclosure and opt-in URL, state that consent is optional and never purchased, include representative estimate/scheduling/status examples, and document STOP/START/HELP. Do not submit invented marketing traffic or enable sending while any status is pending.

After the owner approves a local 615 voice/SMS/MMS-capable number:

1. Create a Messaging Service and attach the number to its sender pool.
2. Set the Messaging webhook to `/api/twilio/sms` and keep **Use inbound webhook on number** off, so the Messaging Service URL is the effective route.
3. Review the Advanced Opt-Out confirmation text, then enable and verify STOP, START, and HELP. Twilio sends the keyword response; the application records `OptOutType` and also fail-safely recognizes only exact standalone keywords when that field is absent.
4. Set the number’s primary voice webhook to `/api/twilio/voice` using HTTP POST.
5. Create a Twilio-hosted TwiML Bin that directly `<Dial>`s the owner cell. Use that Bin as the number-level voice fallback so a Vercel outage cannot also remove fallback calling.
6. Keep `/api/twilio/fallback` for application testing only.
7. Keep `TWILIO_PUBLIC_NUMBER_ENABLED=false` for private real-device voice testing. Enable it only after Moto G acceptance and real incoming/outgoing calls pass.
8. Keep `TWILIO_SMS_ENABLED=false` until A2P approval and the complete STOP/START/HELP, opt-in, inbound, outbound, MMS, retry, and blocked-send matrix passes.

Use one canonical HTTPS origin in `TWILIO_WEBHOOK_BASE_URL`. Configure provider URLs from that same origin; do not mix preview domains, `www` variants, or arbitrary `Host` headers. Signed inbound messages and signed delivery callbacks remain accepted while outbound SMS is paused, so STOP and in-flight receipts are never lost.

Before either launch switch changes, verify in Twilio and on `/api/health`:

- The purchased number is voice/SMS/MMS capable, is in the Messaging Service sender pool, the service's inbound webhook is the canonical `/api/twilio/sms` POST URL, and **Use inbound webhook on number** is off.
- The number's primary voice webhook is the canonical `/api/twilio/voice` POST URL.
- The number's fallback URL points directly to its Twilio-hosted TwiML Bin (`https://handler.twilio.com/twiml/EH…`), not this application or a generic Twilio webpage/API URL.
- The health response reports provider credentials, number lookup, webhook matches, sender-pool membership, and provider-hosted fallback as ready. It reports booleans only; it never returns credentials, SIDs, or phone numbers.
- With `TWILIO_SMS_ENABLED=false`, signed inbound SMS and signed status callbacks still return success, while every application-originated send remains blocked.
- An unknown number texting exact STOP, START, or HELP creates consent/message receipts but no person and no work order. Conversational text still creates or attaches normal intake.
- A checked web consent submission creates the lead and its consent ledger row in one database transaction; a consent persistence failure is surfaced and never silently accepted.
- Real-device tests cover incoming/outgoing voice, recording, provider fallback, consent opt-in, STOP block, START restore, HELP, MMS, delivery failure, callback-before-API-response reconciliation, and a blocked send without consent.

## Gmail and email delivery

Gmail uses `gmail.readonly`. Create an Internal Google Workspace OAuth client, set its client ID and secret locally, and run `node scripts/gmail-auth.mjs` while signed in to the shop mailbox. The owner performs Google password entry. Store the printed refresh token in Vercel; never commit it.

Create a signed Resend webhook for `/api/resend/webhook` and subscribe to `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.failed`, and `email.suppressed`. Provider acceptance remains pending until the webhook records final delivery.

## Recovery and release gate

The Morning Brief cron runs at both possible Central-time UTC offsets and claims the Central calendar day once. The scheduled reminders route also reconciles stale Customer Page uploads.

`shopBrain.ready` always reports the real configuration state. `shopBrain.gateSatisfied` is the release-gate result and can remain true while `SHOP_BRAIN_REQUIRED=false`; this distinction prevents a disabled feature from appearing configured.

Set `SHOP_BRAIN_REQUIRED=true` only after `/api/health` reports the public number, Messaging Service, consent ledger, Blob uploads/recovery, Gmail, Deepgram, AI Gateway, Resend, security secrets, schedulers, and provider checks green; production mobile acceptance and the independent release review must also be complete.
