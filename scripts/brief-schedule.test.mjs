import assert from "node:assert/strict"
import test from "node:test"
import { isCentralBriefHour, morningBriefDedupeKey } from "../lib/brief-schedule.ts"

test("paired UTC cron hours accept only the one that is 6 AM in Central time", () => {
  assert.equal(isCentralBriefHour(new Date("2026-07-01T11:30:00Z")), true)
  assert.equal(isCentralBriefHour(new Date("2026-07-01T12:30:00Z")), false)
  assert.equal(isCentralBriefHour(new Date("2026-12-01T11:30:00Z")), false)
  assert.equal(isCentralBriefHour(new Date("2026-12-01T12:30:00Z")), true)
  // A delayed Actions start within the intended local hour still resumes.
  assert.equal(isCentralBriefHour(new Date("2026-12-01T12:48:00Z")), true)
})

test("the original run and every resume share a per-day delivery key", () => {
  const day = "2026-12-01"
  assert.equal(morningBriefDedupeKey(day), "brief:2026-12-01")
  assert.equal(morningBriefDedupeKey(day), morningBriefDedupeKey(day))
  assert.notEqual(morningBriefDedupeKey(day), morningBriefDedupeKey("2026-12-02"))
})
