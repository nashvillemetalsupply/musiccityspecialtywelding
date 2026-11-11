import assert from "node:assert/strict"
import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"
import { createDryFixture } from "./assistant-a4-fixture.mjs"
import { createA4Safety } from "./assistant-a4-safety.mjs"
import { checkEnvironment, errorDiagnostic, runPreflight, sanitizeDiagnostic } from "./assistant-a4-diagnostics.mjs"
import { parseA4Args, runAskConversation, safeModelDiagnostics } from "./assistant-a4-ask.mjs"

// Usage: node --experimental-strip-types scripts/assistant-a4-run.mjs <env-file> [--dry]
// Or:    node --experimental-strip-types scripts/assistant-a4-run.mjs --dry
// Check only: node --experimental-strip-types scripts/assistant-a4-run.mjs <env-file> --preflight
// Ask: node --experimental-strip-types scripts/assistant-a4-run.mjs --env <env-file> --ask "<message>" [--ask "<message2>"]
// No HTTP server or Twilio API is involved. Dial is inspected, never executed.
const root = new URL("../", import.meta.url)
let options, argumentFailure
try { options = parseA4Args(process.argv.slice(2)) }
catch (error) { argumentFailure = error }
const { dry, preflight, asks } = options ?? { dry: process.argv.includes("--dry"), preflight: false, asks: [] }
const reportPath = new URL("docs/ASSISTANT-A4-RUNS.md", root)
const diagnosticPath = new URL(".tmp/a4-diagnostic.json", root)
const results = [], outbound = [], background = [], diagnostics = [], failures = []
const originalFetch = globalThis.fetch, originalError = console.error, originalWarn = console.warn
let hooks, ts, modelRequests = 0, fixture, env, sql, assist, voice, recover, voiceSessionId, twilio, setupFailure, activeRecord, safety
let stage = "env-load"
const seenErrors = new WeakMap(), sqlWrappers = new WeakMap()
const marked = (text) => `[INTERNAL TEST] ${text}`
const phone = "+16155550100"
const block = (label) => {
  outbound.push(label)
  const error = new Error("Outbound sender was blocked by A4")
  failure(stage, error)
  throw error
}
const stub = (source) => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true })

function failure(at, error) {
  const object = error !== null && (typeof error === "object" || typeof error === "function")
  let diagnostic = object ? seenErrors.get(error) : null
  if (!diagnostic) {
    diagnostic = errorDiagnostic(at, error, { ...process.env, ...env })
    failures.push({ script: activeRecord?.name ?? "Harness setup", ...diagnostic })
    if (object) seenErrors.set(error, diagnostic)
  }
  if (activeRecord && !activeRecord.diagnostics.includes(diagnostic)) activeRecord.diagnostics.push(diagnostic)
  return diagnostic
}

async function step(at, run) {
  const previous = stage
  stage = at
  try { return await run() }
  catch (error) { failure(at, error); throw error }
  finally { stage = previous }
}

function wrapSql(query) {
  if (!sqlWrappers.has(query)) sqlWrappers.set(query, (...args) => step(stage, () => query(...args)))
  return sqlWrappers.get(query)
}

function loadEnv() {
  process.chdir(fileURLToPath(root))
  if (argumentFailure) throw argumentFailure
  if (options.envFile) process.loadEnvFile(options.envFile)
  else if (!dry) throw new Error("Environment file path is required")
}

function redact(value) {
  let text = String(value)
  // All replies are verbatim except required privacy redactions. Never include
  // provider error objects, request headers, credentials or environment dumps.
  const owner = env?.OWNER_CELL_PHONE?.trim()
  if (owner) text = text.split(owner).join("***")
  for (const [name, value] of Object.entries({ ...process.env, ...env })) {
    if (!/(?:KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|AUTH)/i.test(name) || typeof value !== "string" || !value.trim()) continue
    const secret = value.trim()
    for (const candidate of new Set([secret, encodeURIComponent(secret)])) text = text.split(candidate).join("[redacted]")
  }
  for (const secret of Object.values({ ...process.env, ...env }).filter((v) => v && v.length >= 6).sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join("[redacted]")
  }
  return text.replace(/\b(?:sk-ant-|sk[-_]|gh[pousr]_|xox[baprs]-)[A-Z\d_-]+/gi, "[redacted]")
    .replace(/(?<!\d)(?:\+?1[ .-]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[ .-]?[2-9]\d{2}[ .-]?\d{4}(?!\d)/g,
    (number) => number.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "") === "6155550100" ? number : "***")
}

