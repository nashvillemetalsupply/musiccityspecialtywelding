import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const PREVIEW_SOURCE = readFileSync(new URL("../app/design-preview/job-control/job-control-preview.tsx", import.meta.url), "utf8")
const PAGE_SOURCE = readFileSync(new URL("../app/design-preview/job-control/page.tsx", import.meta.url), "utf8")
const TRACKER_SOURCE = PREVIEW_SOURCE.slice(PREVIEW_SOURCE.indexOf('<h2 className="t-title">Job tracker</h2>'))

test("tracker tabs use the canonical stages and refetch the requested stage", () => {
  assert.match(PREVIEW_SOURCE, /board\.stages\.map\(\(stage\) =>/)
  assert.match(PREVIEW_SOURCE, /href=\{`\/design-preview\/job-control\?stage=\$\{stage\}`\}/)
  assert.match(PREVIEW_SOURCE, /board\.counts\[stage\]/)
  assert.match(PAGE_SOURCE, /JOB_BOARD_STAGES\.includes\(requested as JobBoardStage\)/)
  assert.match(PAGE_SOURCE, /stages: \[\.\.\.JOB_BOARD_STAGES\]/)
  assert.match(PAGE_SOURCE, /listBoardJobs\(\{ stage, order: "oldest" \}, role\)/)
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
  assert.match(PREVIEW_SOURCE, /1 of 7 answered/)
})
