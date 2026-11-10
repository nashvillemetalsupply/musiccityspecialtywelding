import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { buildAuditBank, gradeAuditReply } from "./assistant-audit-bank.mjs"
import { createDryFixture } from "./assistant-a4-fixture.mjs"
import { createA4Safety } from "./assistant-a4-safety.mjs"

// No credentials: reuse the existing A4 SQL fixture and deterministic provider
// boundary. All application route, turn, store, journal and handoff code is real.
// --baseline reads the pre-fix source snapshot made before audit changes.
// --prod is separate, real production HTTP; requires explicit safety attestation.
const args = process.argv.slice(2)
const prod = args.includes("--prod"), baseline = args.includes("--baseline")
const baselineRef = "69c9fc5e05a1d98c642ccef1eb3a2bf8a6dcd59f"
const output = args.includes("--output") ? args[args.indexOf("--output") + 1] : `docs/assistant-audit-${prod ? "prod" : baseline ? "before" : "after"}.json`
const root = new URL("../", import.meta.url)
const results = [], outbound = [], background = []
const originalFetch = globalThis.fetch, originalInfo = console.info, originalWarn = console.warn
const stub = (source) => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true })
let hooks, safety, active, sql, knowledge

function writeReport(mode) {
  const counts = Object.fromEntries(["ANSWERED", "HANDOFF", "WRONG", "DEAD END"].map((grade) => [grade, results.filter((r) => r.grade === grade).length]))
  const report = { mode, recordedAt: new Date().toISOString(), ...(baseline ? { baselineRef } : {}), limitation: prod ? "Production is unchanged by this branch; real model samples only, not the full bank." : "Scripted provider candidates and in-memory SQL, using the repository's A4 fixture. This proves application boundaries for these candidates; it does not establish live model expertise or exhaustive factual correctness.",
    assistantVoice: "off; no voice route imported or called", counts, total: results.length,
    ...(prod ? { outboundVerification: "Code suppression only; no production provider delivery or database readback.", safetyEvidence: ["input.ts derives is_test from [INTERNAL TEST]", "store.ts preserves sticky session test state", "service.ts gates notify on !session.is_test", "handoff.ts returns for input/session/lead/person/transcript test markers before all senders", "followup.ts gates test leads"], inputAttestation: "All 10 actual inputs used fresh UUID sessions, turn_index 0, [INTERNAL TEST] prefix and is_test:true; no fabricated IP headers, no retries." } : { outboundAttempts: outbound }),
    ...(safety ? { safety: safety.summary() } : {}), results }
  writeFileSync(new URL(output, root), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ output, mode, counts, total: results.length, outboundAttempts: outbound.length }))
  return counts
}

async function runProd() {
  assert.ok(args.includes("--test-suppression-confirmed"), "Read input/store/service/handoff/followup test guards before enabling production probes")
  const questions = [
    ["mobile", "Do you offer on-site mobile welding in Nashville?"],
    ["trailer", "What pictures help you review a cracked trailer frame?"],
    ["gate", "Do you repair gate motors or just gate metal?"],
    ["equipment", "What information should I send about a broken equipment bracket?"],
    ["fabrication", "Can you work from a dimensioned sketch for a custom bracket?"],
    ["products", "Do you make custom steel planter boxes?"],
    ["area", "Do you serve Lebanon and Franklin?"],
    ["materials", "Do you repair aluminum boats?"],
    ["human", "I want to talk directly to a person at the shop."],
    ["price", "What is your hourly welding rate and mobile callout charge?"],
  ]
  for (const [category, question] of questions) {
    const input = { session_id: randomUUID(), turn_index: 0, message: `[INTERNAL TEST] ${question}`, is_test: true }
    const response = await originalFetch("https://musiccityspecialtywelding.com/api/assist", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), redirect: "error", signal: AbortSignal.timeout(65_000),
    })
    const value = await response.json()
    const entry = { id: `P${results.length + 1}`, category, question, expected: ["human", "price"].includes(category) ? "handoff" : "answer-or-handoff" }
    const grade = gradeAuditReply(entry, value)
    if (grade.grade === "ANSWERED") grade.reason = "Live answer reviewed against site facts; no scripted provider candidate"
    results.push({ ...entry, input, status: response.status, reply: value.reply ?? value.error ?? "", handoff_reason: value.handoff_reason ?? null, ...grade })
    console.log(`Production ${entry.id}: HTTP ${response.status}`)
  }
  writeReport("LIVE production HTTP, unchanged deployment")
}

