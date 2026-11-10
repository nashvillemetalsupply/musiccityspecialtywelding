import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

const usageWrites = []
globalThis.__anthropicUsageWrites = usageWrites
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/db") {
      return {
        url: `data:text/javascript,${encodeURIComponent("export const getSql = () => async (strings, ...values) => { globalThis.__anthropicUsageWrites.push(values); return []; };")}`,
        shortCircuit: true,
      }
    }
    if (specifier === "@/lib/ai-usage.ts") return { url: new URL("../lib/ai-usage.ts", import.meta.url).href, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const { CLAUDE_MODEL, claudeConfigured, draftWithClaude, jsonWithClaude } = await import("../lib/ai.ts")
hooks.deregister()

const input = { system: "Trusted rules.", prompt: "Untrusted customer evidence.", maxRetries: 0 }
const usage = { input_tokens: 21, output_tokens: 8 }
const message = (text = '{"ok":true}', overrides = {}) => ({
  content: [{ type: "text", text }], stop_reason: "end_turn", usage, ...overrides,
})
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

async function withProvider(fetcher, run, key = "  fixture-anthropic-key  ") {
  const previousKey = process.env.ANTHROPIC_API_KEY
  const previousFetch = globalThis.fetch
  if (key == null) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = key
  globalThis.fetch = fetcher
  usageWrites.length = 0
  try {
    return await run()
  } finally {
    globalThis.fetch = previousFetch
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = previousKey
  }
}

test("direct Claude uses the pinned model, Messages protocol, caller budget and Anthropic usage logging", async () => {
  const signal = new AbortController().signal
  await withProvider(async (url, options) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages")
    assert.equal(options.method, "POST")
    assert.deepEqual(options.headers, {
      "Content-Type": "application/json", "x-api-key": "fixture-anthropic-key", "anthropic-version": "2023-06-01",
    })
    assert.equal(options.signal, signal)
    const body = JSON.parse(options.body)
    assert.equal(body.model, CLAUDE_MODEL)
    assert.equal(CLAUDE_MODEL, "claude-haiku-5-5")
    assert.equal(body.max_tokens, 700)
    assert.equal(body.stream, false)
    assert.match(body.system, /^Trusted rules\./)
    assert.match(body.system, /only one valid JSON object, without markdown/)
    assert.deepEqual(body.messages, [{ role: "user", content: input.prompt }])
    assert.equal(body.response_format, undefined)
    return response(message())
  }, async () => {
    assert.equal(claudeConfigured(), true)
    assert.deepEqual(await jsonWithClaude({ ...input, signal, maxTokens: 700, isTest: true, operation: "shop-assistant-turn" }), { ok: true })
    assert.equal(usageWrites.length, 1)
    const [job, ok, detail, meta] = usageWrites[0]
    assert.equal(job, "ai-usage")
    assert.equal(ok, true)
    assert.deepEqual(JSON.parse(detail), { operation: "shop-assistant-turn", provider: "anthropic", model: CLAUDE_MODEL })
    assert.deepEqual(JSON.parse(meta), { usage, isTest: true })
  })
})

test("Claude text and JSON preserve default token limits and bounded timeout signals", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, "timeout")
  const signal = new AbortController().signal
  const durations = []
  const bodies = []
  Object.defineProperty(AbortSignal, "timeout", { configurable: true, value: (duration) => { durations.push(duration); return signal } })
  try {
    await withProvider(async (_url, options) => {
      assert.equal(options.signal, signal)
      bodies.push(JSON.parse(options.body))
      return response(message())
    }, async () => {
      assert.equal(await draftWithClaude(input), '{"ok":true}')
      assert.deepEqual(await jsonWithClaude(input), { ok: true })
    })
    assert.deepEqual(durations, [30_000, 30_000])
    assert.deepEqual(bodies.map((body) => body.max_tokens), [1000, 2000])
    assert.equal(bodies[0].system, input.system)
    assert.equal(usageWrites.length, 2)
  } finally {
    Object.defineProperty(AbortSignal, "timeout", descriptor)
  }
})

test("Claude JSON joins text content blocks before parsing", async () => {
  await withProvider(async () => response(message("", { content: [{ type: "text", text: '{"ok":' }, { type: "text", text: "true}" }] })), async () => {
    assert.deepEqual(await jsonWithClaude(input), { ok: true })
  })
})

test("missing or blank Anthropic credentials fail before provider calls", async () => {
  for (const key of [null, "", " \n"]) {
    await withProvider(() => assert.fail("must not contact a provider"), async () => {
      assert.equal(claudeConfigured(), false)
      await assert.rejects(() => jsonWithClaude(input), /ANTHROPIC_API_KEY is not set/)
      assert.equal(usageWrites.length, 0)
    }, key)
  }
})

test("Claude malformed, empty, non-object, truncated and refused JSON fail closed and log failure", async () => {
  const cases = [
    message("not JSON"), message("[]"), message("null"), message("true"), message(""),
    message("{}", { content: [] }), message("{}", { content: [{ type: "tool_use", text: "{}" }] }),
    message("{}", { stop_reason: "max_tokens" }), message("{}", { stop_reason: "refusal" }),
  ]
  for (const payload of cases) {
    await withProvider(async () => response(payload), async () => {
      await assert.rejects(() => jsonWithClaude(input))
      assert.equal(usageWrites.length, 1)
      assert.equal(usageWrites[0][1], false)
      assert.equal(JSON.parse(usageWrites[0][3]).usage, null)
    })
  }
})

test("Claude authentication failure is not retried and remains an error for human handoff", async () => {
  let calls = 0
  await withProvider(async () => { calls += 1; return response({ error: { message: "invalid credential" } }, 401) }, async () => {
    await assert.rejects(() => jsonWithClaude({ ...input, maxRetries: 2 }), /Claude refused the request \(401\)/)
    assert.equal(calls, 1)
    assert.equal(usageWrites[0][1], false)
  })
})

test("Claude retries transient HTTP and network failures within the existing retry cap", async () => {
  let calls = 0
  await withProvider(async () => {
    calls += 1
    if (calls === 1) throw new TypeError("fixture connection reset")
    if (calls === 2) return response({ error: "busy" }, 429)
    return response(message())
  }, async () => {
    const defaultRetries = { ...input }
    delete defaultRetries.maxRetries
    assert.deepEqual(await jsonWithClaude(defaultRetries), { ok: true })
    assert.equal(calls, 3)
    assert.equal(usageWrites.length, 1)
    assert.equal(usageWrites[0][1], true)
  })
})

test("Claude preserves a caller abort and zero-retry budget", async () => {
  const controller = new AbortController()
  const failure = new DOMException("fixture timeout", "TimeoutError")
  controller.abort(failure)
  let calls = 0
  await withProvider(async (_url, options) => {
    calls += 1
    assert.equal(options.signal, controller.signal)
    options.signal.throwIfAborted()
  }, async () => {
    await assert.rejects(() => jsonWithClaude({ ...input, signal: controller.signal }), (error) => error === failure)
    assert.equal(calls, 1)
    assert.equal(usageWrites[0][1], false)
  })
})
