import assert from "node:assert/strict"
import test from "node:test"
import {
  attachmentCanRetry,
  canApplyDone,
  canUndoDone,
  classifyInboundAttachmentSensitivity,
  countsAsHumanResponse,
  glassExpiryAt,
  glassReviewEligible,
  glassStageIndex,
  GLASS_UPLOAD_PENDING_EXPIRY_MS,
  handoffDisplayState,
  isGlassUploadPendingExpired,
  isReservedCustomerPhone,
  isInternalTestContext,
  messagingConsentState,
  normalizeUsPhone,
  safeActionMovement,
  safeGlassCaptionText,
  selectBriefAudioPath,
  shouldEmitTwilioFailure,
  classifyTwilioConsentKeyword,
  swipeFinishDecision,
  validateCustomerUploadMetadata,
} from "../lib/shop-brain-invariants.mjs"

test("any independent INTERNAL TEST marker keeps the context out of production", () => {
  assert.equal(isInternalTestContext(false, true), true)
  assert.equal(isInternalTestContext(false, "true"), true)
  assert.equal(isInternalTestContext(false, "Customer note [INTERNAL TEST]"), true)
  assert.equal(isInternalTestContext(false, false, "ordinary customer note"), false)
})

test("generic raster attachments stay owner-only until classified", () => {
  assert.equal(classifyInboundAttachmentSensitivity("IMG_1234.jpg", "image/jpeg", "See attached"), "unclassified")
  assert.equal(classifyInboundAttachmentSensitivity("invoice.jpg", "image/jpeg", "See attached"), "owner_paperwork")
  assert.equal(classifyInboundAttachmentSensitivity("gate-plan.dxf", "application/octet-stream", ""), "drawing")
  assert.equal(classifyInboundAttachmentSensitivity("shop.pdf", "application/pdf", "fabrication blueprint"), "drawing")
  assert.equal(classifyInboundAttachmentSensitivity("customer.svg", "image/svg+xml", "photo"), "unclassified")
})

test("shop and forwarding numbers never become customer identity", () => {
  const reserved = ["+16158104910", "+16155550199"]
  assert.equal(isReservedCustomerPhone("(615) 810-4910", reserved), true)
  assert.equal(isReservedCustomerPhone("615-555-0199", reserved), true)
  assert.equal(isReservedCustomerPhone("615-555-0137", reserved), false)
})

test("phone normalization is deterministic and rejects unusable identities", () => {
  assert.equal(normalizeUsPhone("(615) 555-0137"), "+16155550137")
  assert.equal(normalizeUsPhone("1-615-555-0137"), "+16155550137")
  assert.equal(normalizeUsPhone("+44 20 7946 0958"), "+442079460958")
  assert.equal(normalizeUsPhone("911"), "")
  assert.equal(normalizeUsPhone(null), "")
  assert.equal(isReservedCustomerPhone("not a phone", ["+16158104910"]), false)
})

test("crew receives only the crew morning tape", () => {
  const detail = { audioPath: "briefs/owner.mp3", crewAudioPath: "briefs/crew.mp3" }
  assert.equal(selectBriefAudioPath("owner", detail), "briefs/owner.mp3")
  assert.equal(selectBriefAudioPath("crew", detail), "briefs/crew.mp3")
  assert.equal(selectBriefAudioPath("crew", { audioPath: "briefs/owner.mp3" }), null)
})

test("automatic missed-call apology is not a human response", () => {
  assert.equal(countsAsHumanResponse("sms.out", "system"), false)
  assert.equal(countsAsHumanResponse("sms.out", "operator"), true)
  assert.equal(countsAsHumanResponse("call.answered", "operator"), true)
  assert.equal(countsAsHumanResponse("call.out", "operator"), true)
})

