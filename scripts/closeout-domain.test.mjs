import assert from "node:assert/strict"
import test from "node:test"
import { deriveCloseoutDraft, validateCloseoutReview } from "../lib/closeout-domain.mjs"

test("one-breath closeout becomes reviewable structured outcomes", () => {
  const draft = deriveCloseoutDraft("Gate fit good. Took one extra trip for the latch. Reworked the hinge and still need to paint it.")

  assert.equal(draft.completion, "partial")
  assert.equal(draft.fit, "fit")
  assert.equal(draft.extraTrips, 1)
  assert.equal(draft.rework, "yes")
  assert.match(draft.remainingWork, /paint/i)
  assert.equal(draft.reviewed, false)
})

test("closeout refuses to file an unreviewed inference", () => {
  const draft = deriveCloseoutDraft("Finished. Fit good. No extra trips or rework.")
  assert.throws(() => validateCloseoutReview(draft), /review/i)

  const reviewed = validateCloseoutReview({ ...draft, reviewed: true })
  assert.equal(reviewed.completion, "complete")
  assert.equal(reviewed.extraTrips, 0)
  assert.equal(reviewed.rework, "no")
  assert.equal("paid" in reviewed, false)
  assert.equal("payment" in reviewed, false)
})

test("partial outcomes require remaining work and stay valid for a keep-open filing", () => {
  const partial = deriveCloseoutDraft("Fit good, but still need to paint it.")
  assert.equal(validateCloseoutReview({ ...partial, reviewed: true }).completion, "partial")
  assert.throws(() => validateCloseoutReview({ ...partial, remainingWork: "", reviewed: true }), /remaining-work/i)
  assert.throws(() => validateCloseoutReview({ ...partial, completion: "complete", reviewed: true }), /cannot include remaining/i)
  assert.throws(() => validateCloseoutReview({ ...partial, sourceWords: "", reviewed: true }), /one-breath/i)
})
