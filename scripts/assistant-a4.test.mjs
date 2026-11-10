import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import test from "node:test"
import { A4_OPTIONAL_ENV, checkEnvironment, errorDiagnostic, installA4Stubs, runPreflight, sanitizeDiagnostic } from "./assistant-a4-diagnostics.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const runner = fileURLToPath(new URL("./assistant-a4-run.mjs", import.meta.url))

function runDry(inject = "", { args = ["--dry"], setup = "", preload = "", expectReport = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "assistant-a4-"))
  const report = join(dir, "report.md"), diagnostic = join(dir, "diagnostic.json"), preloadPath = join(dir, "preload.mjs")
  try {
    // Keep tests from overwriting the operator's latest run report. Injection
    // happens at the model boundary after the harness installs its guards.
    writeFileSync(preloadPath, `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const write = fs.writeFileSync;
      fs.writeFileSync = (path, ...args) => write(String(path).endsWith('docs/ASSISTANT-A4-RUNS.md') ? ${JSON.stringify(report)} : String(path).endsWith('.tmp/a4-diagnostic.json') ? ${JSON.stringify(diagnostic)} : path, ...args);
      ${preload}
      syncBuiltinESMExports();
      let state;
      Object.defineProperty(globalThis, '__assistantA4', {
        configurable: true, get: () => state,
        set(value) {
          state = value;
          ${setup}
          const model = value.model;
          value.model = async (input) => { ${inject}; return model(input); };
        },
      });
    `)
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--import", pathToFileURL(preloadPath).href, runner, ...args], {
      cwd: root, encoding: "utf8", timeout: 60_000,
    })
    assert.ifError(child.error)
    assert.equal(existsSync(report), expectReport, `${child.stdout}${child.stderr}`)
    return { status: child.status, output: `${child.stdout}${child.stderr}`, report: expectReport ? readFileSync(report, "utf8") : null, diagnostic: existsSync(diagnostic) ? JSON.parse(readFileSync(diagnostic, "utf8")) : null }
  } finally {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()))
    assert.ok(basename(dir).startsWith("assistant-a4-"))
    rmSync(dir, { recursive: true, force: true })
  }
}

test("A4 ask mode executes exact customer turns in one test conversation without report writes or network", () => {
  const r = runDry(`
    const conversation = JSON.parse(input.prompt).conversation;
    const user = conversation.filter((message) => message.role === 'user');
    input.onModelDiagnostics?.({ stop_reason: 'end_turn', content_block_types: ['text'], usage: { input_tokens: 17, output_tokens: 29 } });
    if (user.at(-1).content.includes('steel gate hinge broke')) {
      if (user.length !== 2 || !conversation.some((message) => message.role === 'assistant' && message.content.includes('confirm that job'))) throw new Error('Ask lost prior conversation');
      return { reply: 'Steel gate hinges are a normal repair, and Lebanon is in our service area. Can you send a close photo of the hinge and post?', handoff_reason: null,
        fields: { name: null, callback_phone: null, need: 'gate hinge broke off the post', material_size: 'steel', location: 'Lebanon', timing: null, callback_window: null, is_job: 'yes' } };
    }
  `, { args: ["--dry", "--ask", "[INTERNAL TEST] Do you weld aluminum boat ladders?", "--ask", "[INTERNAL TEST] My steel gate hinge broke off the post in Lebanon. Can you fix it?"], expectReport: false,
    preload: "globalThis.fetch = () => { throw new Error('UNGUARDED_PROVIDER_NETWORK'); };" })
  assert.equal(r.status, 0, r.output)
  const turns = r.output.split(/\r?\n/).filter((line) => line.startsWith('{"turn":')).map((line) => JSON.parse(line))
  assert.equal(turns.length, 2, r.output)
  assert.match(turns[0].reply, /A person at the shop will confirm that job/)
  assert.equal(turns[0].handoff_reason, "unknown")
  assert.match(turns[1].reply, /Steel gate hinges are a normal repair/)
  assert.equal(turns[1].handoff_reason, null)
  assert.equal(turns[0].branch, "unknown-capability-intake")
  assert.equal(turns[1].branch, "model-answer")
  assert.equal(turns[0].decision_trace.unsupportedCapability, true)
  assert.equal(turns[1].decision_trace.currentRepairDetails, true)
  assert.equal(turns[1].decision_trace.assistantHandoffReason, null)
  assert.match(r.output, /^A4 turn 1 branch: unknown-capability-intake$/m)
  assert.match(r.output, /^A4 turn 2 branch: model-answer$/m)
  assert.deepEqual(turns[1].model_diagnostics, { stop_reason: "end_turn", content_block_types: ["text"], usage: { input_tokens: 17, output_tokens: 29 } })
  assert.match(r.output, /A4 ask dry: 1\/1 PASS; 2 turns; model fixture calls: 1; outbound attempts blocked: 0/)
  assert.doesNotMatch(r.output, /UNGUARDED_PROVIDER_NETWORK|sk-ant-/)
  assert.equal(r.diagnostic, null)
})

