import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n")

test("text-in ack and missed-call auto-reply sends log failures instead of swallowing them", () => {
  const sms = read("app/api/twilio/sms/route.ts")
  const voice = read("app/api/twilio/voice-status/route.ts")
  assert.ok(sms.includes('idempotencyKey: `text-in:${sid}:ack`,\n    }).catch((error) => console.warn("Text-in ack not sent:", error))'))
  assert.ok(voice.includes("quietExemptCallAt: new Date(call.called_at),\n    }).catch((error) => console.warn(\"Missed-call auto-reply not sent:\", error))"))
  for (const src of [sms, voice]) {
    assert.doesNotMatch(src, /idempotencyKey:[^\n]*\n(?:[^\n]*\n)?\s*\}\)\.catch\(\(\) => undefined\)/)
  }
})
