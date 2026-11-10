import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/db") return { url: `data:text/javascript,${encodeURIComponent("export const getSql = () => async () => [];")}`, shortCircuit: true }
    if (specifier === "@/lib/ai-usage.ts") return { url: new URL("../lib/ai-usage.ts", import.meta.url).href, shortCircuit: true }
    if (specifier === "@/lib/shop-contact") return { url: `data:text/javascript,${encodeURIComponent('export const getShopPhone = () => ({ display: "shop", href: "tel:+16157033296" });')}`, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const { jsonWithClaude } = await import("../lib/ai.ts")
const { handleAssistantTurn } = await import("../lib/assistant/turn.ts")
const { processAssistantTurn } = await import("../lib/assistant/service.ts")
const { ClaudeResponseError, assistantModelErrorDiagnostics } = await import("../lib/claude-diagnostics.ts")
hooks.deregister()

const privateText = "private customer 615-555-0199 ava@example.com fixture-secret-key"
const fields = { name: null, callback_phone: null, need: "", material_size: null, location: null, timing: null, callback_window: null, is_job: "unsure" }
const message = (overrides = {}) => ({ content: [{ type: "text", text: JSON.stringify({ reply: "What needs welding?", fields }) }], stop_reason: "end_turn", ...overrides })

async function runTurn(responses, model = handleAssistantTurn, key = "fixture-secret-key") {
  const previous = { fetch: globalThis.fetch, warn: console.warn, key: process.env.ANTHROPIC_API_KEY }
  const warnings = []
  const requests = []
  let calls = 0
  let saved
  const input = { session_id: "diagnostics-test", turn_index: 0, message: privateText, is_test: true }
  const claim = { session: { id: input.session_id, next_turn: 0, is_test: true, lead_id: null }, turn: { inbound: input.message, result: null, response: null, lead_captured: false }, token: "fixture" }
  if (key === null) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = key
  globalThis.fetch = async (_url, options) => {
    requests.push({ signal: options.signal, body: JSON.parse(options.body) })
    const response = responses[calls++]
    assert.ok(response, "unexpected provider attempt")
    if (response instanceof Error) throw response
    return response instanceof Response ? response : Response.json(response)
  }
  console.warn = (...args) => warnings.push(args)
  try {
    const result = await processAssistantTurn(input, "fixture", {
      store: { begin: async () => claim, history: async () => [{ role: "user", content: input.message }], verifyLease: async () => {}, saveModel: async (_claim, _index, value) => { saved = value }, finish: async () => {}, release: async () => {} },
      rateLimit: async () => false, fingerprint: (value) => value, model,
      phone: { display: "shop", href: "tel:+16157033296" }, validPhone: () => "",
      fileLead: async () => assert.fail("no lead"), receipt: async () => assert.fail("no receipt"), notify: async () => assert.fail("no notification"),
      handoff: async () => ({ leadId: null }),
    })
    return { result, warnings, calls, saved, requests }
  } finally {
    globalThis.fetch = previous.fetch
    console.warn = previous.warn
    if (previous.key === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = previous.key
  }
}

function diagnostic(fixture, expected) {
  assert.equal(fixture.result.handoff_reason, "model-error")
  assert.equal(fixture.warnings.length, 1)
  assert.equal(fixture.warnings[0].length, 1, "one physical log line")
  const line = fixture.warnings[0][0]
  assert.equal(typeof line, "string")
  assert.doesNotMatch(line, /private|615-555|ava@example|fixture-secret-key|\n/)
  assert.ok(line.startsWith("Assistant model error. "))
  const detail = JSON.parse(line.slice("Assistant model error. ".length))
  assert.equal(Number.isFinite(detail.elapsed_ms), true)
  assert.ok(detail.elapsed_ms >= 0)
  assert.deepEqual({ ...detail, elapsed_ms: 0 }, { ...expected, elapsed_ms: 0 })
  assert.equal(Object.hasOwn(fixture.result, "model_diagnostics"), false)
}

test("assist HTTP failures log safe status, message and actual attempts", async () => {
  diagnostic(await runTurn([new Response(privateText, { status: 401 })]), {
    name: "ClaudeResponseError", message: "Claude refused the request (401).", http_status: 401, attempt_count: 1, stop_reason: null,
  })
  const retryModel = async () => jsonWithClaude({ system: privateText, prompt: privateText, maxRetries: 1 })
  const fixture = await runTurn([new Response(privateText, { status: 503 }), new Response(privateText, { status: 503 })], retryModel)
  assert.equal(fixture.calls, 2)
  diagnostic(fixture, { name: "ClaudeResponseError", message: "Claude refused the request (503).", http_status: 503, attempt_count: 2, stop_reason: null })
})

test("assist network and timeout failures never print arbitrary error text", async () => {
  for (const failure of [new TypeError(privateText), new DOMException(privateText, "TimeoutError"), new DOMException(privateText, "AbortError")]) {
    diagnostic(await runTurn([failure]), { name: failure.name, message: null, http_status: null, attempt_count: 1, stop_reason: null })
  }
})

test("assist missing credentials log a safe configuration message before any provider attempt", async () => {
  const fixture = await runTurn([], handleAssistantTurn, null)
  diagnostic(fixture, { name: "ClaudeResponseError", message: "ANTHROPIC_API_KEY is not set.", http_status: null, attempt_count: 0, stop_reason: null })
  assert.equal(fixture.calls, 0)
})

test("assist body-reader aborts and timeouts preserve safe names on first and truncation responses", async () => {
  for (const name of ["AbortError", "TimeoutError"]) {
    for (const truncated of [false, true]) {
      const response = new Response(privateText)
      response.json = async () => { throw new DOMException(privateText, name) }
      diagnostic(await runTurn([...(truncated ? [message({ stop_reason: "max_tokens" })] : []), response]), {
        name, message: "Claude returned an invalid response.", http_status: 200,
        attempt_count: truncated ? 2 : 1, stop_reason: truncated ? "max_tokens" : null,
      })
    }
  }
})

test("assist malformed provider JSON keeps its stable safe response error", async () => {
  diagnostic(await runTurn([new Response(privateText)]), {
    name: "ClaudeResponseError", message: "Claude returned an invalid response.", http_status: 200, attempt_count: 1, stop_reason: null,
  })
})

test("assist failed truncation retry retains stop reason and counts both attempts", async () => {
  for (const [failure, name, safeMessage, status] of [
    [new Response(privateText, { status: 503 }), "ClaudeResponseError", "Claude refused the request (503).", 503],
    [new TypeError(privateText), "ClaudeResponseError", "Claude request failed.", null],
    [new DOMException(privateText, "TimeoutError"), "TimeoutError", "Claude request failed.", null],
  ]) {
    const fixture = await runTurn([message({ stop_reason: "max_tokens" }), failure])
    diagnostic(fixture, { name, message: safeMessage, http_status: status, attempt_count: 2, stop_reason: "max_tokens" })
  }
})

test("chat truncation retry shares its single 25-second deadline and has no HTTP retries", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, "timeout")
  const controller = new AbortController()
  const durations = []
  Object.defineProperty(AbortSignal, "timeout", { configurable: true, value: (duration) => { durations.push(duration); return controller.signal } })
  try {
    const fixture = await runTurn([message({ stop_reason: "max_tokens" }), message()])
    assert.notEqual(fixture.result.handoff_reason, "model-error")
    assert.deepEqual(fixture.warnings, [])
    assert.deepEqual(durations, [25_000])
    assert.deepEqual(fixture.requests.map(({ body }) => body.max_tokens), [2000, 4000])
    assert.ok(fixture.requests.every(({ signal }) => signal === controller.signal))
    const failed = await runTurn([new Response(privateText, { status: 503 })])
    assert.equal(failed.calls, 1)
  } finally {
    Object.defineProperty(AbortSignal, "timeout", descriptor)
  }
})

