import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"
import test from "node:test"
import { isSafeRelativePushUrl, normalizePushUrl } from "../lib/push-url.mjs"

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n")
const MANIFEST = source("../app/ops/manifest.webmanifest/route.ts")
const PUSH = source("../lib/push.ts")
const WORKER = source("../public/ops-sw.js")

function pngDimensions(path) {
  const png = readFileSync(new URL(path, import.meta.url))
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a")
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

test("install manifest starts at the board and covers the site root", () => {
  assert.match(MANIFEST, /start_url:\s*"\/board"/)
  assert.match(MANIFEST, /scope:\s*"\/"/)
  assert.match(MANIFEST, /background_color:\s*"#[0-9a-fA-F]{6}"/)
  assert.match(MANIFEST, /mcsw-jobs-icon-192\.png[\s\S]*?192x192[\s\S]*?maskable/)
  assert.match(MANIFEST, /mcsw-jobs-icon-512\.png[\s\S]*?512x512[\s\S]*?maskable/)
  assert.deepEqual(pngDimensions("../public/mcsw-jobs-icon-192.png"), { width: 192, height: 192 })
  assert.deepEqual(pngDimensions("../public/mcsw-jobs-icon-512.png"), { width: 512, height: 512 })
})

test("push payload builder rejects absolute and cross-origin destinations", () => {
  assert.equal(isSafeRelativePushUrl("/ops/leads/42#spike"), true)
  assert.equal(isSafeRelativePushUrl("https://attacker.example/steal"), false)
  assert.equal(isSafeRelativePushUrl("//attacker.example/steal"), false)
  assert.equal(normalizePushUrl("https://attacker.example/steal"), "/board")
  assert.match(PUSH, /normalizePushUrl\(payload\.url\)/)
})

test("notification click accepts /board and focuses an existing same-origin window", () => {
  const handlers = {}
  let navigatedTo = ""
  let focused = false
  const client = {
    url: "https://mcsw.test/ops",
    async navigate(target) { navigatedTo = target; this.url = target; return this },
    async focus() { focused = true; return this },
  }
  const fakeClients = {
    async matchAll() { return [client] },
    async openWindow(target) { navigatedTo = target; return client },
  }
  const self = {
    location: { origin: "https://mcsw.test" },
    registration: { scope: "https://mcsw.test/", async showNotification() {} },
    addEventListener(name, handler) { handlers[name] = handler },
    async skipWaiting() {},
  }
  vm.runInNewContext(WORKER, { self, clients: fakeClients, URL, Promise })

  const click = async (url) => {
    let pending
    handlers.notificationclick({
      notification: { data: { url }, close() {} },
      waitUntil(value) { pending = value },
    })
    await pending
  }

  return click("/board").then(async () => {
    assert.equal(navigatedTo, "https://mcsw.test/board")
    assert.equal(focused, true)
    await click("https://attacker.example/steal")
    assert.equal(navigatedTo, "https://mcsw.test/board")
  })
})
