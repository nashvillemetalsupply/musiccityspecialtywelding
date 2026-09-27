import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("the Customer Page counts only after three continuous seconds visible in the browser", () => {
  const page = source("app/j/[token]/page.tsx")
  const beacon = source("app/j/[token]/view-beacon.tsx")
  const route = source("app/api/glass/view/route.ts")
  assert.match(page, /<GlassViewBeacon token=\{token\}\s*\/>/)
  assert.doesNotMatch(page, /noteGlassView\(/)
  assert.match(beacon, /visibilityState !== "visible"/)
  assert.match(beacon, /setTimeout\(send, 3000\)/)
  assert.match(beacon, /clearTimeout\(timer\)/)
  assert.match(beacon, /fetch\("\/api\/glass\/view"/)
  assert.match(route, /if \(!sameOrigin\(req\)\)/)
  assert.match(route, /await noteGlassView\(job\)/)
  assert.match(route, /if \(job\.is_test\)/)
})

test("view-count notifications stay behind the daily threshold and are durable", () => {
  const route = source("app/api/glass/view/route.ts")
  assert.match(route, /Number\(view\.daily_view_count\) >= 3/)
  assert.match(route, /kind: "glass\.view"/)
  assert.match(route, /externalId/)
  assert.match(route, /timeZone: "America\/Chicago"/)
  assert.match(route, /notifyAll\(/)
})