function writeReport() {
  const passed = results.filter((r) => r.pass).length
  const lines = ["# Assistant A4 scripted runs", "", `Mode: **${dry ? "DRY — fixture model, DB and Twilio configuration" : "LIVE — real model and shared Neon DB"}**.`,
    `Result: **${passed}/8 PASS**. Live verification ${dry ? "pending" : "attempted in-process; see each script result"}.`,
    "", "Each inbound contains [INTERNAL TEST]. Outbound senders are blocked in both modes; returned Dial instructions are never submitted to Twilio.",
    "Assistant replies below preserve returned text, with phone numbers other than 615-555-0100 and environment values redacted. OWNER_CELL_PHONE is ***.",
    "The partial-email script advances only its own test session's idle timestamp and runs recovery scoped to that session. Replay seeds its own session and reuses its original turn indexes.",
    "Run `node --experimental-strip-types scripts/assistant-a4-run.mjs .env.local --preflight` for environment names and a read-only DB check; preflight makes no model calls or file/database writes.",
    "Sanitized failure details are also saved to `.tmp/a4-diagnostic.json` (gitignored).", ""]
  if (env) {
    const checked = checkEnvironment(env)
    lines.push("## Environment check", "", `Required variable names: ${checked.required.join(", ")}.`,
      `Missing/empty variable names: ${checked.missing.join(", ") || "none"}.`, ...checked.notes.map((note) => `${note}\n`), "")
  }
  for (const r of results) {
    lines.push(`## ${r.name}: ${r.pass ? "PASS" : "FAIL"}`, "")
    for (const item of r.transcript) lines.push(`**${item.role}**`, "", "```text", redact(item.text).replaceAll("```", "` ` `"), "```", "")
    lines.push(`Lead/handoff: ${redact(r.detail || "No readback completed.")}`, "")
    for (const diagnostic of r.diagnostics) lines.push("Failure diagnostic:", "", "```json", JSON.stringify(diagnostic, null, 2).replaceAll("```", "` ` `"), "```", "")
  }
  lines.push(`Outbound attempts blocked: ${outbound.length} (notify/SMS/email must each remain zero).`,
    `Model ${dry ? "fixture calls" : "HTTP requests"}: ${dry ? fixture?.modelCalls() ?? 0 : modelRequests}.`,
    `Suppressed diagnostic messages: ${diagnostics.length}.`, "")
  writeFileSync(reportPath, lines.join("\n"))
  mkdirSync(new URL(".tmp/", root), { recursive: true })
  writeFileSync(diagnosticPath, `${JSON.stringify({ mode: dry ? "dry" : "live", passed, total: 8,
    environment: env ? checkEnvironment(env) : null,
    safety: safety?.summary() ?? { pass: false, intercepted: [] },
    results: results.map(({ name, pass, diagnostics }) => ({ name, pass, diagnostics })),
    diagnostics: failures, modelRequests, outboundAttempts: outbound.length,
  }, null, 2)}\n`)
}

async function drain() {
  let firstError
  while (background.length) {
    try { await step("route", background.shift()) }
    catch (error) { firstError ??= error }
  }
  if (firstError) throw firstError
}

