import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import test from "node:test"

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")
const page = read("../app/ops/leads/[id]/page.tsx")
const component = read("../app/ops/leads/[id]/photo-drafts.tsx")
const actions = read("../app/ops/leads/[id]/claim-actions.ts")
const finalizeRoute = read("../app/api/glass/upload/finalize/route.ts")
const draftService = read("../lib/photo-drafts.ts")
const styles = read("../app/ops/leads/[id]/job.css")

test("photo draft UI is gated to authenticated owners while the feature flag is enabled", () => {
  assert.match(page, /const showPhotoDrafts = operator\.role === "owner" && photoDraftsEnabled\(\)/)
  assert.match(page, /showPhotoDrafts \? listPhotoDraftEntries\(leadId\) : Promise\.resolve\(\[\]\)/)
  assert.match(page, /\{showPhotoDrafts && <PhotoDrafts/)
  assert.match(page, /!claim\.predicate\.startsWith\("photo_draft_"\)/)
  assert.match(actions, /operator\.role !== "owner"/)
  assert.match(actions, /if \(!photoDraftsEnabled\(\)\)/)
})

test("review controls preserve keyboard, screen-reader, private-source, and forced-colors access", () => {
  assert.match(component, /aria-labelledby="photo-drafts-title"/)
  assert.match(component, /role="status"/)
  assert.match(component, /role="alert"/)
  assert.match(component, /action=\{acceptPhotoDraft\}/)
  assert.match(component, /action=\{rejectPhotoDraft\}/)
  assert.match(component, /View source photo/)
  assert.match(component, /api\/ops\/attachment\?lead=/)
  assert.match(finalizeRoute, /import \{ after \} from "next\/server"/)
  assert.match(finalizeRoute, /if \(photoDraftsEnabled\(\)\)/)
  assert.match(finalizeRoute, /schedulePhotoDraftAfterFinalize\(upload/)
  assert.doesNotMatch(draftService, /notifyAll|sendSms|sendEmail|deliverGlassClipboard/)
  assert.match(styles, /@media \(forced-colors: active\)/)
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(styles, /@media \(max-width: 20rem\)/)
  assert.match(styles, /min-height: 44px/)
  assert.match(styles, /var\(--s[234]\)/)
})
