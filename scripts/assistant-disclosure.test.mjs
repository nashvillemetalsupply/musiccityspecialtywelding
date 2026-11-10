import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

const aiUrl = new URL("../lib/ai.ts", import.meta.url).href
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/shop-contact") return { url: `data:text/javascript,${encodeURIComponent('export const getShopPhone = () => ({display:"(615) 703-3296",href:"tel:+16157033296"});')}`, shortCircuit: true }
    if (new URL(specifier, context.parentURL ?? import.meta.url).href === aiUrl) return { url: `data:text/javascript,${encodeURIComponent("export const jsonWithClaude = (input) => globalThis.__disclosureModel(input);")}`, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const { ASSISTANT_SYSTEM_PROMPT, handleAssistantTurn } = await import("../lib/assistant/turn.ts")
hooks.deregister()

const englishDisclosure = "I'm an automated assistant for Music City Specialty Welding."
const spanishDisclosure = "Soy un asistente automatizado de Music City Specialty Welding."
const englishReply = "We repair steel gate hinges. Did the hinge tear metal out of the post?"
const spanishReply = "Reparamos bisagras de puertas de acero. ¿La bisagra arrancó metal del poste?"

async function replyTo(modelReply, spanish = false, laterTurn = false) {
  globalThis.__disclosureModel = async () => ({
    reply: modelReply,
    handoff_reason: null,
    fields: { name: null, callback_phone: null, need: "", material_size: null, location: null, timing: null, callback_window: null, is_job: "unsure" },
  })
  return handleAssistantTurn([
    ...(laterTurn ? [{ role: "user", content: "Hello" }, { role: "assistant", content: englishDisclosure }] : []),
    { role: "user", content: spanish ? "Mi puerta de acero tiene una bisagra rota." : "My steel gate hinge broke off the post." },
  ], { isTest: true })
}

test("English model self-disclosures are replaced with the app's single first-reply disclosure", async () => {
  for (const introduction of [
    "I'm an automated shop assistant.",
    "I am an AI assistant for Music City Specialty Welding.",
    "I'm an A.I. assistant for Music City Specialty Welding.",
    "I'm your virtual welding assistant.",
    "I’m an artificial intelligence assistant.",
    "As an AI assistant, I can help with your request.",
    englishDisclosure,
  ]) {
    assert.equal((await replyTo(`${introduction} ${englishReply}`)).reply, `${englishDisclosure} ${englishReply}`, introduction)
  }
})

test("Spanish model self-disclosures are replaced with the app's single first-reply disclosure", async () => {
  for (const introduction of [
    "Soy un asistente automatizado del taller.",
    "Soy una asistente virtual de Music City Specialty Welding.",
    "Soy el asistente de IA del taller.",
    "Soy el asistente de I.A. del taller.",
    "Soy un asistente de inteligencia artificial.",
    "Como asistente virtual, puedo ayudarte.",
    spanishDisclosure,
  ]) {
    assert.equal((await replyTo(`${introduction} ${spanishReply}`, true)).reply, `${spanishDisclosure} ${spanishReply}`, introduction)
  }
})

test("self-disclosures are removed after another sentence and from later model replies", async () => {
  assert.equal((await replyTo("We repair steel gate hinges. I'm an AI assistant. Did the hinge tear metal out of the post?")).reply, `${englishDisclosure} ${englishReply}`)
  assert.equal((await replyTo(`I'm an automated shop assistant. ${englishReply}`, false, true)).reply, englishReply)
  assert.equal((await replyTo(`Soy un asistente virtual. ${spanishReply}`, true, true)).reply, spanishReply)
})

test("HTML and Markdown surfaces cannot hide model self-disclosures", async () => {
  assert.equal((await replyTo(`<p>I'm an AI assistant.</p> ${englishReply}`)).reply, `${englishDisclosure} ${englishReply}`)
  assert.equal((await replyTo(`<p>Soy un asistente virtual.</p> ${spanishReply}`, true)).reply, `${spanishDisclosure} ${spanishReply}`)
  assert.equal((await replyTo(`[I'm an automated shop assistant.](#assistant) ${englishReply}`)).reply, `${englishDisclosure} ${englishReply}`)
})

test("adjacent HTML blocks preserve useful replies after removing self-disclosure", async () => {
  assert.equal((await replyTo("<p>I'm an AI assistant.</p><p>We repair steel gate hinges.</p><p>Did the hinge tear metal out of the post?</p>")).reply, `${englishDisclosure} ${englishReply}`)
  assert.equal((await replyTo("<p>Soy un asistente virtual.</p><p>Reparamos bisagras de puertas de acero.</p><p>¿La bisagra arrancó metal del poste?</p>", true)).reply, `${spanishDisclosure} ${spanishReply}`)
  assert.equal((await replyTo("<p>I'm an AI assistant.</p><p>We re<strong>pair</strong> steel gate hinges.</p><p>Did the hinge tear metal out of the post?</p>")).reply, `${englishDisclosure} ${englishReply}`)
})

test("quoted and emphasized introductions preserve the following useful reply", async () => {
  for (const introduction of ["**I'm an AI assistant.**", '"I am an AI assistant."', "_I'm a virtual assistant._"]) {
    assert.equal((await replyTo(`${introduction} ${englishReply}`)).reply, `${englishDisclosure} ${englishReply}`, introduction)
  }
  assert.equal((await replyTo(`“Soy un asistente virtual.” ${spanishReply}`, true)).reply, `${spanishDisclosure} ${spanishReply}`)
})

test("model self-disclosure removal preserves useful non-introduction sentences", async () => {
  const reply = "An assistant can help with the photos. Did the hinge tear metal out of the post?"
  assert.equal((await replyTo(reply)).reply, `${englishDisclosure} ${reply}`)
})

test("a disclosure-only model reply retains a useful question and a complete handoff", async () => {
  const result = await replyTo("I'm an AI assistant.")
  assert.ok(result.reply.startsWith(englishDisclosure))
  assert.equal(result.reply.split(englishDisclosure).length - 1, 1)
  assert.match(result.reply, /What needs welding or repair\?/)
  assert.match(result.reply, /\(tel:\+16157033296\)/)
  assert.match(result.reply, /\(\/#contact\)/)
  assert.equal(result.handoff_reason, "unknown")
})

test("the model prompt gives self-disclosure ownership to the application", () => {
  assert.match(ASSISTANT_SYSTEM_PROMPT, /do not introduce yourself/i)
  assert.match(ASSISTANT_SYSTEM_PROMPT, /application.*disclosure/i)
  assert.doesNotMatch(ASSISTANT_SYSTEM_PROMPT, /in your first reply, say clearly that you are/i)
})
