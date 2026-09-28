import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n")
const BOARD = source("app/board/board.tsx")
const JOB = source("app/ops/leads/[id]/page.tsx")
const JOB_CSS = source("app/ops/leads/[id]/job.css")
const TRACKED_CALL = source("app/ops/tracked-call-button.tsx")
const PHOTO_INPUT = source("app/ops/leads/[id]/closeout-photo-input.tsx")

function actionStrip() {
  const start = JOB.indexOf('<nav className="job-action-spine"')
  const end = JOB.indexOf("</nav>", start)
  assert.ok(start >= 0 && end > start, "job page renders the action strip")
  return JOB.slice(start, end)
}

test("the sticky strip orders Call, Text, Photo, then the owner quote amount", () => {
  const strip = actionStrip()
  const call = strip.indexOf('label="Call"')
  const text = strip.indexOf(">Text</a>")
  const photo = strip.indexOf('href="#finish-photo">Photo</Link>')
  const quote = strip.indexOf("job-action-price")
  assert.ok(call >= 0 && call < text && text < photo && photo < quote, "actions keep the approved order")
  assert.match(strip, /compact directFallback/)
  assert.match(strip, /href=\{`sms:\$\{customerPhone\.replace/)
  assert.match(strip, /operator\.role === "owner"[\s\S]*?job-action-price[\s\S]*?money\(lead\.estimate_value_cents\)/)
  assert.match(TRACKED_CALL, /href=\{`tel:\$\{phone\.replace/)
  assert.match(JOB_CSS, /\.job-action-spine\s*\{[^}]*position:\s*sticky/)
})

test("the board row opens the job at the photo input in one tap", () => {
  const rowLink = BOARD.indexOf('href={`/ops/leads/${lead.id}#finish-photo`}')
  assert.ok(rowLink >= 0, "the row points directly to the photo input")
  assert.ok(BOARD.slice(rowLink, rowLink + 160).includes(">Open job</Link>"), "the existing row action reaches it in one tap")
  assert.match(PHOTO_INPUT, /const fieldId = mode === "completion" \? "finish-photo"/)
  assert.match(PHOTO_INPUT, /type="file"[\s\S]*?accept="image\/\*"[\s\S]*?capture="environment"/)
})

test("the board detail keeps the estimate amount inline and links it to the estimate field", () => {
  const price = BOARD.slice(BOARD.indexOf("{chrome.owner && <div><dt>Price</dt><dd>"))
  assert.ok(price.length > 0, "owner price detail exists")
  assert.match(price, /moneyCell\.note === "estimated"[\s\S]*?href=\{`\/ops\/leads\/\$\{lead\.id\}#lead-estimate`\}[\s\S]*?moneyCell\.value/)
})