async function runDry() {
  const fixture = createDryFixture()
  fixture.env.ASSISTANT_VOICE = "0"
  sql = fixture.sql
  const state = { env: fixture.env, sql, model: async (input) => {
    assert.equal(input.isTest, true)
    const messages = JSON.parse(input.prompt).conversation
    const inbound = messages.at(-1).content
    assert.ok(inbound.startsWith("[INTERNAL TEST]"))
    const rows = await sql`/* a4:turns */ SELECT turn_index, inbound FROM assistant_turns WHERE session_id = ${active.sessionId}::uuid ORDER BY turn_index`
    assert.ok(rows.some((row) => row.inbound === inbound), "inbound persisted before model")
    if (active.failure === "throw") throw new Error("Audit fixture model unavailable")
    return { reply: active.failure === "empty" ? "" : active.candidate,
      handoff_reason: active.modelHandoff ?? null,
      fields: { name: null, callback_phone: null, need: "", material_size: null, location: null, timing: null, callback_window: null, is_job: active.isJob ?? "unsure" } }
  } }
  globalThis.__assistantAudit = state
  const block = (label) => { outbound.push(label); throw new Error("Audit blocked outbound operation") }
  safety = createA4Safety({ block, fetch: originalFetch, allowFetch: () => false })
  safety.install()
  const blockedModules = ["lib/notify.ts", "lib/messages.ts", "lib/push.ts"]
  const senderNames = (path) => [...readFileSync(new URL(path, root), "utf8").matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1])
  globalThis.__assistantAudit.sender = safety.sender
  const { default: ts } = await import("typescript")
  const fileFor = (specifier, parent = root.href) => {
    const url = specifier.startsWith("@/") ? new URL(specifier.slice(2), root) : new URL(specifier, parent)
    if (url.protocol !== "file:") return null
    return [url, new URL(`${url.href}.ts`), new URL(`${url.href}.mjs`), new URL(`${url.href}/index.ts`)].find((candidate) => existsSync(candidate) && !candidate.pathname.endsWith("/"))
  }
  hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "next/server") return stub("export const after = fn => globalThis.__assistantAudit.background.push(fn);")
      if (specifier.startsWith("@/") || specifier.startsWith(".")) {
        const url = fileFor(specifier, context.parentURL)
        if (url) {
          const path = url.href.slice(root.href.length)
          if (path === "lib/db.ts") return stub("export const dbConfigured = () => true; export const getSql = () => globalThis.__assistantAudit.sql;")
          if (path === "lib/ai.ts") return stub("export const jsonWithClaude = input => globalThis.__assistantAudit.model(input);")
          return { url: url.href, shortCircuit: true }
        }
      }
      return nextResolve(specifier, context)
    },
    load(url, context, nextLoad) {
      if (url.startsWith(root.href) && url.endsWith(".ts")) {
        const path = url.slice(root.href.length)
        if (blockedModules.includes(path)) return { format: "module", source: senderNames(path).map((name) => `export const ${name} = globalThis.__assistantAudit.sender(${JSON.stringify(`${path}:${name}`)});`).join("\n"), shortCircuit: true }
        const baselineFile = baseline && ["lib/assistant/turn.ts", "lib/assistant/contact.ts", "lib/assistant/service.ts", "lib/assistant/knowledge.ts"].includes(path)
        const snapshot = new URL(`.tmp/assistant-audit-baseline/${path.split("/").at(-1)}`, root)
        const input = baselineFile ? existsSync(snapshot) ? readFileSync(snapshot, "utf8") : execFileSync("git", ["show", `${baselineRef}:${path}`], { cwd: root, encoding: "utf8", windowsHide: true }) : readFileSync(new URL(url), "utf8")
        const source = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
        return { format: "module", source: source.replaceAll("process.env", "globalThis.__assistantAudit.env"), shortCircuit: true }
      }
      return nextLoad(url, context)
    },
  })
  state.background = background
  const entries = []
  for (const path of blockedModules) {
    const senderModule = await import(`../${path}`)
    for (const name of senderNames(path)) entries.push([`${path}:${name}`, senderModule[name]])
  }
  await safety.checkSenders(entries)
  knowledge = (await import("../lib/assistant/knowledge.ts")).assistantKnowledge
  const bank = buildAuditBank(knowledge)
  assert.ok(bank.length >= 80)
  assert.deepEqual(new Set(bank.filter((q) => q.area).map((q) => q.area)), new Set(knowledge.serviceAreas))
  for (const service of knowledge.services) assert.ok(bank.some((q) => q.category === service.slug))
  const { POST } = await import("../app/api/assist/route.ts")
  console.info = () => {}
  console.warn = () => {}
  for (const entry of bank) {
    active = { ...entry, sessionId: randomUUID() }
    const response = await POST(new Request("https://example.test/api/assist", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${results.length + 1}` },
      body: JSON.stringify({ session_id: active.sessionId, turn_index: 0, message: `[INTERNAL TEST] ${entry.question}`, is_test: true }),
    }))
    const value = await response.json()
    while (background.length) await background.shift()()
    assert.equal(response.status, 200, `route failed: ${entry.id}`)
    const session = (await sql`/* a4:session */ SELECT id, is_test FROM assistant_sessions WHERE id = ${active.sessionId}::uuid`)[0]
    assert.equal(session.is_test, true)
    const turns = await sql`/* a4:turns */ SELECT turn_index, result FROM assistant_turns WHERE session_id = ${active.sessionId}::uuid ORDER BY turn_index`
    const events = await sql`/* a4:events */ SELECT id, kind, detail, is_test FROM events WHERE detail->>'sessionId' = ${active.sessionId}::text OR external_id = ${"audit:no-call"}::text OR lead_id = ${null}::bigint ORDER BY id`
    for (const event of events) assert.equal(event.is_test, true)
    if (value.handoff_reason) assert.ok(events.some((e) => e.kind === "assistant.handoff-request"), "handoff intent persisted")
    const handoffPersisted = events.some((e) => e.kind === "assistant.handoff-request")
    results.push({ ...entry, status: response.status, reply: value.reply, handoff_reason: value.handoff_reason ?? null, branch: turns[0]?.result?.branch ?? null, handoffEvents: events.map((e) => e.kind), ...gradeAuditReply(entry, { ...value, handoffPersisted }) })
  }
  assert.equal(outbound.length, 0)
  const counts = writeReport(`DRY A4 route/SQL/provider fixture${baseline ? "; original pre-fix assistant snapshot" : ""}`)
  if (!baseline && (counts.WRONG || counts["DEAD END"])) process.exitCode = 1
}

try { if (prod) await runProd(); else await runDry() }
finally { hooks?.deregister(); safety?.restore(); console.info = originalInfo; console.warn = originalWarn; delete globalThis.__assistantAudit }
