import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { calendarQuickAddIntakeKey } from "../lib/calendar-quick-add.mjs"
import { resolveCentralDateTime } from "../lib/central-date-time.mjs"

const action = readFileSync(new URL("../app/board/calendar-actions.ts", import.meta.url), "utf8")
const calendar = readFileSync(new URL("../app/board/job-calendar.tsx", import.meta.url), "utf8")
const opsActions = readFileSync(new URL("../app/ops/actions.ts", import.meta.url), "utf8")
const css = readFileSync(new URL("../app/board/job-calendar.module.css", import.meta.url), "utf8")

test("calendar quick add creates the manual lead before scheduling it atomically in Central time", () => {
  assert.match(action, /await createManualLeadRecord\(manual\)[\s\S]*await scheduleLeadRecord\(schedule/)
  assert.match(action, /schedule\.set\("scheduledAt", `\$\{scheduledDate\}T\$\{scheduledTime\}`\)/)
  assert.match(action, /schedule\.set\("scheduleKey", intakeKey\)/)
  assert.match(opsActions, /WITH target AS MATERIALIZED \([\s\S]*new_receipt AS \([\s\S]*lead_update AS \([\s\S]*replayed AS \(/)
  assert.match(opsActions, /SET scheduled_at = \$\{scheduledInstant\}::timestamptz/)
  assert.match(opsActions, /const source = options\.source \?\? "job_profile_calendar"/)
  assert.match(action, /source: "board_calendar_quick_add"/)
})

test("calendar quick add preserves auth, test partition, retry keys, and honest event receipts", () => {
  assert.match(action, /await getAuthenticatedOperator\(\)/)
  assert.match(action, /canAccessInternalTests\(operator\.role\)/)
  assert.match(action, /\^\[a-zA-Z0-9_-\]\{12,80\}\$/)
  assert.match(action, /nextIntakeKey: randomUUID\(\)/)
  assert.match(action, /status: "partial"[\s\S]*The job was saved, but the appointment was not added/)
  assert.match(opsActions, /ON CONFLICT \(kind, external_id\) WHERE external_id <> '' DO NOTHING/)
  assert.match(opsActions, /const externalId = `lead-scheduled:\$\{leadId\}:\$\{scheduleKey\}`/)
  assert.doesNotMatch(opsActions, /const externalId = `lead-scheduled:\$\{leadId\}:\$\{scheduledInstant\}`/)
  assert.match(opsActions, /e\.detail->>'scheduledAt' = \$\{scheduledInstant\}::text/)
  assert.match(opsActions, /FROM new_receipt r WHERE l\.id = r\.lead_id/)
  assert.match(opsActions, /AND NOT EXISTS \(SELECT 1 FROM new_receipt\)/)
  assert.match(opsActions, /prior\[0\]\?\.scheduled_at === scheduledInstant && prior\[0\]\.actor_id === actorId\(operator\)/)
  assert.match(opsActions, /This schedule form changed after it was saved/)
  assert.doesNotMatch(opsActions.slice(opsActions.indexOf("export async function scheduleLeadRecord"), opsActions.indexOf("export async function scheduleLead(")), /recordLeadEvent/)

  assert.equal(calendarQuickAddIntakeKey({ status: "partial", intakeKey: "same-retry-key" }, "page-key"), "same-retry-key")
  assert.equal(calendarQuickAddIntakeKey({ status: "error", intakeKey: "same-retry-key" }, "page-key"), "same-retry-key")
  assert.equal(calendarQuickAddIntakeKey({ status: "saved", nextIntakeKey: "fresh-key" }, "page-key"), "fresh-key")
})

test("Central scheduler rejects nonexistent and ambiguous daylight-saving times", () => {
  assert.equal(resolveCentralDateTime("2026-03-08", "02:30"), null)
  assert.equal(resolveCentralDateTime("2026-11-01", "01:30"), null)
  assert.equal(resolveCentralDateTime("2026-03-08", "03:30"), "2026-03-08T08:30:00.000Z")
  assert.equal(resolveCentralDateTime("2026-11-01", "02:30"), "2026-11-01T08:30:00.000Z")
  assert.equal(resolveCentralDateTime("2026-02-29", "08:00"), null)
})

test("selected calendar dates expose the compact accessible required fields", () => {
  for (const name of ["scheduledDate", "scheduledTime", "firstName", "phone", "message"]) {
    assert.match(calendar, new RegExp(`name="${name}"`))
  }
  assert.match(calendar, /action=\{quickAddAction\}/)
  assert.match(calendar, /role="alert"/)
  assert.match(calendar, /role="status"/)
  assert.match(css, /\.quickAdd input,[\s\S]*min-height: 44px/)
  assert.match(css, /\.quickAddButton \{[\s\S]*min-height: 44px/)
})
