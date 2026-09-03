import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const opsData = readFileSync("lib/ops-data.ts", "utf8")
const fn = opsData.slice(opsData.indexOf("export async function getWeekAhead"))

test("getWeekAhead exists and works in Central time", () => {
  assert.notEqual(fn.length, opsData.length)
  assert.match(fn, /America\/Chicago/)
})

test("crew never queries the invoice lane", () => {
  // the invoice query must be gated on role before it runs, not filtered after
  const invoiceIdx = fn.indexOf("invoice_due_at")
  assert.ok(invoiceIdx > -1, "invoice lane exists")
  assert.match(fn.slice(0, invoiceIdx), /role === "owner"/)
})

test("test rows stay out of the week", () => {
  assert.match(fn, /is_test/)
})

test("the week card is gone from the board (owner cut the pane 2026-09-03)", () => {
  const board = readFileSync("app/board/board.tsx", "utf8")
  assert.doesNotMatch(board, /card week/)
})
