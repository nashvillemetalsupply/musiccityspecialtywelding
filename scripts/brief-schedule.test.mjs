import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { isCentralBriefHour, morningBriefDedupeKey } from "../lib/brief-schedule.ts"

test("the brief window includes Central hours 6 through 11 in summer and winter", () => {
  for (const instant of [
    "2026-07-01T10:59:59Z", // 5:59 CDT
    "2026-07-01T17:00:00Z", // 12:00 CDT
    "2026-12-01T11:30:00Z", // 5:30 CST
    "2026-12-01T18:00:00Z", // 12:00 CST
  ]) assert.equal(isCentralBriefHour(new Date(instant)), false, instant)
  for (const instant of [
    "2026-07-01T11:00:00Z", // 6:00 CDT
    "2026-07-01T16:59:59Z", // 11:59 CDT
    "2026-12-01T12:00:00Z", // 6:00 CST
    "2026-12-01T17:59:59Z", // 11:59 CST
  ]) assert.equal(isCentralBriefHour(new Date(instant)), true, instant)
})

test("scheduled and delayed morning starts remain inside the brief window", () => {
  assert.equal(isCentralBriefHour(new Date("2026-07-01T11:30:00Z")), true)
  assert.equal(isCentralBriefHour(new Date("2026-07-01T12:30:00Z")), true)
  assert.equal(isCentralBriefHour(new Date("2026-12-01T12:30:00Z")), true)
  assert.equal(isCentralBriefHour(new Date("2026-12-01T12:48:00Z")), true)
  assert.equal(isCentralBriefHour(new Date("2026-11-07T16:57:00Z")), true)
  assert.equal(isCentralBriefHour(new Date("2026-11-07T17:59:59Z")), true)
})

test("the Vercel brief cron falls within the morning window in both seasons", () => {
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"))
  assert.equal(vercel.crons.find((cron) => cron.path === "/api/ops/brief").schedule, "30 12 * * *")
  assert.equal(isCentralBriefHour(new Date("2026-07-01T12:30:00Z")), true)
  assert.equal(isCentralBriefHour(new Date("2026-12-01T12:30:00Z")), true)
})

test("the original run and every resume share a per-day delivery key", () => {
  const day = "2026-12-01"
  assert.equal(morningBriefDedupeKey(day), "brief:2026-12-01")
  assert.equal(morningBriefDedupeKey(day), morningBriefDedupeKey(day))
  assert.notEqual(morningBriefDedupeKey(day), morningBriefDedupeKey("2026-12-02"))
})
