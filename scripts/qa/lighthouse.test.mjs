import assert from "node:assert/strict"
import test from "node:test"
import { findChromePath, LIGHTHOUSE_TARGETS, lighthouseArgs, reportFileName } from "./lighthouse.mjs"

test("mobile Lighthouse targets production home, a service page, and service areas", () => {
  assert.deepEqual(LIGHTHOUSE_TARGETS, [
    { slug: "home", path: "/" },
    { slug: "service-mobile-welding", path: "/services/mobile-welding" },
    { slug: "service-areas", path: "/service-areas" },
  ])
  assert.equal(reportFileName("2026-09-27", "home"), "lighthouse-2026-09-27-home.json")

  const args = lighthouseArgs({
    url: "https://musiccityspecialtywelding.com/",
    outputPath: "scripts/qa/reports/lighthouse-2026-09-27-home.json",
    chromePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  })
  assert.ok(args.includes("--form-factor=mobile"))
  assert.ok(args.includes("--output=json"))
  assert.ok(args.includes("--chrome-path=C:/Program Files/Google/Chrome/Application/chrome.exe"))
  assert.ok(args.includes("lighthouse@12.8.2"))
})

test("Lighthouse does not start or download its runner when Chrome is absent", () => {
  assert.equal(
    findChromePath({ platform: "linux", env: { PATH: "" }, exists: () => false }),
    null,
  )
})
