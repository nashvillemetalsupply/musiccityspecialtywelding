import assert from "node:assert/strict"
import { createHash, timingSafeEqual } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = fileURLToPath(new URL("..", import.meta.url))
const path = resolve(root, "app/api/admin/leads/route.ts")
const output = ts.transpileModule(readFileSync(path, "utf8"), {
  fileName: path,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const secret = "synthetic-feed-secret"

const vectors = [
  { email: "  Alice.Example+Tag@EXAMPLE.COM  ", first_name: "  Alice\t", last_name: " O’Neil-Smith!  " },
  { email: "\tJOSÉ@EXAMPLE.COM\n", first_name: " ÉLODIE— ", last_name: " D’Ávila...\tJr. " },
]

// Reproduce the fixed vectors with Mirror's verbatim functions:
// node scripts/admin-leads-route.behavior.test.mjs --print-hash-vectors
if (process.argv.includes("--print-hash-vectors")) {
  const hashEmail = (email) => `sha256:${createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex")}`
  const normalizeName = (name) => String(name ?? "").trim().toLowerCase().replace(/\s+/gu, " ").replace(/\p{P}/gu, "").trim().replace(/\s+/gu, " ")
  const hashName = (name) => {
    const normalized = normalizeName(name)
    return normalized ? `sha256:${createHash("sha256").update(normalized).digest("hex")}` : null
  }
  console.log(JSON.stringify(vectors.map((row) => ({
    email_hash: hashEmail(row.email), name_hash: hashName(`${row.first_name} ${row.last_name}`),
  })), null, 2))
  process.exit(0)
}

function loadRoute({ token = secret, rows = [], now = "2026-10-03T04:59:59.000Z", dbError = false } = {}) {
  const calls = []
  const comparisons = []
  const sql = async (strings, ...values) => {
    const text = strings.join(" ? ").replace(/\s+/g, " ").trim()
    calls.push({ text, values })
    if (dbError) throw new Error("Sensitive database error: customer@example.invalid")
    // Emulate Postgres's date::timestamp AT TIME ZONE Chicago predicate.
    const day = (instant) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(instant))
    return rows.filter((row) => day(row.created_at) >= values[0] && day(row.created_at) < values[1])
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.public_id.localeCompare(b.public_id))
  }
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
  }
  const fakes = new Map([
    ["node:crypto", { createHash, timingSafeEqual: (a, b) => {
      comparisons.push([a.length, b.length])
      return timingSafeEqual(a, b)
    } }],
    ["@/lib/db", { getSql: () => sql }],
  ])
  const context = vm.createContext({
    process: { env: token === null ? {} : { LEADS_FEED_SECRET: token } }, Request, Response, URL, Buffer, Date: FixedDate,
  })
  const loaded = { exports: {} }
  const factory = vm.runInContext(`(function (exports, require, module) { ${output}\n})`, context, { filename: path })
  factory(loaded.exports, (specifier) => {
    if (fakes.has(specifier)) return fakes.get(specifier)
    throw new Error(`Unexpected lead feed import: ${specifier}`)
  }, loaded)
  const get = (query = "", authorization = `Bearer ${secret}`) => loaded.exports.GET(new Request(
    `https://example.test/api/admin/leads${query}`,
    { headers: authorization === null ? {} : { authorization } },
  ))
  return { route: loaded.exports, calls, comparisons, get }
}

function row(overrides = {}) {
  return {
    public_id: "L-20261002-ABCD", created_at: "2026-10-03T04:59:58.000Z",
    first_name: "RawFirst", last_name: "RawLast", email: "private@example.invalid",
    source: "direct", is_test: false, phone: "6155550199", address: "Private street",
    message: "Private customer message", ...overrides,
  }
}

function assertPrivate(response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store")
}

test("lead feed fails closed with 503 when its secret is unset or blank", async () => {
  for (const token of [null, "", "  "]) {
    const { get, calls } = loadRoute({ token })
    const response = await get()
    assert.equal(response.status, 503)
    assertPrivate(response)
    assert.equal(calls.length, 0)
  }
})

test("lead feed requires a bearer and compares fixed-length digests in constant time", async () => {
  const { get, calls, comparisons } = loadRoute()
  for (const auth of [null, secret, `Basic ${secret}`, "Bearer short", `Bearer ${"x".repeat(secret.length)}`, `Bearer ${secret}extra`]) {
    const response = await get("", auth)
    assert.equal(response.status, 401)
    assertPrivate(response)
  }
  assert.equal(calls.length, 0)
  assert.deepEqual(comparisons, [[32, 32], [32, 32], [32, 32]])
  assert.equal((await get()).status, 200)
  assert.deepEqual(comparisons.at(-1), [32, 32])
})

test("lead feed is dynamic Node-only, bearer-only, and has no middleware session gate", () => {
  const { route } = loadRoute()
  assert.equal(route.dynamic, "force-dynamic")
  assert.equal(route.runtime, "nodejs")
  for (const name of ["middleware", "proxy"]) {
    for (const extension of ["ts", "js", "mjs"]) {
      for (const prefix of ["", "src/"]) assert.equal(existsSync(resolve(root, `${prefix}${name}.${extension}`)), false)
    }
  }
})

