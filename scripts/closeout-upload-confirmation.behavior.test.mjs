import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"

const uploadId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
function fixture({ status = "pending", blobSize = 1234, expired = false } = {}) {
  const receipt = { id: uploadId, lead_id: 7, operator_id: 2, mode: "completion", is_test: false,
    pathname: `closeouts/${uploadId}-fixture.jpg`, size_bytes: 1234, content_type: "image/jpeg", status,
    expires_at: expired ? "2000-01-01T00:00:00Z" : "2099-01-01T00:00:00Z", attached_event_id: null }
  const effects = { heads: 0, writes: 0 }
  const sql = async (strings, ...values) => {
    const query = strings.join(" ? ").replace(/\s+/g, " ").trim()
    if (query.startsWith("SELECT id, lead_id, operator_id")) {
      const [id, leadId, operatorId, mode, isTest] = values
      const allowedStatuses = query.includes("'pending','uploaded','attached'") ? ["pending", "uploaded", "attached"] : ["uploaded", "attached"]
      return id === receipt.id && leadId === receipt.lead_id && operatorId === receipt.operator_id
        && mode === receipt.mode && isTest === receipt.is_test && allowedStatuses.includes(receipt.status)
        && (!expired || receipt.status === "attached") ? [{ ...receipt }] : []
    }
    if (query.startsWith("SELECT id, pathname, size_bytes")) return [{ ...receipt }]
    if (query.startsWith("UPDATE closeout_photo_uploads SET status = 'uploaded'")) {
      effects.writes++
      if (receipt.status !== "pending" || expired || values[1] !== receipt.pathname || values[2] !== receipt.size_bytes) return []
      receipt.status = "uploaded"; return [{ id: receipt.id }]
    }
    if (query.startsWith("SELECT status FROM closeout_photo_uploads")) return [{ status: receipt.status }]
    throw new Error(`Unexpected upload SQL: ${query}`)
  }
  const fakes = new Map([
    ["@/lib/db", { getSql: () => sql }],
    ["@/lib/operators", { requireLeadMutationAccess: async () => { throw new Error("No upload creation expected") } }],
    ["@vercel/blob", { head: async () => { effects.heads++; return { pathname: receipt.pathname, size: blobSize } } }],
  ])
  const output = ts.transpileModule(readFileSync(new URL("../lib/closeout-photo-uploads.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const context = vm.createContext({ Error, Date })
  const loaded = { exports: {} }
  const require = (name) => {
    if (fakes.has(name)) return fakes.get(name)
    throw new Error(`Unexpected upload import: ${name}`)
  }
  vm.runInContext(`(function(exports, require, module) { ${output}\n})`, context)(loaded.exports, require, loaded)
  return { receipt, effects, api: loaded.exports, input: { id: uploadId, leadId: 7, operatorId: 2, mode: "completion", isTest: false } }
}

test("finishing immediately after upload confirms bytes while the signed callback is delayed", async () => {
  const current = fixture()
  const upload = await current.api.getCloseoutPhotoUpload(current.input)
  assert.equal(upload.status, "uploaded")
  assert.equal(current.effects.heads, 1)
  assert.equal(current.effects.writes, 1)
  await current.api.confirmCloseoutPhotoUpload(uploadId, current.receipt.pathname)
  assert.equal(current.effects.heads, 1, "the later signed callback is an idempotent replay")
  assert.equal(current.effects.writes, 1)
})

test("pending receipt confirmation never reads Blob storage for another job, operator, mode, test partition, or expired receipt", async () => {
  for (const change of [{ leadId: 8 }, { operatorId: 3 }, { mode: "addendum" }, { isTest: true }, { expired: true }]) {
    const current = fixture({ expired: Boolean(change.expired) })
    await assert.rejects(current.api.getCloseoutPhotoUpload({ ...current.input, ...change }), /unavailable/)
    assert.equal(current.effects.heads, 0)
    assert.equal(current.effects.writes, 0)
  }
})

test("a byte-size mismatch cannot promote a pending upload to ready", async () => {
  const current = fixture({ blobSize: 999 })
  await assert.rejects(current.api.getCloseoutPhotoUpload(current.input), /did not match/)
  assert.equal(current.receipt.status, "pending")
  assert.equal(current.effects.writes, 0)
})

test("already attached receipts remain usable without rechecking expired Blob authorization", async () => {
  const current = fixture({ status: "attached", expired: true })
  assert.equal((await current.api.getCloseoutPhotoUpload(current.input)).status, "attached")
  assert.equal(current.effects.heads, 0)
})
