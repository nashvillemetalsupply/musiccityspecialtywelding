import assert from "node:assert/strict"
import test from "node:test"
import { prepareMediaOffload } from "./prepare-media-offload.mjs"

const VIDEO_PATHS = ["/wr-customer-walkaround.mp4", "/wr-shopcut-92.mp4"]
const CDN = "https://cdn.example.com"
const baseConfig = () => ({
  headers: [{
    source: "/(.*).mp4",
    headers: [
      { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      { key: "Access-Control-Allow-Origin", value: "*" },
    ],
  }, { source: "/api/b", headers: [{ key: "X-Beacon", value: "keep" }] }],
  rewrites: [{ source: "/api/b/beacon", destination: "/api/b" }],
  functions: { "api/b.js": { maxDuration: 10 } },
})

test("offload redirects only the two known video paths and preserves unrelated config without mutating input", () => {
  const base = baseConfig()
  const original = structuredClone(base)
  const config = prepareMediaOffload(base, `${CDN}/`)
  assert.deepEqual(base, original)
  assert.deepEqual(config.redirects, VIDEO_PATHS.map((source) => ({
    source, destination: `${CDN}${source}`, statusCode: 307,
  })))
  assert.deepEqual(config.rewrites, original.rewrites)
  assert.deepEqual(config.functions, original.functions)
  assert.deepEqual(config.headers[1], original.headers[1])
  assert.equal(config.headers[0].headers.find(({ key }) => key === "Access-Control-Allow-Origin").value, "*")
  assert.equal(config.redirects.some(({ source }) => source.startsWith("/api/")), false)
})

test("temporary video redirects cannot inherit the old year-long immutable cache rule", () => {
  const config = prepareMediaOffload(baseConfig(), CDN)
  assert.equal(config.headers[0].headers.find(({ key }) => key === "Cache-Control").value, "no-store")
  for (const path of VIDEO_PATHS) {
    const rule = config.headers.find(({ source }) => source === path)
    assert.ok(rule)
    for (const key of ["Cache-Control", "CDN-Cache-Control", "Vercel-CDN-Cache-Control"]) {
      assert.equal(rule.headers.find((header) => header.key === key)?.value, "no-store")
    }
  }
})

test("existing redirect order survives while exact offload paths precede a wildcard", () => {
  const base = { ...baseConfig(), redirects: [
    { source: "/old", destination: "/new", permanent: true },
    { source: "/:path*", destination: "/archive/:path*", statusCode: 307 },
  ] }
  const config = prepareMediaOffload(base, CDN)
  assert.deepEqual(config.redirects.slice(2), base.redirects)
  assert.deepEqual(config.redirects.slice(0, 2).map(({ source }) => source), VIDEO_PATHS)
})

test("existing exact video redirects fail instead of silently overwriting a route", () => {
  for (const source of VIDEO_PATHS) {
    const base = { redirects: [{ source, destination: "https://old.example.com/video.mp4", permanent: true }] }
    assert.throws(() => prepareMediaOffload(base, CDN), /already has a redirect/)
    assert.equal(base.redirects.length, 1)
  }
})

test("empty base config works and legacy routes or malformed config fail closed", () => {
  assert.equal(prepareMediaOffload({}, CDN).redirects.length, 2)
  for (const base of [null, [], "bad", { routes: [] }, { redirects: {} }, { headers: {} }]) {
    assert.throws(() => prepareMediaOffload(base, CDN), /configuration|routes|array/)
  }
})

test("CDN origin must be public HTTPS origin only, with no embedded credentials or URL components", () => {
  const badOrigins = [
    "http://cdn.example.com", "//cdn.example.com", "https://cdn.example.com/path",
    "https://cdn.example.com/../", "https://cdn.example.com?token=secret",
    "https://cdn.example.com/#fragment", "https://user:secret@cdn.example.com",
    "https://localhost", "https://x.localhost", "https://storage.local", "https://storage.internal",
    "https://127.0.0.1", "https://10.0.0.1", "https://172.16.0.1", "https://192.168.0.1",
    "https://169.254.169.254", "https://2130706433", "https://[::1]", "https://[fd00::1]",
    "https://example.vercel.app", "https://vercel.app", "https://example.now.sh",
    "https://musiccityspecialtywelding.com", "https://www.musiccityspecialtywelding.com",
    "https://cdn.example.com\\evil", "https://cdn.example.com\n", "garbage", "", null,
  ]
  for (const origin of badOrigins) assert.throws(() => prepareMediaOffload({}, origin), /CDN origin/, String(origin))
})

test("validation errors never echo supplied secrets", () => {
  const secret = "do-not-echo-this"
  for (const origin of [`https://user:${secret}@cdn.example.com`, `https://cdn.example.com?key=${secret}`]) {
    assert.throws(() => prepareMediaOffload({}, origin), (error) => {
      assert.doesNotMatch(error.message, new RegExp(secret))
      return true
    })
  }
})
