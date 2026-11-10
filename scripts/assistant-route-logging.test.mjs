import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { AssistantRequestError } from "../lib/assistant/input.ts"
import { assistantContactReply } from "../lib/assistant/contact.ts"

const compiled = ts.transpileModule(readFileSync(new URL("../app/api/assist/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function route({ enabled = true, reason, failure, invalidInput = false } = {}) {
  const logs = []
  const input = { session_id: "126e8815-0502-4f7d-94a5-0df870ac6b46", turn_index: 0, message: "private customer 615-555-0199 ava@example.com", is_test: true }
  const modules = new Map([
    ["@/lib/assistant/input.ts", { AssistantRequestError, readAssistantInput: async () => {
      if (invalidInput) throw new AssistantRequestError("private invalid input", 400)
      return input
    } }],
    ["@/lib/assistant/contact.ts", { assistantContactReply }],
    ["@/lib/assistant/service.ts", { processAssistantTurn: async () => {
      if (failure) throw failure
      return { ok: true, reply: "private reply", handoff_reason: reason }
    } }],
    ["@/lib/assistant/store.ts", { PostgresAssistantStore: class {} }],
    ["@/lib/assistant/turn.ts", { handleAssistantTurn() {} }],
    ["@/lib/assistant/money.ts", { stripAssistantMoney: (value) => value }],
    ["@/lib/assistant/handoff.ts", { deliverAssistantHandoff: async () => ({ leadId: null }) }],
    ["@/lib/db", { getSql() { assert.fail("logging test cannot access database") } }],
    ["@/lib/events", { recordEvent() {} }],
    ["@/lib/job-intake", { fileAssistantLead() {} }],
    ["@/lib/people", { normalizePhone() {}, isReservedShopPhone() {} }],
    ["@/lib/rate-limit", { consumeStrictRateLimit() {}, rateLimitFingerprint() {} }],
    ["@/lib/shop-contact", { getShopPhone: () => ({ display: "(615) 703-3296", href: "tel:+16157033296" }) }],
  ])
  const loaded = { exports: {} }
  const context = vm.createContext({ Response, console: { info: (...values) => logs.push(JSON.parse(JSON.stringify(values))), error() {} }, process: { env: enabled ? { NEXT_PUBLIC_ASSISTANT_CHAT: "1" } : {} } })
  vm.runInContext(`(function(require,module,exports){${compiled}\n})`, context)((name) => {
    assert.ok(modules.has(name), `unmocked route import ${name}`)
    return modules.get(name)
  }, loaded, loaded.exports)
  return { logs, post: () => loaded.exports.POST(new Request("http://localhost/api/assist", { method: "POST" })) }
}

test("assist 200 responses log only an allowlisted handoff reason and status", async () => {
  for (const reason of [undefined, "human", "unknown", "model-error", "rate-limit", "private customer 615-555-0199"]) {
    const f = route({ reason })
    assert.equal((await f.post()).status, 200)
    assert.deepEqual(f.logs, [["Assistant chat response.", { status: 200, handoff_reason: ["human", "unknown", "model-error", "rate-limit"].includes(reason) ? reason : null }]])
    assert.doesNotMatch(JSON.stringify(f.logs), /private|615-555|ava@example|session_id|reply/)
  }
})

test("assist disabled and error responses log fixed reasons without customer or error text", async () => {
  for (const [options, status, reason] of [
    [{ enabled: false }, 404, null],
    [{ invalidInput: true }, 400, null],
    [{ failure: new AssistantRequestError("private rate limit", 429) }, 429, "rate-limit"],
    [{ failure: new AssistantRequestError("private lease", 409) }, 409, "unavailable"],
    [{ failure: new Error("private provider key-secret") }, 503, "unavailable"],
  ]) {
    const f = route(options)
    assert.equal((await f.post()).status, status)
    assert.deepEqual(f.logs, [["Assistant chat response.", { status, handoff_reason: reason }]])
    assert.doesNotMatch(JSON.stringify(f.logs), /private|615-555|ava@example|key-secret/)
  }
})
