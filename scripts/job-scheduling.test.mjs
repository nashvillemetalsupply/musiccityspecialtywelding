import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const actions = readFileSync(new URL("../app/ops/actions.ts", import.meta.url), "utf8")
const page = readFileSync(new URL("../app/ops/leads/[id]/page.tsx", import.meta.url), "utf8")
const css = readFileSync(new URL("../app/ops/leads/[id]/job.css", import.meta.url), "utf8")

test("job-profile scheduling writes the shared Central-time schedule and refreshes the board", () => {
  assert.match(actions, /export async function scheduleLead\(formData: FormData\)/)
  assert.match(actions, /scheduledAt\}::timestamp AT TIME ZONE 'America\/Chicago'/)
  assert.match(actions, /recordLeadEvent\(leadId, "scheduled"/)
  assert.match(actions, /revalidatePath\("\/board"\)/)
  assert.match(actions, /completed_at IS NULL AND handed_off_at IS NULL/)
})

test("job profile exposes one schedule control tied to the board calendar", () => {
  assert.match(page, /action=\{scheduleLead\}/)
  assert.match(page, /name="scheduledAt"[\s\S]*type="datetime-local"/)
  assert.match(page, /This is the same schedule shown on the main Job Control calendar\./)
  assert.match(css, /\.job-schedule-form input\[type="datetime-local"\]/)
})
