import assert from "node:assert/strict"
import { registerHooks } from "node:module"
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
hooks.deregister()

const fields = (overrides = {}) => ({ name: null, callback_phone: null, need: "", material_size: null, location: null, timing: null, callback_window: null, is_job: "unsure", ...overrides })
const ladder = "[INTERNAL TEST] Do you weld aluminum boat ladders?"
const gate = "[INTERNAL TEST] My steel gate hinge broke off the post in Lebanon. Can you fix it?"
const gateReply = "We repair metal gate hinges and posts. Did the hinge break, or did it tear metal out of the post?"

test("production ladder then Lebanon gate keeps unknown intake and resumes expert answers", async () => {
  const conversation = []
  globalThis.__turnRegressionModel = async () => ({ reply: "The shop must confirm whether we weld aluminum boat ladders. What name should the shop use?", handoff_reason: "unknown", fields: fields({ need: "aluminum boat ladders", material_size: "aluminum" }) })
  conversation.push({ role: "user", content: ladder })
  const first = await handleAssistantTurn(conversation, { isTest: true })
  assert.match(first.reply, /A person at the shop will confirm that job\./)
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

test("production ladder then Lebanon gate clears a model handoff carried from unknown intake", async () => {
  const conversation = [{ role: "user", content: ladder }]
  globalThis.__turnRegressionModel = async () => ({ reply: "The shop must confirm whether we weld aluminum boat ladders. What name should the shop use?", handoff_reason: "unknown", fields: fields({ need: "aluminum boat ladders", material_size: "aluminum" }) })
  const first = await handleAssistantTurn(conversation, { isTest: true })
  assert.match(first.reply, /A person at the shop will confirm that job\./)
  assert.equal(first.handoff_reason, "unknown")
  assert.equal(first.continue_intake, true)
  assert.equal(first.branch, "unknown-capability-intake")

  conversation.push({ role: "assistant", content: first.reply }, { role: "user", content: gate })
  globalThis.__turnRegressionModel = async () => ({ reply: gateReply, handoff_reason: "unknown", fields: fields({ need: "aluminum boat ladders", material_size: "aluminum" }) })
  const second = await handleAssistantTurn(conversation, { isTest: true })
  assert.equal(second.reply, gateReply)
  assert.equal(second.handoff_reason, undefined)
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
  assert.equal(second.branch, "contact-handoff")
  assert.match(second.reply, /A person at the shop can help\./)
})

test("unsupported boat ladders keep intake even when the model mistakes confirmation for a human request", async () => {
  for (const handoff_reason of [null, "unknown", "human"]) {
    globalThis.__turnRegressionModel = async () => ({ reply: "The shop needs to confirm that job. What name should the shop use?", handoff_reason, fields: fields({ need: "aluminum boat ladders", material_size: "aluminum" }) })
    const result = await handleAssistantTurn([{ role: "user", content: ladder }], { isTest: true })
    assert.match(result.reply, /A person at the shop will confirm that job\./)
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
  assert.match(result.reply, /^Did the hinge break/)
  assert.equal(result.handoff_reason, undefined)
})

test("formatted callback details after a known gate handoff do not carry stale model metadata", async () => {
  globalThis.__turnRegressionModel = async () => ({ reply: "Did the hinge break, or did it tear metal out of the post?", handoff_reason: "unknown", fields: fields({ need: "gate hinge broke off the post", callback_phone: "+16155550199", material_size: "steel", location: "Lebanon", is_job: "yes" }) })
  const result = await handleAssistantTurn([
    { role: "user", content: gate },
    { role: "assistant", content: "A person at the shop can help. What callback number should the shop use?" },
    { role: "user", content: "615-555-0199" },
  ], { isTest: true })
  assert.match(result.reply, /^Did the hinge break/)
  assert.equal(result.handoff_reason, undefined)
})

test("individual size and callback-window details after a known gate handoff keep the model answer", async () => {
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
    assert.match(result.reply, /^Did the hinge break/)
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
  assert.equal(result.branch, "contact-handoff")
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

test("a stale model handoff cannot replace a supported gate answer after a prior handoff", async () => {
  globalThis.__turnRegressionModel = async () => ({ reply: gateReply, handoff_reason: "unknown", fields: fields({ need: "gate hinge broke off the post", material_size: "steel", location: "Lebanon", is_job: "yes" }) })
  const result = await handleAssistantTurn([
    { role: "user", content: ladder },
    { role: "assistant", content: "A person at the shop can help. What callback number should the shop use?" },
    { role: "user", content: gate },
  ], { isTest: true })
  assert.equal(result.reply, gateReply)
  assert.equal(result.handoff_reason, undefined)
})
