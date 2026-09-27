import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("Twilio status ids and durations are zod-validated before SQL casts", () => {
  const voice = source("app/api/twilio/voice-status/route.ts")
  const outbound = source("app/api/twilio/outbound-status/route.ts")
  const voiceGuard = voice.indexOf('if (!parsedSid.success || !parsedDuration.success) return twiml("", 400)')
  const outboundGuard = outbound.indexOf('if (!parsedIntent.success || !parsedDuration.success) return twiml("", 400)')

  assert.match(voice, /const callSidSchema = z\.string\(\)\.regex\(\/\^CA\[0-9a-f\]\{32\}\$\/i\)/)
  assert.match(voice, /callDurationSchema\.safeParse\(/)
  assert.ok(voiceGuard >= 0 && voiceGuard < voice.indexOf("const sql = getSql()"))
  assert.match(outbound, /intentIdSchema = z\.coerce\.number\(\)\.int\(\)\.positive\(\)\.safe\(\)/)
  assert.match(outbound, /callDurationSchema\.safeParse\(/)
  assert.ok(outboundGuard >= 0 && outboundGuard < outbound.indexOf("const sql = getSql()"))
  assert.doesNotMatch(voice, /const duration = Number\(/)
  assert.doesNotMatch(outbound, /const duration = customerLeg \? Number\(/)
})
