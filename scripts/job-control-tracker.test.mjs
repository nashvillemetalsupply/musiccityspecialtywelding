import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const PREVIEW_SOURCE = readFileSync(new URL("../app/board/board.tsx", import.meta.url), "utf8")
const PAGE_SOURCE = readFileSync(new URL("../app/board/page.tsx", import.meta.url), "utf8")
const TRACKER_SOURCE = PREVIEW_SOURCE.slice(PREVIEW_SOURCE.indexOf('<h2 className="t-title">Job tracker</h2>'))

test("tracker tabs use the canonical stages and refetch the requested stage", () => {
  assert.match(PREVIEW_SOURCE, /board\.stages\.map\(\(stage\) =>/)
  assert.match(PREVIEW_SOURCE, /href=\{`\/board\?stage=\$\{stage\}`\}/)
  assert.match(PREVIEW_SOURCE, /board\.counts\[stage\]/)
  assert.match(PAGE_SOURCE, /JOB_BOARD_STAGES\.includes\(requested as JobBoardStage\)/)
  assert.match(PAGE_SOURCE, /stages: \[\.\.\.JOB_BOARD_STAGES\]/)
  assert.match(PAGE_SOURCE, /listBoardJobs\(\{ stage, order: "oldest", query \}, role\)/)
})

test("tracker rows come from listBoardJobs and keep its reason string verbatim", () => {
  assert.match(PAGE_SOURCE, /items: page\.items/)
  assert.match(TRACKER_SOURCE, /board\.items\.map\(\(lead\) =>/)
  assert.match(TRACKER_SOURCE, /\{lead\.board_reason\}/)
  assert.doesNotMatch(TRACKER_SOURCE, /attentionReason\(lead\.board_reason\)|BOARD_SIGNAL_LABELS\[lead\.board_reason\]/)
  for (const fixture of ["Phil Lloyd", "Hendersonville Fab", "Wendy Cauthen", "Dock Repair", "Ray Colter"]) {
    assert.ok(!TRACKER_SOURCE.includes(fixture), `${fixture} fixture survived in the tracker`)
  }
})

test("tracker has an honest empty state and the protected regions remain", () => {
  assert.match(PREVIEW_SOURCE, /No jobs in this stage right now\./)
  assert.match(PAGE_SOURCE, /const EMPTY_BOARD: BoardPaneData = \{/)
  assert.doesNotMatch(PREVIEW_SOURCE, /export const EMPTY_BOARD/)
  assert.match(PREVIEW_SOURCE, /SIGNAL_ORDER\.map\(\(kind\) =>/)
  assert.match(PREVIEW_SOURCE, /<h3 className="t-sub">Promises<\/h3>/)
  assert.match(PREVIEW_SOURCE, /<h2 className="t-title">Live call sketch<\/h2>/)
  assert.match(PREVIEW_SOURCE, /<p className="ask">Ask next<\/p>/)
  assert.match(PREVIEW_SOURCE, /\{answered\} of \{PANEL_FACT_KEYS\.length\} answered/)
})

test("every service a form can write has a row mark", () => {
  // The mark is keyed on `service`, which is TEXT. It only stays honest while
  // the map covers what the forms actually write, so read the options back out
  // of the forms rather than trusting a copy of the list.
  const forms = [
    "../components/mainstreet-contact.tsx",
    "../app/ops/intake/job-intake-form.tsx",
    "../app/ops/intake/inline-job-intake.tsx",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))

  const written = new Set()
  for (const form of forms) {
    // Only the service select. The same forms carry a referral select whose
    // options are Google, Referral, Facebook — not services, and not marks.
    const start = form.indexOf('name="service"')
    assert.ok(start > -1, "a form stopped writing a service field")
    const select = form.slice(start, form.indexOf("</select>", start))
    for (const [, label] of select.matchAll(/<option(?![^>]*value=)[^>]*>([^<]+)<\/option>/g)) {
      written.add(label.replace(/&amp;/g, "&").trim())
    }
  }
  // "Not Sure / Other" is deliberately unmapped: it falls back to blank stock.
  written.delete("Not Sure / Other")
  assert.ok(written.size >= 6, `found only ${written.size} service options`)

  const marks = PREVIEW_SOURCE.slice(
    PREVIEW_SOURCE.indexOf("const SERVICE_MARKS"),
    PREVIEW_SOURCE.indexOf("function serviceMark"),
  )
  for (const service of written) {
    assert.ok(marks.includes(`"${service}"`), `no row mark for service ${service}`)
  }
  assert.match(PREVIEW_SOURCE, /SERVICE_MARKS\[service\.trim\(\)\] \?\?/)
})
