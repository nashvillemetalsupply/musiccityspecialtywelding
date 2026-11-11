import { servicePages } from "../service-pages.ts"
import { serviceAreas } from "../service-areas.ts"

export type AssistantAnswer = {
  id: string
  /** Whole questions, matched after punctuation/case normalization. */
  patterns: readonly string[]
  answer: string
  /** Versioned public copy that establishes every business claim. */
  source: string
}

const entry = (id: string, patterns: string[], answer: string, source: string): AssistantAnswer => ({ id, patterns, answer, source })
const serviceSource = (slug: string) => `lib/service-pages.ts (${slug})`
const faqParaphrases: Record<string, string[]> = {
  "trailer-welding-repair-1": ["Do you repair trailers on site?", "Can you repair my trailer on-site?"],
  "trailer-welding-repair-2": ["Do you repair cracked trailer frames?"],
  "trailer-welding-repair-3": ["What photos should I send for a trailer quote?", "What photos should I send of my trailer?"],
  "gate-repair-2": ["Do you repair gates on site?", "Can you repair my gate on-site?"],
  "gate-repair-3": ["What photos should I send for a gate quote?", "What photos should I send of my gate?"],
  "equipment-repair-1": ["Do you repair equipment on site?", "Can you repair equipment at my facility?"],
}

