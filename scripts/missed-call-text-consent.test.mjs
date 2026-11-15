import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { missedCallTextConsentAllowed } from "../lib/missed-call-consent.ts"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n")
const missedCallKey = `missed-call:CA${"a".repeat(32)}:auto-reply`

for (const { label, flag, key = missedCallKey, state, allowed } of [
  { label: "flag off blocks unknown consent", flag: undefined, state: "unknown", allowed: false },
  { label: "flag on allows unknown consent", flag: "1", state: "unknown", allowed: true },
  { label: "flag on allows granted consent", flag: "1", state: "granted", allowed: true },
  { label: "flag on still blocks revoked consent", flag: "1", state: "revoked", allowed: false },
  { label: "unrelated keys cannot bypass unknown consent", flag: "1", key: "operator-reply:42", state: "unknown", allowed: false },
]) {
  test(label, () => {
    assert.equal(missedCallTextConsentAllowed(flag, key, state), allowed)
  })
}

test("only the exact flag value enables the missed-call consent exception", () => {
  for (const flag of [undefined, "", "0", "true", "01", " 1", "1 "]) {
    assert.equal(missedCallTextConsentAllowed(flag, missedCallKey, "unknown"), false)
  }
})

test("the missed-call key requires a complete CallSid and auto-reply suffix, ignoring case", () => {
  assert.equal(missedCallTextConsentAllowed("1", missedCallKey.toUpperCase(), "unknown"), true)
  for (const key of [
    "",
    `missed-call:CA${"a".repeat(31)}:auto-reply`,
    `missed-call:CA${"a".repeat(33)}:auto-reply`,
    `missed-call:CA${"g".repeat(32)}:auto-reply`,
    `missed-call:SM${"a".repeat(32)}:auto-reply`,
    `prefix:${missedCallKey}`,
    `${missedCallKey}:extra`,
    missedCallKey.replace(":auto-reply", ":manual-reply"),
  ]) {
    assert.equal(missedCallTextConsentAllowed("1", key, "unknown"), false, key)
  }
})

test("the shared send gate checks missed-call consent using the persisted intent key", () => {
  const messages = read("lib/messages.ts")
  const gate = messages.slice(messages.indexOf("async function sendClaimedSms"), messages.indexOf("export async function sendSmsPersisted"))
  assert.match(gate, /isMissedCallTextOnCall\(process\.env\.MISSED_CALL_TEXT_ON_CALL, intent\.idempotency_key\)/)
  assert.match(gate, /\? missedCallTextConsentAllowed\(process\.env\.MISSED_CALL_TEXT_ON_CALL, intent\.idempotency_key, await getMessagingConsentState\(to\)\)/)
  assert.match(gate, /: await customerSmsAllowed\(to\)/)
  assert.match(gate, /if \(!smsAllowed\) blockedReason = "Text canceled: this customer no longer has texting permission\."/)
  assert.match(messages, /return sendClaimedSms\(claimed\[0\], false, sendAfter\)/)
  const worker = messages.slice(messages.indexOf("export async function sendDeferredSms"), messages.indexOf("/** Never guesses"))
  assert.match(worker, /RETURNING[\s\S]*?idempotency_key/)
  assert.match(worker, /\(intent\) => sendClaimedSms\(intent, true\)/)
})
