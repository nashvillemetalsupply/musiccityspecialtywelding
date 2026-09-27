import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = fileURLToPath(new URL("..", import.meta.url))
const nativeRequire = createRequire(import.meta.url)
const quietConsole = { error() {}, warn() {}, log() {} }

function transpile(path) {
  return ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
}

function loadStrictRateLimit({ failStore = false } = {}) {
  const path = resolve(root, "lib/rate-limit.ts")
  const rows = []
  const inserts = []
  const sql = async (strings, ...values) => {
    const text = strings.join(" ? ").replace(/\s+/g, " ").trim()
    if (failStore) throw new Error("database unavailable")
    if (text.startsWith("INSERT INTO rate_limits")) {
      rows.push({ key: values[0], ts: Date.now() })
      inserts.push({ text, values })
      return []
    }
    if (text.includes("SELECT count(*)::int AS count FROM rate_limits")) {
      const [key, start] = values
      const threshold = Date.parse(start)
      return [{ count: rows.filter((row) => row.key === key && row.ts >= threshold).length }]
    }
    throw new Error(`Unexpected rate-limit query: ${text}`)
  }
  const context = vm.createContext({
    console: quietConsole,
    process: { env: {} },
    Buffer,
    require: (specifier) => {
      if (specifier === "node:crypto") return nativeRequire("node:crypto")
      if (specifier === "@/lib/db") return { getSql: () => sql }
      throw new Error(`Unexpected rate-limit import: ${specifier}`)
    },
  })
  const loaded = { exports: {} }
  const factory = vm.runInContext(`(function (exports, require, module) { ${transpile(path)}\n})`, context, { filename: path })
  factory(loaded.exports, context.require, loaded)
  return { ...loaded.exports, inserts }
}

function loadLoginRoute(rateLimit) {
  const path = resolve(root, "app/api/ops/login/route.ts")
  const moduleFakes = new Map([
    ["resend", { Resend: class { constructor() { throw new Error("email must not be sent in limiter tests") } } }],
    ["@/lib/db", { dbConfigured: () => true }],
    ["@/lib/rate-limit", rateLimit],
    ["@/lib/leads", { isRateLimitedDurable: async () => false }],
    ["@/lib/email-templates", { brandedEmail: () => "" }],
    ["@/lib/ops-auth", { CANONICAL_ORIGIN: "https://example.test", createLoginToken: async () => "unused" }],
    ["@/lib/operators", { getOperatorByEmail: async () => null, getOperatorByPunchSelector: async () => null }],
  ])
  const context = vm.createContext({
    console: quietConsole,
    process: { env: {} },
    Response,
    require: (specifier) => {
      if (moduleFakes.has(specifier)) return moduleFakes.get(specifier)
      throw new Error(`Unexpected login import: ${specifier}`)
    },
  })
  const loaded = { exports: {} }
  const factory = vm.runInContext(`(function (exports, require, module) { ${transpile(path)}\n})`, context, { filename: path })
  factory(loaded.exports, context.require, loaded)
  return loaded.exports
}

async function postLogin(route, email) {
  return route.POST(new Request("https://example.test/api/ops/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.17" },
    body: JSON.stringify({ email }),
  }))
}

test("login refuses attempt six and keys it by IP plus a hash of normalized email", async () => {
  const limiter = loadStrictRateLimit()
  const route = loadLoginRoute(limiter)
  let sixth
  for (let attempt = 1; attempt <= 6; attempt++) {
    const response = await postLogin(route, attempt % 2 ? " Owner@Shop.COM " : "OWNER@SHOP.com")
    if (attempt < 6) assert.equal(response.status, 503, "the allowed path stops at missing mail configuration")
    else sixth = response
  }

  assert.equal(sixth.status, 429)
  assert.match((await sixth.json()).error, /Wait a few minutes/)
  const emailHash = createHash("sha256").update("owner@shop.com").digest("hex").slice(0, 32)
  assert.deepEqual(limiter.inserts.map((row) => row.values[0]), Array(6).fill(`ops-login:ip:203.0.113.17:email:${emailHash}`))
})

test("login refuses with a retry response when the limiter store throws", async () => {
  const route = loadLoginRoute(loadStrictRateLimit({ failStore: true }))
  const response = await postLogin(route, "owner@shop.com")
  assert.equal(response.status, 429)
  assert.match((await response.json()).error, /Wait a few minutes/)
})

test("expired rate-limit cleanup runs in the recovery sweep, not the lead request limiter", () => {
  const leads = readFileSync(new URL("../lib/leads.ts", import.meta.url), "utf8")
  const limiterStart = leads.indexOf("export async function isRateLimitedDurable")
  const limiterEnd = leads.indexOf("\n}", limiterStart)
  const limiter = leads.slice(limiterStart, limiterEnd)
  const sweep = readFileSync(new URL("../lib/recovery-sweep.ts", import.meta.url), "utf8")

  assert.doesNotMatch(limiter, /DELETE FROM rate_limits/)
  assert.match(sweep, /DELETE FROM rate_limits WHERE ts < now\(\) - interval '1 day'/)
})
