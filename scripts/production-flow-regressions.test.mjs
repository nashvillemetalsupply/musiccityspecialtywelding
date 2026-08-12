import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("inline intake keeps the receipt until a deliberate next-step action", () => {
  const intake = read("app/ops/intake/inline-job-intake.tsx")
  assert.match(intake, /ignoredCallPublicId/)
  assert.match(intake, /continueAfterSaved/)
  assert.match(intake, /continueAfterDismissed/)
  assert.match(intake, />Next call<|"Next call"/)
  assert.match(intake, /setIgnoredCallPublicId\(saveState\.intakeRef\)[\s\S]*router\.refresh\(\)/)
  assert.match(intake, /setIgnoredCallPublicId\(dismissedCall\.publicId\)[\s\S]*router\.refresh\(\)/)
})

test("inline terminal actions do not refresh away the deep-link receipt", () => {
  const actions = read("app/ops/intake/actions.ts")
  const saveRecord = actions.slice(actions.indexOf("export async function saveCallDraftRecord"), actions.indexOf("export async function saveCallDraftAction"))
  const disposition = actions.slice(actions.indexOf("export async function changeCallDraftDispositionAction"))
  assert.doesNotMatch(saveRecord, /revalidatePath\(`\/ops\/intake\/\$\{publicId\}`\)/)
  assert.doesNotMatch(disposition, /revalidatePath\(`\/ops\/intake\/\$\{publicId\}`\)/)
  assert.match(actions, /revalidatePath\("\/ops"\)/)
})

test("Active Jobs search keeps its mounted input and skips the hidden submit in tab order", () => {
  const index = read("app/ops/active-job-index.tsx")
  const controls = read("app/ops/active-job-controls.tsx")
  assert.doesNotMatch(index, /<ActiveJobControls\s+key=/)
  assert.match(controls, /sourceQuery: query/)
  assert.match(controls, /tabIndex=\{-1\}/)
})

test("existing and legacy Customer Pages load truthful owner controls", () => {
  const glass = read("lib/glass.ts")
  const page = read("app/ops/leads/[id]/page.tsx")
  const control = read("app/ops/leads/[id]/glass-control.tsx")
  assert.match(glass, /getActiveGlassLinkState/)
  assert.match(glass, /needsReplacement: true/)
  assert.match(page, /initialUrl=\{activeGlassUrl\}/)
  assert.match(page, /initialNeedsReplacement=\{activeGlassNeedsReplacement\}/)
  assert.match(control, /Replace Customer Page/)
  assert.match(control, /role="alert"/)
  assert.match(control, /aria-live="polite"/)
  assert.match(control, /className="ops-glass-link-wide"[\s\S]*Close Customer Page/)
  const css = read("app/ops/jobs-brand.css")
  assert.match(css, /ops-glass-link-wide[\s\S]*grid-column: 1 \/ -1/)
  assert.match(css, /ops-glass-link > :is\(button, a, form > button\)[\s\S]*text-transform: none[\s\S]*white-space: normal/)
  assert.match(css, /ops-glass-link > a[\s\S]*background: var\(--jobs-primary\)[\s\S]*color: var\(--jobs-on-primary\) !important/)
})

test("dynamic action labels and overdue disclosure stay bounded and touch safe", () => {
  const intake = read("app/ops/intake/inline-job-intake.tsx")
  const wire = read("app/ops/wire-strip.tsx")
  const page = read("app/ops/leads/[id]/page.tsx")
  const css = read("app/ops/jobs-brand.css")
  assert.match(intake, />Call customer<\/a>/)
  assert.match(wire, />Text contact<\/SafeActionButton>/)
  assert.match(wire, />Email contact<\/SafeActionButton>/)
  assert.match(page, />Use this customer<\/SafeSubmitButton>/)
  assert.match(css, /\.ops-handle-promise > summary[\s\S]*min-height: 3rem[\s\S]*font-size: 0\.875rem/)
})

test("empty activity pages keep a valid role-filtered count query", () => {
  const events = read("lib/events.ts")
  const fallback = events.slice(events.indexOf("const totalRows = rows.length"), events.indexOf("const clampedPage"))
  assert.match(fallback, /\s{3}\)\)`\) as/)
  assert.doesNotMatch(fallback, /\s{3}\)\)\)`\) as/)
})