test("A4 ask output redacts short configured keys and unconfigured key-shaped reply strings", () => {
  const r = runDry(`
    return { reply: 'Which part needs repair, tiny sk-ant-fixture-private-key?', handoff_reason: null,
      fields: { name: null, callback_phone: null, need: 'repair a steel gate hinge', material_size: 'steel', location: null, timing: null, callback_window: null, is_job: 'yes' } };
  `, { args: ["--dry", "--ask", "I need you to repair a steel gate hinge."], expectReport: false,
    setup: "value.env.ANTHROPIC_API_KEY = 'tiny';" })
  assert.equal(r.status, 0, r.output)
  assert.doesNotMatch(r.output, /tiny|sk-ant-/)
  assert.match(r.output, /\[redacted\]/)
})

test("A4 ask model failures print the fallback branch and safe protocol metadata without provider text", () => {
  const r = runDry(`
    const error = new Error('private provider reply sk-ant-fixture-key tiny');
    error.name = 'ClaudeResponseError';
    error.modelDiagnostics = { stop_reason: 'max_tokens', content_block_types: ['thinking', 'text'],
      usage: { input_tokens: 17, output_tokens: 4000 }, api_key: 'sk-ant-fixture-key', content: 'private provider reply' };
    throw error;
  `, { args: ["--dry", "--ask", "I need you to repair a steel gate hinge."], expectReport: false,
    setup: "value.env.ANTHROPIC_API_KEY = 'tiny';" })
  assert.equal(r.status, 1, r.output)
  const turn = JSON.parse(r.output.split(/\r?\n/).find((line) => line.startsWith('{"turn":')))
  assert.equal(turn.handoff_reason, "model-error")
  assert.equal(turn.branch, "model-error")
  assert.deepEqual(turn.model_diagnostics, { stop_reason: "max_tokens", content_block_types: ["thinking", "text"], usage: { input_tokens: 17, output_tokens: 4000 } })
  assert.doesNotMatch(r.output, /private provider reply|tiny|sk-ant-/)
  assert.match(r.output, /outbound attempts blocked: 0/)
})