test("GLASS never calls payment or pipeline won DONE", () => {
  assert.equal(glassStageIndex({ invoice_number: "1332" }), 1)
  assert.equal(glassStageIndex({ estimate_value_cents: 30000, quoted_at: null }), 0)
  assert.equal(glassStageIndex({ paid_at: "2026-08-08T12:00:00Z" }), 0)
  assert.equal(glassStageIndex({ scheduled_at: "2026-08-08T12:00:00Z" }), 2)
  assert.equal(glassStageIndex({ work_started_at: "2026-08-08T12:00:00Z" }), 3)
  assert.equal(glassStageIndex({ completed_at: "2026-08-08T12:00:00Z" }), 4)
  assert.equal(glassReviewEligible({ completed_at: "2026-08-08T12:00:00Z", paid_at: null }), false)
  assert.equal(glassReviewEligible({ completed_at: "2026-08-08T12:00:00Z", paid_at: "2026-08-09T12:00:00Z" }), true)
  assert.equal(glassExpiryAt("2026-08-08T12:00:00.000Z"), "2026-11-06T12:00:00.000Z")
})

test("Customer Page stage, review, and expiry boundaries fail conservatively", () => {
  assert.equal(glassStageIndex({ scheduled_at: "2026-08-08T12:00:00Z", work_started_at: "2026-08-09T12:00:00Z" }), 3)
  assert.equal(glassStageIndex({ scheduled_at: "2026-08-08T12:00:00Z", completed_at: "2026-08-10T12:00:00Z" }), 4)
  assert.equal(glassReviewEligible({ completed_at: null, paid_at: "2026-08-09T12:00:00Z" }), false)
  assert.equal(glassExpiryAt(null), null)
  assert.equal(glassExpiryAt("not-a-date"), null)
})

test("abandoned Customer Page upload reservations expire only after the conservative pending window", () => {
  const now = Date.parse("2026-08-10T18:00:00.000Z")
  assert.equal(GLASS_UPLOAD_PENDING_EXPIRY_MS, 6 * 60 * 60 * 1000)
  assert.equal(isGlassUploadPendingExpired("pending", "2026-08-10T12:00:00.000Z", now), true)
  assert.equal(isGlassUploadPendingExpired("pending", "2026-08-10T12:00:00.001Z", now), false)
  assert.equal(isGlassUploadPendingExpired("uploading", "2026-08-10T12:00:00.000Z", now), false)
  assert.equal(isGlassUploadPendingExpired("failed", "2026-08-10T12:00:00.000Z", now), false)
  assert.equal(isGlassUploadPendingExpired("pending", "not-a-date", now), false)
  assert.equal(isGlassUploadPendingExpired("pending", "2026-08-10T19:00:00.000Z", now), false)
})

test("DONE is idempotent, briefly undoable, and raw private notes stay off GLASS", () => {
  assert.equal(canApplyDone(null), true)
  assert.equal(canApplyDone("2026-08-08T12:00:00Z"), false)
  const now = Date.parse("2026-08-08T12:00:10Z")
  assert.equal(canUndoDone("2026-08-08T12:00:01Z", now), true)
  assert.equal(canUndoDone("2026-08-08T11:59:59Z", now), false)
  assert.equal(safeGlassCaptionText("Gate code 1942. Invoice is $900.", "Gate repair"), "Gate repair finished and checked by the crew.")
  assert.equal(safeGlassCaptionText("Replaced both hinges and checked the swing.", "Gate repair"), "Replaced both hinges and checked the swing.")
})

test("DONE undo uses an exact ten-second window and captions fail closed", () => {
  const now = Date.parse("2026-08-08T12:00:10.000Z")
  assert.equal(canUndoDone("2026-08-08T12:00:00.000Z", now), true)
  assert.equal(canUndoDone("2026-08-07T23:59:59.999Z", now), false)
  assert.equal(canUndoDone("2026-08-08T12:00:10.001Z", now), false)
  assert.equal(canUndoDone("not-a-date", now), false)
  assert.equal(safeGlassCaptionText("", "Gate repair"), "Gate repair finished and checked by the crew.")
  assert.equal(safeGlassCaptionText("PIN 1942", "Gate repair"), "Gate repair finished and checked by the crew.")
})