test("lead feed days default to 14, clamp to 1..90, and remain oldest first ending Chicago today", async () => {
  for (const [query, count] of [["", 14], ["?days=", 14], ["?days=garbage", 14], ["?days=Infinity", 14],
    ["?days=0", 1], ["?days=-20", 1], ["?days=1", 1], ["?days=2.9", 2], ["?days=90", 90], ["?days=999", 90]]) {
    const { get, calls } = loadRoute()
    const response = await get(query)
    assert.equal(response.status, 200)
    assertPrivate(response)
    const body = await response.json()
    assert.equal(body.generated_at, "2026-10-03T04:59:59.000Z")
    assert.equal(body.days.length, count)
    assert.equal(body.days.at(-1).day, "2026-10-02", "UTC October 3 is still Chicago October 2")
    assert.deepEqual(body.days.map((bucket) => bucket.day), body.days.map((bucket) => bucket.day).sort())
    for (let i = 1; i < body.days.length; i++) {
      assert.equal(Date.parse(body.days[i].day) - Date.parse(body.days[i - 1].day), 86_400_000)
    }
    assert.ok(body.days.every(({ total, test }) => total === 0 && test === 0))
    assert.deepEqual(calls[0].values, [body.days[0].day, "2026-10-03"])
    assert.match(calls[0].text, /SELECT public_id, created_at, first_name, last_name, email, source, is_test FROM leads/)
    assert.match(calls[0].text, /created_at >= \( \? ::date::timestamp AT TIME ZONE 'America\/Chicago'\)/)
    assert.match(calls[0].text, /created_at < \( \? ::date::timestamp AT TIME ZONE 'America\/Chicago'\)/)
  }
})

test("Chicago midnight and both DST transitions include exactly the requested calendar days", async () => {
  for (const [now, start, end, previous, today] of [
    ["2026-03-09T05:00:00.000Z", "2026-03-08T06:00:00.000Z", "2026-03-10T05:00:00.000Z", "2026-03-08", "2026-03-09"],
    ["2026-11-02T06:00:00.000Z", "2026-11-01T05:00:00.000Z", "2026-11-03T06:00:00.000Z", "2026-11-01", "2026-11-02"],
  ]) {
    const rows = [
      row({ public_id: "before", created_at: new Date(Date.parse(start) - 1) }),
      row({ public_id: "start", created_at: start }),
      row({ public_id: "before-today", created_at: new Date(Date.parse(now) - 1), is_test: true }),
      row({ public_id: "today", created_at: now }),
      row({ public_id: "end", created_at: end }),
    ]
    const body = await (await loadRoute({ rows, now }).get("?days=2")).json()
    assert.deepEqual(body.leads.map(({ lead_id }) => lead_id), ["start", "before-today", "today"])
    assert.deepEqual(body.days, [{ day: previous, total: 2, test: 1 }, { day: today, total: 1, test: 0 }])
  }
})

test("hashes match two fixed Mirror vectors, including Unicode punctuation and whitespace", async () => {
  const rows = vectors.map((vector, index) => row({ ...vector, public_id: `vector-${index}` }))
  const body = await (await loadRoute({ rows }).get()).json()
  assert.deepEqual(body.leads.map(({ email_hash, name_hash }) => ({ email_hash, name_hash })), [
    { email_hash: "sha256:cbc605c49fd774ff4d9ea789d8f6bffa719e9774cb86f62d11fd244121150956", name_hash: "sha256:042a60a6c9857c58e5bfec05686feef2dc08a441bc45fffa6ce16e404207d9ef" },
    { email_hash: "sha256:b0a53cf19e34d05b57bced7365c6b00ddbe38d62957e863de2a66a56c3b42cea", name_hash: "sha256:0800e16b05e24b28f59aa710c9a28618c9b4526e56d06e3fe4cf86724af4461e" },
  ])
})

test("public IDs, sources and is_test pass through; empty identities hash to null; no PII is serialized", async () => {
  const rows = [
    row({ public_id: "unchanged-id", source: "custom/source", first_name: "[INTERNAL TEST]", is_test: false }),
    row({ public_id: "test-with-ordinary-name", created_at: "2026-10-03T04:59:58.001Z", is_test: true }),
    row({ public_id: "empty", created_at: "2026-10-03T04:59:58.002Z", first_name: "—", last_name: "...", email: " \t " }),
  ]
  const response = await loadRoute({ rows }).get()
  const serialized = await response.text()
  const body = JSON.parse(serialized)
  assert.deepEqual(Object.keys(body).sort(), ["days", "generated_at", "leads"])
  assert.deepEqual(body.leads.map(({ lead_id, source, is_test }) => ({ lead_id, source, is_test })),
    rows.map(({ public_id, source, is_test }) => ({ lead_id: public_id, source, is_test })))
  assert.equal(body.leads[2].email_hash, null)
  assert.equal(body.leads[2].name_hash, null)
  for (const lead of body.leads) {
    assert.deepEqual(Object.keys(lead).sort(), ["created_at", "email_hash", "is_test", "lead_id", "name_hash", "source"])
  }
  for (const value of ["RawFirst", "RawLast", "[INTERNAL TEST]", "private@example.invalid", "6155550199", "Private street", "Private customer message"]) {
    assert.ok(!serialized.includes(value), `raw PII leaked: ${value}`)
  }
  assert.deepEqual(body.days.at(-1), { day: "2026-10-02", total: 3, test: 1 })
})

test("database failures return a private generic 503 without leaking query errors", async () => {
  const response = await loadRoute({ dbError: true }).get()
  assert.equal(response.status, 503)
  assertPrivate(response)
  assert.deepEqual(await response.json(), { error: "Lead feed is unavailable." })
})
