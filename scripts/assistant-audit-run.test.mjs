import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { registerHooks } from "node:module"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { auditOrigin, loadLiveAuditCases, runLiveAudit, LIVE_AUDIT_INTERVAL_MS,
  LIVE_AUDIT_OUTPUT, LIVE_AUDIT_SOURCE, LIVE_AUDIT_PARAPHRASES } from "./assistant-audit-live.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const runner = fileURLToPath(new URL("./assistant-audit-run.mjs", import.meta.url))
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/shop-contact") return {
      url: `data:text/javascript,${encodeURIComponent('export const getShopPhone = () => ({display:"(615) 555-0177",href:"tel:+16155550177"});')}`,
      shortCircuit: true,
    }
    return nextResolve(specifier, context)
  },
})
let findAssistantAnswer
try { ({ findAssistantAnswer } = await import("../lib/assistant/answers.ts")) }
finally { hooks.deregister() }

function runNode(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", ...args], {
      cwd: root, env, windowsHide: true,
    })
    let stdout = "", stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

function run(args, { env = {}, setup = `globalThis.fetch = () => { throw new Error("Unexpected network request"); };` } = {}) {
  return runNode(["--import", `data:text/javascript,${encodeURIComponent(setup)}`, runner, ...args], env)
}

test("live audit refuses a missing base URL before any network request", async () => {
  const result = await run(["--prod", "--test-suppression-confirmed"])
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /--base-url/)
  assert.doesNotMatch(result.stderr, /Unexpected network request/)
})

test("live case set has the exact 82 offline handoffs and three novel paraphrases per named row", () => {
  const cases = loadLiveAuditCases(path.join(root, LIVE_AUDIT_SOURCE), path.join(root, LIVE_AUDIT_PARAPHRASES))
  const offline = JSON.parse(readFileSync(path.join(root, LIVE_AUDIT_SOURCE), "utf8"))
  assert.deepEqual(cases.filter((entry) => entry.set === "offline-handoff").map((entry) => entry.id),
    offline.results.filter((entry) => entry.grade === "HANDOFF").map((entry) => entry.id))
  const paraphrases = cases.filter((entry) => entry.set === "sourced-paraphrase")
  assert.equal(cases.length, 118)
  assert.equal(paraphrases.length, 36)
  const counts = Map.groupBy(paraphrases, (entry) => entry.canonicalQuestion)
  assert.equal(counts.size, 12)
  for (const rows of counts.values()) {
    assert.equal(rows.length, 3)
    assert.ok(rows.every((entry) => entry.expected === "answer" && entry.source && entry.referenceAnswer))
  }
  // Exercise the real matcher, including its greeting, grammar, synonym,
  // suffix and internal-test normalization, rather than comparing raw text.
  for (const entry of paraphrases) assert.equal(findAssistantAnswer(`[INTERNAL TEST] ${entry.question}`), undefined, entry.question)
  assert.equal(LIVE_AUDIT_OUTPUT, "docs/assistant-audit-live-r3.json")
})

test("live audit marks all 118 mocked requests and stays strictly below 60 per ten minutes", async () => {
  const cases = loadLiveAuditCases(path.join(root, LIVE_AUDIT_SOURCE), path.join(root, LIVE_AUDIT_PARAPHRASES))
  const requests = []
  let clock = 0
  const results = await runLiveAudit(cases, {
    baseUrl: "http://127.0.0.1:1/", now: () => clock, wait: async (ms) => { clock += ms },
    fetch: async (url, init) => {
      requests.push({ url, ...init, input: JSON.parse(init.body), start: clock })
      return new Response(JSON.stringify({ reply: "We review the exact job scope.", handoff_reason: null }))
    },
  })
  assert.equal(requests.length, 118)
  assert.equal(results.length, 118)
  for (const [index, request] of requests.entries()) {
    assert.equal(request.method, "POST")
    assert.equal(request.url, "http://127.0.0.1:1/api/assist")
    assert.equal(request.redirect, "error")
    assert.ok(request.signal instanceof AbortSignal)
    assert.equal(request.input.is_test, true)
    assert.equal(request.input.message, `[INTERNAL TEST] ${cases[index].question}`)
    assert.equal(request.input.turn_index, 0)
    assert.match(request.input.session_id, /^[0-9a-f-]{36}$/)
    if (index) assert.ok(request.start - requests[index - 1].start >= LIVE_AUDIT_INTERVAL_MS)
    assert.ok(requests.filter((other) => other.start >= request.start && other.start <= request.start + 600_000).length < 60)
  }
  assert.equal(new Set(requests.map((request) => request.input.session_id)).size, requests.length)
  assert.ok(results.every((entry) => entry.review === "PENDING"))
})

