import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("glass upload routes log internals and return plain customer guidance", () => {
  const upload = source("app/api/glass/upload/route.ts")
  const finalize = source("app/api/glass/upload/finalize/route.ts")

  assert.match(upload, /console\.error\("Glass upload failed:", error\)/)
  assert.match(upload, /This file could not be uploaded\. Check it and try again\./)
  assert.doesNotMatch(upload, /error: error instanceof Error \? error\.message/)

  assert.match(finalize, /console\.error\("Glass upload finalization failed:", error\)/)
  assert.match(finalize, /That upload request expired\. Choose the file again\./)
  assert.match(finalize, /The file could not be filed yet\. Try again in a moment\./)
  assert.doesNotMatch(finalize, /error: error instanceof Error \? error\.message/)
})
