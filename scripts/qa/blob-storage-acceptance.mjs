// Explicitly opt-in provider probe. Never reads, lists, or deletes customer blobs.
import assert from "node:assert/strict"
import { randomUUID, createHash } from "node:crypto"
import { mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseEnv } from "node:util"
import { put, head, get, del, BlobNotFoundError } from "@vercel/blob"

if (process.env.MCSW_RUN_STORAGE_ACCEPTANCE !== "1") {
  throw new Error("Provider probe is opt-in: set MCSW_RUN_STORAGE_ACCEPTANCE=1.")
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const envFile = process.env.MCSW_BLOB_ENV_FILE
assert.ok(envFile, "A specific existing environment file is required.")
const token = parseEnv(readFileSync(envFile, "utf8")).BLOB_READ_WRITE_TOKEN?.trim()
assert.ok(token?.startsWith("vercel_blob_rw_"), "Configured Blob read-write token is unavailable.")
const runId = randomUUID()
const pathname = `qa/crm-polish/${runId}/probe.txt`
const directory = path.join(root, ".tmp", `blob-acceptance-${runId}`)
mkdirSync(directory, { recursive: false, mode: 0o700 })
const receiptFile = path.join(directory, "receipt.json")
const bytes = Buffer.from(`[INTERNAL TEST] MCSW storage acceptance\nRun: ${runId}\nSynthetic bytes only; remove after verification.\n`)
assert.ok(bytes.length <= 1024)
const sha = (value) => createHash("sha256").update(value).digest("hex")
function classify(error) {
  const text = String(error.message || "")
  const patterns = {
    privateOnPublicStore: /private.*public store|public store.*private/i,
    publicOnPrivateStore: /public.*private store|private store.*public/i,
    unauthorized: /unauthorized|forbidden|invalid token|access denied/i,
    rateLimited: /rate limit/i, timeout: /timed out|timeout|aborted/i,
    network: /fetch failed|network|ENOTFOUND|ECONN|certificate|SSL/i,
    disabledOrSuspended: /disabled|suspended|blocked/i,
    quotaOrBilling: /quota|billing|limit exceeded|bandwidth/i,
    configuration: /config|environment|not supported/i,
    invalidParameter: /invalid|must be|required|minimum|maximum/i,
    cacheControl: /cacheControl|cache control|cache-control/i,
    stream: /stream|Buffer|duplex/i,
    notFound: /not found|404/i, assertion: error.code === "ERR_ASSERTION",
  }
  return { type: error.constructor.name, code: error.code || null,
    flags: Object.fromEntries(Object.entries(patterns).map(([key, value]) => [key, value instanceof RegExp ? value.test(text) : value])) }
}
const summary = {
  startedAt: new Date().toISOString(), sdkVersion: "2.6.1", access: "private",
  bytes: bytes.length, sha256: sha(bytes), steps: [], passed: false,
  customerObjectsRead: false, productionDatabaseUsed: false, providerMessagesSent: false,
}
const receipt = { runId, pathname, state: "intent", uploadAttempted: false, deleted: false }
function persist() {
  const fd = openSync(receiptFile, "w", 0o600)
  try { writeFileSync(fd, JSON.stringify(receipt, null, 2)); fsyncSync(fd) } finally { closeSync(fd) }
}
function record(name, details = {}) { summary.steps.push({ name, ...details }); console.log(name) }
const options = () => ({ token, abortSignal: AbortSignal.timeout(45000) })
function validateOwned(meta) {
  assert.equal(meta.pathname, pathname)
  const url = new URL(meta.url)
  assert.equal(url.protocol, "https:")
  assert.ok(url.hostname.endsWith(".private.blob.vercel-storage.com"))
  assert.equal(decodeURIComponent(url.pathname.slice(1)), pathname)
  assert.equal(url.username + url.password + url.search + url.hash, "")
  assert.equal(meta.size, bytes.length)
  return meta
}
async function absent() {
  try { await head(pathname, options()); return false }
  catch (error) { if (error instanceof BlobNotFoundError) return true; throw error }
}
async function readOwn(url) {
  const result = await get(url, { ...options(), access: "private", useCache: false })
  assert.equal(result?.statusCode, 200)
  assert.equal(result.blob.size, bytes.length)
  const reader = result.stream.getReader()
  const parts = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      assert.ok(size <= 1024, "Provider returned more than the probe size limit.")
      parts.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  assert.deepEqual(Buffer.concat(parts), bytes)
}

persist() // Flush intent before the first provider operation.
let originalError
try {
  assert.equal(await absent(), true, "The unique probe pathname must not already exist.")
  receipt.preflightAbsent = true
  persist()
  record("unique pathname absent before upload")
  receipt.state = "uploading"
  receipt.uploadAttempted = true
  persist()
  const uploaded = await put(pathname, bytes, { ...options(), access: "private",
    contentType: "text/plain", addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 60 })
  receipt.url = uploaded.url
  receipt.state = "uploaded"
  persist()
  const metadata = validateOwned(await head(uploaded.url, options()))
  receipt.etag = metadata.etag
  persist()
  record("private upload and metadata verified", { size: metadata.size })
  await readOwn(metadata.url)
  record("authenticated origin read matches exact synthetic bytes")
  const denied = await fetch(metadata.url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(45000) })
  await denied.body?.cancel()
  assert.ok([401, 403, 404].includes(denied.status), "Private object must reject unauthenticated reads.")
  record("unauthenticated read denied", { status: denied.status })
  summary.verificationPassed = true
} catch (error) {
  originalError = error
  summary.failure = classify(error)
} finally {
  if (receipt.uploadAttempted && receipt.preflightAbsent) {
    try {
      if (!(await absent())) {
        // Reconcile a lost upload response only at this run's random pathname.
        const metadata = validateOwned(await head(pathname, options()))
        await readOwn(metadata.url)
        receipt.url = metadata.url
        receipt.etag = metadata.etag
        receipt.state = "delete-intent"
        persist()
        assert.ok(metadata.etag, "Conditional deletion requires the owned object's ETag.")
        await del(metadata.url, { ...options(), ifMatch: metadata.etag })
      }
      assert.equal(await absent(), true, "Deleted probe must be absent from provider metadata.")
      summary.metadataAbsenceVerified = true
      record("exact owned pathname absent from provider metadata")
      const gone = await get(pathname, { ...options(), access: "private", useCache: false })
      assert.equal(gone, null, "Deleted probe must be absent at origin storage.")
      summary.originAbsenceVerified = true
      receipt.deleted = true
      receipt.state = "removed"
      record("exact owned object deleted and origin absence verified")
    } catch (error) {
      receipt.state = "cleanup-required"
      summary.cleanupFailure = classify(error)
    }
  } else receipt.state = "no-upload"
  summary.removed = !receipt.uploadAttempted || receipt.deleted
  summary.passed = Boolean(summary.verificationPassed && summary.removed)
  summary.completedAt = new Date().toISOString()
  persist()
  // Aggregate evidence deliberately excludes tokens, object URLs and pathname.
  writeFileSync(path.join(directory, "summary.json"), JSON.stringify(summary, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ passed: summary.passed, removed: summary.removed,
    evidence: path.relative(root, path.join(directory, "summary.json")) }))
  if (originalError || !summary.passed) process.exitCode = 1
}