test("live audit sends the OIDC header on every request and redacts diagnostics and results", async () => {
  const token = 'synthetic"oidc\\token'
  const result = await runNode(["--input-type=module", "--eval", `
    import assert from "node:assert/strict"
    import { runLiveAudit } from "./scripts/assistant-audit-live.mjs"
    const token = process.env.VERCEL_OIDC_TOKEN
    const cases = [{ id: "T1", question: "First?" }, { id: "T2", question: "Second?" }]
    const observed = [], requests = []
    let clock = 0
    const results = await runLiveAudit(cases, {
      baseUrl: "https://preview.example.test", now: () => clock, wait: async (ms) => { clock += ms },
      onResult: (result) => observed.push(result),
      fetch: async (url, init) => {
        assert.equal(new Headers(init.headers).get("x-vercel-trusted-oidc-idp-token"), token)
        requests.push(JSON.stringify({ url, ...init }))
        return new Response(JSON.stringify({ reply: token, handoff_reason: token }))
      },
    })
    assert.equal(requests.length, 2)
    assert.ok(requests.every((request) => request.includes("[REDACTED]")))
    const failed = await runLiveAudit(cases, {
      baseUrl: "https://preview.example.test",
      fetch: async (url, init) => {
        throw new Error(token + " " + JSON.stringify({ url, ...init, headers: Object.fromEntries(init.headers) }))
      },
    })
    const escapedToken = JSON.stringify(token).slice(1, -1)
    for (const result of results) {
      assert.equal(result.status, 200)
      assert.equal(result.reply, "[REDACTED]")
      assert.equal(result.handoff_reason, "[REDACTED]")
      assert.ok(!result.reply.includes(token) && !result.reply.includes(escapedToken))
      assert.ok(!result.handoff_reason.includes(token) && !result.handoff_reason.includes(escapedToken))
    }
    assert.ok(!failed[0].reason.includes(token) && !failed[0].reason.includes(escapedToken))
    const nested = await runLiveAudit(cases.slice(0, 1), {
      baseUrl: "https://preview.example.test",
      fetch: async () => new Response(JSON.stringify({ reply: { [token]: [{ [escapedToken]: token }] } })),
    })
    assert.deepEqual(nested[0].reply, { "[REDACTED]": [{ "[REDACTED]": "[REDACTED]" }] })
    console.log(JSON.stringify({ results, observed, requests, failed, nested }))
  `], { VERCEL_OIDC_TOKEN: token })
  assert.equal(result.code, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.results.length, 2)
  assert.equal(output.failed[0].status, null)
  assert.match(output.failed[0].reason, /\[REDACTED\]/)
  assert.ok(!JSON.stringify(output).includes(token))
  assert.ok(!result.stdout.includes(JSON.stringify(token).slice(1, -1)))
  assert.ok(!result.stderr.includes(token))
})

test("live audit omits the OIDC header when the environment value is unset or empty", async () => {
  for (const env of [{}, { VERCEL_OIDC_TOKEN: "" }]) {
    const result = await runNode(["--input-type=module", "--eval", `
      import assert from "node:assert/strict"
      import { runLiveAudit } from "./scripts/assistant-audit-live.mjs"
      let observed
      const results = await runLiveAudit([{ id: "T1", question: "First?" }], {
        baseUrl: "https://preview.example.test",
        fetch: async (_url, init) => {
          const headers = new Headers(init.headers)
          observed = { hasOidc: headers.has("x-vercel-trusted-oidc-idp-token"), contentType: headers.get("content-type") }
          return new Response(JSON.stringify({ reply: "Scope review required." }))
        },
      })
      assert.deepEqual(observed, { hasOidc: false, contentType: "application/json" })
      assert.equal(results.length, 1)
      assert.equal(results[0].status, 200)
    `], env)
    assert.equal(result.code, 0, result.stderr)
  }
})

