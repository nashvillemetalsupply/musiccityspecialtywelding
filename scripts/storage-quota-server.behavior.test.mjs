import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"

const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
class BlobNotFoundError extends Error {}
function load(file, dependencies, globals = {}) {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} }
  vm.runInNewContext(`(function(exports, require, module) { ${output}\n})`, { Request, Response, URL, Buffer, Date, Error, ...globals })(loaded.exports, name => {
    assert.ok(name in dependencies, `Unexpected import: ${name}`)
    return dependencies[name]
  }, loaded)
  return loaded.exports
}

function photoFixture({ status = "pending", absent = false, expired = false, wrongSize = false, headError = null, completed = false } = {}) {
  const receipt = { id, lead_id: 7, operator_id: 2, mode: "completion", pathname: `closeouts/${id}-fixture.jpg`,
    original_name: "fixture.jpg", content_type: "image/jpeg", size_bytes: 4, is_test: false, status,
    expires_at: expired ? "2000-01-01" : "2099-01-01", attached_event_id: null }
  const effects = { heads: 0, renewals: 0, confirmations: 0, creates: [] }
  const sql = async (strings, ...values) => {
    const query = strings.join(" ? ").replace(/\s+/g, " ").trim()
    if (query.startsWith("SELECT completed_at")) return [{ completed_at: completed ? "2026-10-30" : null, is_test: false }]
    if (query.startsWith("SELECT id FROM leads")) return completed && values[0] === 7 && values[1] === false ? [{ id: 7 }] : []
    if (query.startsWith("INSERT INTO closeout_photo_uploads")) { effects.creates.push(values); return [{ id }] }
    if (query.startsWith("SELECT id, lead_id, operator_id")) {
      return values[0] === id && values[1] === 7 && values[2] === 2 && values[3] === "completion" && values[4] === false ? [{ ...receipt }] : []
    }
    if (query.startsWith("UPDATE closeout_photo_uploads SET expires_at")) {
      effects.renewals++; receipt.expires_at = "2099-01-01"; return [{ id }]
    }
    if (query.startsWith("SELECT id, pathname, size_bytes")) return [{ ...receipt }]
    if (query.startsWith("UPDATE closeout_photo_uploads SET status = 'uploaded'")) {
      effects.confirmations++; receipt.status = "uploaded"; return [{ id }]
    }
    throw new Error(`Unexpected SQL: ${query}`)
  }
  const api = load("lib/closeout-photo-uploads.ts", {
    "@/lib/db": { getSql: () => sql },
    "@/lib/operators": { requireLeadMutationAccess: async () => ({ isTest: false }) },
    "@vercel/blob": { BlobNotFoundError, head: async () => {
      effects.heads++
      if (headError) throw headError
      if (absent) throw new BlobNotFoundError("Missing")
      return { pathname: receipt.pathname, size: wrongSize ? 99 : 4 }
    } },
  })
  const input = { operator: { id: 2, role: "owner" }, id, leadId: 7, mode: "completion" }
  return { api, receipt, effects, input }
}

test("photo retry reconciles accepted bytes after response loss without another upload", async () => {
  const current = photoFixture()
  const state = await current.api.recoverCloseoutPhotoUpload(current.input)
  assert.equal(state.ready, true)
  assert.equal(state.uploadRequired, false)
  assert.equal(current.receipt.status, "uploaded")
  assert.equal(current.effects.heads, 1)
})

test("only confirmed Blob absence allows a pending photo upload retry", async () => {
  const current = photoFixture({ absent: true })
  assert.equal((await current.api.recoverCloseoutPhotoUpload(current.input)).uploadRequired, true)
  const suspended = photoFixture({ headError: new Error("BlobStoreSuspendedError") })
  await assert.rejects(suspended.api.recoverCloseoutPhotoUpload(suspended.input), /suspended/i)
  assert.equal(suspended.effects.confirmations, 0)
})

test("a retained receipt renews after a quota reset without a new object identity", async () => {
  const current = photoFixture({ expired: true, absent: true })
  assert.equal((await current.api.recoverCloseoutPhotoUpload(current.input)).uploadRequired, true)
  assert.equal(current.effects.renewals, 1)
  assert.equal(current.receipt.id, id)
})

test("photo recovery cannot renew or inspect another operator, job or workflow", async () => {
  for (const change of [{ operator: { id: 3, role: "owner" } }, { leadId: 8 }, { mode: "addendum" }]) {
    const current = photoFixture()
    const state = await current.api.recoverCloseoutPhotoUpload({ ...current.input, ...change })
    assert.equal(state.uploadRequired, true)
    assert.equal(current.effects.heads, 0)
    assert.equal(current.effects.renewals, 0)
  }
})