// This is deliberately a small, reviewable fact bank rather than a keyword
// classifier. A recognized noun never licenses an unknown process, policy,
// alloy, dispatch promise or safety approval. Each reply is at most two sentences.
export const assistantAnswers: readonly AssistantAnswer[] = Object.freeze([
  ...servicePages.flatMap((service) => service.faqs.map((faq, index) => entry(
    `${service.slug}-faq-${index + 1}`, [faq.question, ...(faqParaphrases[`${service.slug}-${index + 1}`] ?? [])],
    // The mobile FAQ has a third sentence repeating its second; retain the
    // substantive explanation without adding any fact or availability promise.
    faq.answer.split(/(?<=[.!?])\s+/).slice(0, 2).join(" "), serviceSource(service.slug),
  ))),
  entry("mobile-service", ["Do you offer mobile welding?", "Do you do mobile welding?", "Do you offer on-site welding?", "Do you come to the job site?", "Do you come out to the job?", "Do you bring welding equipment to my job site?"],
    "We bring the rig when the metal is better repaired where it sits.", serviceSource("mobile-welding")),
  entry("mobile-shop-fit", ["Should I bring my part to the shop or use mobile welding?"],
    "Access, material condition, weather, fire risk, power and repair method determine whether mobile or shop work fits.", serviceSource("mobile-welding")),
  entry("mobile-shop-conditions", ["What could make a mobile repair better suited to the shop?"],
    "Access, material condition, weather, fire risk, power and repair method can make shop work the better option.", serviceSource("mobile-welding")),
  entry("mobile-access", ["What access information do you need before a road call?"],
    "Include the job-site address, access restrictions and desired timing.", serviceSource("mobile-welding")),
  entry("mobile-photos", ["What photos should I send for a mobile welding quote?", "What pictures should I send for mobile welding?"],
    "Send full-item and close-up photos, location, access restrictions and desired timing through the website contact form or shop email.", serviceSource("mobile-welding")),
  entry("trailer-parts", ["Do you work on utility trailer ramps and fenders?", "Do you repair trailers?"],
    "We repair trailer ramps, fenders, brackets, hangers and attachment points.", serviceSource("trailer-welding-repair")),
  entry("trailer-details", ["What trailer details should I send before repair?"],
    "Include the trailer type, approximate capacity, location, prior repairs and whether it can be moved.", serviceSource("trailer-welding-repair")),
  entry("gate-parts", ["Do you repair sagging steel driveway gates?", "Do you repair gates?"],
    "We repair sagging steel and iron gate frames, hinges, latches, posts and brackets.", serviceSource("gate-repair")),
  entry("gate-electrical-boundary", ["Do you repair gate motors and electrical openers?"],
    "We repair gate metal; motor, operator and electrical work belongs with the installer.", serviceSource("gate-repair")),
  entry("gate-hinge-details", ["What do you need to know about a broken gate hinge?"],
    "Send the gate type, approximate size, location and whether it can be unhung.", serviceSource("gate-repair")),
  entry("equipment-parts", ["Do you repair machinery frames and brackets?", "Do you repair equipment?"],
    "We repair machinery frames, brackets, guards, supports and attachments.", serviceSource("equipment-repair")),
  entry("equipment-details", ["What information do you need about a failed equipment attachment?"],
    "Share the equipment make/model, failed component, photos, location and timing.", serviceSource("equipment-repair")),
  entry("equipment-repeat-failure", ["Why does the same equipment bracket keep cracking?"],
    "Repeated failure can point to load, alignment, fatigue or design issues; the shop reviews the surrounding assembly before recommending reinforcement.", serviceSource("equipment-repair")),
  entry("architectural-parts", ["Do you fabricate steel railings and stair components?", "Do you do architectural welding?"],
    "We fabricate steel railings, guardrails and stair components.", serviceSource("architectural-welding")),
  entry("architectural-drawings", ["Can I send architectural drawings and finish requirements?"],
    "Send drawings, dimensions, finish requirements and site photos.", serviceSource("architectural-welding")),
  entry("architectural-installation", ["Is installation automatically included with architectural metalwork?"],
    "Installation depends on access, anchoring, site readiness and project location; final scope must be confirmed.", serviceSource("architectural-welding")),
  entry("fabrication-sketches", ["Do you make custom brackets and frames from sketches?", "Can you work from a dimensioned sketch for a custom bracket?", "Do you do custom fabrication?"],
    "We work from drawings, sketches, measurements or samples to build custom brackets and frames.", serviceSource("custom-fabrication")),
  entry("gas-meter-manifolds", ["Can you fabricate gas meter manifolds?"],
    "We fabricate gas meter manifolds; the shop reviews the exact scope before accepting the work.", "BRAND-BRIEF.md (Approved secondary capabilities); lib/service-pages.ts (custom-fabrication)"),
  entry("fabrication-one-off", ["Do you consider one-off or short-run fabrication?"],
    "One-off and specialized projects are considered when scope, material, dimensions and intended use are clear.", serviceSource("custom-fabrication")),
  entry("fabrication-measurements", ["What measurements help with a custom fabrication quote?", "What dimensions do you need for custom fabrication?"],
    "Send a dimensioned sketch, material, quantity, finish, tolerances and installation needs.", serviceSource("custom-fabrication")),
  entry("mailboxes", ["Do you build custom steel mailbox supports?", "Do you make custom mailboxes?"],
    "We fabricate custom steel mailbox supports, clusters and brackets.", serviceSource("custom-metal-products")),
  entry("planters", ["Do you make metal planter boxes to fit a space?", "Do you make custom steel planter boxes?"],
    "We build custom metal planter boxes sized for the space.", serviceSource("custom-metal-products")),
  entry("planter-measurements", ["What measurements should I send for a planter box?"],
    "Provide length, width, height, quantity, placement photos, finish preference and installation needs.", serviceSource("custom-metal-products")),
  entry("boats", ["Do you work on aluminum boats?", "Do you repair aluminum boats?", "Do you weld aluminum boats?", "Do you weld aluminum and repair boats?"],
    "We handle aluminum boat repair; the shop reviews the exact scope before accepting the work.", "BRAND-BRIEF.md (Approved secondary capabilities); app/page.tsx (FAQs)"),
  entry("stainless-countertops", ["Do you fabricate stainless countertops?"],
    "We handle stainless countertops; the shop reviews the exact scope before accepting the work.", "BRAND-BRIEF.md (Approved secondary capabilities)"),
  entry("steel-aluminum-planters", ["Can you build large steel and aluminum planters?"],
    "We handle large steel/aluminum planters; the shop reviews the exact scope before accepting the work.", "BRAND-BRIEF.md (Approved secondary capabilities)"),
  entry("supported-metals", ["What metals do you work with?", "Do you weld steel aluminum and stainless?"],
    "The site lists steel and iron gate work, aluminum welding and boat repair, and stainless countertops.", "lib/service-pages.ts (gate-repair); app/page.tsx (FAQs); BRAND-BRIEF.md (Approved secondary capabilities)"),
  entry("quote-equipment-model", ["Should I include the equipment make and model?"],
    "Yes, send the equipment make/model and the failed component if known.", serviceSource("equipment-repair")),
  entry("quote-full-closeup", ["Do you need close-up and full-item photos?", "What photos do you need?", "What photos should I send?", "What photos?"],
    "Yes, send the full item and close-ups of the failure.", serviceSource("mobile-welding")),
  entry("quote-prior-repairs", ["Should I mention earlier repairs and rust?"],
    "Yes, mention prior repairs, visible bending, corrosion and how the failure occurred.", "lib/service-pages.ts (trailer-welding-repair; equipment-repair)"),
  entry("quote-drawings", ["How do I send drawings and dimensions?"],
    "Send drawings and dimensions through the website contact form or shop email.", "lib/service-pages.ts (custom-fabrication); components/mainstreet-contact.tsx; lib/assistant/turn.ts (photo and drawing channels)"),
  entry("chat-photos", ["Can I upload a picture directly in this chat?", "Can I send photos in chat?", "Can I upload photos here?"],
    "Chat doesn't accept photo uploads; use the website contact form or shop email.", "lib/assistant/turn.ts (photo and drawing channels); components/mainstreet-contact.tsx (Photos)"),
  entry("quote-start", ["How do I get a quote?", "What should I send for a quote?"],
    "Send the location, a short description, and clear photos of the full item and the problem area. Add dimensions or a drawing if you have them.", "app/page.tsx (FAQs); components/mainstreet-contact.tsx"),
  entry("quote-photo-limits", ["What photo files can I upload?", "How many photos can I upload?"],
    "The quote form takes up to 5 optional JPG, PNG, WebP, GIF, HEIC or HEIF photos. Keep each photo at 3 MB or less and the total at 4 MB or less.", "components/mainstreet-contact.tsx (photo validation)"),
  entry("shop-location", ["Where is your welding shop?", "What is your address?", "Where are you located?"],
    "The shop is at 533 W Baddour Pkwy, Lebanon, TN 37087.", "app/service-areas/page.tsx; BRAND-BRIEF.md (Existing business details)"),
  entry("shop-contact", ["How do I reach you?", "How can I contact the shop?", "What is your phone number?", "What is your email?"],
    "Call (615) 703-3296, use the website quote form, or email Sales@musiccityspecialtywelding.com.", "BRAND-BRIEF.md (Conversion Priorities); components/mainstreet-contact.tsx"),
  entry("service-list", ["What services do you offer?", "What do you do?"],
    "We do mobile welding, trailer and equipment repair, gate repair, architectural metal, custom fabrication, mailboxes and planters. Aluminum boat repair and stainless countertops are also listed shop capabilities.", "lib/service-pages.ts; BRAND-BRIEF.md (Approved secondary capabilities)"),
  entry("small-large-jobs", ["Do you take both small and large work?", "Do you take small jobs?"],
    "We handle local repairs and larger fabrication work.", "app/page.tsx (FAQs)"),
  entry("customer-page", ["How do I follow my job?", "What is the private customer page?"],
    "Active jobs have a private customer page with job notes, photos, documents and the quote, invoice and payment link.", "app/page.tsx (ms-job-glass-copy)"),
  ...serviceAreas.map((area) => entry(`area-${area.toLowerCase()}`, [
    `Do you provide mobile welding in ${area}?`, `Do you offer on-site mobile welding in ${area}?`,
    `Do you serve ${area}?`, `Do you do mobile welding in ${area}?`,
  ], `${area} is a listed service area. The job scope, location and schedule determine the trip.`, "lib/service-areas.ts; app/service-areas/page.tsx (travel scope)")),
  entry("listed-areas", ["What areas do you serve?", "What cities do you serve?"],
    `We list ${serviceAreas.slice(0, -1).join(", ")} and ${serviceAreas.at(-1)}. Travel depends on the location and scope; call the shop to confirm the fit.`, "lib/service-areas.ts; app/service-areas/page.tsx (travel scope)"),
])

