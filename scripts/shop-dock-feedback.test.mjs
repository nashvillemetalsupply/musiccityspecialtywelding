import assert from "node:assert/strict"
import test from "node:test"
import { readDockJson, clearDockAnswers } from "../app/ops/shop-dock-requests.ts"

test("dock reads preserve a successful empty result", async () => {
  const payload = { brief: null, audioUrl: "", daySheet: [] }
  const result = await readDockJson("/api/ops/brief/latest", "Unavailable", async () => Response.json(payload))
  assert.deepEqual(result, payload)
})

test("failed brief or receipt reads never masquerade as an empty result", async () => {
  for (const path of ["/api/ops/brief/latest", "/api/ops/receipts?ids=1"]) {
    for (const status of [401, 403, 500, 503]) {
      await assert.rejects(readDockJson(path, "Unavailable", async () => Response.json({ error: "private diagnostic" }, { status })), /^Error: Unavailable$/)
    }
  }
})

test("offline and malformed successful responses reach the UI failure branch", async () => {
  await assert.rejects(readDockJson("/api/ops/brief/latest", "Unavailable", async () => { throw new TypeError("Failed to fetch") }), /Failed to fetch/)
  await assert.rejects(readDockJson("/api/ops/brief/latest", "Unavailable", async () => new Response("not JSON")), SyntaxError)
})

test("saved answers clear only after a successful acknowledged DELETE", async () => {
  const calls = []
  await clearDockAnswers(async (...args) => { calls.push(args); return new Response(null, { status: 204 }) })
  assert.deepEqual(calls, [["/api/ops/handset-slips", { method: "DELETE" }]])
  for (const status of [401, 500]) {
    await assert.rejects(clearDockAnswers(async () => new Response(null, { status })), /could not be cleared/)
  }
  await assert.rejects(clearDockAnswers(async () => { throw new TypeError("offline") }), /offline/)
})