test("live runner output JSON and console output never contain the OIDC token", async () => {
  mkdirSync(path.join(root, ".tmp"), { recursive: true })
  const temporary = mkdtempSync(path.join(root, ".tmp", "audit-runner-oidc-test-"))
  const output = path.join(temporary, "report.json")
  const token = "synthetic-runner-oidc-token"
  try {
    const result = await run(["--prod", "--base-url", "https://preview.example.test", "--test-suppression-confirmed", "--output", output], {
      env: { VERCEL_OIDC_TOKEN: token },
      setup: `globalThis.fetch = async (_url, init) => {
        const token = process.env.VERCEL_OIDC_TOKEN
        if (new Headers(init.headers).get("x-vercel-trusted-oidc-idp-token") !== token) throw new Error("Missing OIDC header")
        return new Response(JSON.stringify({ reply: token, handoff_reason: token }), { status: 503 })
      };`,
    })
    assert.equal(result.code, 1)
    const report = readFileSync(output, "utf8")
    assert.equal(JSON.parse(report).results[0].reply, "[REDACTED]")
    assert.ok(!report.includes(token))
    assert.ok(!result.stdout.includes(token))
    assert.ok(!result.stderr.includes(token))
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test("live runner rejects malformed OIDC tokens without exposing them or sending a request", async () => {
  mkdirSync(path.join(root, ".tmp"), { recursive: true })
  const temporary = mkdtempSync(path.join(root, ".tmp", "audit-runner-invalid-oidc-test-"))
  const output = path.join(temporary, "report.json")
  const token = "synthetic-invalid-oidc-token\nprivate-credential"
  try {
    const result = await run(["--prod", "--base-url", "https://preview.example.test", "--test-suppression-confirmed", "--output", output], {
      env: { VERCEL_OIDC_TOKEN: token },
    })
    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /VERCEL_OIDC_TOKEN is not a valid HTTP header value/)
    assert.doesNotMatch(result.stderr, /Unexpected network request/)
    for (const secret of [token, JSON.stringify(token).slice(1, -1), ...token.split("\n")]) {
      assert.ok(!result.stderr.includes(secret))
      assert.ok(!result.stdout.includes(secret))
    }
    assert.equal(existsSync(output), false)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test("pacing accounts for slow responses and never retries rate limits or transport failures", async () => {
  const cases = [{ id: "T1", question: "First?" }, { id: "T2", question: "Second?" }, { id: "T3", question: "Third?" }]
  let clock = 0, waits = 0
  const starts = []
  const results = await runLiveAudit(cases, {
    baseUrl: "http://127.0.0.1:1", now: () => clock, wait: async () => { waits++ },
    fetch: async () => {
      starts.push(clock)
      clock += 20_000
      return new Response(JSON.stringify({ reply: "Unavailable" }), { status: starts.length === 2 ? 429 : 200 })
    },
  })
  assert.deepEqual(starts, [0, 20_000])
  assert.equal(waits, 0)
  assert.equal(results.length, 2)
  assert.equal(results[1].grade, "DEAD END")
  let calls = 0
  const failed = await runLiveAudit(cases, { baseUrl: "http://127.0.0.1:1", fetch: async () => { calls++; throw new Error("synthetic unavailable endpoint") } })
  assert.equal(calls, 1)
  assert.equal(failed.length, 1)
  assert.equal(failed[0].status, null)
  assert.equal(failed[0].grade, "DEAD END")
})

test("live paraphrase grading rejects a handoff and leaves factual review pending", async () => {
  const [result] = await runLiveAudit([{ id: "P1", expected: "answer", question: "Can I send a photo here?" }], {
    baseUrl: "http://127.0.0.1:1", fetch: async () => new Response(JSON.stringify({ reply: "Ask the shop.", handoff_reason: "unknown" })),
  })
  assert.equal(result.grade, "DEAD END")
  assert.match(result.reason, /required sourced answer/)
  assert.equal(result.review, "PENDING")
})

test("live audit accepts only explicit HTTP origins without paths, secrets or redirects", async () => {
  for (const value of ["https://preview.example.test/api/assist", "https://user:pass@preview.example.test", "https://preview.example.test?bypass=secret", "https://preview.example.test/#section", "file:///tmp/audit"]) {
    assert.throws(() => auditOrigin(value), /origin without credentials/)
  }
  for (const hostname of ["musiccityspecialtywelding.com", "www.musiccityspecialtywelding.com", "preview.musiccityspecialtywelding.com"]) {
    assert.throws(() => auditOrigin(`https://${hostname}`), /production hostname/)
  }
  const result = await run(["--prod", "--base-url", "https://preview.example.test/api/assist", "--test-suppression-confirmed"])
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /origin without credentials/)
  assert.doesNotMatch(result.stderr, /Unexpected network request/)
})

test("live audit rejects an existing report before any network request", async () => {
  mkdirSync(path.join(root, ".tmp"), { recursive: true })
  const temporary = mkdtempSync(path.join(root, ".tmp", "audit-runner-existing-test-"))
  const output = path.join(temporary, "existing.json")
  writeFileSync(output, "existing evidence\n")
  try {
    const result = await run(["--prod", "--base-url", "http://127.0.0.1:1", "--test-suppression-confirmed", "--output", output])
    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /report already exists/)
    assert.doesNotMatch(result.stderr, /Unexpected network request/)
    assert.equal(readFileSync(output, "utf8"), "existing evidence\n")
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
