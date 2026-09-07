import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

function notificationBlock(contents, title) {
  const titleAt = contents.indexOf(title)
  assert.ok(titleAt >= 0, `missing alert ${title}`)
  const start = contents.lastIndexOf("await notifyAll({", titleAt)
  const nextAlert = contents.indexOf("await notifyAll({", titleAt + title.length)
  const end = nextAlert >= 0 ? nextAlert : contents.length
  assert.ok(start >= 0 && end > start, `cannot isolate alert ${title}`)
  return contents.slice(start, end)
}

test("every inbound-call alert has an always-send SMS fallback", () => {
  const voice = source("app/api/twilio/voice/route.ts")
  const status = source("app/api/twilio/voice-status/route.ts")
  const recovery = source("lib/ingest.ts")
  const alerts = [
    notificationBlock(voice, "title: `MCSW call"),
    notificationBlock(status, 'title: "Save this call"'),
    notificationBlock(status, 'title: "Missed shop call"'),
    notificationBlock(recovery, "title: `${name} called`"),
  ]

  for (const alert of alerts) {
    assert.match(alert, /capExempt: true/)
    assert.match(alert, /quietHoursExempt: true/)
    assert.match(alert, /smsFallback: true/)
  }
})

test("internal calls remain suppressed before operator alerts", () => {
  const voice = source("app/api/twilio/voice/route.ts")
  const status = source("app/api/twilio/voice-status/route.ts")
  assert.match(voice, /!isTestCall && !person\?\.is_test && !\(prepared\.kind === "draft" && prepared\.draft\.is_test\)/)
  assert.match(status, /if \(!eventId \|\| call\.is_test\) return twiml\(""\)/)
})
