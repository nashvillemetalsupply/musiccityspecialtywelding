import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const SOURCE = readFileSync(new URL("./weekly-production-baseline.mjs", import.meta.url), "utf8")

test("weekly call totals use the persisted call direction vocabulary", () => {
  assert.match(SOURCE, /c\.direction = 'in'/)
  assert.match(SOURCE, /c\.direction = 'out'/)
  assert.doesNotMatch(SOURCE, /c\.direction = 'inbound'|c\.direction = 'outbound'/)
})

test("weekly call totals exclude either linked or receipt-marked test traffic", () => {
  assert.match(SOURCE, /COALESCE\(l\.is_test, false\) = false/)
  assert.match(SOURCE, /lower\(COALESCE\(c\.detail->>'isTest', 'false'\)\) <> 'true'/)
})

test("weekly source totals use canonical paid-search-first attribution", () => {
  assert.match(SOURCE, /WHEN btrim\(gclid\) <> '' OR/)
  assert.match(SOURCE, /lower\(btrim\(utm_source\)\) IN \('google', 'google ads', 'google_ads', 'googleads'\)/)
  assert.match(SOURCE, /THEN 'google ads'/)
  assert.match(SOURCE, /WHEN lower\(btrim\(source\)\) IN \('phone-in', 'twilio-call', 'call'\) THEN 'phone-in'/)
  assert.match(SOURCE, /GROUP BY 1/)
})

test("a degraded authenticated health response still prints its safe diagnosis", () => {
  assert.match(SOURCE, /httpStatus: healthResponse\.status/)
  assert.ok(SOURCE.indexOf("console.log(JSON.stringify(output") < SOURCE.indexOf("process.exitCode = 1"))
  assert.doesNotMatch(SOURCE, /throw new Error\(`Authenticated health returned HTTP/)
})

test("weekly diagnostics summarize unresolved notification delivery without customer data", () => {
  assert.match(SOURCE, /n\.delivery_status = ANY\(ARRAY\['dead','unknown'\]::text\[\]\)/)
  assert.match(SOURCE, /unresolvedNotificationDelivery: notificationFailureRows\.map/)
  assert.match(SOURCE, /oldestAt: row\.oldest_at/)
  assert.doesNotMatch(SOURCE.slice(SOURCE.indexOf("unresolvedNotificationDelivery:")), /body:|title:|email:|phone:/)
})
