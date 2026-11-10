import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"
import { errorDiagnostic } from "./assistant-a4-diagnostics.mjs"

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/db") return {
      url: `data:text/javascript,${encodeURIComponent("export const getSql = () => async () => [];")}`,
      shortCircuit: true,
    }
    if (specifier === "@/lib/ai-usage.ts") return { url: new URL("../lib/ai-usage.ts", import.meta.url).href, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const { draftWithClaude, jsonWithClaude } = await import("../lib/ai.ts")
hooks.deregister()

const input = { system: "Shop rules", prompt: "Customer evidence", maxRetries: 0 }
const message = (text, overrides = {}) => ({ content: [{ type: "text", text }], stop_reason: "end_turn", ...overrides })

async function withMessages(messages, run) {
  const previousKey = process.env.ANTHROPIC_API_KEY
  const previousFetch = globalThis.fetch
  const requests = []
  process.env.ANTHROPIC_API_KEY = "fixture-secret-key"
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body))
    assert.ok(requests.length <= messages.length, "unexpected additional provider request")
    const result = messages[requests.length - 1]
    if (result instanceof Error) throw result
    return result instanceof Response ? result : Response.json(result)
  }
  try { await run(requests) } finally {
    globalThis.fetch = previousFetch
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = previousKey
  }
}

test("Claude JSON ignores thinking and redacted blocks and requests the raised budget without thinking", async () => {
  await withMessages([message("", { content: [
    { type: "thinking", thinking: "private reasoning" },
    { type: "redacted_thinking", data: "private redacted data" },
    { type: "text", text: '{"ok":' },
    { type: "text", text: "true}" },
  ] })], async (requests) => {
    assert.deepEqual(await jsonWithClaude(input), { ok: true })
    assert.equal(requests[0].max_tokens, 2000)
    assert.equal(Object.hasOwn(requests[0], "thinking"), false)
  })
})

test("Claude text accepts stop_sequence and ignores non-text blocks", async () => {
  await withMessages([message("", { stop_reason: "stop_sequence", content: [
    { type: "thinking", thinking: "private reasoning" }, { type: "text", text: "Ask the shop." },
  ] })], async (requests) => {
    assert.equal(await draftWithClaude(input), "Ask the shop.")
    assert.equal(requests[0].max_tokens, 1000)
    assert.equal(Object.hasOwn(requests[0], "thinking"), false)
  })
})

test("Claude extracts the first balanced JSON object from prose and fences while respecting quoted braces", async () => {
  const object = { reply: 'Use a 2" bracket {like this}; escaped slash \\ and quote "', fields: { need: "repair" } }
  await withMessages([message(`Here is the result:\n\`\`\`json\n${JSON.stringify(object)}\n\`\`\`\nAnother object: {"wrong":true}`)], async () => {
    assert.deepEqual(await jsonWithClaude(input), object)
  })
})

test("Claude retries max_tokens exactly once at twice the JSON budget before accepting a complete response", async () => {
  await withMessages([message('{"partial":true}', { stop_reason: "max_tokens" }), message('{"complete":true}')], async (requests) => {
    assert.deepEqual(await jsonWithClaude(input), { complete: true })
    assert.deepEqual(requests.map((request) => request.max_tokens), [2000, 4000])
  })
})

test("Claude text retry doubles a caller budget and accepts stop_sequence", async () => {
  await withMessages([message("partial", { stop_reason: "max_tokens" }), message("complete", { stop_reason: "stop_sequence" })], async (requests) => {
    assert.equal(await draftWithClaude({ ...input, maxTokens: 1250 }), "complete")
    assert.deepEqual(requests.map((request) => request.max_tokens), [1250, 2500])
  })
})

test("Claude fails a second max_tokens response with safe final model diagnostics", async () => {
  const final = message("fixture-secret-key private answer", {
    stop_reason: "max_tokens",
    content: [{ type: "thinking", thinking: "private reasoning" }, { type: "text", text: "private answer" }],
    usage: { input_tokens: 19, output_tokens: 4000, cache_creation_input_tokens: 3, cache_read_input_tokens: 5, private: "fixture-secret-key" },
  })
  await withMessages([message("partial", { stop_reason: "max_tokens" }), final], async (requests) => {
    await assert.rejects(() => jsonWithClaude(input), (error) => {
      assert.deepEqual(error.modelDiagnostics, {
        stop_reason: "max_tokens", content_block_types: ["thinking", "text"],
        usage: { input_tokens: 19, output_tokens: 4000, cache_creation_input_tokens: 3, cache_read_input_tokens: 5 },
      })
      assert.doesNotMatch(JSON.stringify(error), /private|fixture-secret-key/)
      return /did not finish/.test(error.message)
    })
    assert.equal(requests.length, 2)
  })
})

test("Claude no-text and invalid JSON failures preserve safe metadata without returning model content", async () => {
  for (const payload of [
    message("", { content: [{ type: "thinking", thinking: "private reasoning" }] }),
    message('{"private answer": broken}'),
    message('{"reply":"private answer"'),
    message("private answer", { stop_reason: "refusal" }),
  ]) {
    await withMessages([{ ...payload, usage: { input_tokens: 9, output_tokens: 11 } }], async () => {
      await assert.rejects(() => jsonWithClaude(input), (error) => {
        assert.deepEqual(error.modelDiagnostics, {
          stop_reason: payload.stop_reason, content_block_types: payload.content.map((block) => block.type),
          usage: { input_tokens: 9, output_tokens: 11 },
        })
        assert.doesNotMatch(`${error.message}${JSON.stringify(error)}`, /private answer|private reasoning|fixture-secret-key/)
        return true
      })
    })
  }
})

test("Claude retry network, HTTP and invalid response failures retain the last model metadata in A4", async () => {
  const first = message("private answer", {
    stop_reason: "max_tokens",
    content: [{ type: "thinking", thinking: "private reasoning" }, { type: "text", text: "private answer" }],
    usage: { input_tokens: 17, output_tokens: 2000 },
  })
  const expected = { stop_reason: "max_tokens", content_block_types: ["thinking", "text"], usage: { input_tokens: 17, output_tokens: 2000 } }
  for (const failure of [
    new TypeError("private failure fixture-secret-key"),
    new Response("private response fixture-secret-key", { status: 503 }),
    new Response("private invalid JSON fixture-secret-key"),
  ]) {
    await withMessages([first, failure], async (requests) => {
      await assert.rejects(() => jsonWithClaude(input), (error) => {
        assert.deepEqual(error.modelDiagnostics, expected)
        const diagnostic = errorDiagnostic("model", error)
        assert.deepEqual(diagnostic.model, expected)
        assert.doesNotMatch(`${error.message}${JSON.stringify(error)}${JSON.stringify(diagnostic)}`, /private|fixture-secret-key/)
        return true
      })
      assert.equal(requests.length, 2)
    })
  }
})

test("Claude retry abort and timeout failures retain their names with safe metadata and messages", async () => {
  for (const name of ["AbortError", "TimeoutError"]) {
    await withMessages([
      message("private answer", { stop_reason: "max_tokens", usage: { input_tokens: 2, output_tokens: 2000 } }),
      new DOMException("private failure fixture-secret-key", name),
    ], async () => {
      await assert.rejects(() => jsonWithClaude(input), (error) => {
        assert.equal(error.name, name)
        assert.deepEqual(error.modelDiagnostics, { stop_reason: "max_tokens", content_block_types: ["text"], usage: { input_tokens: 2, output_tokens: 2000 } })
        assert.doesNotMatch(`${error.message}${JSON.stringify(error)}`, /private|fixture-secret-key/)
        return true
      })
    })
  }
})