test("photo recovery never marks mismatched bytes ready", async () => {
  const current = photoFixture({ wrongSize: true })
  await assert.rejects(current.api.recoverCloseoutPhotoUpload(current.input), /did not match/)
  assert.equal(current.effects.confirmations, 0)
})

test("uploaded and attached photos skip storage traffic on every retry", async () => {
  for (const status of ["uploaded", "attached"]) {
    const current = photoFixture({ status })
    const state = await current.api.recoverCloseoutPhotoUpload(current.input)
    assert.equal(state.ready, true)
    assert.equal(state.attached, status === "attached")
    assert.equal(current.effects.heads, 0)
  }
})

function voiceFixture({ lostResponse = false, stored = false, headSize = 3, newIntent = false, headAbsent = false, headError = null } = {}) {
  const row = { status: "persisted", transcript: "", blob_path: stored ? `voice-notes/2/${id}.webm` : "", content_type: "audio/webm", recovery_key: "done:7", lead_id: 7 }
  const effects = { puts: 0, heads: 0, options: null }
  const route = load("app/api/ops/transcribe/route.ts", {
    "node:crypto": { randomUUID: () => id },
    "@/lib/ops-auth": { getAuthenticatedOperator: async () => ({ id: 2, role: "owner" }) },
    "@/lib/voice-outbox-scope.ts": { voiceOperatorScope: () => "operator:2:owner" },
    "@/lib/db": { getSql: () => async (strings, ...values) => {
      const query = strings.join(" ? ").replace(/\s+/g, " ").trim()
      if (query.startsWith("INSERT")) return newIntent ? [{ id }] : []
      if (query.startsWith("SELECT")) return [{ ...row }]
      if (query.includes("SET blob_path")) { row.blob_path = values[0]; row.status = "queued" }
      return []
    } },
    "@/lib/voice-transcription": { transcribeVoiceIntent: async () => "Words" },
    "@vercel/blob": { BlobNotFoundError, put: async (pathname, _bytes, options) => {
      effects.puts++; effects.options = options
      if (lostResponse) throw new Error("Provider response lost")
      return { pathname }
    }, head: async pathname => {
      effects.heads++
      if (headError) throw headError
      if (headAbsent) throw new BlobNotFoundError("Missing")
      return { pathname, size: headSize, contentType: "audio/webm" }
    } },
  }, { process: { env: { DEEPGRAM_API_KEY: "synthetic", BLOB_READ_WRITE_TOKEN: "synthetic" } } })
  const request = recoveryKey => new Request("https://fixture.invalid/api/ops/transcribe", { method: "POST", body: new Uint8Array([1, 2, 3]),
    headers: { "content-type": "audio/webm", "x-voice-intent-id": id, "x-voice-recovery-key": recoveryKey || "done:7", "x-voice-operator-scope": "operator:2:owner" } })
  return { route, effects, row, request }
}

test("voice upload response loss reconciles the same private path without overwriting", async () => {
  const current = voiceFixture({ lostResponse: true, newIntent: true })
  assert.equal((await current.route.POST(current.request())).status, 200)
  assert.equal(current.effects.heads, 1)
  assert.equal(current.effects.options.allowOverwrite, false)
  assert.equal(current.effects.options.addRandomSuffix, false)
  assert.ok(current.row.blob_path)
})

test("voice replay with stored bytes does not upload again", async () => {
  const current = voiceFixture({ stored: true })
  assert.equal((await current.route.POST(current.request())).status, 200)
  assert.equal(current.effects.puts, 0)
  assert.equal(current.effects.heads, 0)
})

test("voice replay cannot bind an existing recording to another workflow", async () => {
  const current = voiceFixture()
  assert.equal((await current.route.POST(current.request("done:8"))).status, 409)
  assert.equal(current.effects.puts, 0)
})

test("voice response-loss reconciliation rejects mismatched stored bytes", async () => {
  const current = voiceFixture({ lostResponse: true, headSize: 99 })
  assert.equal((await current.route.POST(current.request())).status, 502)
  assert.equal(current.row.blob_path, "")
})

test("an existing voice intent reconciles lost acknowledgement before transmitting bytes", async () => {
  const current = voiceFixture()
  assert.equal((await current.route.POST(current.request())).status, 200)
  assert.equal(current.effects.heads, 1)
  assert.equal(current.effects.puts, 0)
})

