import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import ts from "typescript"

const root = fileURLToPath(new URL("..", import.meta.url))
const nativeRequire = createRequire(import.meta.url)

function loadRateLimit(clock) {
  const path = resolve(root, "lib/rate-limit.ts")
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const loaded = { exports: {} }
  const rows = []
  const inserts = []
  const sql = async (strings, ...values) => {
    const text = strings.join(" ? ").replace(/\s+/g, " ").trim()
    if (text.startsWith("INSERT INTO rate_limits")) {
      rows.push({ key: values[0], ts: clock.now })
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
  class InjectedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clock.now]))
    }

    static now() {
      return clock.now
    }
  }
  const fakes = new Map([["@/lib/db", { getSql: () => sql }]])
  const context = vm.createContext({
    console,
    process: { env: {} },
    Date: InjectedDate,
    Buffer,
    require: (specifier) => {
      if (specifier === "node:crypto") return nativeRequire("node:crypto")
      if (fakes.has(specifier)) return fakes.get(specifier)
      throw new Error(`Unexpected rate-limit import: ${specifier}`)
    },
  })
  const factory = vm.runInContext(`(function (exports, require, module) { ${output}\n})`, context, { filename: path })
  factory(loaded.exports, context.require, loaded)
  return { ...loaded.exports, rows, inserts }
}

test("strict rate limit counts only timestamps inside its inclusive rolling window", async () => {
  const clock = { now: Date.parse("2026-09-26T12:00:00.000Z") }
  const limiter = loadRateLimit(clock)
  const check = () => limiter.consumeStrictRateLimit("synthetic-ip-email", 60_000, 2)

  assert.equal(await check(), false)
  clock.now += 30_000
  assert.equal(await check(), false)
  clock.now += 30_000
  assert.equal(await check(), true, "the exact window boundary is still counted (ts >= windowStart)")
  clock.now += 60_000
  assert.equal(await check(), false, "attempts older than the rolling window have aged out")
  assert.equal(limiter.inserts.length, 4)
  assert.equal(limiter.rows.length, 4)
})
