import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  QUOTE_CONSENT_DISCLOSURE_VERSION,
  TEXT_CONSENT_REVOKED_WARNING,
  TEXT_CONSENT_UNVERIFIED_WARNING,
  webTextConsentResolution,
} from "../lib/shop-brain-invariants.mjs"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("a prior STOP cannot be overridden by a web checkbox", () => {
  assert.deepEqual(webTextConsentResolution("revoked"), { grant: false, consentConflict: true })
})

test("ordinary unknown and granted states keep the normal atomic lead + consent behavior", () => {
  assert.deepEqual(webTextConsentResolution("granted"), { grant: true, consentConflict: false })
  assert.deepEqual(webTextConsentResolution("unknown"), { grant: true, consentConflict: false })
})

test("null, empty, invalid, and unavailable inputs deny the grant without a false conflict", () => {
  const denied = { grant: false, consentConflict: false }
  assert.deepEqual(webTextConsentResolution(null), denied)
  assert.deepEqual(webTextConsentResolution(undefined), denied)
  assert.deepEqual(webTextConsentResolution(""), denied)
  assert.deepEqual(webTextConsentResolution("   "), denied)
  assert.deepEqual(webTextConsentResolution("GRANTED"), denied) // wrong case is not a durable state
  assert.deepEqual(webTextConsentResolution("revoked-ish"), denied)
  assert.deepEqual(webTextConsentResolution(0), denied)
  assert.deepEqual(webTextConsentResolution({}), denied)
  assert.deepEqual(webTextConsentResolution([]), denied)
})

test("both warnings are stable, customer-facing, and never leak a phone value", () => {
  for (const warning of [TEXT_CONSENT_REVOKED_WARNING, TEXT_CONSENT_UNVERIFIED_WARNING]) {
    assert.equal(typeof warning, "string")
    assert.ok(warning.length > 20, "warning must be a full sentence, not an empty stub")
    assert.match(warning, /START/)
    assert.match(warning, /shop number/)
    // No internal E.164 or digits may ride along in a client-facing warning.
    assert.doesNotMatch(warning, /\d/)
  }
})

test("the quote consent disclosure version is current", () => {
  assert.equal(QUOTE_CONSENT_DISCLOSURE_VERSION, "2026-08-14")
})

test("the quote route resolves durable consent before granting web consent", () => {
  const quote = source("app/api/quote/route.ts")

  // The normalized non-test phone is looked up, not the raw form value.
  assert.match(quote, /getMessagingConsentState\(consentPhone\)/)
  assert.match(quote, /webTextConsentResolution\(/)
  assert.match(quote, /textConsent && !isTest && consentPhone/)

  // Grant permission is tracked separately from any conflict.
  assert.match(quote, /let webTextGrant = true/)
  assert.match(quote, /webTextGrant = resolution\.grant/)
  assert.match(quote, /consentConflict = resolution\.consentConflict/)

  // The webTextConsent payload is gated on the grant flag, not on the conflict.
  assert.match(quote, /textConsent && !isTest && webTextGrant/)
  // The disclosure version is sourced from the single shared constant.
  assert.match(quote, /disclosureVersion: QUOTE_CONSENT_DISCLOSURE_VERSION/)
  assert.doesNotMatch(quote, /disclosureVersion: "2026-08-08"/)

  // The success response surfaces the stable warning without breaking the
  // ordinary success path or exposing an internal phone value. A real conflict
  // flag is preserved only for a prior STOP.
  assert.match(quote, /warning: consentWarning/)
  assert.match(quote, /consentConflict \? \{ consentConflict: true \} : \{\}/)
  assert.match(quote, /\{ ok: true, accepted: true \}/)
})

test("a consent lookup failure cannot grant web text permission", () => {
  const quote = source("app/api/quote/route.ts")

  // The catch path denies the grant and omits the webTextConsent payload,
  // keeps lead intake alive, and sets the distinct unverified warning without
  // manufacturing a STOP conflict.
  assert.match(quote, /catch \(consentLookupError\)/)
  assert.match(quote, /webTextGrant = false/)
  assert.match(quote, /consentConflict = false/)
  assert.match(quote, /consentWarning = TEXT_CONSENT_UNVERIFIED_WARNING/)
  assert.match(quote, /Text-consent lookup error/)

  // Because the payload is gated on webTextGrant and the catch clears it, a
  // throw can never write a webTextConsent row.
  const gate = quote.match(/textConsent && !isTest && webTextGrant/)
  assert.ok(gate, "webTextConsent payload must be gated on the grant flag")
  assert.ok(
    quote.indexOf("webTextGrant = false") < quote.indexOf("webTextConsent:"),
    "failure must be able to exclude the webTextConsent payload"
  )
})

test("the success warning is exposed whenever the grant was suppressed", () => {
  const quote = source("app/api/quote/route.ts")

  // Both a prior STOP and a lookup failure set the single consentWarning
  // channel that the success response exposes.
  assert.match(quote, /if \(consentConflict\) consentWarning = TEXT_CONSENT_REVOKED_WARNING/)
  assert.match(quote, /consentWarning = TEXT_CONSENT_UNVERIFIED_WARNING/)
  assert.match(quote, /consentWarning\s*\?/)
  assert.match(quote, /warning: consentWarning/)
})

test("the quote form surfaces any success warning, not only a conflict", () => {
  const contact = source("components/mainstreet-contact.tsx")
  assert.match(contact, /if \(data\?\.warning\)/)
  assert.match(contact, /setWarning\(data\.warning\)/)
  assert.match(contact, /status === "success" && warning/)
  assert.match(contact, /ms-form-status is-warning/)
  assert.match(contact, /role="status"/)
  // The conflict-only gate is gone; the form trusts the server's warning field.
  assert.doesNotMatch(contact, /data\?\.consentConflict/)
})
