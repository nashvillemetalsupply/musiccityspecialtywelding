import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const homePage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8")

test("home sign keeps its visual text and names the service and city accessibly", () => {
  assert.match(
    homePage,
    /<h1 className="sw-sign" aria-label="Music City Specialty Welding — Nashville mobile welding, on-site repair, and custom fabrication across Middle Tennessee">/
  )
  assert.match(homePage, /<span className="sw-line-sm">Music City<\/span>/)
  assert.match(homePage, /<span className="sw-line-lg">Specialty<\/span>/)
  assert.match(homePage, /<span className="sw-line-lg">\s*Weld<i className="sw-buzz"/)
})
