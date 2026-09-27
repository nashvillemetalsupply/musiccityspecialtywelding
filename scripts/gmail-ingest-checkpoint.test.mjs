import assert from "node:assert/strict"
import test from "node:test"
import { GMAIL_MESSAGE_CAP, pendingGmailMessageIds, settleGmailRun, shouldNotifyGmailDeadLetter, splitGmailMessageBatch } from "../lib/gmail-ingest-checkpoint.mjs"

test("Gmail processes no more than fifty listed messages in one run", () => {
  const ids = Array.from({ length: 73 }, (_, index) => `message-${index}`)
  const { batch, remaining } = splitGmailMessageBatch(ids)
  assert.equal(GMAIL_MESSAGE_CAP, 50)
  assert.equal(batch.length, 50)
  assert.equal(remaining.length, 23)
  assert.deepEqual(batch, ids.slice(0, 50))
})

test("each checkpoint retains unprocessed messages and retries a failed message", () => {
  const ids = ["one", "two", "three", "four"]
  const { batch, remaining } = splitGmailMessageBatch(ids, 3)
  assert.deepEqual(pendingGmailMessageIds({ batch, remaining, processedIndex: 0 }), ["two", "three", "four"])
  assert.deepEqual(pendingGmailMessageIds({ batch, remaining, processedIndex: 1, retryIds: ["one", "two"] }), ["three", "four", "one", "two"])
  assert.deepEqual(pendingGmailMessageIds({ batch, remaining, processedIndex: 2, retryIds: ["one", "two"] }), ["four", "one", "two"])
})

test("failed dead-letter data never pages for an internal test message", () => {
  assert.equal(shouldNotifyGmailDeadLetter(true), false)
  assert.equal(shouldNotifyGmailDeadLetter(false), true)
})

test("a token failure records a failed run after releasing the acquired lease", async () => {
  const order = []
  let run
  await settleGmailRun({
    job: "gmail-ingest",
    ok: false,
    detail: { error: "OAuth refresh failed" },
    release: async () => { order.push("released") },
    recordRun: async (value) => { order.push("recorded"); run = value },
  })
  assert.deepEqual(order, ["released", "recorded"])
  assert.deepEqual(run, { job: "gmail-ingest", ok: false, detail: { error: "OAuth refresh failed" } })
})

test("a lease release error still produces a failed automation run", async () => {
  let run
  await settleGmailRun({
    job: "gmail-ingest",
    ok: true,
    detail: { scanned: 4 },
    release: async () => { throw new Error("database unavailable") },
    recordRun: async (value) => { run = value },
  })
  assert.equal(run.ok, false)
  assert.deepEqual(run.detail, { scanned: 4, leaseReleaseError: "database unavailable" })
})
