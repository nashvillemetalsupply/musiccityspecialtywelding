import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { readFileSync } from "node:fs"
import test from "node:test"

const aiUrl = new URL("../lib/ai.ts", import.meta.url).href
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/shop-contact") return { url: `data:text/javascript,${encodeURIComponent('export const getShopPhone = () => ({display:"(615) 703-3296",href:"tel:+16157033296"});')}`, shortCircuit: true }
    if (new URL(specifier, context.parentURL ?? import.meta.url).href === aiUrl) return { url: `data:text/javascript,${encodeURIComponent("export const jsonWithClaude = (input) => globalThis.__turnRegressionModel(input);")}`, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const { handleAssistantTurn } = await import("../lib/assistant/turn.ts")
const { processAssistantTurn } = await import("../lib/assistant/service.ts")
const { assistantHandoffReason } = await import("../lib/assistant/contact.ts")
const { findAssistantAnswer } = await import("../lib/assistant/answers.ts")
hooks.deregister()

const fields = (overrides = {}) => ({ name: null, callback_phone: null, need: "", material_size: null, location: null, timing: null, callback_window: null, is_job: "unsure", ...overrides })
const ladder = "[INTERNAL TEST] Do you weld aluminum boat ladders?"
const gate = "[INTERNAL TEST] My steel gate hinge broke off the post in Lebanon. Can you fix it?"
const gateReply = "We repair metal gate hinges and posts. Did the hinge break, or did it tear metal out of the post?"

test("all 36 audit paraphrases retain complete repository answers through the model path", async () => {
  const groups = JSON.parse(readFileSync(new URL("./fixtures/assistant-audit-paraphrases.json", import.meta.url), "utf8"))
  let calls = 0, turns = 0
  const failures = []
  for (const group of groups) {
    const approved = findAssistantAnswer(group.canonicalQuestion)
    assert.ok(approved, group.canonicalQuestion)
    for (const content of group.questions) {
      assert.equal(findAssistantAnswer(content), undefined, `audit paraphrase must reach model: ${content}`)
      for (const handoff_reason of [null, "unknown"]) {
        const reply = approved.answer
        globalThis.__turnRegressionModel = async () => { calls++; return { reply, handoff_reason, fields: fields({ need: content, is_job: "yes" }) } }
        const result = await handleAssistantTurn([{ role: "user", content }], { isTest: true })
        if (result.branch !== "model-answer" || result.handoff_reason || !result.reply.includes(reply) || (result.reply.match(/\?/g) ?? []).length !== 1) failures.push({ content, handoff_reason, branch: result.branch, trace: result.decision_trace })
      }
      turns++
    }
  }
  assert.equal(turns, 36)
  assert.equal(calls, 72)
  assert.deepEqual(failures, [])
})

test("source text cannot override unknown work, prices, dates, safety or extra model claims", async () => {
  const approved = findAssistantAnswer("Can you repair a gate where it hangs?").answer
  for (const [content, reply] of [
    ["Do you weld aluminum boat ladders?", approved],
    ["Can you repair my gate tomorrow?", approved],
    ["How much does this gate repair cost and what pictures do you need?", approved],
    ["Is my cracked trailer safe to tow?", approved],
    ["Can you repair my gate?", `${approved} We guarantee it will hold.`],
    ["Can you repair my gate?", "We repair all gates on site without an inspection."],
    ["Do you fabricate ASME certified gas manifolds?", findAssistantAnswer("Can you fabricate gas meter manifolds?").answer],
  ]) {
    globalThis.__turnRegressionModel = async () => ({ reply, handoff_reason: "unknown", fields: fields({ need: content, is_job: "yes" }) })
    const result = await handleAssistantTurn([{ role: "user", content }], { isTest: true })
    assert.equal(result.handoff_reason, "unknown", content)
    assert.notEqual(result.branch, "model-answer", content)
  }
  const photoReply = findAssistantAnswer("Can I upload a picture directly in this chat?").answer
  globalThis.__turnRegressionModel = async () => ({ reply: photoReply, handoff_reason: "unknown", fields: fields() })
  const upload = await handleAssistantTurn([{ role: "user", content: "Where can I attach this image for your shop?" }], { isTest: true })
  assert.match(upload.reply, /Chat doesn't accept photo uploads/)
  assert.match(upload.reply, /\[Quote form\]\(\/#contact\)/)
  assert.match(upload.reply, /mailto:sales@musiccityspecialtywelding.com/)
})

test("Q106-P1 service-worker intent keeps the model photo answer even with human metadata", async () => {
  const content = "I need someone to weld a part at my property. What pictures and site details help you figure out the mobile work?"
  const reply = "Send photos of the full item and close-ups of the failure. Include the job-site address, access restrictions, and desired timing."
  globalThis.__turnRegressionModel = async () => ({ reply, handoff_reason: "human", fields: fields({ need: "weld a part", is_job: "yes" }) })
  const result = await handleAssistantTurn([{ role: "user", content }], { isTest: true })
  assert.equal(result.handoff_reason, undefined)
  assert.match(result.reply, /Send photos of the full item and close-ups of the failure/)
  assert.equal(result.branch, "model-answer")
})

test("site descriptions are not unlisted cities, while named travel still needs confirmation", async () => {
  for (const location of ["behind the barn", "the jobsite", "my driveway", "our warehouse", "our plant", "our machine floor", "the barn in Knoxville", "Knoxville"]) {
    const content = `My trailer needs repair at ${location}.`
    globalThis.__turnRegressionModel = async () => ({ reply: "What material is it?", handoff_reason: null, fields: fields({ need: "trailer needs repair", location, is_job: "yes" }) })
    const result = await handleAssistantTurn([{ role: "user", content }], { isTest: true })
    if (location.includes("Knoxville")) {
      assert.equal(result.handoff_reason, "unknown", location)
      assert.match(result.reply, /Travel to that location depends on the job/, location)
    } else {
      assert.equal(result.handoff_reason, undefined, location)
      assert.equal(result.branch, "model-answer", location)
      assert.equal(result.fields.location, location)
      assert.doesNotMatch(result.reply, /Travel|confirm the trip|dispatch/i, location)
    }
  }
})

test("Q142 unavailable assistant always supplies configured contact routes and one question", async () => {
  const message = "I need help with a broken gate but the assistant is unavailable."
  const phone = { display: "(615) 810-4910", href: "tel:+16158104910" }
  for (const reply of [
    "Sorry your gate is giving you trouble. You can call (615) 810-4910 to talk to the shop now. What is your name?",
    "What is your name?",
  ]) {
    globalThis.__turnRegressionModel = async () => ({ reply, handoff_reason: null, fields: fields({ need: "broken gate", is_job: "yes" }) })
    const result = await handleAssistantTurn([{ role: "user", content: message }], { isTest: true, phone })
    assert.equal(result.handoff_reason, "unknown")
    assert.match(result.reply, /\[Call the shop at \(615\) 810-4910\]\(tel:\+16158104910\)/)
    assert.match(result.reply, /\[Quote form\]\(\/#contact\)/)
    assert.equal((result.reply.match(/\?/g) ?? []).length, 1)
  }
})

async function serviceConversation(inputs) {
  const conversation = [], stored = [], responses = [], handoffs = []
  const session = { id: "turn-routing-test", next_turn: 0, is_test: true, lead_id: null }
  let filed = 0
  for (const [index, { message, output }] of inputs.entries()) {
    const inbound = /^\[INTERNAL TEST\]/.test(message) ? message : `[INTERNAL TEST] ${message}`
    conversation.push({ role: "user", content: inbound })
    const claim = { session, turn: { inbound, result: null, response: null, lead_captured: false }, token: "test" }
    globalThis.__turnRegressionModel = async () => output
    responses.push(await processAssistantTurn({ session_id: session.id, turn_index: index, message: inbound, is_test: true }, "test", {
      store: {
        begin: async () => claim, history: async () => conversation,
        saveModel: async (_claim, _index, result) => { stored.push(structuredClone(result)) },
        verifyLease: async () => {}, saveLead: async () => {}, release: async () => {},
        finish: async (_claim, _index, result) => { conversation.push({ role: "assistant", content: result.reply }) },
      },
      rateLimit: async () => false, fingerprint: (value) => value, model: handleAssistantTurn,
      validPhone: (value) => value, fileLead: async () => { filed++; return { leadId: 501, isTest: true } },
      receipt: async () => 601, notify: async () => assert.fail("internal test must not alert crew"),
      handoff: async (value) => { handoffs.push(value); return { leadId: session.lead_id } },
      phone: { display: "(615) 703-3296", href: "tel:+16157033296" },
    }))
  }
  return { responses, stored, handoffs, filed }
}

test("sourced price policy then stair-railing detail keeps uncertain scope in intake", async () => {
  const result = await serviceConversation([
    { message: "how much for a railing?", output: { reply: "A person at the shop must quote the job. What name should the shop use?", handoff_reason: "unknown", fields: fields({ need: "railing" }) } },
    { message: "12 ft steel stair railing, Nashville", output: { reply: "The shop needs to review the railing before quoting. What name should the shop use?", handoff_reason: null, fields: fields({ need: "stair railing", material_size: "12 ft; steel", location: "Nashville", is_job: "yes" }) } },
  ])
  assert.equal(result.stored[0].branch, "sourced-answer")
  assert.equal(result.responses[0].handoff_reason, undefined)
  assert.match(result.responses[0].reply, /Estimates are free.*Price depends on the job/)
  assert.equal(result.responses[1].continue_intake, true)
  assert.equal(result.stored[1].branch, "expert-claim-intake")
  assert.doesNotMatch(result.responses[1].reply, /A person at the shop can help|\$|\b\d+\s*dollars/i)
  assert.match(result.responses[1].reply, /What name should the shop use\?/)
})

test("live gate inspection caveat clears prior unknown intake through the service", async () => {
  const cautiousGateReply = "We repair steel gate hinges and posts, but the shop needs to review the damage before confirming the repair. Did the hinge tear metal from the post?"
  const result = await serviceConversation([
    { message: ladder, output: { reply: "The shop must confirm that job. What name should the shop use?", handoff_reason: "unknown", fields: fields({ need: "aluminum boat ladders", material_size: "aluminum" }) } },
    { message: gate, output: { reply: cautiousGateReply, handoff_reason: null, fields: fields({ need: "gate hinge broke off the post", material_size: "steel", location: "Lebanon", is_job: "yes" }) } },
  ])
  assert.equal(result.stored[0].branch, "unknown-capability-intake")
  assert.equal(result.stored[1].branch, "model-answer")
  assert.equal(result.responses[1].handoff_reason, undefined)
  assert.equal(result.responses[1].reply, cautiousGateReply)
})

test("stale human model metadata cannot bypass trailer safety intake after a human request", async () => {
  const result = await serviceConversation([
    { message: "I need a person", output: { reply: "Please call the shop.", handoff_reason: "human", fields: fields() } },
    { message: "trailer tongue cracked, Mt Juliet. Is it safe to tow?", output: { reply: "The cracked tongue needs an inspection. What name should the shop use?", handoff_reason: "human", fields: fields({ need: "trailer tongue cracked", location: "Mt Juliet", is_job: "yes" }) } },
  ])
  assert.equal(result.stored[0].branch, "contact-handoff")
  assert.equal(result.responses[0].handoff_reason, "human")
  assert.equal(result.stored[1].branch, "expert-safety-intake")
  assert.equal(result.responses[1].continue_intake, true)
  assert.equal(result.responses[1].handoff_reason, "unknown")
})

test("first-turn model human intent remains available beyond the deterministic customer phrases", async () => {
  globalThis.__turnRegressionModel = async () => ({ reply: "Please call the shop.", handoff_reason: "human", fields: fields() })
  const result = await handleAssistantTurn([{ role: "user", content: "Could Alex handle this with me?" }], { isTest: true })
  assert.equal(result.handoff_reason, "human")
  assert.equal(result.branch, "contact-handoff")
  assert.equal(result.continue_intake, undefined)
})

test("requests to connect to somebody remain current human intent after prior intake", async () => {
  for (const message of [
    "Put somebody on the line, please.",
    "Put me through, please.",
    "Connect me to Alex.",
    "Transfer me to somebody.",
    "I'd like to talk with somebody.",
  ]) {
    assert.equal(assistantHandoffReason(message), "human", message)
    const result = await serviceConversation([
      { message: "I need a gate repair", output: { reply: "What name should the shop use?", handoff_reason: null, fields: fields({ need: "gate repair", is_job: "yes" }) } },
      { message, output: { reply: "Please call the shop.", handoff_reason: "human", fields: fields({ need: "gate repair", is_job: "yes" }) } },
    ])
    assert.equal(result.stored[1].branch, "contact-handoff", message)
    assert.equal(result.responses[1].handoff_reason, "human", message)
    assert.equal(result.responses[1].continue_intake, undefined, message)
  }
  for (const message of ["Somebody hit my gate.", "I need an operator platform bracket repaired.", "The damaged trailer was put on the line for inspection."]) {
    assert.equal(assistantHandoffReason(message), null, message)
  }
})

test("four customer turns save a trailer lead while stale handoffs clear for normal intake", async () => {
  const result = await serviceConversation([
    { message: "I need a trailer repair", output: { reply: "The shop needs to inspect the trailer. Where is the job?", handoff_reason: "unknown", fields: fields({ need: "trailer repair", is_job: "yes" }) } },
    { message: "Lebanon", output: { reply: "What name should the shop use?", handoff_reason: "human", fields: fields({ need: "trailer repair", location: "Lebanon", is_job: "yes" }) } },
    { message: "Sam", output: { reply: "What callback number should the shop use?", handoff_reason: "unknown", fields: fields({ need: "trailer repair", location: "Lebanon", name: "Sam", is_job: "yes" }) } },
    { message: "615-555-0100", output: { reply: "What time works for a callback?", handoff_reason: "human", fields: fields({ need: "trailer repair", location: "Lebanon", name: "Sam", callback_phone: "+16155550100", is_job: "yes" }) } },
  ])
  assert.equal(result.filed, 1)
  assert.equal(result.responses.at(-1).lead_saved, true)
  assert.equal(result.responses[0].continue_intake, true)
  assert.equal(result.stored[0].branch, "expert-claim-intake")
  for (const [index, response] of result.responses.entries()) {
    if (index > 0) {
      assert.equal(response.handoff_reason, undefined)
      assert.equal(result.stored[index].branch, "model-answer")
    }
    assert.doesNotMatch(response.reply, /Nobody can call that safe|Have it looked at before you tow/)
    assert.doesNotMatch(response.reply, /\b(?:booked|scheduled|guarantee|guaranteed|available)\b|\b(?:we|the shop|someone)\s+(?:will|can)\s+(?:call|text|come|arrive|finish)\b/i)
  }
  assert.match(result.responses.at(-1).reply, /What time works for a callback\?/)
})

test("production ladder then Lebanon gate keeps unknown intake and resumes expert answers", async () => {
  const conversation = []
  globalThis.__turnRegressionModel = async () => ({ reply: "The shop must confirm whether we weld aluminum boat ladders. What name should the shop use?", handoff_reason: "unknown", fields: fields({ need: "aluminum boat ladders", material_size: "aluminum" }) })
  conversation.push({ role: "user", content: ladder })
  const first = await handleAssistantTurn(conversation, { isTest: true })
  assert.match(first.reply, /The shop needs a closer look at that particular job\./)
  assert.equal(first.continue_intake, true)
  assert.equal(first.handoff_reason, "unknown")
  assert.equal(first.branch, "unknown-capability-intake")
  conversation.push({ role: "assistant", content: first.reply }, { role: "user", content: gate })
  globalThis.__turnRegressionModel = async () => ({ reply: gateReply, handoff_reason: null, fields: fields({ need: "gate hinge broke off the post", material_size: "steel", location: "Lebanon", is_job: "yes" }) })
  const second = await handleAssistantTurn(conversation, { isTest: true })
  assert.equal(second.reply, gateReply)
  assert.equal(second.handoff_reason, undefined)
  assert.equal(second.branch, "model-answer")
})

test("exact live boat-ladder then Lebanon gate pair clears a stale unknown handoff", async () => {
  const conversation = [{ role: "user", content: "Do you weld aluminum boat ladders?" }]
  globalThis.__turnRegressionModel = async () => ({ reply: "The shop must confirm whether we weld aluminum boat ladders. What name should the shop use?", handoff_reason: "unknown", fields: fields({ need: "aluminum boat ladders", material_size: "aluminum" }) })
  const first = await handleAssistantTurn(conversation, { isTest: true })
  assert.equal(first.handoff_reason, "unknown")
  assert.equal(first.branch, "unknown-capability-intake")
  conversation.push({ role: "assistant", content: first.reply }, { role: "user", content: "My steel gate hinge broke off the post in Lebanon. Can you fix it?" })
  globalThis.__turnRegressionModel = async () => ({ reply: gateReply, handoff_reason: "unknown", fields: fields({ need: "gate hinge broke off the post", material_size: "steel", location: "Lebanon", is_job: "yes" }) })
  const second = await handleAssistantTurn(conversation, { isTest: true })
  assert.equal(second.reply, gateReply)
  assert.equal(second.handoff_reason, undefined)
  assert.equal(second.branch, "model-answer")
  assert.equal(second.decision_trace.currentRepairDetails, true)
  assert.equal(second.decision_trace.staleModelHandoff, true)
})

test("production ladder then Lebanon gate clears model handoff even with stale job fields", async () => {
  const conversation = [{ role: "user", content: ladder }]
  globalThis.__turnRegressionModel = async () => ({ reply: "The shop must confirm whether we weld aluminum boat ladders. What name should the shop use?", handoff_reason: "unknown", fields: fields({ need: "aluminum boat ladders", material_size: "aluminum" }) })
  const first = await handleAssistantTurn(conversation, { isTest: true })
  assert.match(first.reply, /The shop needs a closer look at that particular job\./)
  assert.equal(first.handoff_reason, "unknown")
  assert.equal(first.continue_intake, true)
  assert.equal(first.branch, "unknown-capability-intake")

  conversation.push({ role: "assistant", content: first.reply }, { role: "user", content: gate })
  globalThis.__turnRegressionModel = async () => ({ reply: gateReply, handoff_reason: "unknown", fields: fields({ need: "aluminum boat ladders", material_size: "aluminum" }) })
  const second = await handleAssistantTurn(conversation, { isTest: true })
  assert.equal(second.reply, gateReply)
  assert.equal(second.handoff_reason, undefined)
  assert.equal(second.continue_intake, undefined)
  assert.equal(second.branch, "model-answer")
})

test("a known repair noun cannot clear an unknown accessory handoff", async () => {
  const conversation = [{ role: "user", content: ladder }]
  globalThis.__turnRegressionModel = async () => ({ reply: "The shop must confirm whether we weld aluminum boat ladders. What name should the shop use?", handoff_reason: "unknown", fields: fields({ need: "aluminum boat ladders", material_size: "aluminum" }) })
  const first = await handleAssistantTurn(conversation, { isTest: true })
  assert.equal(first.branch, "unknown-capability-intake")
  conversation.push({ role: "assistant", content: first.reply }, { role: "user", content: "I need a gate intercom repaired." })
  globalThis.__turnRegressionModel = async () => ({ reply: "What brand is the intercom?", handoff_reason: "unknown", fields: fields({ need: "aluminum boat ladders", material_size: "aluminum" }) })
  const second = await handleAssistantTurn(conversation, { isTest: true })
  assert.equal(second.handoff_reason, "unknown")
  assert.equal(second.branch, "expert-scope-intake")
  assert.equal(second.continue_intake, true)
  assert.match(second.reply, /We repair gate metal; motor and electrical work belongs with the installer\./)
  assert.match(second.reply, /\(tel:\+16157033296\)/)
  assert.match(second.reply, /\(\/#contact\)/)
})

test("contact details for an unsupported boat ladder do not clear its unknown handoff", async () => {
  globalThis.__turnRegressionModel = async () => ({ reply: "The shop must confirm that repair. What callback number should the shop use?", handoff_reason: "unknown", fields: fields({ need: "aluminum boat ladder", material_size: "aluminum", name: "Casey", is_job: "yes" }) })
  const result = await handleAssistantTurn([
    { role: "user", content: "I need an aluminum boat ladder repaired." },
    { role: "assistant", content: "The shop must confirm that job. What name should the shop use?" },
    { role: "user", content: "Casey" },
  ], { isTest: true })
  assert.equal(result.handoff_reason, "unknown")
  assert.equal(result.branch, "expert-claim-intake")
  assert.equal(result.decision_trace.currentRepairDetails, false)
})

test("a steel gate intercom cannot reuse stale supported gate fields to clear unknown", async () => {
  globalThis.__turnRegressionModel = async () => ({ reply: "The shop must confirm the intercom repair. What name should the shop use?", handoff_reason: "unknown", fields: fields({ need: "gate hinge broke off the post", material_size: "steel", location: "Lebanon", is_job: "yes" }) })
  const result = await handleAssistantTurn([
    { role: "user", content: gate },
    { role: "assistant", content: "Did the hinge break?" },
    { role: "user", content: "I need a steel gate intercom repaired." },
  ], { isTest: true })
  assert.equal(result.handoff_reason, "unknown")
  assert.equal(result.branch, "expert-scope-intake")
  assert.match(result.reply, /We repair gate metal; motor and electrical work belongs with the installer\./)
  assert.match(result.reply, /\(tel:\+16157033296\)/)
  assert.match(result.reply, /\(\/#contact\)/)
  assert.equal(result.decision_trace.currentRepairDetails, false)
})

test("unsupported boat ladders keep intake even when the model mistakes confirmation for a human request", async () => {
  for (const handoff_reason of [null, "unknown", "human"]) {
    globalThis.__turnRegressionModel = async () => ({ reply: "The shop needs to confirm that job. What name should the shop use?", handoff_reason, fields: fields({ need: "aluminum boat ladders", material_size: "aluminum" }) })
    const result = await handleAssistantTurn([{ role: "user", content: ladder }], { isTest: true })
    assert.match(result.reply, /The shop needs a closer look at that particular job\./)
    assert.doesNotMatch(result.reply, /A person at the shop can help/)
    assert.equal(result.continue_intake, true)
    assert.equal(result.handoff_reason, "unknown")
    assert.equal(result.branch, "unknown-capability-intake")
  }
})

test("pronoun capability requests retain unknown objects and decimal dimensions cannot hide them", async () => {
  globalThis.__turnRegressionModel = async () => ({ reply: "Yes, we do that work. What name should the shop use?", handoff_reason: null, fields: fields() })
  for (const content of [
    "I have an aluminum boat ladder. Can you weld it?",
    "Can you weld 1.5-inch vibranium flanges?",
    "My boat ladder snapped off. Can you repair it?",
  ]) {
    const result = await handleAssistantTurn([{ role: "user", content }], { isTest: true })
    assert.equal(result.handoff_reason, "unknown", content)
    assert.equal(result.branch, "unknown-capability-intake", content)
    assert.doesNotMatch(result.reply, /Yes, we do that work/)
  }
})

test("known gate repair survives in a fresh conversation and after human or model-error contact replies", async () => {
  for (const previous of [null, "I want a real person.", "[INTERNAL TEST] Do you weld aluminum boat ladders?"]) {
    for (const handoff_reason of [null, "unknown", "human"]) {
      // Fresh model metadata is still honored; the stale-flag recovery applies
      // after an earlier assistant turn only.
      if (!previous && handoff_reason) continue
      globalThis.__turnRegressionModel = async () => ({ reply: gateReply, handoff_reason, fields: fields({ need: "gate hinge broke off the post", material_size: "steel", location: "Lebanon", is_job: "yes" }) })
      const result = await handleAssistantTurn([
        ...(previous ? [{ role: "user", content: previous }, { role: "assistant", content: "A person at the shop can help. Call the shop. What callback number should the shop use?" }] : []),
        { role: "user", content: gate },
      ], { isTest: true })
      assert.equal(result.reply, previous ? gateReply : `I'm an automated assistant for Music City Specialty Welding. ${gateReply}`)
      assert.equal(result.handoff_reason, undefined)
      assert.equal(result.branch, "model-answer")
    }
  }
})

test("new contact details after a known gate handoff do not carry a stale model flag", async () => {
  globalThis.__turnRegressionModel = async () => ({ reply: "Did the hinge break, or did it tear metal out of the post?", handoff_reason: "human", fields: fields({ need: "gate hinge broke off the post", material_size: "steel", location: "Lebanon", name: "Casey", is_job: "yes" }) })
  const result = await handleAssistantTurn([
    { role: "user", content: gate },
    { role: "assistant", content: "A person at the shop can help. What name should the shop use?" },
    { role: "user", content: "Casey. The gate is steel." },
  ], { isTest: true })
  assert.equal(result.reply, "Did the hinge break, or did it tear metal out of the post?")
  assert.equal(result.handoff_reason, undefined)
  assert.equal(result.branch, "model-answer")
})

test("formatted callback details after a known gate handoff do not carry stale model metadata", async () => {
  globalThis.__turnRegressionModel = async () => ({ reply: "Did the hinge break, or did it tear metal out of the post?", handoff_reason: "unknown", fields: fields({ need: "gate hinge broke off the post", callback_phone: "+16155550199", material_size: "steel", location: "Lebanon", is_job: "yes" }) })
  const result = await handleAssistantTurn([
    { role: "user", content: gate },
    { role: "assistant", content: "A person at the shop can help. What callback number should the shop use?" },
    { role: "user", content: "615-555-0199" },
  ], { isTest: true })
  assert.equal(result.reply, "Did the hinge break, or did it tear metal out of the post?")
  assert.equal(result.handoff_reason, undefined)
  assert.equal(result.branch, "model-answer")
})

test("individual size and callback-window details after a known gate handoff keep intake open", async () => {
  for (const [latest, overrides] of [
    ["48 inches wide", { material_size: "steel; 48 inches wide" }],
    ["after 3", { callback_window: "after 3" }],
  ]) {
    globalThis.__turnRegressionModel = async () => ({ reply: "Did the hinge break, or did it tear metal out of the post?", handoff_reason: "human", fields: fields({ need: "gate hinge broke off the post", material_size: "steel", location: "Lebanon", is_job: "yes", ...overrides }) })
    const result = await handleAssistantTurn([
      { role: "user", content: gate },
      { role: "assistant", content: "A person at the shop can help. What detail should the shop use?" },
      { role: "user", content: latest },
    ], { isTest: true })
    assert.equal(result.reply, "Did the hinge break, or did it tear metal out of the post?")
    assert.equal(result.handoff_reason, undefined)
    assert.equal(result.branch, "model-answer")
  }
})

test("generic welding words do not turn an unverified job into a supported repair", async () => {
  globalThis.__turnRegressionModel = async () => ({ reply: "What size is the widget?", handoff_reason: "unknown", fields: fields({ need: "welding vibranium widget", is_job: "yes" }) })
  const result = await handleAssistantTurn([
    { role: "user", content: "I need welding vibranium widget." },
    { role: "assistant", content: "The shop must confirm that work." },
    { role: "user", content: "It needs welding vibranium widget." },
  ], { isTest: true })
  assert.equal(result.handoff_reason, "unknown")
  assert.equal(result.branch, "expert-claim-intake")
  assert.equal(result.continue_intake, true)
})

test("current human, price, date and unsupported accessory requests retain their boundaries", async () => {
  for (const [message, reason, branch] of [
    ["My steel gate hinge broke off the post in Lebanon. I want a real person.", "human", "contact-handoff"],
    ["My steel gate hinge broke off the post in Lebanon. How much?", "unknown", "contact-handoff"],
    ["Can you fix my gate tomorrow?", "unknown", "contact-handoff"],
    ["Do you weld aluminum boat ladders?", "unknown", "unknown-capability-intake"],
  ]) {
    globalThis.__turnRegressionModel = async () => ({ reply: gateReply, handoff_reason: "human", fields: fields({ need: "gate", material_size: "steel", location: "Lebanon", is_job: "yes" }) })
    const result = await handleAssistantTurn([{ role: "user", content: gate }, { role: "assistant", content: "What failed?" }, { role: "user", content: message }], { isTest: true })
    assert.equal(result.handoff_reason, reason)
    assert.equal(result.branch, branch)
    assert.notEqual(result.reply, gateReply)
  }
})

test("ordinary answer words can and available still distinguish answer from promise guard", async () => {
  for (const [reply, branch] of [
    ["We can repair metal gate hinges. Did the hinge break, or did it tear metal out of the post?", "model-answer"],
    ["We are available tomorrow. Did the hinge break?", "promise-guard-intake"],
    ["We will come tomorrow. What size is the gate?", "promise-guard-intake"],
  ]) {
    globalThis.__turnRegressionModel = async () => ({ reply, handoff_reason: null, fields: fields({ need: "gate hinge broke off the post", material_size: "steel", location: "Lebanon", is_job: "yes" }) })
    const result = await handleAssistantTurn([{ role: "user", content: gate }], { isTest: true })
    assert.equal(result.branch, branch)
    assert.equal(result.handoff_reason, branch === "model-answer" ? undefined : "unknown")
  }
})

test("successful turn records safe provider diagnostics alongside the exact branch", async () => {
  const diagnostics = { stop_reason: "end_turn", content_block_types: ["text"], usage: { input_tokens: 27, output_tokens: 19 } }
  globalThis.__turnRegressionModel = async (input) => {
    input.onModelDiagnostics(diagnostics)
    return { reply: gateReply, handoff_reason: null, fields: fields({ need: "gate hinge broke off the post", material_size: "steel", location: "Lebanon", is_job: "yes" }) }
  }
  const result = await handleAssistantTurn([{ role: "user", content: gate }], { isTest: true })
  assert.equal(result.branch, "model-answer")
  assert.deepEqual(result.model_diagnostics, diagnostics)
})

test("invalid assistant schema after a successful provider response stores safe model-error diagnostics", async () => {
  const diagnostics = { stop_reason: "end_turn", content_block_types: ["text"], usage: { input_tokens: 27, output_tokens: 19 } }
  globalThis.__turnRegressionModel = async (input) => {
    input.onModelDiagnostics(diagnostics)
    return { reply: "private provider answer fixture-secret-key", fields: fields({ name: { secret: "fixture-secret-key" } }) }
  }
  await assert.rejects(() => handleAssistantTurn([{ role: "user", content: gate }], { isTest: true }), (error) => {
    assert.deepEqual(error.modelDiagnostics, diagnostics)
    assert.equal(error.message, "Invalid assistant lead field.")
    assert.doesNotMatch(JSON.stringify(error), /private|fixture-secret-key/)
    return true
  })
  const claim = { session: { id: "schema-test", next_turn: 0, is_test: true, lead_id: null }, turn: { inbound: gate, result: null, response: null, lead_captured: false }, token: "test" }
  let stored
  const response = await processAssistantTurn({ session_id: "schema-test", turn_index: 0, message: gate, is_test: true }, "test", {
    store: {
      begin: async () => claim, history: async () => [{ role: "user", content: gate }],
      saveModel: async (_claim, _index, result) => { stored = result }, verifyLease: async () => {},
      saveLead: async () => assert.fail("no lead on schema failure"), finish: async () => {}, release: async () => {},
    },
    rateLimit: async () => false, fingerprint: (value) => value, model: handleAssistantTurn,
    validPhone: () => "", fileLead: async () => assert.fail("no lead on schema failure"),
    receipt: async () => assert.fail("no receipt on schema failure"), notify: async () => assert.fail("internal test must not alert crew"),
    handoff: async () => ({ leadId: null }), phone: { display: "(615) 703-3296", href: "tel:+16157033296" },
  })
  assert.equal(response.handoff_reason, "model-error")
  assert.equal(stored.branch, "model-error")
  assert.deepEqual(stored.model_diagnostics, diagnostics)
  assert.doesNotMatch(JSON.stringify(stored), /private|fixture-secret-key/)
  assert.equal(Object.hasOwn(response, "model_diagnostics"), false)
})

test("a stale model handoff cannot end supported gate intake after a prior handoff", async () => {
  globalThis.__turnRegressionModel = async () => ({ reply: gateReply, handoff_reason: "unknown", fields: fields({ need: "gate hinge broke off the post", material_size: "steel", location: "Lebanon", is_job: "yes" }) })
  const result = await handleAssistantTurn([
    { role: "user", content: ladder },
    { role: "assistant", content: "A person at the shop can help. What callback number should the shop use?" },
    { role: "user", content: gate },
  ], { isTest: true })
  assert.equal(result.reply, gateReply)
  assert.equal(result.handoff_reason, undefined)
  assert.equal(result.continue_intake, undefined)
  assert.equal(result.branch, "model-answer")
})
