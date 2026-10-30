import assert from "node:assert/strict"
import { createServer, request } from "node:http"
import test from "node:test"
import { Script } from "node:vm"
import { createPhonePreviewGateway } from "./android-preview-gateway.mjs"

async function setup(t, options = {}) {
  const received = []
  const upstream = createServer((req, res) => {
    received.push({ path: req.url, headers: req.headers })
    res.writeHead(200, { "Content-Type": "text/plain", "Set-Cookie": "upstream_auth=must-not-escape" })
    res.end("synthetic fixture")
  })
  await new Promise((done) => upstream.listen(0, "127.0.0.1", done))
  const gateway = createPhonePreviewGateway({ upstreamPort: upstream.address().port, ...options })
  await new Promise((done) => gateway.server.listen(0, "127.0.0.1", done))
  t.after(async () => {
    for (const server of [gateway.server, upstream]) {
      server.closeAllConnections()
      await new Promise((done) => server.close(done))
    }
  })
  const base = `http://127.0.0.1:${gateway.server.address().port}`
  const open = await fetch(base + gateway.entryPath, { redirect: "manual", headers: { "x-forwarded-proto": "https" } })
  const cookie = open.headers.get("set-cookie")?.split(";")[0]
  return { base, received, open, cookie, gateway }
}

test("private preview gates all content and strips upstream credentials and cookies", async (t) => {
  const f = await setup(t)
  assert.equal(f.open.status, 303)
  assert.match(f.open.headers.get("set-cookie"), /HttpOnly; SameSite=Lax; Secure/)
  assert.equal((await fetch(f.base + "/")).status, 403)
  const landing = await fetch(f.base + "/", { headers: { cookie: f.cookie } })
  assert.equal(landing.status, 200)
  const html = await landing.text()
  assert.match(html, /microphone recording are disabled/)
  assert.doesNotThrow(() => new Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]))
  const fixture = await fetch(f.base + "/board/qa-polish?surface=forms&state=empty", { headers: { cookie: f.cookie + "; ops-session=secret", authorization: "Bearer must-not-forward" } })
  assert.equal(fixture.status, 200)
  assert.equal(await fixture.text(), "synthetic fixture")
  assert.equal(fixture.headers.get("set-cookie"), null)
  assert.equal(f.received[0].headers.cookie, undefined)
  assert.equal(f.received[0].headers.authorization, undefined)
  assert.match(fixture.headers.get("content-security-policy"), /connect-src 'self'/)
  assert.match(fixture.headers.get("permissions-policy"), /microphone=\(\)/)
})

test("gateway rejects mutations, live routes, image proxying, source maps, debug and unexpected query parameters", async (t) => {
  const f = await setup(t)
  for (const path of ["/api/ops/voice", "/ops", "/board", "/_next/webpack-hmr", "/_next/image?url=https://example.invalid/a.png", "/_next/static/chunks/app.js.map", "/_next/static/%252e%252e/secret.js", "/__nextjs_original-stack-frame", "/board/qa-polish?surface=forms&token=unexpected", "/board/qa-polish?surface=voice"]) {
    assert.equal((await fetch(f.base + path, { headers: { cookie: f.cookie } })).status, 403, path)
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    assert.equal((await fetch(f.base + "/board/qa-polish", { method, headers: { cookie: f.cookie } })).status, 405, method)
  }
  assert.equal(f.received.length, 0)
  const asset = await fetch(f.base + "/_next/static/chunks/app/board/qa-polish/page.js?v=1", { headers: { cookie: f.cookie } })
  assert.equal(asset.status, 200)
})

test("expired sessions fail closed and raw traversal paths never reach the upstream", async (t) => {
  const expired = await setup(t, { expiresAt: Date.now() - 1 })
  assert.equal(expired.open.status, 410)
  const f = await setup(t)
  for (const path of ["/_next/static/%2e%2e/secret.js", "/_next/static/%5csecret.js", "//example.invalid/board/qa-polish"]) {
    const status = await new Promise((accept, reject) => {
      const req = request(f.base, { path, headers: { Cookie: f.cookie } }, (res) => { res.resume(); res.on("end", () => accept(res.statusCode)) })
      req.on("error", reject)
      req.end()
    })
    assert.equal(status, 400, path)
  }
  assert.equal(f.received.length, 0)
})