async function snapshot(id, sid = "") {
  stage = "readback"
  const key = sid ? `call:${sid}` : `assistant:${id}`
  const sessions = await sql`/* a4:session */ SELECT id, next_turn, is_test, lead_id FROM assistant_sessions WHERE id = ${id}::uuid`
  const turns = await sql`/* a4:turns */ SELECT turn_index, inbound, result, response, is_test FROM assistant_turns WHERE session_id = ${id}::uuid ORDER BY turn_index`
  const leads = await sql`/* a4:leads */ SELECT id, first_name, phone, email, message, person_id, is_test, intake_key FROM leads WHERE intake_key = ${key}::text`
  const leadId = Number(sessions[0]?.lead_id ?? leads[0]?.id) || null
  const events = await sql`/* a4:events */ SELECT id, kind, body, detail, is_test FROM events
    WHERE detail->>'sessionId' = ${id}::text OR external_id = ${sid || "a4:no-call"}::text OR lead_id = ${leadId}::bigint ORDER BY id`
  const people = await sql`/* a4:people */ SELECT id, is_test FROM people WHERE id = ${leads[0]?.person_id ?? null}::bigint`
  const calls = await sql`/* a4:call */ SELECT is_test, lead_id FROM calls WHERE twilio_sid = ${sid}::text`
  const sends = await sql`/* a4:outbound */ SELECT
    (SELECT count(*)::int FROM notifications n JOIN events e ON e.id = n.source_event_id
      WHERE e.detail->>'sessionId' = ${id}::text OR e.lead_id = ${leadId}::bigint) AS notifications,
    (SELECT count(*)::int FROM messages WHERE lead_id = ${leadId}::bigint
      OR idempotency_key = ${`assistant-no-answer:${sid}`}::text) AS sms,
    (SELECT count(*)::int FROM events WHERE kind = 'email.out'
      AND (detail->>'sessionId' = ${id}::text OR lead_id = ${leadId}::bigint)) AS email`
  return { sessions, turns, leads, events, people, calls, sends: sends[0] }
}

function verifyPartition(s) {
  assert.equal(s.sessions.length, 1, "session must persist")
  assert.equal(s.sessions[0].is_test, true, "session test marker")
  for (const [kind, rows] of Object.entries({ turns: s.turns, leads: s.leads, events: s.events, people: s.people, calls: s.calls })) {
    for (const row of rows) assert.equal(row.is_test, true, `${kind} test marker`)
  }
  for (const t of s.turns) assert.ok(t.inbound.startsWith("[INTERNAL TEST]"), "persisted inbound marker")
  assert.deepEqual(Object.values(s.sends).map(Number), [0, 0, 0], "no durable notification, SMS or email intent")
  assert.equal(outbound.length, activeRecord.outboundBefore, "no sender may be invoked")
}

function verifyReply(reply, first = false, reason = null) {
  assert.equal(typeof reply, "string", "assistant reply")
  if (first) assert.match(reply, /I(?:'m| am) an automated assistant/i, "first reply disclosure")
  assert.doesNotMatch(reply, /\$|\b\d[\d,.]*\s*(?:dollars|USD)|\[owner-only money\]/i, "no money in reply")
  if (reason) {
    assert.match(reply, /\]\(tel:\+\d+\)/, "tap-to-call offered")
    assert.ok(reply.includes("sales@musiccityspecialtywelding.com"), "shop email offered")
    assert.match(reply, /mailto:sales@musiccityspecialtywelding\.com/, "email link offered")
  }
}

function verifyHandoff(s, reason) {
  assert.ok(s.events.some((e) => e.kind === "assistant.handoff-request" && e.detail?.reason === reason), "handoff intent persisted")
  assert.ok(s.events.some((e) => e.kind === "assistant.handoff" && e.detail?.reason === reason), "handoff reason recorded")
}

async function script(name, run) {
  const record = { name, transcript: [], detail: "", pass: false, diagnostics: [], outboundBefore: outbound.length }
  results.push(record)
  activeRecord = record
  stage = "route"
  const errorsBefore = diagnostics.length
  try {
    if (setupFailure) { record.diagnostics.push(setupFailure); return }
    await step("outbound-safety", () => safety.verify())
    if (!dry) await step("env-check", () => {
      const checked = checkEnvironment(env)
      if (checked.missing.length) {
        const error = new Error(`Missing/empty required environment variables: ${checked.missing.join(", ")}`)
        error.name = "EnvironmentError"; error.code = "A4_ENV_MISSING"
        throw error
      }
    })
    await step("db-connect", async () => {
      const { getSql } = await step("import", () => import("../lib/db.ts"))
      sql = getSql()
      if (!dry) await sql`SELECT 1 AS ok`
    })
    await step("import", async () => {
      if (/^[78]\./.test(name)) {
        ;({ POST: voice } = await import("../app/api/twilio/assist-voice/route.ts"))
        ;({ voiceSessionId } = await import("../lib/assistant/voice.ts"))
        twilio = await import("../lib/twilio.ts")
      } else {
        ;({ POST: assist } = await import("../app/api/assist/route.ts"))
      }
      if (name.startsWith("5.")) ({ recoverAssistantHandoffs: recover } = await import("../lib/assistant/handoff.ts"))
    })
    if (/^[78]\./.test(name)) await step("env-check", () => assert.equal(twilio.twilioVoiceConfigured(), true, "voice configuration must be ready"))
    try { await run(record) }
    finally { await drain() }
    assert.equal(diagnostics.length, errorsBefore, "route/storage/provider diagnostic indicates failure")
    assert.equal(record.diagnostics.length, 0, "execution boundary recorded a failure")
    assert.equal(outbound.length, record.outboundBefore, "outbound sender was invoked")
    await step("outbound-safety", () => safety.verify())
    record.pass = true
  } catch (error) {
    failure(stage, error)
    if (record.id) {
      try {
        const s = await snapshot(record.id, record.sid)
        record.detail = `${s.leads.length} leads; handoff reasons: ${s.events.filter((e) => e.kind === "assistant.handoff").map((e) => e.detail?.reason).join(", ") || "none"}.`
      } catch (readbackError) { failure("readback", readbackError); record.detail = "Lead/handoff readback failed." }
    }
  } finally { activeRecord = null }
}

async function chat(record, id, messages, reason = null) {
  stage = "route"
  const replies = []
  for (let i = 0; i < messages.length; i++) {
    const message = marked(messages[i])
    record.transcript.push({ role: "Customer", text: message })
    const response = await assist(new Request("https://example.test/api/assist", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.4" },
      body: JSON.stringify({ session_id: id, turn_index: i, message }),
    }))
    const value = await response.json()
    record.transcript.push({ role: "Assistant", text: value.reply ?? value.error ?? "[no reply]" })
    assert.equal(response.status, 200, "chat route must succeed")
    assert.equal(value.ok, true)
    verifyReply(value.reply, i === 0, reason)
    assert.notEqual(value.handoff_reason, "model-error", "real model path must succeed")
    if (reason) assert.equal(value.handoff_reason, reason, "returned handoff reason")
    replies.push(value)
  }
  return replies
}

