import assert from "node:assert/strict"
import test from "node:test"
import { processTranscriptEventIfUnclaimed } from "../lib/transcript-extraction.mjs"

test("the second transcript route skips a source event that already produced a claim", async () => {
  const processed = []
  const result = await processTranscriptEventIfUnclaimed(
    42,
    async (sourceEventId) => sourceEventId === 42,
    async (eventId) => { processed.push(eventId) },
  )
  assert.deepEqual(result, { processed: false, reason: "source-claim-exists" })
  assert.deepEqual(processed, [])
})

test("an unclaimed transcript event still reaches extraction once", async () => {
  const processed = []
  const result = await processTranscriptEventIfUnclaimed(
    43,
    async () => false,
    async (eventId) => { processed.push(eventId) },
  )
  assert.deepEqual(result, { processed: true })
  assert.deepEqual(processed, [43])
})