test("only typed absence permits an existing voice intent to transmit retained bytes", async () => {
  const missing = voiceFixture({ headAbsent: true })
  assert.equal((await missing.route.POST(missing.request())).status, 200)
  assert.equal(missing.effects.puts, 1)
  for (const message of ["BlobStoreSuspendedError", "Timeout", "Access denied"]) {
    const current = voiceFixture({ headError: new Error(message) })
    assert.equal((await current.route.POST(current.request())).status, 502)
    assert.equal(current.effects.puts, 0)
    assert.equal(current.row.blob_path, "")
  }
})

test("an offline completion photo can first create its original receipt after the job finishes", async () => {
  const current = photoFixture({ completed: true })
  await current.api.createCloseoutPhotoUpload({ ...current.input, originalName: "fixture.jpg", contentType: "image/jpeg", sizeBytes: 4, pathname: current.receipt.pathname })
  assert.equal(current.effects.creates.length, 1)
  assert.equal(current.effects.creates[0][0], id)
  assert.equal(current.effects.creates[0][3], "completion")
})

test("completed-job addenda can file their original same-operator completion photo without changing its mode", async () => {
  const current = photoFixture({ completed: true, status: "uploaded" })
  const input = { id, leadId: 7, operatorId: 2, mode: "addendum", isTest: false }
  const receipt = await current.api.getCloseoutPhotoUpload(input)
  assert.equal(receipt.id, id)
  assert.equal(receipt.mode, "completion")
  assert.equal(current.effects.heads, 0)
  for (const change of [{ leadId: 8 }, { operatorId: 3 }, { isTest: true }]) {
    await assert.rejects(current.api.getCloseoutPhotoUpload({ ...input, ...change }), /unavailable/)
  }
  const unfinished = photoFixture({ status: "uploaded" })
  await assert.rejects(unfinished.api.getCloseoutPhotoUpload(input), /unavailable/)
})

test("photo status recovery authenticates the current identity before reading a receipt", async () => {
  let operator = { id: 2, role: "owner" }
  const calls = []
  const route = load("app/api/ops/closeout-upload/route.ts", {
    "@vercel/blob/client": { handleUpload: async () => { throw new Error("No token issuance expected") } },
    "next/headers": { cookies: async () => ({ get: () => ({ value: "synthetic" }) }) },
    "@/lib/ops-auth": { OPS_SESSION_COOKIE: "session", validateSessionToken: async () => operator },
    "@/lib/voice-outbox-scope.ts": { voiceOperatorScope: () => "operator:2:owner" },
    "@/lib/closeout-photo-uploads": { recoverCloseoutPhotoUpload: async input => {
      calls.push(input); return { ready: true, uploadRequired: false, attached: false }
    } },
  })
  const request = scope => new Request(`https://fixture.invalid/api/ops/closeout-upload?uploadId=${id}&leadId=7&mode=completion`, {
    headers: scope ? { "x-voice-operator-scope": scope } : {},
  })
  operator = null
  assert.equal((await route.GET(request("operator:2:owner"))).status, 401)
  operator = { id: 2, role: "owner" }
  for (const scope of [null, "operator:3:owner", "operator:2:crew"]) {
    assert.equal((await route.GET(request(scope))).status, 409)
  }
  assert.equal(calls.length, 0)
  const response = await route.GET(request("operator:2:owner"))
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.equal((await response.json()).ready, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].id, id)
  assert.equal(calls[0].leadId, 7)
})

test("in-progress voice transcription does not reset another request's provider claim", async () => {
  const current = voiceFixture({ stored: true })
  current.row.status = "submitting"
  const response = await current.route.POST(current.request())
  assert.equal(response.status, 202)
  assert.equal(current.row.status, "submitting")
  assert.equal(current.effects.puts, 0)
})

test("a session switch between photo recovery and token issuance cannot upload under another operator", async () => {
  let operator = { id: 3, role: "owner" }
  let created = 0
  const payload = { uploadId: id, leadId: 7, mode: "completion", originalName: "fixture.jpg", contentType: "image/jpeg", sizeBytes: 4, operatorScope: "operator:2:owner" }
  const route = load("app/api/ops/closeout-upload/route.ts", {
    "@vercel/blob/client": { handleUpload: async ({ onBeforeGenerateToken }) => onBeforeGenerateToken(`closeouts/${id}-fixture.jpg`, JSON.stringify(payload)) },
    "next/headers": { cookies: async () => ({ get: () => ({ value: "synthetic" }) }) },
    "@/lib/ops-auth": { OPS_SESSION_COOKIE: "session", validateSessionToken: async () => operator },
    "@/lib/voice-outbox-scope.ts": { voiceOperatorScope: current => `operator:${current.id}:${current.role}` },
    "@/lib/closeout-photo-uploads": { createCloseoutPhotoUpload: async () => { created++ } },
  })
  const request = () => new Request("https://fixture.invalid/api/ops/closeout-upload", { method: "POST", body: "{}", headers: { "content-type": "application/json" } })
  assert.equal((await route.POST(request())).status, 400)
  assert.equal(created, 0)
  operator = { id: 2, role: "owner" }
  const response = await route.POST(request())
  assert.equal(response.status, 200)
  assert.equal(created, 1)
  assert.equal((await response.json()).allowOverwrite, false)
})