function voiceRequest(sid, path, extra = {}) {
  const url = twilio.twilioCallbackUrl(path)
  const params = new URLSearchParams({ CallSid: sid, From: phone, To: env.TWILIO_PHONE_NUMBER.trim(), CallerName: marked("A4 Test Customer"), ...extra })
  let signed = url
  for (const key of [...params.keys()].sort()) signed += key + params.get(key)
  return new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": createHmac("sha1", env.TWILIO_AUTH_TOKEN.trim()).update(signed).digest("base64") }, body: params.toString() })
}

const unescapeXml = (s) => s.replaceAll("&apos;", "'").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")
async function voicePost(record, sid, path, speech = null) {
  stage = "route"
  record.transcript.push({ role: "Customer", text: marked(speech ?? "Call connected; no speech yet.") })
  const response = await voice(voiceRequest(sid, path, speech === null ? {} : { SpeechResult: marked(speech) }))
  const xml = await response.text()
  for (const [i, m] of [...xml.matchAll(/<Say(?:\s[^>]*)?>([\s\S]*?)<\/Say>/g)].entries()) {
    const reply = unescapeXml(m[1])
    record.transcript.push({ role: i === 0 ? "Assistant" : "Assistant (no-input fallback)", text: reply })
    verifyReply(reply, speech === null && i === 0)
  }
  await drain()
  assert.equal(response.status, 200, "signed voice request must succeed")
  return xml
}

async function seedCall(sid) {
  stage = "route"
  const detail = JSON.stringify({ callerName: marked("A4 Test Customer"), isTest: true, harness: "assistant-a4" })
  await sql`INSERT INTO calls (twilio_sid, direction, from_phone, to_phone, status, detail, is_test)
    VALUES (${sid}::text, 'in', ${phone}::text, ${env.TWILIO_PHONE_NUMBER.trim()}::text, 'in-progress', ${detail}::jsonb,
      mcsw_is_test_row(NULL::bigint, NULL::bigint, NULL::bigint, ${sid}::text, ${detail}::jsonb, '[INTERNAL TEST] A4 Test Customer'::text))
    ON CONFLICT (twilio_sid) DO NOTHING`
}