test("assist invalid output logs the completed provider attempt without model text", async () => {
  diagnostic(await runTurn([message({ content: [{ type: "text", text: privateText }] })]), {
    name: "ClaudeResponseError", message: "Claude returned an invalid JSON object.", http_status: 200, attempt_count: 1, stop_reason: "end_turn",
  })
  diagnostic(await runTurn([message({ content: [{ type: "text", text: JSON.stringify({ reply: privateText, fields: { ...fields, name: { privateText } } }) }] })]), {
    name: "Error", message: null, http_status: 200, attempt_count: 1, stop_reason: "end_turn",
  })
})

test("assist unknown error metadata is allowlisted and success never warns", async () => {
  diagnostic(await runTurn([], async () => { throw Object.assign(new Error(privateText), { name: privateText, modelDiagnostics: { stop_reason: privateText }, requestDiagnostics: { http_status: privateText, attempt_count: privateText } }) }), {
    name: "Error", message: null, http_status: null, attempt_count: 0, stop_reason: null,
  })
  const fixture = await runTurn([message()])
  assert.notEqual(fixture.result.handoff_reason, "model-error")
  assert.deepEqual(fixture.warnings, [])
  const forged = new ClaudeResponseError(privateText, { stop_reason: privateText, content_block_types: [], usage: null })
  forged.name = privateText
  assert.deepEqual(assistantModelErrorDiagnostics(forged, Number.NaN), {
    name: "Error", message: null, http_status: null, elapsed_ms: 0, attempt_count: 0, stop_reason: null,
  })
})
