import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("only a new consented quote schedules one persisted acknowledgement without blocking intake", async () => {
  const source = readFileSync(new URL("../app/api/quote/route.ts", import.meta.url), "utf8")
  assert.match(source, /let wasNewLead = false/)
  assert.match(source, /leadPersonId = leadRows\[0\]\?\.person_id \?\? null;\s+wasNewLead = !lead\.reused;/)
  assert.equal((source.match(/sendSmsPersisted\(/g) ?? []).length, 1)
  const start = source.indexOf("    if (leadId !== null && wasNewLead")
  const end = source.indexOf("    if (leadId !== null && !isTest)", start)
  assert.ok(start > source.indexOf("const lead = await createLead("))
  assert.ok(start > source.indexOf("if (leadId === null)"))
  assert.ok(end > start, "the ack must be independent of quote draft work")
  const block = source.slice(start, end)
  assert.match(block, /after\(async \(\) =>/)
  assert.match(block, /await sendSmsPersisted\(/)
  assert.doesNotMatch(block, /process\.env|ownerInitiated/)

  const run = new Function("state", "after", "sendSmsPersisted", "console", `
    const { leadId, wasNewLead, textConsent, isTest, consentPhone, webTextGrant,
      consentConflict, leadPersonId, configured, reserved } = state
    const twilioSmsConfigured = () => configured
    const isReservedShopPhone = (phone) => { if (phone !== consentPhone) throw new Error("wrong phone"); return reserved }
    ${block}
  `)
  const eligible = {
    leadId: 42, wasNewLead: true, textConsent: true, isTest: false,
    consentPhone: "+16155550123", webTextGrant: true, consentConflict: false,
    leadPersonId: 7, configured: true, reserved: false,
  }
  for (const denied of [
    { leadId: null }, { wasNewLead: false }, { textConsent: false }, { isTest: true },
    { consentPhone: "" }, { webTextGrant: false }, { consentConflict: true },
    { configured: false }, { reserved: true },
  ]) {
    run({ ...eligible, ...denied }, () => assert.fail(`scheduled despite ${JSON.stringify(denied)}`),
      () => assert.fail("sent during intake"), console)
  }
  const callbacks = []
  const sent = []
  const errors = []
  const failure = new Error("provider unavailable")
  run(eligible, (callback) => callbacks.push(callback), async (input) => {
    sent.push(input)
    throw failure
  }, { error: (...args) => errors.push(args) })
  assert.equal(sent.length, 0, "sending must wait for after()")
  assert.equal(callbacks.length, 1)
  await assert.doesNotReject(callbacks[0])
  assert.deepEqual(sent, [{
    to: eligible.consentPhone,
    body: "Got your request. We'll call or email you back. Send a photo and the size if you can. - Music City Specialty Welding",
    leadId: 42,
    personId: 7,
    idempotencyKey: "form:42:ack",
  }])
  assert.equal(errors.length, 1)
  assert.equal(errors[0][1], failure)
})
