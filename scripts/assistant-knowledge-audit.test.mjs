import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/shop-contact") return {
      url: `data:text/javascript,${encodeURIComponent('export const getShopPhone = () => ({display:"(615) 703-3296",href:"tel:+16157033296"});')}`,
      shortCircuit: true,
    }
    return nextResolve(specifier, context)
  },
})
const { assistantKnowledge, ASSISTANT_KNOWLEDGE } = await import("../lib/assistant/knowledge.ts")
hooks.deregister()

test("customer knowledge preserves every literal homepage FAQ without importing example job state", () => {
  const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8")
  const questions = [...source.matchAll(/question: "([^"]+)"/g)].map((match) => match[1])
  assert.deepEqual(assistantKnowledge.homepage.faqs.map((faq) => faq.question), questions)
  assert.equal(questions.length, 13)
  const quote = assistantKnowledge.homepage.faqs.find((faq) => faq.question === "What should I send for a quote?")
  assert.match(quote.answer, /full item and the problem area/)
  assert.match(quote.answer, /dimensions or a drawing/)
  assert.match(quote.answer, /do not need to know the metal/)
  assert.deepEqual(assistantKnowledge.homepage.process, [
    "Call the shop. Tell us what broke, what needs built, and where it sits.",
    "Show the job. Send photos, dimensions, location, timing, or the drawing.",
    "Work out the plan. We review the scope and talk through shop work or an on-site repair.",
  ])
  assert.match(assistantKnowledge.homepage.customerPage.join(" "), /Active jobs have a private customer page/)
  assert.match(assistantKnowledge.homepage.customerPage.join(" "), /Quote, invoice, and payment link/)
  assert.doesNotMatch(assistantKnowledge.homepage.customerPage.join(" "), /In progress|Frame fitted square|Hinge stock|Driveway gate repair/)
})

test("quote upload guidance comes from the current form and preserves optional photos", () => {
  const source = readFileSync(new URL("../components/mainstreet-contact.tsx", import.meta.url), "utf8")
  const form = assistantKnowledge.quoteForm
  assert.equal(form.href, "/#contact")
  assert.deepEqual(form.requiredFields, ["Your name", "Phone", "What kind of job?"])
  assert.equal(form.photos.optional, true)
  assert.equal(form.photos.limit, "Up to 5 / 4 MB total")
  assert.deepEqual(form.photos.validation, [
    "Use JPG, PNG, WebP, GIF, HEIC, or HEIF photos.",
    "Each photo must be 3 MB or smaller.",
    "Photos must total 4 MB or less.",
  ])
  for (const fact of [form.photos.limit, ...form.photos.validation]) assert.ok(source.includes(fact))
})

test("model knowledge publishes only the public shop contact and owner-confirmed hours", () => {
  assert.match(ASSISTANT_KNOWLEDGE, /\(615\) 703-3296/)
  assert.doesNotMatch(ASSISTANT_KNOWLEDGE, /810-4910|fallback owner line/)
  assert.match(ASSISTANT_KNOWLEDGE, /Operating hours.*24\/7/)
  for (const source of ["app/page.tsx", "components/mainstreet-contact.tsx"]) assert.ok(assistantKnowledge.sources.includes(source))
})
