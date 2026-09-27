import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const route = readFileSync(new URL("../app/j/[token]/review/route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")

function loadSameOrigin() {
  const start = route.indexOf("function sameOrigin(req: Request) {")
  const end = route.indexOf("\n}\n", start)
  assert.ok(start >= 0 && end > start, "review must define a same-origin guard")
  const functionSource = route.slice(start, end + 2).replace("req: Request", "req")
  return new Function(`return (${functionSource})`)()
}

test("review action refuses cross-origin posts before reading or mutating the Customer Page", () => {
  const sameOrigin = loadSameOrigin()
  const routeGuard = route.indexOf("if (!sameOrigin(req))")
  const lookup = route.indexOf("const job = await getGlassJob(token)")

  assert.equal(sameOrigin(new Request("https://shop.example/j/token/review", { headers: { origin: "https://shop.example" } })), true)
  assert.equal(sameOrigin(new Request("https://shop.example/j/token/review", { headers: { origin: "https://attacker.example" } })), false)
  assert.equal(sameOrigin(new Request("https://shop.example/j/token/review")), false)
  assert.ok(routeGuard >= 0 && routeGuard < lookup)
})
