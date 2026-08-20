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

test("job search keeps a mounted, labelled input on the board", () => {
  // C7 archived active-job-index/-controls; the live search is the board's
  // .find form, which must stay a plain GET form with a labelled input.
  const board = read("app/board/board.tsx")
  assert.match(board, /<form className="find" action="\/board" method="get" role="search">/)
  assert.match(board, /name="q" type="search" defaultValue=\{chrome\.query\}/)
  assert.match(board, /aria-label="Search jobs"/)
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
  // C7 retired jobs-brand.css; the glass controls' touch rules live in job.css.
  const css = read("app/ops/leads/[id]/job.css")
  assert.match(css, /\.job-page \.ops-glass-link \{ display: grid/)
  assert.match(css, /\.ops-glass-link button, \.ops-glass-link a\) \{ min-height: 44px/)
})

test("dynamic action labels and overdue disclosure stay bounded and touch safe", () => {
  const intake = read("app/ops/intake/inline-job-intake.tsx")
  const wire = read("app/ops/wire-strip.tsx")
  const page = read("app/ops/leads/[id]/page.tsx")
  // C7 retired jobs-brand.css; the touch floor for the job page's controls
  // (promise disclosure included) lives in job.css.
  const css = read("app/ops/leads/[id]/job.css")
  assert.match(intake, />Call customer<\/a>/)
  assert.match(wire, />Text contact<\/SafeActionButton>/)
  assert.match(wire, />Email contact<\/SafeActionButton>/)
  assert.match(page, />Use this customer<\/SafeSubmitButton>/)
  assert.match(css, /\.job-handle > summary[\s\S]{0,200}min-height: 44px/)
})

test("empty activity pages keep a valid role-filtered count query", () => {
  const events = read("lib/events.ts")
  const fallback = events.slice(events.indexOf("const totalRows = rows.length"), events.indexOf("const clampedPage"))
  assert.match(fallback, /\s{3}\)\)`\) as/)
  assert.doesNotMatch(fallback, /\s{3}\)\)\)`\) as/)
})

test("Morning Brief falls back to deterministic copy when AI prose is unavailable", () => {
  const brief = read("app/api/ops/brief/route.ts")
  assert.match(brief, /if \(aiConfigured\(\)\) \{\s*try \{/)
  assert.match(brief, /catch \(error\) \{\s*console\.error\("Morning brief AI prose failed; using deterministic copy:"/)
  assert.match(brief, /let text = `Morning\./)
  assert.match(brief, /let briefModel = "deterministic"/)
  assert.match(brief, /model: briefModel/)
})