async function main() {
  if (preflight) {
    const checked = await runPreflight({ env: process.env, loadEnv, connect: async () => {
      const { neon } = await import("@neondatabase/serverless")
      return neon(process.env.DATABASE_URL.trim())
    } })
    for (const result of checked.stages) console.log(JSON.stringify(result))
    console.log(`A4 preflight: ${checked.pass ? "PASS" : "FAIL"}`)
    process.exitCode = checked.pass ? 0 : 1
    return
  }
try {
  await step("env-load", loadEnv)
  process.env.NEXT_PUBLIC_ASSISTANT_CHAT = "1"
  process.env.ASSISTANT_VOICE = "1"
  stage = "import"
  fixture = dry ? createDryFixture() : null
  env = fixture?.env ?? process.env
  checkEnvironment(env)
  await step("import", async () => { ({ default: ts } = await import("typescript")) })
  safety = createA4Safety({ block,
    fetch: (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
      return step(url.href === "https://api.anthropic.com/v1/messages" ? "model" : stage, () => originalFetch(input, init))
    },
    allowFetch: (input) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
      let allowedDb = ""
      try { allowedDb = new URL(env.DATABASE_URL).hostname } catch {}
      const hostParts = allowedDb.split(".")
      const neonApi = hostParts.length > 2 ? `api.${hostParts.slice(1).join(".")}` : ""
      const database = url.protocol === "https:" && [allowedDb, neonApi].includes(url.hostname) && url.pathname === "/sql"
      const model = url.href === "https://api.anthropic.com/v1/messages"
      if (dry || (!database && !model)) return false
      if (model) modelRequests++
      return true
    },
  })
  safety.install()
  // These are module-boundary spies, independent of is_test guards. A bug may
  // attempt delivery, but cannot reach any crew/customer provider from here.
  globalThis.__assistantA4 = { env, sql: fixture?.sql, model: fixture?.model, block, background, step, wrapSql, sender: safety.sender, safety }
  const captureLog = (level, args) => {
    diagnostics.push(level)
    for (const error of args) if (error instanceof Error) failure(stage, error)
    const message = args.filter((arg) => typeof arg === "string").map((arg) => sanitizeDiagnostic(arg, { ...process.env, ...env })).join(" ")
    if (message) failure(stage, new Error(message))
  }
  console.error = (...args) => captureLog("error", args)
  console.warn = (...args) => captureLog("warning", args)
  const blockedModules = ["lib/notify.ts", "lib/messages.ts", "lib/push.ts"]
  const senderNames = (path) => [...readFileSync(new URL(path, root), "utf8").matchAll(/^export (async )?function (\w+)/gm)]
    .filter((match) => path !== "lib/twilio.ts" || match[1] && match[2] !== "readTwilioForm")
    .map((match) => match[2])
  const blockedSource = (path, names) => names.map((name) => `export const ${name} = globalThis.__assistantA4.sender(${JSON.stringify(`${path}:${name}`)});`).join("\n")
  const moduleFile = (specifier, parent = root.href) => {
    const url = specifier.startsWith("@/") ? new URL(specifier.slice(2), root) : new URL(specifier, parent)
    if (url.protocol !== "file:") return null
    for (const candidate of [url, new URL(`${url.href}.ts`), new URL(`${url.href}.mjs`), new URL(`${url.href}/index.ts`)]) {
      if (existsSync(candidate) && !candidate.pathname.endsWith("/")) return candidate
    }
    return null
  }
  hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "next/server") return stub("export const after = (fn) => globalThis.__assistantA4.background.push(fn);")
      if (specifier.startsWith("@/") || specifier.startsWith(".")) {
        const url = moduleFile(specifier, context.parentURL)
        if (url) {
          const path = url.href.slice(root.href.length)
          if (dry && path === "lib/db.ts") return stub("export const dbConfigured = () => true; export const getSql = () => globalThis.__assistantA4.wrapSql(globalThis.__assistantA4.sql);")
          if (dry && path === "lib/ai.ts") return stub("export const jsonWithClaude = (input) => globalThis.__assistantA4.step('model', () => globalThis.__assistantA4.model(input));")
          return { url: url.href, shortCircuit: true }
        }
      }
      return nextResolve(specifier, context)
    },
    load(url, context, nextLoad) {
      if (url.startsWith(root.href) && url.endsWith(".ts")) {
        const path = url.slice(root.href.length)
        if (blockedModules.includes(path)) return { format: "module", source: blockedSource(path, senderNames(path)), shortCircuit: true }
        // The fixture tests also transpile TS: transitive error classes use
        // parameter properties, which node's strip-only mode cannot execute.
        let input = readFileSync(new URL(url), "utf8")
        if (url === new URL("lib/twilio.ts", root).href) {
          // Keep the real webhook parser, HMAC validator and configuration
          // gates. Every exported REST operation is intercepted independently.
          const names = senderNames("lib/twilio.ts")
          for (const name of names) {
            input = input.replace(`export async function ${name}`, `async function a4_${name}`)
            input += `\nexport const ${name} = globalThis.__assistantA4.sender(${JSON.stringify(`lib/twilio.ts:${name}`)});\n`
          }
        }
        // Capture exceptions before public routes turn them into safe fallbacks.
        // This instrumentation exists only inside this harness's module loader.
        if (url === new URL("lib/ai.ts", root).href) {
          input = input.replace("export async function jsonWithClaude", "async function a4JsonWithClaude")
          input += "\nexport const jsonWithClaude = (...args) => globalThis.__assistantA4.step('model', () => a4JsonWithClaude(...args));\n"
        }
        if (url === new URL("lib/db.ts", root).href) {
          input = input.replace("export function getSql", "function a4GetSql")
          input += "\nexport const getSql = () => globalThis.__assistantA4.wrapSql(a4GetSql());\n"
        }
        const source = ts.transpileModule(input, {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText
        return { format: "module", source: dry ? source.replaceAll("process.env", "globalThis.__assistantA4.env") : source, shortCircuit: true }
      }
      return nextLoad(url, context)
    },
  })
  await step("outbound-safety", async () => {
    const entries = []
    for (const path of ["lib/notify.ts", "lib/messages.ts", "lib/push.ts", "lib/twilio.ts"]) {
      const senderModule = await import(`../${path}`)
      const names = senderNames(path)
      assert.ok(names.length, `outbound sender inventory missing for ${path}`)
      for (const name of names) entries.push([`${path}:${name}`, senderModule[name]])
    }
    assert.ok(entries.length, "outbound sender inventory must not be empty")
    await safety.checkSenders(entries)
    assert.equal(outbound.length, 0, "safety probes must not count as delivery attempts")
  })
} catch (error) {
  setupFailure = failure(stage, error)
}