test("A4 dry runs all eight real-route scripts and reports only masked phone contacts", () => {
  const r = runDry()
  assert.equal(r.status, 0, r.output)
  assert.match(r.output, /8\/8 PASS/)
  assert.equal((r.report.match(/^## .*: PASS$/gm) ?? []).length, 8)
  assert.match(r.report, /Live verification pending/)
  assert.match(r.report, /OWNER_CELL_PHONE=\*\*\*/)
  assert.match(r.report, /0 new leads, turns, journal entries or model calls/)
  assert.match(r.report, /1 partial lead with test@example.com/)
  assert.match(r.report, /Outbound attempts blocked: 0/)
  for (const m of r.report.matchAll(/(?:\+?1[ .-]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[ .-]?[2-9]\d{2}[ .-]?\d{4}/g)) {
    assert.equal(m[0].replace(/\D/g, "").slice(-10), "6155550100")
  }
})

test("A4 stubs stay behind every sender interception with zero outbound attempts", () => {
  const r = runDry()
  assert.equal(r.status, 0, r.output)
  assert.deepEqual(r.diagnostic.environment.stubbed, [...A4_OPTIONAL_ENV])
  assert.equal(r.diagnostic.outboundAttempts, 0)
  assert.equal(r.diagnostic.safety.pass, true)
  for (const name of ["notifyAll", "emailAssistantTranscript", "notifyOwnerCellSms", "sendSmsPersisted", "sendPushToAll",
    "sendSms", "startVoiceCall", "startPhoneLoginVerification", "checkPhoneLoginVerification"]) {
    assert.ok(r.diagnostic.safety.intercepted.some((label) => label.endsWith(`:${name}`)), `${name} must be intercepted and probed`)
  }
  for (const name of A4_OPTIONAL_ENV) assert.match(r.report, new RegExp(`${name}.*stubbed for A4; outbound blocked`))
  assert.doesNotMatch(r.report, /AC[0-9a-f]{32}|\+16155550199/)
})

test("A4 aborts before any route if an outbound sender escapes interception", () => {
  const r = runDry("", { setup: "value.sender = () => () => {};" })
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /0\/8 PASS/)
  assert.equal(r.diagnostic.safety.pass, false)
  assert.equal(r.diagnostic.outboundAttempts, 0)
  assert.match(JSON.stringify(r.diagnostic.diagnostics), /A4_OUTBOUND_UNSAFE/)
  assert.match(r.report, /Model fixture calls: 0/)
})

test("A4 detects a replaced network guard before running routes", () => {
  const r = runDry("", { setup: "queueMicrotask(() => { globalThis.fetch = async () => new Response('unsafe'); });" })
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /0\/8 PASS/)
  assert.equal(r.diagnostic.safety.pass, false)
  assert.match(JSON.stringify(r.diagnostic.diagnostics), /A4_OUTBOUND_UNSAFE/)
  assert.match(r.report, /Model fixture calls: 0/)
})

test("A4 signs voice requests using its stub token while real signature validation rejects tampering", () => {
  const r = runDry(`
    if (!globalThis.__a4CheckedSignature) {
      globalThis.__a4CheckedSignature = true;
      const { POST } = await import('@/app/api/twilio/assist-voice/route');
      const { twilioCallbackUrl, validateTwilioSignature } = await import('@/lib/twilio');
      const { createHmac } = await import('node:crypto');
      const url = twilioCallbackUrl('/api/twilio/assist-voice');
      const params = new URLSearchParams({ CallSid: 'CA_INTERNAL_TEST_0123456789abcdef0123456789abcdef', From: '+16155550100', To: globalThis.__assistantA4.env.TWILIO_PHONE_NUMBER });
      let payload = url;
      for (const key of [...params.keys()].sort()) payload += key + params.get(key);
      const signature = createHmac('sha1', globalThis.__assistantA4.env.TWILIO_AUTH_TOKEN).update(payload).digest('base64');
      const signed = new Request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature }, body: params.toString() });
      if (!validateTwilioSignature(signed, params)) throw new Error('Stub token did not sign a valid webhook');
      const invalid = new Request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'invalid' }, body: params.toString() });
      if ((await POST(invalid)).status !== 403) throw new Error('Webhook accepted invalid signature');
    }
  `)
  assert.equal(r.status, 0, r.output)
  assert.equal(r.diagnostic.outboundAttempts, 0)
  assert.match(r.report, /## 7\. Voice human: PASS/)
  assert.match(r.report, /## 8\. Voice normal intake: PASS/)
})

test("A4 blocks buggy notify, email and SMS attempts and exits nonzero even when caller swallows errors", () => {
  const r = runDry(`
    const notify = await import('@/lib/notify');
    const messages = await import('@/lib/messages');
    for (const sender of [notify.notifyAll, notify.emailAssistantTranscript, messages.sendSmsPersisted]) {
      try { await sender({}); } catch {}
    }
  `)
  assert.equal(r.status, 1, r.output)
  assert.doesNotMatch(r.output, /8\/8 PASS/)
  assert.match(r.report, /Outbound attempts blocked: [1-9]/)
  assert.match(r.report, /: FAIL/)
})

test("A4 intercepts direct Twilio REST, email, SMS, push and native network bypasses with stubs active", () => {
  const r = runDry(`
    if (!globalThis.__a4ProbedOutbound) {
      globalThis.__a4ProbedOutbound = true;
      const notify = await import('@/lib/notify');
      const messages = await import('@/lib/messages');
      const push = await import('@/lib/push');
      const twilio = await import('@/lib/twilio');
      const direct = await import(${JSON.stringify(pathToFileURL(join(root, "lib/notify.ts")).href)});
      if (direct.notifyAll !== notify.notifyAll) throw new Error('File URL bypassed sender interception');
      const http = await import('node:http');
      const https = await import('node:https');
      const net = await import('node:net');
      const tls = await import('node:tls');
      const senders = [notify.notifyAll, notify.emailAssistantTranscript, messages.sendSmsPersisted,
        push.sendPushToAll, twilio.sendSms, twilio.startVoiceCall, twilio.startPhoneLoginVerification,
        twilio.checkPhoneLoginVerification,
        () => fetch('https://api.twilio.com/2010-04-01/Accounts/test/Calls.json', { method: 'POST' }),
        () => https.request('https://api.twilio.com/'), () => http.request('http://api.twilio.com/'),
        () => net.connect(443, 'api.twilio.com'), () => tls.connect(443, 'api.twilio.com')];
      for (const send of senders) {
        let blocked = false;
        try { await send({}); } catch { blocked = true; }
        if (!blocked) throw new Error('Outbound bypass was reachable');
      }
    }
  `, { preload: "globalThis.fetch = () => { throw new Error('UNGUARDED_PROVIDER_NETWORK'); };" })
  assert.equal(r.status, 1, r.output)
  assert.equal(r.diagnostic.safety.pass, true)
  assert.deepEqual(r.diagnostic.environment.stubbed, [...A4_OPTIONAL_ENV])
  assert.equal(r.diagnostic.outboundAttempts, 13, r.report)
  assert.doesNotMatch(JSON.stringify(r.diagnostic), /UNGUARDED_PROVIDER_NETWORK|Outbound bypass was reachable/)
})

test("A4 blocks unexpected network traffic and withholds provider diagnostic bodies", () => {
  const secret = "a4-provider-secret-must-never-print"
  const r = runDry(`
    console.error(${JSON.stringify(secret)});
    try { await fetch('https://api.twilio.com/a4-send-probe', { method: 'POST' }); } catch {}
  `)
  assert.equal(r.status, 1, r.output)
  assert.ok(!r.output.includes(secret) && !r.report.includes(secret))
  assert.match(r.report, /Outbound attempts blocked: [1-9]/)
  assert.match(r.report, /Suppressed diagnostic messages: [1-9]/)
})

test("A4 isolates a model failure and records its sanitized cause without losing the eight-script denominator", () => {
  const r = runDry(`
    if (!globalThis.__a4FailedOnce) {
      globalThis.__a4FailedOnce = true;
      const error = new TypeError('Model refused https://provider.test/private?key=short-secret for user@example.com token=short-secret');
      error.code = 'E_PROVIDER';
      throw error;
    }
  `)
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /[1-7]\/8 PASS/)
  assert.equal((r.report.match(/^## [1-8]\. .*: (?:PASS|FAIL)$/gm) ?? []).length, 8)
  assert.match(r.report, /## 2\. Chat human: PASS/)
  assert.match(r.report, /## 6\. Chat full-lead replay: PASS/)
  assert.match(r.report, /## 8\. Voice normal intake: PASS/)
  assert.ok(r.diagnostic, "structured diagnostics must be written")
  const serialized = JSON.stringify(r.diagnostic)
  assert.match(serialized, /"stage":"model"/)
  assert.match(serialized, /"name":"TypeError"/)
  assert.match(serialized, /"code":"E_PROVIDER"/)
  for (const secret of ["https://provider.test", "short-secret", "user@example.com"]) {
    assert.ok(!serialized.includes(secret) && !r.report.includes(secret) && !r.output.includes(secret))
  }
})

test("A4 voice gathering failure follows the model failure and retains only safe model metadata", () => {
  const r = runDry(`
    if (input.system.includes('This is a phone conversation')) {
      const error = new Error('Claude did not finish its response.');
      error.name = 'ClaudeResponseError';
      error.modelDiagnostics = {
        stop_reason: 'max_tokens',
        content_block_types: ['thinking', 'text'],
        usage: { input_tokens: 123, output_tokens: 4000, cache_read_input_tokens: 50 },
        content: 'private model answer',
        api_key: 'sk-ant-private-key',
      };
      throw error;
    }
  `)
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /7\/8 PASS/)
  const voice = r.diagnostic.results.find(({ name }) => name === "8. Voice normal intake")
  assert.equal(voice.pass, false)
  const model = voice.diagnostics.find(({ stage }) => stage === "model")
  assert.deepEqual(model.model, {
    stop_reason: "max_tokens", content_block_types: ["thinking", "text"],
    usage: { input_tokens: 123, output_tokens: 4000, cache_read_input_tokens: 50 },
  })
  assert.ok(voice.diagnostics.some(({ message }) => /normal intake must continue gathering/.test(message)))
  const serialized = JSON.stringify(r.diagnostic)
  assert.ok(!serialized.includes("private model answer") && !r.report.includes("private model answer"))
  assert.ok(!serialized.includes("sk-ant-private-key") && !r.report.includes("sk-ant-private-key"))
})

test("A4 reports an env-load failure for all eight scripts with the error class and code", () => {
  const r = runDry("", { args: [join(tmpdir(), "a4-nonexistent-env-file"), "--dry"] })
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /0\/8 PASS/)
  assert.equal(r.diagnostic.results.length, 8)
  assert.ok(r.diagnostic.results.every(({ pass, diagnostics }) => !pass && diagnostics[0].stage === "env-load"))
  assert.equal(r.diagnostic.diagnostics[0].name, "Error")
  assert.equal(r.diagnostic.diagnostics[0].code, "ENOENT")
  assert.match(r.report, /"stage": "env-load"/)
})

test("A4 isolates a failed readback and still runs its independent replay and later scripts", () => {
  const r = runDry("", { setup: `
    const query = value.sql;
    let failed = false;
    value.sql = (parts, ...params) => {
      if (!failed && parts.join(' ').includes('/* a4:session */')) {
        failed = true;
        throw Object.assign(new Error('Readback failed at postgres://owner:pass@db.test/main'), { name: 'NeonDbError', code: '42P01' });
      }
      return query(parts, ...params);
    };
  ` })
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /7\/8 PASS/)
  assert.match(r.report, /## 6\. Chat full-lead replay: PASS/)
  assert.match(r.report, /## 8\. Voice normal intake: PASS/)
  const diagnostic = r.diagnostic.diagnostics.find(({ code }) => code === "42P01")
  assert.equal(diagnostic.stage, "readback")
  assert.equal(diagnostic.name, "NeonDbError")
  assert.ok(!JSON.stringify(r.diagnostic).includes("owner:pass") && !r.report.includes("db.test"))
})

test("A4 records voice import failure without invalidating the six chat scripts", () => {
  const r = runDry("", { preload: `
    const read = fs.readFileSync;
    fs.readFileSync = (path, ...args) => {
      if (String(path).endsWith('/app/api/twilio/assist-voice/route.ts')) {
        throw Object.assign(new Error('Cannot import voice route token=tiny-secret'), { code: 'ERR_MODULE_NOT_FOUND' });
      }
      return read(path, ...args);
    };
  ` })
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /6\/8 PASS/)
  assert.equal(r.diagnostic.results.filter(({ pass }) => pass).length, 6)
  assert.ok(r.diagnostic.results.slice(6).every(({ diagnostics }) => diagnostics.some(({ stage, code }) => stage === "import" && code === "ERR_MODULE_NOT_FOUND")))
  assert.ok(!r.report.includes("tiny-secret") && !JSON.stringify(r.diagnostic).includes("tiny-secret"))
})

const configuredEnv = () => ({
  DATABASE_URL: "postgres://owner:db-password@database.test/shop",
  ANTHROPIC_API_KEY: "short-model-key",
  TWILIO_ACCOUNT_SID: ["AC", "0123456789abcdef0123456789abcdef"].join(""),
  TWILIO_AUTH_TOKEN: "short-auth-token",
  TWILIO_PHONE_NUMBER: "+16155550100",
  OWNER_CELL_PHONE: "+16155550999",
})

test("A4 sanitizer strips credentials, URLs, phones, and unapproved email addresses", () => {
  const secrets = [
    "https://provider.test/path?api_key=secret", "postgres://user:pass@db.test/main",
    "postgresql://user:pass@db.test/main", "wss://private.test/socket", "www.private.test/path",
    "Bearer tiny-secret", "Basic dXNlcjpwYXNz", "api_key=small", '"token":"little"', "key=short-secret", "ANTHROPIC_API_KEY='tiny'",
    "sk-short-key", "a4-provider-secret-must-never-print", "deadbeefdeadbeefdeadbeef",
    "YWJjZGVmZ2hpamtsbW5vcHFyc3Q=", "+1 (615) 555-0100", "615.555.0100",
    "+44 20 7946 0958", "615/555/0100", "+1\u00a0615\u00a0555\u00a00100", "615\u2011555\u20110100", "user+tag@example.com",
    "data:text/plain;base64,c2hvcnQ=", "mailto:person@example.com", "tel:+16155550100",
  ]
  const result = sanitizeDiagnostic(`failure: ${secrets.join(" ; ")} test@example.com Sales@musiccityspecialtywelding.com`, {})
  for (const secret of secrets) assert.ok(!result.includes(secret), `${secret} survived: ${result}`)
  assert.ok(result.includes("test@example.com"))
  assert.ok(result.includes("Sales@musiccityspecialtywelding.com"))
  assert.match(result, /failure/)
})

test("A4 sanitizer redacts configured secret values even when short or encoded and retains useful error codes", () => {
  const result = sanitizeDiagnostic("key foo!bar encoded foo%21bar EHOSTUNREACH 42P01", { ANTHROPIC_API_KEY: "foo!bar" })
  assert.ok(!result.includes("foo!bar") && !result.includes("foo%21bar"))
  assert.match(result, /EHOSTUNREACH 42P01/)
})

test("A4 sanitizer redacts unconfigured Anthropic keys in every diagnostic field", () => {
  const keys = ["sk-ant-tiny", "sk-ant-api03-fixture_key-1234567890", "SK-ANT-UPPER_CASE"]
  const error = Object.assign(new Error(`Provider refused ${keys[0]}`), {
    name: `ProviderError ${keys[1]}`,
    code: `E_AUTH ${keys[2]}`,
  })
  const diagnostic = errorDiagnostic("model", error, {})
  assert.equal(diagnostic.stage, "model")
  assert.match(diagnostic.message, /Provider refused \[redacted\]/)
  assert.match(diagnostic.name, /ProviderError \[redacted\]/)
  assert.match(diagnostic.code, /E_AUTH \[redacted\]/)
  for (const key of keys) {
    assert.equal(sanitizeDiagnostic(`(${key})`, {}), "([redacted])")
    assert.ok(!JSON.stringify(diagnostic).includes(key))
  }
})

test("A4 error diagnostics sanitize every provider-controlled field without including raw objects or stacks", () => {
  const error = Object.assign(new TypeError("Failed postgres://owner:secret@db.test/shop for person@example.com"), {
    name: "TypeError https://private.test/name",
    code: "E_FETCH token=short-secret",
    headers: { authorization: "raw-header-secret" },
  })
  const result = errorDiagnostic("db-connect", error, {})
  assert.deepEqual(Object.keys(result), ["stage", "name", "code", "message"])
  assert.equal(result.stage, "db-connect")
  assert.match(result.name, /TypeError/)
  assert.match(result.code, /E_FETCH/)
  for (const secret of ["private.test", "owner:secret", "person@example.com", "short-secret", "raw-header-secret", " at "]) {
    assert.ok(!JSON.stringify(result).includes(secret))
  }
  assert.deepEqual(errorDiagnostic("route", "plain failure", {}), { stage: "route", name: "Error", code: null, message: "plain failure" })
})

test("A4 model diagnostics whitelist token counts and sanitize provider metadata", () => {
  const error = Object.assign(new Error("Claude returned no text."), {
    modelDiagnostics: {
      stop_reason: "end_turn",
      content_block_types: ["thinking", "redacted_thinking", "sk-ant-private-key", { text: "private model answer" }],
      usage: { input_tokens: 42, output_tokens: 500, cache_creation_input_tokens: 10, cache_read_input_tokens: Infinity,
        text: "private model answer", api_key: "sk-ant-private-key", arbitrary: 100 },
      text: "private model answer", key: "sk-ant-private-key",
    },
  })
  const diagnostic = errorDiagnostic("model", error, {})
  assert.deepEqual(diagnostic.model, {
    stop_reason: "end_turn", content_block_types: ["thinking", "redacted_thinking", "[redacted]"],
    usage: { input_tokens: 42, output_tokens: 500, cache_creation_input_tokens: 10 },
  })
  assert.doesNotMatch(JSON.stringify(diagnostic), /private model answer|sk-ant-private-key|arbitrary/)
})

test("A4 environment check derives assistant requirements and accepts Claude without gateway/OIDC credentials", () => {
  const env = configuredEnv()
  const result = checkEnvironment(env)
  assert.deepEqual(result.required, ["DATABASE_URL", "ANTHROPIC_API_KEY"])
  assert.deepEqual(result.missing, [])
  assert.deepEqual(result.stubbed, [])
  assert.match(result.notes.join(" "), /ANTHROPIC_API_KEY.*present/)
  assert.match(result.notes.join(" "), /AI_GATEWAY_API_KEY/)
  assert.match(result.notes.join(" "), /VERCEL_OIDC_TOKEN/)
  for (const value of Object.values(env)) assert.ok(!JSON.stringify(result).includes(value))
})

test("A4 installs only missing or empty optional values in-process and reports names without values", () => {
  const env = { DATABASE_URL: configuredEnv().DATABASE_URL, ANTHROPIC_API_KEY: "fixture-model-key", TWILIO_AUTH_TOKEN: " \n" }
  const checked = checkEnvironment(env)
  assert.deepEqual(checked.required, ["DATABASE_URL", "ANTHROPIC_API_KEY"])
  assert.deepEqual(checked.missing, [])
  assert.deepEqual(checked.stubbed, [...A4_OPTIONAL_ENV])
  assert.match(env.TWILIO_ACCOUNT_SID, /^AC[0-9a-f]{32}$/i)
  assert.ok(env.TWILIO_AUTH_TOKEN.trim().length >= 32)
  assert.equal(env.TWILIO_PHONE_NUMBER, "+16155550101")
  assert.equal(env.OWNER_CELL_PHONE, "+16155550199")
  const token = env.TWILIO_AUTH_TOKEN
  assert.deepEqual(installA4Stubs(env), [...A4_OPTIONAL_ENV])
  assert.equal(env.TWILIO_AUTH_TOKEN, token, "token must remain stable within a run")
  assert.deepEqual(checkEnvironment(env).stubbed, checked.stubbed)
  const second = {}
  installA4Stubs(second)
  assert.notEqual(second.TWILIO_AUTH_TOKEN, token, "separate runs must not share a token")
  const configured = configuredEnv(), original = { ...configured }
  assert.deepEqual(installA4Stubs(configured), [])
  assert.deepEqual(configured, original)
  for (const value of Object.values(env)) assert.ok(!JSON.stringify(checked).includes(value))
  for (const name of A4_OPTIONAL_ENV) assert.match(checked.notes.join("\n"), new RegExp(`${name}.*stubbed for A4; outbound blocked`))
})

test("A4 environment check lists all absent/empty names and does not substitute gateway credentials for Claude", () => {
  const env = { DATABASE_URL: " \n", ANTHROPIC_API_KEY: "", AI_GATEWAY_API_KEY: "provided-gateway-key", VERCEL_OIDC_TOKEN: "provided-oidc-token", VERCEL: "1" }
  const result = checkEnvironment(env)
  assert.deepEqual(result.missing, result.required)
  assert.deepEqual(checkEnvironment(env, { voice: false }).required, ["DATABASE_URL", "ANTHROPIC_API_KEY"])
  assert.match(result.notes.join(" "), /ANTHROPIC_API_KEY.*missing/)
  assert.ok(!JSON.stringify(result).includes("provided-gateway-key") && !JSON.stringify(result).includes("provided-oidc-token"))
})

test("A4 preflight loads env before checking it and makes exactly one read-only DB query", async () => {
  const env = {}, order = [], queries = []
  const result = await runPreflight({
    env,
    loadEnv: () => { order.push("load"); Object.assign(env, { DATABASE_URL: configuredEnv().DATABASE_URL, ANTHROPIC_API_KEY: configuredEnv().ANTHROPIC_API_KEY }) },
    connect: () => {
      order.push("connect")
      assert.ok(env.DATABASE_URL)
      return async (parts, ...params) => {
        queries.push({ sql: parts.join("?"), params })
        return [{ ok: 1, assistant_sessions: "assistant_sessions" }]
      }
    },
  })
  assert.equal(result.pass, true)
  assert.deepEqual(result.stages[1].stubbed, [...A4_OPTIONAL_ENV])
  assert.deepEqual(order, ["load", "connect"])
  assert.deepEqual(result.stages.map(({ stage, pass }) => ({ stage, pass })), [
    { stage: "env-load", pass: true }, { stage: "env-check", pass: true }, { stage: "db-connect", pass: true },
  ])
  assert.equal(queries.length, 1)
  assert.match(queries[0].sql, /^\s*SELECT 1 AS ok, to_regclass\('assistant_sessions'\) AS assistant_sessions\s*$/i)
  assert.deepEqual(queries[0].params, [])
  assert.doesNotMatch(queries[0].sql, /INSERT|UPDATE|DELETE|CREATE|ALTER|DROP/i)
})

test("A4 preflight CLI prints stages without importing routes, using the network, or writing artifacts", () => {
  const dir = mkdtempSync(join(tmpdir(), "assistant-a4-"))
  const preload = join(dir, "preflight-mock.mjs")
  try {
    const provider = `export function neon() {
      return async (parts, ...values) => {
        if (values.length || parts.join('').trim() !== "SELECT 1 AS ok, to_regclass('assistant_sessions') AS assistant_sessions") throw new Error('Unexpected database operation');
        console.log('Mock preflight DB read');
        return [{ ok: 1, assistant_sessions: 'assistant_sessions' }];
      };
    }`
    writeFileSync(preload, `
      import fs from 'node:fs';
      import { registerHooks, syncBuiltinESMExports } from 'node:module';
      process.loadEnvFile = () => {
        for (const name of ${JSON.stringify(A4_OPTIONAL_ENV)}) delete process.env[name];
        Object.assign(process.env, ${JSON.stringify({ DATABASE_URL: configuredEnv().DATABASE_URL, ANTHROPIC_API_KEY: configuredEnv().ANTHROPIC_API_KEY })});
      };
      const noWrite = () => { throw new Error('Preflight must not write files'); };
      fs.writeFileSync = noWrite; fs.mkdirSync = noWrite;
      syncBuiltinESMExports();
      globalThis.fetch = () => { throw new Error('Preflight must not use real network'); };
      registerHooks({ resolve(specifier, context, next) {
        if (specifier === '@neondatabase/serverless') return { url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(provider)}`)}, shortCircuit: true };
        if (/lib\\/(?:ai|assistant)|api\\/(?:assist|twilio)/.test(specifier)) throw new Error('Preflight must not import assistant/model routes');
        return next(specifier, context);
      } });
    `)
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--import", pathToFileURL(preload).href, runner, "mock.env", "--preflight"], {
      cwd: root, encoding: "utf8", timeout: 60_000,
    })
    assert.ifError(child.error)
    assert.equal(child.status, 0, `${child.stdout}${child.stderr}`)
    assert.match(child.stdout, /A4 preflight: PASS/)
    assert.equal((child.stdout.match(/Mock preflight DB read/g) ?? []).length, 1)
    const stages = child.stdout.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line))
    assert.deepEqual(stages.map(({ stage, pass }) => ({ stage, pass })), [
      { stage: "env-load", pass: true }, { stage: "env-check", pass: true }, { stage: "db-connect", pass: true },
    ])
    assert.deepEqual(stages[1].required, ["DATABASE_URL", "ANTHROPIC_API_KEY"])
    assert.deepEqual(stages[1].stubbed, [...A4_OPTIONAL_ENV])
    assert.match(child.stdout, /stubbed for A4; outbound blocked/)
    for (const value of Object.values(configuredEnv())) assert.ok(!child.stdout.includes(value))
  } finally {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()))
    assert.ok(basename(dir).startsWith("assistant-a4-"))
    rmSync(dir, { recursive: true, force: true })
  }
})

test("A4 preflight reports missing names but independently probes an available DB", async () => {
  const env = { DATABASE_URL: configuredEnv().DATABASE_URL }
  let connects = 0
  const result = await runPreflight({
    env, loadEnv: () => {}, connect: () => { connects++; return async () => [{ ok: 1, assistant_sessions: "assistant_sessions" }] },
  })
  assert.equal(result.pass, false)
  assert.equal(connects, 1)
  assert.equal(result.stages[1].pass, false)
  assert.ok(result.stages[1].missing.includes("ANTHROPIC_API_KEY"))
  assert.equal(result.stages[1].diagnostic.stage, "env-check")
  assert.equal(result.stages[2].pass, true)
})

test("A4 preflight skips DB access when DATABASE_URL is absent", async () => {
  const result = await runPreflight({ env: {}, loadEnv: () => {}, connect: () => { assert.fail("must not connect") } })
  assert.equal(result.pass, false)
  assert.equal(result.stages[1].pass, false)
  assert.equal(result.stages[2].skipped, true)
})

test("A4 preflight sanitizes env-load failure and skips later stages", async () => {
  const result = await runPreflight({
    env: {}, loadEnv: () => { throw Object.assign(new Error("Cannot read https://private.test/env token=small"), { code: "ENOENT" }) },
    connect: () => { assert.fail("must not connect") },
  })
  assert.equal(result.pass, false)
  assert.equal(result.stages[0].diagnostic.code, "ENOENT")
  assert.equal(result.stages[0].diagnostic.stage, "env-load")
  assert.ok(result.stages.slice(1).every(({ skipped }) => skipped))
  assert.ok(!JSON.stringify(result).includes("private.test") && !JSON.stringify(result).includes("small"))
})

test("A4 preflight preserves safe DB failure class/code while sanitizing connection details", async () => {
  const env = configuredEnv()
  const result = await runPreflight({ env, loadEnv: () => {}, connect: () => { throw Object.assign(new TypeError(`Failed ${env.DATABASE_URL}`), { code: "ENOTFOUND" }) } })
  assert.equal(result.pass, false)
  assert.equal(result.stages[2].diagnostic.name, "TypeError")
  assert.equal(result.stages[2].diagnostic.code, "ENOTFOUND")
  assert.ok(!JSON.stringify(result).includes("db-password") && !JSON.stringify(result).includes("database.test"))
})

test("A4 preflight fails when the assistant sessions table is missing or SELECT 1 fails", async () => {
  for (const row of [{ ok: 1, assistant_sessions: null }, { ok: 0, assistant_sessions: "assistant_sessions" }]) {
    const result = await runPreflight({ env: configuredEnv(), loadEnv: () => {}, connect: () => async () => [row] })
    assert.equal(result.pass, false)
    assert.equal(result.stages[2].diagnostic.stage, "db-connect")
  }
})
