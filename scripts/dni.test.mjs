import { strict as assert } from "node:assert"
import test from "node:test"

import { channelForNumber, dniConfigured, dniNumber, normalizedE164, paidChannelForVisit } from "../lib/dni.mjs"

test("an unset tracking number leaves the whole feature inert", () => {
  // No NEXT_PUBLIC_TWILIO_PHONE_NUMBER_* in the test environment, which is the
  // state production is in until the owner buys the numbers.
  assert.equal(dniNumber("google"), "")
  assert.equal(dniConfigured(), false)
  assert.equal(channelForNumber("+16158104910"), null)
  assert.equal(channelForNumber(""), null)
})

test("numbers normalise to E.164 the way the Twilio gate does", () => {
  assert.equal(normalizedE164("615-810-4910"), "+16158104910")
  assert.equal(normalizedE164("16158104910"), "+16158104910")
  assert.equal(normalizedE164("+16158104910"), "+16158104910")
  assert.equal(normalizedE164("nope"), "")
  assert.equal(normalizedE164(undefined), "")
})

test("a Google ad click is recognised from gclid, from the landing page, or from utm", () => {
  assert.equal(paidChannelForVisit({ gclid: "abc" }), "google")
  // iOS and other limited-signal clicks carry gbraid or wbraid instead.
  assert.equal(paidChannelForVisit({ landingPage: "/?gbraid=xyz" }), "google")
  assert.equal(paidChannelForVisit({ landingPage: "/?utm_medium=cpc&wbraid=xyz" }), "google")
  assert.equal(paidChannelForVisit({ utmSource: "Google Ads" }), "google")
})

test("a Meta ad click is recognised from fbclid or utm", () => {
  assert.equal(paidChannelForVisit({ landingPage: "/?fbclid=xyz" }), "facebook")
  assert.equal(paidChannelForVisit({ utmSource: "instagram" }), "facebook")
})

test("organic and direct visits get no tracking number", () => {
  assert.equal(paidChannelForVisit({}), null)
  assert.equal(paidChannelForVisit({ landingPage: "/services", utmSource: "" }), null)
  // A page whose path merely contains the word is not a click id.
  assert.equal(paidChannelForVisit({ landingPage: "/gclid-explained" }), null)
})