function closeoutVoiceAddendum({ savedKey = "closeout:7", savedOperator = 2, savedLead = 7, savedStatus = "completed", jobCompleted = true } = {}) {
  const source = readFileSync(new URL("../app/ops/actions.ts", import.meta.url), "utf8")
  const ast = ts.createSourceFile("actions.ts", source, ts.ScriptTarget.Latest, true)
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "addLeadCompletionNote")
  assert.ok(declaration)
  const output = ts.transpileModule(declaration.getText(ast), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const effects = { events: [], enrichment: [], sql: [] }
  const sql = async (strings, ...values) => {
    const query = strings.join(" ? ").replace(/\s+/g, " ").trim()
    effects.sql.push({ query, values })
    if (query.startsWith("SELECT l.public_id")) return jobCompleted ? [{ public_id: "synthetic-job", first_name: "Fixture", person_id: null, is_test: false, completion_event_id: 25 }] : []
    if (query.startsWith("SELECT blob_path, content_type")) {
      const [requestedId, operator, lead, ...keys] = values
      return requestedId === id && operator === savedOperator && lead === savedLead && keys.includes(savedKey) && savedStatus === "completed"
        ? [{ blob_path: "voice-notes/2/synthetic.webm", content_type: "audio/webm" }] : []
    }
    if (query.startsWith("UPDATE events SET detail")) { effects.enrichment.push(JSON.parse(values[0])); return [] }
    throw new Error(`Unexpected addendum SQL: ${query}`)
  }
  const loaded = { exports: {} }
  vm.runInNewContext(`(function(exports) { ${output}\n})`, {
    File, Buffer, createHash,
    requireOperator: async () => ({ id: 2, role: "owner", name: "Fixture" }),
    requireMutableLeadId: async () => 7,
    getSql: () => sql,
    canAccessInternalTests: () => true,
    recordEvent: async event => { effects.events.push(event); return 26 },
    redactCrewText: value => value,
    after: () => {}, revalidatePath: () => {},
  })(loaded.exports)
  const form = new FormData()
  form.set("leadId", "7")
  form.set("voiceIntentId", id)
  form.set("noteSource", "voice")
  form.set("note", "Recovered original completion recording")
  return { run: () => loaded.exports.addLeadCompletionNote(form), effects }
}

test("a finished-job addendum files its original closeout voice capture with the same intent", async () => {
  for (const savedKey of ["closeout:7", "done:7"]) {
    const current = closeoutVoiceAddendum({ savedKey })
    await current.run()
    assert.equal(current.effects.events.length, 1)
    assert.equal(current.effects.events[0].detail.voiceIntentId, id)
    assert.equal(current.effects.enrichment[0].recoveredVoiceIntentId, id)
    assert.equal(current.effects.enrichment[0].voicePath, "voice-notes/2/synthetic.webm")
    const query = current.effects.sql.find(item => item.query.startsWith("SELECT blob_path"))
    assert.match(query.query, /operator_id = \? ::bigint/)
    assert.match(query.query, /lead_id = \? ::bigint/)
    assert.match(query.query, /status = 'completed'/)
  }
})

test("closeout voice recovery cannot file another operator, job, workflow or unfinished recording", async () => {
  for (const change of [{ savedOperator: 3 }, { savedLead: 8 }, { savedKey: "closeout:8" }, { savedKey: "spike:7" }, { savedStatus: "failed" }]) {
    const current = closeoutVoiceAddendum(change)
    await assert.rejects(current.run(), /does not belong to this closeout/)
    assert.equal(current.effects.events.length, 0)
    assert.equal(current.effects.enrichment.length, 0)
  }
  const unfinished = closeoutVoiceAddendum({ jobCompleted: false })
  await assert.rejects(unfinished.run(), /Stamp DONE/)
  assert.equal(unfinished.effects.events.length, 0)
})