try {
  if (asks.length) {
    await script("Ask conversation", async (record) => {
      const id = randomUUID()
      record.id = id
      await runAskConversation({
        messages: asks, sessionId: id, redact,
        postTurn: async (input) => {
          stage = "route"
          record.transcript.push({ role: "Customer", text: input.message })
          const response = await assist(new Request("https://example.test/api/assist", {
            method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.4" },
            body: JSON.stringify(input),
          }))
          const value = await response.json()
          record.transcript.push({ role: "Assistant", text: value.reply ?? "[no reply]" })
          assert.equal(response.status, 200, "ask route must succeed")
          return value
        },
        readTurn: async (sessionId, turnIndex) => {
          stage = "readback"
          const rows = await sql`/* a4:turns */ SELECT turn_index, result FROM assistant_turns
            WHERE session_id = ${sessionId}::uuid ORDER BY turn_index`
          return rows.find((row) => Number(row.turn_index) === turnIndex)?.result ?? null
        },
        onTurn: (turn) => {
          console.log(`A4 turn ${turn.turn} branch: ${turn.branch ?? "unavailable"}`)
          console.log(JSON.stringify(turn))
        },
      })
      await drain()
      verifyPartition(await snapshot(id))
    })
  } else {
  const fullMessages = ["My name is A4 Test Customer.", "My callback phone is 615-555-0100.", "I need you to repair a steel gate hinge."]
  await script("1. Chat full lead", async (r) => {
    const fullId = randomUUID()
    r.id = fullId
    const fullReplies = await chat(r, fullId, fullMessages)
    const fullSnapshot = await snapshot(fullId); verifyPartition(fullSnapshot)
    r.detail = `${fullSnapshot.leads.length} lead; ${fullSnapshot.events.filter((e) => e.kind === "assistant.handoff").length} handoffs.`
    assert.equal(fullSnapshot.leads.length, 1, "full script must file exactly one lead")
    assert.equal(fullReplies.at(-1).lead_saved, true)
    assert.equal(fullSnapshot.leads[0].phone, phone)
    assert.equal(fullSnapshot.leads[0].first_name, "A4 Test Customer")
    assert.match(fullSnapshot.leads[0].message, /repair a steel gate hinge/)
    assert.equal(fullSnapshot.people.length, 1, "test customer person filed")
  })
  for (const [name, text, reason] of [
    ["2. Chat human", "I want to talk to a person", "human"],
    ["3. Chat unknown", "Can you repair a hafnium reactor pressure vessel certified for lunar vacuum?", "unknown"],
    ["4. Chat price", "How much does a gate repair cost?", "unknown"],
  ]) await script(name, async (r) => {
    const id = randomUUID(); r.id = id; const replies = await chat(r, id, [text], reason)
    if (name === "3. Chat unknown") {
      assert.equal(replies[0].continue_intake, true, "unknown capability must keep intake open")
      assert.match(replies[0].reply, /(?:confirm the credentials|checked by the shop|closer look|needs inspection|Have it looked at)[\s\S]+\?/, "unknown capability asks the next intake question")
      assert.equal((replies[0].reply.match(/\?/g) ?? []).length, 1, "unknown capability asks one intake question")
      assert.doesNotMatch(replies[0].reply, /\byes\b|we can|we will|we'll|booked|scheduled|guarantee|available/i, "unknown capability makes no work or callback promise")
    }
    const s = await snapshot(id); verifyPartition(s); verifyHandoff(s, reason)
    assert.equal(s.leads.length, 0, "no contact means no lead")
    r.detail = `0 leads; durable handoff reason: ${reason}.`
  })
  await script("5. Chat email only then leaves", async (r) => {
    const id = randomUUID(); r.id = id; await chat(r, id, ["test@example.com"])
    const aged = await sql`/* a4:age */ UPDATE assistant_sessions SET updated_at = now() - interval '16 minutes'
      WHERE id = ${id}::uuid AND is_test = true AND lead_id IS NULL RETURNING id`
    assert.equal(aged.length, 1, "only the current unfiled test session is aged")
    const recovered = await recover(1, id)
    assert.equal(recovered.failed, 0, "targeted recovery must succeed")
    assert.equal(recovered.idle, 1, "idle partial must be recovered")
    const s = await snapshot(id); verifyPartition(s); verifyHandoff(s, "idle")
    assert.equal(s.leads.length, 1, "email-only contact must file one partial lead")
    assert.equal(s.leads[0].email, "test@example.com")
    assert.equal(s.leads[0].phone, "", "email-only lead must not invent phone")
    assert.match(s.leads[0].message, /Partial assistant request\./)
    assert.equal(s.people.length, 1)
    r.detail = "1 partial lead with test@example.com; durable handoff reason: idle."
    await recover(1, id)
    assert.equal((await snapshot(id)).leads.length, 1, "idle recovery retry must reuse lead")
  })
  await script("6. Chat full-lead replay", async (r) => {
    const fullId = randomUUID()
    r.id = fullId
    const fullReplies = await chat(r, fullId, fullMessages)
    const fullSnapshot = await snapshot(fullId); verifyPartition(fullSnapshot)
    const before = dry ? fixture.modelCalls() : modelRequests
    const replies = await chat(r, fullId, fullMessages)
    const s = await snapshot(fullId); verifyPartition(s)
    assert.deepEqual(replies, fullReplies, "replay must return original responses")
    assert.equal(s.leads.length, 1, "replay must add zero leads")
    assert.equal(s.leads[0].id, fullSnapshot.leads[0]?.id, "replay must keep same lead")
    assert.equal(s.turns.length, fullSnapshot.turns.length, "replay must add zero turns")
    assert.equal(s.events.length, fullSnapshot.events.length, "replay must add zero journal entries")
    assert.equal(dry ? fixture.modelCalls() : modelRequests, before, "replay must not invoke model")
    r.detail = "0 new leads, turns, journal entries or model calls; original lead retained."
  })
  await script("7. Voice human", async (r) => {
    const sid = `CA_INTERNAL_TEST_${randomBytes(16).toString("hex")}`, id = voiceSessionId(sid)
    r.id = id; r.sid = sid
    await seedCall(sid)
    await voicePost(r, sid, "/api/twilio/assist-voice")
    const xml = await voicePost(r, sid, "/api/twilio/assist-voice?turn=0", "I want to talk to a person")
    const dial = xml.match(/<Dial\b([^>]*)>([\s\S]*?)<\/Dial>/)
    assert.ok(dial, "human request must Dial")
    assert.equal(unescapeXml(dial[2].replace(/<[^>]+>/g, "")), env.OWNER_CELL_PHONE.trim(), "Dial must target OWNER_CELL_PHONE")
    assert.ok(unescapeXml(dial[1]).includes(twilio.twilioCallbackUrl("/api/twilio/assist-voice?handoff=1")), "Dial must use handoff action")
    const s = await snapshot(id, sid); verifyPartition(s); verifyHandoff(s, "human")
    r.detail = `${s.leads.length} partial lead; human handoff recorded; Dial OWNER_CELL_PHONE=***, action=/api/twilio/assist-voice?handoff=1 (not executed).`
  })
  await script("8. Voice normal intake", async (r) => {
    const sid = `CA_INTERNAL_TEST_${randomBytes(16).toString("hex")}`, id = voiceSessionId(sid)
    r.id = id; r.sid = sid
    await seedCall(sid); await voicePost(r, sid, "/api/twilio/assist-voice")
    for (const [i, speech] of ["I need you to repair a steel gate hinge.", "My name is A4 Test Customer."].entries()) {
      const xml = await voicePost(r, sid, `/api/twilio/assist-voice?turn=${i}`, speech)
      assert.match(xml, /<Gather\b/, "normal intake must continue gathering")
      assert.doesNotMatch(xml, /\b(?:booked|scheduled|saved|sent|guarantee|guaranteed|available|24\/7)\b|\b(?:we|the shop|someone)\s+(?:will|can)\s+(?:call|text|come|arrive|finish)\b/i, "normal intake makes no work or callback promise")
    }
    const s = await snapshot(id, sid); verifyPartition(s)
    assert.equal(s.leads.length, 1, "voice intake files one lead")
    assert.equal(s.leads[0].phone, phone, "voice uses verified caller phone")
    assert.equal(Number(s.calls[0]?.lead_id), Number(s.leads[0].id), "call linked to saved lead")
    assert.equal(s.events.filter((e) => e.kind === "assistant.voice").length, 1, "voice lead receipt saved")
    assert.equal(s.events.filter((e) => e.kind === "assistant.handoff").length, 0, "normal intake has no handoff")
    r.detail = "1 lead; verified caller number; call linked; assistant.voice receipt; no handoff."
  })
  }
} finally {
  hooks?.deregister()
  safety?.restore()
  globalThis.fetch = originalFetch; console.error = originalError; console.warn = originalWarn
  if (!asks.length) writeReport()
}
const passed = results.filter((r) => r.pass).length
if (asks.length) {
  // No transcript/report files or extra database writes are needed in ask mode.
  // Failure details retain A4's existing credential/PII sanitizer.
  for (const { stage, name, code, model } of failures) console.log(JSON.stringify({ diagnostic: {
    stage, name, code, ...(model ? { model: safeModelDiagnostics(model) } : {}),
  } }))
  console.log(`A4 ask ${dry ? "dry" : "live"}: ${passed}/1 PASS; ${asks.length} turns; model ${dry ? "fixture calls" : "HTTP requests"}: ${dry ? fixture?.modelCalls() ?? 0 : modelRequests}; outbound attempts blocked: ${outbound.length}`)
} else console.log(`A4 ${dry ? "dry" : "live"}: ${passed}/8 PASS; docs/ASSISTANT-A4-RUNS.md; .tmp/a4-diagnostic.json`)
const expected = asks.length ? 1 : 8
process.exitCode = results.length === expected && passed === expected && outbound.length === 0 && diagnostics.length === 0 && failures.length === 0 ? 0 : 1
}

await main()
