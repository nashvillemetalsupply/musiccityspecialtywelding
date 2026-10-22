import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n")

const PHOTO = read("../app/api/ops/photo/route.ts")
const ACTIONS = read("../app/ops/actions.ts")
const BOARD = read("../app/board/board.tsx")

// Blob is suspended until Nov 12. The crew's photo tile says so instead of
// breaking; every other Blob failure still answers 404.
test("a suspended or 403 Blob store answers 200 with the Nov 12 sentence", () => {
  assert.match(PHOTO, /Photos are unavailable until Nov 12 \(storage suspended\)/)
  assert.match(PHOTO, /error instanceof BlobStoreSuspendedError \|\| .*suspended.*403/)
  assert.match(PHOTO, /new Response\(PHOTOS_SUSPENDED_SVG, \{ status: 200, headers: \{ "Content-Type": "image\/svg\+xml"/)
  assert.match(PHOTO, /Content-Security-Policy/)
  assert.match(PHOTO, /return new Response\("Not found\.", \{ status: 404 \}\)\s*\}\s*\}\s*$/)
})

// The board's Not a job button hit the locked-job throw and sent the crew to
// the error page. The form now shows the sentence inline.
test("the board Not a job form returns the locked-job sentence inline", () => {
  assert.match(ACTIONS, /export async function updateLeadStatusState\(_previous: OpsActionState, formData: FormData\)/)
  assert.match(ACTIONS, /await updateLeadStatus\(formData\)[\s\S]*?recoverableActionError\(error,/)
  assert.match(BOARD, /useActionState\(updateLeadStatusState, NOT_A_JOB_INITIAL\)/)
  assert.match(BOARD, /state\.status === "error" && <small role="alert">\{state\.message\}<\/small>/)
  assert.doesNotMatch(BOARD, /action=\{updateLeadStatus\}/)
  assert.match(read("../lib/job-commands.ts"), /"Finished jobs are locked\. Use Undo finish before changing their status\."/)
})
