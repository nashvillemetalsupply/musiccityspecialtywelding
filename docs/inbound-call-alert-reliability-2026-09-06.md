# Inbound-call operator alert reliability

Scope: inbound-call operator alert implementation, isolated verification, additive production migration, and deployment. No historical alert was replayed and no synthetic live alert was sent.

## Evidence and reproduction

Owner-provided incident evidence: voice routing and persistence work; 30 interrupt notifications are dead, including 22 with `No configured alert channel accepted this retry` and 8 Twilio undelivered receipts. The September 6 call rang the owner and persisted. These counts were not independently queried.

Pre-fix command:

```powershell
node --test scripts/inbound-call-alert-reliability.test.mjs
```

Captured result: **2 passed, 1 failed**. The behavioral failure was `the operator email must receive the fallback alert`, expected `1`, actual `0`. The test exercised `notifyAll` with an inbound-call source, unsuccessful push, disabled SMS, and an available fake email provider. Internal-test traffic invoked zero providers. All providers and SQL were isolated from production.

Unchanged baseline: 79 alert/provider boundary tests passed; `node node_modules/typescript/bin/tsc --noEmit --incremental false` passed.

## Ranked hypotheses

1. Missing independent fallback: an available email provider should rescue the persisted alert when push and SMS cannot accept it.
2. Route-specific SMS opt-in: setting SMS fallback can help only if outbound SMS is configured and accepted.
3. Stale push subscriptions: healthy push should work; pruning stale subscriptions alone cannot provide another delivery channel.
4. Retry safety: a queued alert whose recipient or source is no longer eligible must be suppressed before another provider attempt.

## Cause

`notify` and `retryPendingInterrupts` originally supported push and optional SMS only. Push returns zero when unavailable or after pruning stale endpoints. Several inbound-call routes omit SMS fallback, and configured SMS can still be undelivered. Retrying those same channels cannot create a viable independent fallback. Successful voice routing does not establish alert-channel health.

## Fix and final verification

Persisted `call.in`, `call.missed`, and `call.answered` interrupts now try the active operator's email after unsuccessful push and before optional SMS. Initial sends, queued retries, and capped summaries share that policy. SMS-only and other event kinds retain their channel policy. The email attempt is persisted before Resend, uses a stable notification idempotency key, and records the provider receipt. Ambiguous acceptance is replayed with that key while bounded retries remain, then quarantined. Definite rejection can fall through to SMS. The email-to-SMS transition is atomic, ignores duplicate failure receipts, and preserves one final SMS claim even when email used the fifth attempt. Retry delivery rechecks active-recipient, role, and linked test markers, including the raw call receipt.

Signed Resend receipts reconcile the operator notification without creating customer events. They restore the send timestamp and clear reservations/retry scheduling after a crash. Twilio receipts cannot overwrite an email attempt or acceptance. The migration adds two nullable email receipt columns and a unique partial provider-ID index; it does not revive any backlog.

Final checks:

- `npm run test:inbound-call-alerts`: **24 passed, 0 failed**.
- `npm run test:shop-brain`: **539 passed, 0 failed, 2 skipped**.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.

The callback crash-window tests also went red before their fixes. The existing coalesced-link regression was updated to check each shared URL at its push call site.

Files changed:

- `lib/notify.ts`
- `app/api/resend/webhook/route.ts`
- `app/api/twilio/notification-status/route.ts`
- `scripts/migrate.mjs`
- `scripts/inbound-call-alert-reliability.test.mjs`
- `scripts/inbound-call-alert-callbacks.test.mjs`
- `scripts/board-push-links.test.mjs`
- `package.json`
- This evidence and activation note.

## Live activation

The additive receipt migration completed, both active owners have an email address, Resend and its signed webhook are configured, and production deployment `dpl_7GagPJE1W3NwMqPFcAC5BGxfDzaG` is Ready on the canonical domain. Public health returned 200; unsigned Resend and Twilio receipt requests returned 403. A fresh call from a phone not marked as an internal test caller remains the final delivery proof. Internal-test calls must remain silent.

Existing dead and unknown notifications require owner review; this fix must not automatically revive them or replay historical alerts. SMS carrier/A2P delivery failures and browser push enrollment remain separate operational checks.