test("handoff display follows immutable receipt order across handoff, undo, and handoff again", () => {
  assert.equal(handoffDisplayState({ persistedHandedOff: false, handoffStatus: "handed-off", handoffActionEventId: 101, undoStatus: "idle", undoActionEventId: null }), true)
  assert.equal(handoffDisplayState({ persistedHandedOff: true, handoffStatus: "handed-off", handoffActionEventId: 101, undoStatus: "active", undoActionEventId: 102 }), false)
  assert.equal(handoffDisplayState({ persistedHandedOff: false, handoffStatus: "handed-off", handoffActionEventId: 103, undoStatus: "active", undoActionEventId: 102 }), true)
})

test("Twilio retries and tests cannot duplicate failure side effects", () => {
  assert.equal(shouldEmitTwilioFailure("queued", "failed", false, true), true)
  assert.equal(shouldEmitTwilioFailure("failed", "failed", false, true), false)
  assert.equal(shouldEmitTwilioFailure("queued", "failed", true, true), false)
  assert.equal(shouldEmitTwilioFailure("queued", "failed", false, false), false)
})

test("Twilio failure emission requires a new definitive terminal transition", () => {
  assert.equal(shouldEmitTwilioFailure("sent", "undelivered", false, true), true)
  assert.equal(shouldEmitTwilioFailure("undelivered", "undelivered", false, true), false)
  assert.equal(shouldEmitTwilioFailure("queued", "unknown", false, true), false)
  assert.equal(shouldEmitTwilioFailure("queued", "failed", true, true), false)
})

test("Twilio consent classification prefers provider truth and otherwise fails safe", () => {
  assert.equal(classifyTwilioConsentKeyword("STOP", "please keep texting"), "STOP")
  assert.equal(classifyTwilioConsentKeyword("start", "anything"), "START")
  assert.equal(classifyTwilioConsentKeyword("", "  HELP  "), "HELP")
  assert.equal(classifyTwilioConsentKeyword(null, "stop"), "STOP")
  assert.equal(classifyTwilioConsentKeyword("unknown", "Please stop texting me"), null)
  assert.equal(classifyTwilioConsentKeyword(null, "YES"), null)
  assert.equal(classifyTwilioConsentKeyword(null, "START updates"), null)
})

test("attachment retry is bounded and age-gated", () => {
  assert.equal(attachmentCanRetry("pending", 0, 300_000), true)
  assert.equal(attachmentCanRetry("failed", 7, 300_000), true)
  assert.equal(attachmentCanRetry("failed", 8, 300_000), false)
  assert.equal(attachmentCanRetry("stored", 1, 300_000), false)
  assert.equal(attachmentCanRetry("pending", 1, 299_999), false)
})

test("touch actions cancel when a finger turns into a scroll", () => {
  assert.equal(safeActionMovement(20, 20, 24, 25), false)
  assert.equal(safeActionMovement(20, 20, 22, 30), true)
  assert.equal(safeActionMovement(20, 20, 34, 20), true)
})

test("touch cancellation thresholds are exact at noisy mobile boundaries", () => {
  assert.equal(safeActionMovement(0, 0, 13, 0), false)
  assert.equal(safeActionMovement(0, 0, 14, 0), true)
  assert.equal(safeActionMovement(0, 0, 0, 9), false)
  assert.equal(safeActionMovement(0, 0, 0, 10), true)
})

test("Swipe to Finish requires 70 percent and cancels vertical movement", () => {
  assert.deepEqual(swipeFinishDecision({ deltaX: 69, deltaY: 0, width: 100 }), { outcome: "reset", progress: 0.69 })
  assert.deepEqual(swipeFinishDecision({ deltaX: 70, deltaY: 0, width: 100 }), { outcome: "submit", progress: 0.7 })
  assert.deepEqual(swipeFinishDecision({ deltaX: 18, deltaY: 14, width: 100 }), { outcome: "cancel", progress: 0 })
  assert.deepEqual(swipeFinishDecision({ deltaX: 100, deltaY: 0, width: 100, submitted: true }), { outcome: "submitted", progress: 1 })
})

