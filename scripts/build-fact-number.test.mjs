import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const actions = readFileSync(new URL("../app/ops/leads/[id]/builds/actions.ts", import.meta.url), "utf8")
let parseBuildFactNumber
try {
  ({ parseBuildFactNumber } = await import("../lib/build-fact-number.ts"))
} catch {
  parseBuildFactNumber = null
}

test("build number parser rejects non-numbers and incomplete numeric input", () => {
  assert.equal(typeof parseBuildFactNumber, "function", "build actions need a shared number parser")

  for (const input of ["NaN", "Infinity", "", "  ", "12 inches", "12abc"]) {
    assert.throws(
      () => parseBuildFactNumber(input, { label: "shop estimate" }),
      /valid shop estimate/i,
      `expected ${JSON.stringify(input)} to be rejected with a plain-language error`,
    )
  }

  assert.equal(parseBuildFactNumber("12.5", { label: "shop estimate" }), 12.5)
})

test("integer build values must be safe, non-negative integers within the allowed range", () => {
  assert.equal(typeof parseBuildFactNumber, "function", "build actions need a shared number parser")

  const options = { label: "inside rails", integer: true, min: 0, max: 8 }
  assert.equal(parseBuildFactNumber("0", options), 0)
  assert.equal(parseBuildFactNumber("8", options), 8)
  for (const input of ["-1", "1.5", "9", "9007199254740992"]) {
    assert.throws(() => parseBuildFactNumber(input, options), /valid inside rails/i)
  }
})

test("build actions validate BIGINT IDs and estimate values before calling write actions", () => {
  assert.match(actions, /parseBuildFactNumber\(formData\.get\("claimId"\)/)
  assert.match(actions, /parseBuildFactNumber\(formData\.get\("value"\)/)
  assert.match(actions, /integer:\s*true/)
  assert.ok(actions.indexOf("parseBuildFactNumber(formData.get(\"claimId\")") < actions.indexOf("await proposeBuildFactChange("))
  assert.ok(actions.indexOf("parseBuildFactNumber(formData.get(\"value\")") < actions.indexOf("await addWorkingBuildFact("))
})
