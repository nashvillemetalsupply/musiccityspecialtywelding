import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n")
const BOARD = source("app/board/board.tsx")
const JOB = source("app/ops/leads/[id]/page.tsx")
const JOB_CSS = source("app/ops/leads/[id]/job.css")
const TRACKED_CALL = source("app/ops/tracked-call-button.tsx")
const PHOTO_INPUT = source("app/ops/leads/[id]/closeout-photo-input.tsx")
const DONE_STAMP = source("app/ops/leads/[id]/done-stamp.tsx")

function actionStrip() {
  const start = JOB.indexOf('<nav className="job-action-spine"')
  const end = JOB.indexOf("</nav>", start)
  assert.ok(start >= 0 && end > start, "job page renders the action strip")
  return JOB.slice(start, end)
}

test("the sticky strip orders Call, Text, Photo, then the owner quote amount", () => {
  const strip = actionStrip()
  const call = strip.indexOf('label="Call"')
  const text = strip.indexOf('href="?replyChannel=text#job-reply">Text</Link>')
  const photo = strip.indexOf('href={lead.completed_at ? "#done-photo" : "#finish-photo"}>Photo</Link>')
  const quote = strip.indexOf("job-action-price")
  assert.ok(call >= 0 && call < text && text < photo && photo < quote, "actions keep the approved order")
  assert.match(strip, /compact directFallback/)
  assert.doesNotMatch(strip, /sms:/)
  assert.match(strip, /operator\.role === "owner"[\s\S]*?job-action-price[\s\S]*?money\(lead\.estimate_value_cents\)/)
  assert.match(TRACKED_CALL, /href=\{`tel:\$\{phone\.replace/)
  assert.match(JOB_CSS, /\.job-action-spine\s*\{[^}]*position:\s*sticky;\s*top:\s*0/)
})

test("the action strip is a direct job-page child outside the contact card", () => {
  const root = JOB.indexOf('<div className="job-page">')
  const lead = JOB.indexOf('<section className="card job-lead"', root)
  const strip = JOB.indexOf('<nav className="job-action-spine"', root)
  const flow = JOB.indexOf('<div className="job-flow">', strip)
  const leadEnd = JOB.lastIndexOf('</section>', strip)
  const contact = JOB.indexOf('<div className="job-contact">', lead)
  assert.ok(root >= 0 && lead >= root && contact > lead)
  assert.ok(leadEnd > contact && leadEnd < strip && strip < flow, "the strip follows the lead card as a job-page sibling")
  assert.match(JOB.slice(leadEnd, flow), /<\/section>\s*\{!needsJobMatch && !routedToLeadId && <nav className="job-action-spine"/)
  assert.doesNotMatch(JOB.slice(contact, leadEnd), /job-action-spine/, "the strip is not inside the contact card")
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
  assert.match(strip, /className="btn btn--sm btn--go" href=\{lead\.completed_at \? "#done-photo" : "#finish-photo"\}>Photo<\/Link>/)
  assert.match(JOB, /id="finish-close"[\s\S]*?completed=\{Boolean\(lead\.completed_at\)\}/)
  assert.match(DONE_STAMP, /\{!completed && <form[\s\S]*?mode="completion"/)
  assert.match(DONE_STAMP, /\{completed && addendumOpen && <form[\s\S]*?mode="addendum"/)
  assert.match(DONE_STAMP, /window\.location\.hash === "#done-photo"\) setAddendumOpen\(true\)/)
  assert.match(DONE_STAMP, /getElementById\("done-photo"\)\?\.scrollIntoView/)
  assert.match(PHOTO_INPUT, /const fieldId = mode === "completion" \? "finish-photo" : "done-photo"/)
  assert.match(PHOTO_INPUT, /id=\{fieldId\}/)
  assert.match(PHOTO_INPUT, /type="file"[\s\S]*?accept="image\/\*"[\s\S]*?capture="environment"/)
})

test("the board detail keeps the estimate amount inline and links it to the estimate field", () => {
  const price = BOARD.slice(BOARD.indexOf("{chrome.owner && <div><dt>Price</dt><dd>"))
  assert.ok(price.length > 0, "owner price detail exists")
  assert.match(price, /moneyCell\.note === "estimated"[\s\S]*?href=\{`\/ops\/leads\/\$\{lead\.id\}#lead-estimate`\}[\s\S]*?moneyCell\.value/)
})
