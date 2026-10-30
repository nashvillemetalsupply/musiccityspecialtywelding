import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n")
const BOARD = source("app/board/board.tsx")
const JOB = source("app/ops/leads/[id]/page.tsx")
const JOB_CSS = source("app/ops/leads/[id]/job.css")
const OPS_SHELL_CSS = source("app/ops/ops-shell.css")
const TRACKED_CALL = source("app/ops/tracked-call-button.tsx")
const PHOTO_INPUT = source("app/ops/leads/[id]/closeout-photo-input.tsx")
const DONE_STAMP = source("app/ops/leads/[id]/done-stamp.tsx")

function actionStrip() {
  const start = JOB.indexOf('<nav className="job-action-spine"')
  const end = JOB.indexOf("</nav>", start)
  assert.ok(start >= 0 && end > start, "job page renders the action strip")
  return JOB.slice(start, end)
}

test("the sticky strip orders tracked Call, Text, Photo, then the owner price action", () => {
  const strip = actionStrip()
  const call = strip.indexOf('label="Call"')
  const text = strip.indexOf('href="?replyChannel=text#job-reply">Text</Link>')
  const photo = strip.indexOf('href={lead.completed_at ? "#done-photo" : "#finish-photo"}>Photo</Link>')
  const quote = strip.indexOf("job-action-price")
  assert.ok(call >= 0 && call < text && text < photo && photo < quote, "actions keep the approved order")
  assert.match(strip, /TrackedCallButton[^>]*label="Call"[^>]*compact[^>]*btn--go/)
  assert.doesNotMatch(strip, /directFallback/)
  assert.doesNotMatch(strip, /sms:/)
  assert.match(strip, /operator\.role === "owner"[\s\S]*?job-action-price[\s\S]*?money\(lead\.estimate_value_cents\)/)
  assert.match(TRACKED_CALL, /const directDialPhone = normalizeUsPhone\(phone\)/)
  assert.match(TRACKED_CALL, /href=\{`tel:\$\{directDialPhone\}`\}/)
  const contactStart = JOB.indexOf('<div className="job-contact">')
  const contactEnd = JOB.indexOf('className="job-contact-edit"', contactStart)
  const contact = JOB.slice(contactStart, contactEnd)
  assert.match(contact, /!needsJobMatch && !routedToLeadId && hasCustomerPhone && <details className="job-direct-call"/)
  assert.match(contact, /Call directly — not saved/)
  assert.match(contact, /href=\{`tel:\$\{customerPhone\}`\}/)
  const stripRule = JOB_CSS.match(/\.job-action-spine\s*\{([^}]*)\}/)?.[1] ?? ""
  const opsTopRule = OPS_SHELL_CSS.match(/\.ops-top\s*\{([^}]*)\}/)?.[1] ?? ""
  const stripZIndex = Number(stripRule.match(/z-index:\s*(\d+)/)?.[1])
  const opsTopZIndex = Number(opsTopRule.match(/z-index:\s*(\d+)/)?.[1])
  assert.match(stripRule, /position:\s*sticky/)
  assert.match(stripRule, /bottom:\s*var\(--safe-area-bottom\)/)
  assert.doesNotMatch(stripRule, /top:\s*0/)
  assert.ok(Number.isFinite(stripZIndex) && Number.isFinite(opsTopZIndex) && stripZIndex < opsTopZIndex, "the strip stays below the sticky ops header")
})

test("the action strip is the last direct job-page child outside the contact card", () => {
  const root = JOB.indexOf('<div className="job-page">')
  const strip = JOB.indexOf('<nav className="job-action-spine"', root)
  const stripEnd = JOB.indexOf("</nav>", strip)
  const rootEnd = JOB.lastIndexOf("</div>")
  const contact = JOB.indexOf('<div className="job-contact">', root)
  const recentActivity = JOB.indexOf('<section className="card job-events"', root)
  const navCondition = "{!needsJobMatch && !routedToLeadId && "
  const navConditionStart = JOB.lastIndexOf(navCondition, strip)
  assert.ok(root >= 0 && contact > root && recentActivity > contact && strip > recentActivity)
  assert.ok(stripEnd > strip && rootEnd > stripEnd, "the strip follows the job content")
  assert.match(JOB.slice(stripEnd + "</nav>".length, rootEnd), /^\s*}\s*$/, "no sibling follows the strip before the job-page closes")
  assert.equal(strip - navConditionStart, navCondition.length, "existing visibility conditions stay on the direct child")
  assert.doesNotMatch(JOB.slice(contact, strip), /job-action-spine/, "the strip is outside the contact card")
})

test("the board row opens the job page with its action strip in one tap", () => {
  const rowAction = BOARD.indexOf('onClick={() => tapped(TAPS.jobOpen)}>Open job</Link>')
  const rowLink = BOARD.lastIndexOf('href={`/ops/leads/${lead.id}`}', rowAction)
  assert.ok(rowAction >= 0 && rowLink >= 0, "the row opens the job detail route")
  assert.doesNotMatch(BOARD.slice(rowLink, rowAction), /#/, "the row does not skip the contact card")
  assert.match(JOB, /<nav className="job-action-spine" aria-label="Job actions">/)
})

test("Photo opens the photo input for active and completed jobs", () => {
  const strip = actionStrip()
  assert.match(strip, /href=\{lead\.completed_at \? "#done-photo" : "#finish-photo"\}>Photo<\/Link>/)
  assert.match(strip, /hasCustomerPhone \? "btn--edge" : "btn--go"/)
  assert.match(JOB, /id="finish-close"[\s\S]*?completed=\{Boolean\(lead\.completed_at\)\}/)
  assert.match(DONE_STAMP, /\{!completed && <form[\s\S]*?mode="completion"/)
  assert.match(DONE_STAMP, /\{completed && addendumOpen && <form[\s\S]*?mode="addendum"/)
  assert.match(DONE_STAMP, /window\.location\.hash === "#done-photo" && benchRef\.current\?\.getClientRects\(\)\.length\) setAddendumOpen\(true\)/)
  assert.match(DONE_STAMP, /addendumRef\.current\?\.querySelector<HTMLElement>\('\[data-job-fragment="done-photo"\]'\)/)
  assert.match(DONE_STAMP, /photo\?\.focus\(\{ preventScroll: true \}\)/)
  assert.match(PHOTO_INPUT, /data-job-fragment=\{fragment\}/)
  assert.match(PHOTO_INPUT, /const fieldId = `\$\{fragment\}-\$\{instanceId\}`/)
  assert.match(PHOTO_INPUT, /const fragment = mode === "completion" \? "finish-photo" : "done-photo"/)
  assert.match(PHOTO_INPUT, /id=\{fieldId\}/)
  assert.match(PHOTO_INPUT, /type="file"[\s\S]*?accept="image\/\*"[\s\S]*?capture="environment"/)
})

test("the board detail keeps the estimate amount inline and links it to the estimate field", () => {
  const price = BOARD.slice(BOARD.indexOf("{chrome.owner && <div><dt>Price</dt><dd>"))
  assert.ok(price.length > 0, "owner price detail exists")
  assert.match(price, /moneyCell\.note === "estimated"[\s\S]*?href=\{`\/ops\/leads\/\$\{lead\.id\}#lead-estimate`\}[\s\S]*?moneyCell\.value/)
})