const serviceSuffix = new RegExp(`I'm asking about (?:${servicePages.map((service) => service.shortTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\.?$`, "i")

export function normalizeAssistantAnswer(text: string): string {
  return text.replace(/\[INTERNAL TEST\]/gi, "").replace(serviceSuffix, "")
    .toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim()
    // Only whole-question grammar varies. Keep negations, extra clauses,
    // locations, unsupported objects and requested policies in the evidence.
    .replace(/^(?:hi|hello|hey)\s+/, "").replace(/^please\s+|\s+please$/g, "")
    .replace(/\byall\b/g, "you").replace(/^you\s+(?=(?:do|offer|provide|repair|weld)\b)/, "do you ")
    .replace(/^(?:are you able to|would you be able to|could you|can you|do you)\s+/, "you ")
    .replace(/^you\s+(?:offer|provide|do)\s+/, "you ")
    .replace(/\b(?:pictures|pics|photographs)\b/g, "photos").replace(/\bpicture\b/g, "photo")
    .replace(/\b(?:estimates?|quotes)\b/g, "quote")
}

export function findAssistantAnswer(message: string): AssistantAnswer | undefined {
  const question = normalizeAssistantAnswer(message)
  return assistantAnswers.find((answer) => answer.patterns.some((pattern) => normalizeAssistantAnswer(pattern) === question))
}

// Sourced exceptions apply only to the complete approved answer, never to a
// model assertion sharing some of its vocabulary. Added clauses fail closed.
export function isSourcedAssistantAnswer(reply: string, answer: AssistantAnswer | undefined): boolean {
  return Boolean(answer && normalizeAssistantAnswer(reply) === normalizeAssistantAnswer(answer.answer))
}
