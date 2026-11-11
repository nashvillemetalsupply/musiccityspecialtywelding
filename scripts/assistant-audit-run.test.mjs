import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import http from "node:http"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const runner = fileURLToPath(new URL("./assistant-audit-run.mjs", import.meta.url))

function run(args, allowedOrigin) {
  const guard = `const original = globalThis.fetch; globalThis.fetch = (url, init) => {
    if (new URL(url).origin !== ${JSON.stringify(allowedOrigin ?? "no-network")}) throw new Error("Unexpected network request");
    return original(url, init);
  };`
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--import", `data:text/javascript,${encodeURIComponent(guard)}`, runner, ...args], {
      cwd: root, env: {}, windowsHide: true,
    })
    let stdout = "", stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

test("live audit refuses a missing base URL before any network request", async () => {
  const result = await run(["--prod", "--test-suppression-confirmed"])
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /--base-url/)
  assert.doesNotMatch(result.stderr, /Unexpected network request/)
})

test("live audit sends both test markers on every request to the explicit base URL", async () => {
  const requests = []
  const server = http.createServer(async (request, response) => {
    let body = ""
    for await (const chunk of request) body += chunk
    requests.push({ method: request.method, url: request.url, body: JSON.parse(body) })
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({ reply: "We review the exact job scope.", handoff_reason: null }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  mkdirSync(path.join(root, ".tmp"), { recursive: true })
  const temporary = mkdtempSync(path.join(root, ".tmp", "audit-runner-test-"))
  const output = path.join(temporary, "live.json")
  try {
    const origin = `http://127.0.0.1:${server.address().port}`
    const result = await run(["--prod", "--base-url", `${origin}/`, "--test-suppression-confirmed", "--output", output], origin)
    assert.equal(result.code, 0, result.stderr)
    assert.equal(requests.length, 10)
    for (const request of requests) {
      assert.equal(request.method, "POST")
      assert.equal(request.url, "/api/assist")
      assert.equal(request.body.is_test, true)
      assert.match(request.body.message, /^\[INTERNAL TEST\] /)
      assert.equal(request.body.turn_index, 0)
    }
    assert.equal(new Set(requests.map((request) => request.body.session_id)).size, requests.length)
    const report = JSON.parse(readFileSync(output, "utf8"))
    assert.equal(report.total, requests.length)
    assert.equal(report.baseUrl, origin)
    assert.ok(report.results.every((entry) => entry.input.is_test && entry.input.message.startsWith("[INTERNAL TEST] ")))
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(temporary, { recursive: true, force: true })
  }
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
