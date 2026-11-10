import assert from "node:assert/strict"
import test from "node:test"
import { parseA4Args, runAskConversation, safeModelDiagnostics } from "./assistant-a4-ask.mjs"

test("A4 parses repeated asks and both environment file forms without treating message text as a path", () => {
  const asks = ["Do you weld aluminum boat ladders?", "My steel gate hinge broke off the post in Lebanon. Can you fix it?"]
  for (const envArgs of [[".env.local"], ["--env", ".env.local"]]) {
    assert.deepEqual(parseA4Args([...envArgs, "--ask", asks[0], "--ask", asks[1]]), {
      dry: false, preflight: false, envFile: ".env.local", asks,
    })
  }
  assert.deepEqual(parseA4Args(["--dry", "--ask", "Question"]), { dry: true, preflight: false, envFile: null, asks: ["Question"] })
  assert.deepEqual(parseA4Args(["--ask", asks[0], "--env", ".env.local", "--ask", asks[1]]), {
    dry: false, preflight: false, envFile: ".env.local", asks,
  })
  for (const args of [["--ask"], ["--ask", "--dry"], ["--ask", ""], ["--env"], ["one", "two"], ["one", "--env", "two"], ["--preflight", "--ask", "Question"], ["--dry", "--preflight"], ["--unknown"]]) {
    assert.throws(() => parseA4Args(args), /Use one environment file/)
  }
})

test("A4 asks use one sequential conversation, retain internal markers and print only sanitized metadata", async () => {
  const requests = [], emitted = []
  let finished = false
  const turns = await runAskConversation({
    messages: ["[INTERNAL TEST] Do you weld aluminum boat ladders?", "My steel gate hinge broke off the post in Lebanon. Can you fix it?"],
    sessionId: "same-session",
    postTurn: async (input) => {
      if (input.turn_index === 1) assert.equal(finished, true, "previous output must finish before next request")
      requests.push(input)
      return { ok: true, reply: input.turn_index ? "Gate hinges are a normal repair. Can you send a close photo?" : "A person at the shop will confirm that job. What name should the shop use?", handoff_reason: input.turn_index ? undefined : "unknown" }
    },
    readTurn: async (id, index) => {
      assert.equal(id, "same-session")
      return { branch: index ? "model-answer" : "unknown-capability-intake", model_diagnostics: {
        stop_reason: "end_turn", content_block_types: ["text", "sk-ant-secret-key"],
        usage: { input_tokens: 12, output_tokens: 34, private: "sk-ant-key", cache_read_input_tokens: -1 },
        content: "private model response", api_key: "sk-ant-key",
      } }
    },
    onTurn: async (turn) => { emitted.push(turn); finished = true },
  })
  assert.deepEqual(requests.map(({ session_id, turn_index }) => [session_id, turn_index]), [["same-session", 0], ["same-session", 1]])
  assert.ok(requests.every(({ message }) => message.startsWith("[INTERNAL TEST] ")))
  assert.equal(requests[0].message.match(/\[INTERNAL TEST\]/g).length, 1)
  assert.equal(turns[0].handoff_reason, "unknown")
  assert.equal(turns[1].handoff_reason, null)
  assert.equal(turns[1].branch, "model-answer")
  assert.deepEqual(turns[1].model_diagnostics, { stop_reason: "end_turn", content_block_types: ["text", "unknown"], usage: { input_tokens: 12, output_tokens: 34 } })
  assert.deepEqual(turns, emitted)
  assert.doesNotMatch(JSON.stringify(turns), /sk-ant-|private model response/)
})

test("A4 ask diagnostics label absent metadata and reject arbitrary provider strings", async () => {
  assert.equal(safeModelDiagnostics(undefined), null)
  assert.deepEqual(safeModelDiagnostics({ stop_reason: "sk-ant-key", content_block_types: [null, "https://private.test"], usage: { input_tokens: Infinity, output_tokens: "secret" } }), {
    stop_reason: null, content_block_types: ["unknown", "unknown"], usage: null,
  })
  const result = await runAskConversation({ messages: ["Question"], sessionId: "session", postTurn: async () => ({ ok: true, reply: "reply secret" }),
    readTurn: async () => ({ branch: "sk-ant-private-key" }), onTurn: async () => {}, redact: (text) => text.replace("secret", "[redacted]") })
  assert.deepEqual(result, [{ turn: 1, reply: "reply [redacted]", handoff_reason: null, branch: null, model_diagnostics: null }])
})