test("Swipe to Finish clamps malformed and overshoot gestures safely", () => {
  assert.deepEqual(swipeFinishDecision({ deltaX: -20, deltaY: 0, width: 100 }), { outcome: "reset", progress: 0 })
  assert.deepEqual(swipeFinishDecision({ deltaX: 200, deltaY: 0, width: 100 }), { outcome: "submit", progress: 1 })
  assert.deepEqual(swipeFinishDecision({ deltaX: 0, deltaY: 0, width: 0 }), { outcome: "reset", progress: 0 })
  assert.deepEqual(swipeFinishDecision({ deltaX: 18, deltaY: 12, width: 100 }), { outcome: "cancel", progress: 0 })
})

test("Customer Page upload metadata accepts only the documented safe formats", () => {
  const accepted = [
    ["photo.jpg", "image/jpeg"],
    ["photo.png", "image/png"],
    ["photo.webp", "image/webp"],
    ["iphone.heic", "image/heic"],
    ["iphone.heif", "application/octet-stream"],
    ["scan.pdf", "application/pdf"],
    ["drawing.dxf", "application/octet-stream"],
    ["drawing.dwg", "application/x-dwg"],
    ["model.step", "model/step"],
    ["model.stp", "application/octet-stream"],
    ["model.iges", "model/iges"],
    ["model.igs", "application/octet-stream"],
  ]
  for (const [filename, contentType] of accepted) {
    const result = validateCustomerUploadMetadata(filename, contentType, 1024)
    assert.equal(result.filename, filename)
    assert.equal(result.size, 1024)
  }
  assert.throws(() => validateCustomerUploadMetadata("payload.svg", "image/svg+xml", 1024), /Use JPG/)
  assert.throws(() => validateCustomerUploadMetadata("payload.html", "text/html", 1024), /Use JPG/)
  assert.throws(() => validateCustomerUploadMetadata("renamed.jpg", "application/pdf", 1024), /does not match/)
  assert.throws(() => validateCustomerUploadMetadata("large.pdf", "application/pdf", 20 * 1024 * 1024 + 1), /20 MB/)
})

test("Customer Page upload metadata strips header and pathname hazards", () => {
  const upload = validateCustomerUploadMetadata("shop\r\n drawing 01.PDF", "application/pdf; charset=binary", 20 * 1024 * 1024)
  assert.equal(upload.filename, "shop   drawing 01.PDF")
  assert.equal(upload.safeName, "shop-drawing-01.PDF")
  assert.equal(upload.contentType, "application/pdf")
  assert.equal(upload.size, 20 * 1024 * 1024)
  assert.throws(() => validateCustomerUploadMetadata("empty.pdf", "application/pdf", 0), /20 MB/)
  assert.throws(() => validateCustomerUploadMetadata("renamed.pdf.exe", "application/pdf", 100), /Use JPG/)
})

test("STOP remains authoritative until a later START and HELP changes nothing", () => {
  assert.equal(messagingConsentState([]), "unknown")
  assert.equal(messagingConsentState([{ source: "web" }]), "granted")
  assert.equal(messagingConsentState([{ source: "web" }, { source: "HELP" }]), "granted")
  assert.equal(messagingConsentState([{ source: "web" }, { source: "STOP" }, { source: "verbal-operator" }]), "revoked")
  assert.equal(messagingConsentState([{ source: "web" }, { source: "STOP" }, { source: "START" }]), "granted")
})

test("consent precedence follows the complete ordered event history", () => {
  assert.equal(messagingConsentState([{ source: "STOP" }, { source: "HELP" }, { source: "web" }]), "revoked")
  assert.equal(messagingConsentState([{ source: "STOP" }, { source: "START" }, { source: "HELP" }]), "granted")
  assert.equal(messagingConsentState([{ source: "STOP" }, { source: "START" }, { source: "STOP" }]), "revoked")
  assert.equal(messagingConsentState([{ source: "HELP" }]), "unknown")
})
