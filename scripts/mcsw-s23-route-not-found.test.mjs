import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parsePositiveRouteId, requirePositiveRouteId, requireRouteValue } from "../lib/route-ids.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const read = (path) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n")

test("unknown board paths dispatch to the board not-found page", () => {
  const routePath = join(root, "app/board/[...unknown]/page.tsx")
  assert.ok(existsSync(routePath), "the board segment has no catch-all route for /board/nope")
  assert.match(read("app/board/[...unknown]/page.tsx"), /from "next\/navigation"[\s\S]*notFound\(\)/)
  assert.match(read("app/board/not-found.tsx"), /Nothing here[\s\S]*Back to the job tracker/)
})

test("job detail routes dispatch invalid IDs and missing records to not-found", () => {
  const page = read("app/ops/leads/[id]/page.tsx")
  const builds = read("app/ops/leads/[id]/builds/page.tsx")
  assert.match(page, /requirePositiveRouteId\(id, notFound\)/)
  assert.match(page, /requireRouteValue\(await getCachedLead\([\s\S]*?, notFound\)/)
  assert.match(builds, /requirePositiveRouteId\(id, notFound\)/)
  assert.match(builds, /requireRouteValue\(await getBuildsWorkspace\([\s\S]*?, notFound\)/)

  class RouteNotFound extends Error {}
  const notFound = () => { throw new RouteNotFound() }
  for (const id of [undefined, null, "", "nope", "12x", "1.5", "1e2", "-1", "0", "9007199254740992"]) {
    assert.equal(parsePositiveRouteId(id), null, `accepted invalid route id ${String(id)}`)
    assert.throws(() => requirePositiveRouteId(id, notFound), RouteNotFound)
  }
  assert.equal(parsePositiveRouteId("34"), 34)
  assert.equal(requirePositiveRouteId("00034", notFound), 34)
  assert.throws(() => requireRouteValue(null, notFound), RouteNotFound)
  assert.throws(() => requireRouteValue(undefined, notFound), RouteNotFound)
  const job = { id: 34 }
  assert.equal(requireRouteValue(job, notFound), job)
})
