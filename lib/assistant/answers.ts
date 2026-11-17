import { servicePages } from "../service-pages.ts"
import { serviceAreas } from "../service-areas.ts"
import { getShopPhone } from "@/lib/shop-contact"
import { ASSISTANT_SHOP_EMAIL, ASSISTANT_QUOTE_FORM, assistantShopPhone } from "./contact.ts"

export type AssistantAnswer = {
  id: string
  /** Whole questions, matched after punctuation/case normalization. */
  patterns: readonly string[]
  answer: string
  /** Versioned public copy or dated owner confirmation establishing the claim. */
  source: string
}

const yesNoQuestion = /^(?:do|does|can|could|should|is|are|will|would)\b/i
const entry = (id: string, patterns: string[], answer: string, source: string): AssistantAnswer => ({
  id, patterns, answer, source,
})
export const ASSISTANT_SHOP_PHONE = assistantShopPhone(getShopPhone())
const serviceSource = (slug: string) => `lib/service-pages.ts (${slug})`
const ownerSource = "owner 2026-11-11"
// Reviewed whole-question alternatives use the sourced answer without Yes/No.
// Keep these literal patterns in the bank; extra clauses still miss exactly.
const reviewedParaphrases: Record<string, string[]> = {
  "trailer-welding-repair-faq-1": [
    "My utility trailer is parked behind the barn and I can't move it right now. Is that something your welding truck could work on there?",
    "The ramp hinge broke on our trailer at the jobsite. Would we have to haul the whole thing to Lebanon for welding?",
    "I've got a trailer needing metal repair in my driveway. How do you decide whether to send the mobile rig or have me bring it in?",
  ],
  "trailer-welding-repair-faq-2": [
    "There's a split along one of the frame rails on my landscape trailer. Is that the sort of damage you look at repairing?",
    "We found a crack in the metal frame of our equipment trailer. Can your shop assess it for a welded repair?",
    "The trailer chassis has started cracking near an old weld. What would you need to see before deciding if you can fix it?",
  ],
  "gate-repair-faq-2": [
    "Our driveway gate needs welding but it's still attached to the posts. Could your crew work on it here?",
    "I've got a heavy iron gate with a broken weld. Does it have to come off first or can you work with it in place?",
    "The metal on our entrance gate needs repair and we don't have a way to take it down. Is a site visit an option?",
  ],
  "equipment-repair-faq-1": [
    "One of our machine guards broke at the warehouse. Could a welder come to our facility instead of us shipping the machine?",
    "We have a steel support on some equipment that needs repair. The machine stays on our floor; is that work you can look at here?",
    "Can your mobile crew assess a broken machinery bracket at our plant, or does all equipment work go through your shop?",
  ],
  "gas-meter-manifolds": [
    "We're putting together a project that needs a fabricated manifold for gas meters. Is building that part within your shop's scope?",
    "I have a drawing for a gas-meter manifold assembly. Is that something you could review for fabrication?",
    "Do you take on custom metal fabrication for a group of gas meters connected through a manifold?",
  ],
  "quote-full-closeup": [
    "I took a tight picture of the broken weld. Should I back up and get the whole piece in another shot too?",
    "Before I send these pictures, do you want the entire item as well as the damaged spot?",
    "I've got one wide shot and a few pictures right up against the crack. Which ones would help your shop review it?",
  ],
  "chat-photos": [
    "I'm on my phone with a photo of the damage. Where can I attach it so you can see it?",
    "I don't see a paperclip in this conversation. How am I supposed to get a picture over to the shop?",
    "Can I drop an image into this message window, or is there another place I should send it?",
  ],
  "gate-hinge-details": [
    "The top hinge on our driveway gate has broken. What details should I have ready when I contact you?",
    "I'm trying to get a gate hinge repair reviewed. Besides saying the hinge is broken, what information helps?",
    "Our steel entrance gate is hanging crooked after a hinge failed. What should I tell the shop about the gate and where it is?",
  ],
  "trailer-welding-repair-faq-3": [
    "I'm walking around my trailer with my phone before asking for a repair quote. What parts should I photograph?",
    "The trailer needs welding and I want to send useful pictures the first time. What views do you need?",
    "I've photographed the broken bit on our utility trailer. Are there other angles or trailer details your estimator will want?",
  ],
  "gate-repair-faq-3": [
    "I need a welding quote for our entrance gate. Where should I stand and what should I include in the pictures?",
    "Before I email about the damaged gate, what pictures would give you enough context to review it?",
    "I've got a close picture of our gate's broken weld. Should I also show the posts, hinges and the whole opening?",
  ],
  "mobile-photos": [
    "I need someone to weld a part at my property. What pictures and site details help you figure out the mobile work?",
    "I'm getting information together for a welding truck visit. What should I photograph around the job before I send a request?",
    "For a repair that can't leave our site, what do you want to see in the photos and know about getting your rig in?",
  ],
  "fabrication-measurements": [
    "I want a custom steel bracket made from my sketch. Which dimensions and other details should I put on it for a quote?",
    "I'm drawing up a little frame for you to build. What sizes, material information and finish details do you need from me?",
    "Before I ask you to price a made-to-order metal part, how much detail should I include about measurements, quantity and how it'll mount?",
  ],
}
const faqParaphrases: Record<string, string[]> = {
  "mobile-welding-3": ["Do you offer 24/7 emergency welding?"],
  "trailer-welding-repair-1": ["Do you repair trailers on site?", "Can you repair my trailer on-site?", ...reviewedParaphrases["trailer-welding-repair-faq-1"]],
  "trailer-welding-repair-2": ["Do you repair cracked trailer frames?", ...reviewedParaphrases["trailer-welding-repair-faq-2"]],
  "trailer-welding-repair-3": ["What photos should I send for a trailer quote?", "What photos should I send of my trailer?", ...reviewedParaphrases["trailer-welding-repair-faq-3"]],
  "gate-repair-2": ["Do you repair gates on site?", "Can you repair my gate on-site?", ...reviewedParaphrases["gate-repair-faq-2"]],
  "gate-repair-3": ["What photos should I send for a gate quote?", "What photos should I send of my gate?", ...reviewedParaphrases["gate-repair-faq-3"]],
  "equipment-repair-1": ["Do you repair equipment on site?", "Can you repair equipment at my facility?", ...reviewedParaphrases["equipment-repair-faq-1"]],
}

function faqAnswer(question: string, answer: string): string {
  if (question === "Do I need a finished CAD drawing?") return `No. Not every job needs a finished CAD drawing. ${answer.replace(/^Not always\.\s*/, "")}`
  if (question === "Can you reinforce a repeatedly cracked area?") return "Yes. Reinforcement is something we can review, but repeated failure often points to load, alignment, fatigue, or design issues. We review the surrounding assembly before recommending it."
  return answer.replaceAll("make/model", "make and model")
}

// This is deliberately a small, reviewable fact bank rather than a keyword
// classifier. A recognized noun never licenses an unknown process, policy,
// alloy, dispatch promise or safety approval. FAQ caveats stay intact, including
// a short leading Yes/No; the turn adds one next intake question.
export const assistantAnswers: readonly AssistantAnswer[] = Object.freeze([
  ...servicePages.flatMap((service) => service.faqs.map((faq, index) => entry(
    `${service.slug}-faq-${index + 1}`, [faq.question, ...(faqParaphrases[`${service.slug}-${index + 1}`] ?? [])],
    faqAnswer(faq.question, faq.answer), service.slug === "mobile-welding" && [0, 2].includes(index) ? ownerSource : serviceSource(service.slug),
  ))),
  entry("legal-entity", ["What is your legal business name?", "What is the LLC name?", "What company operates Music City Specialty Welding?", "Who operates Music City Specialty Welding?"],
    "Music City Specialty Welding is the brand. The LLC is Neverlift Chassis Works, LLC.", ownerSource),
  entry("shop-hours", ["What are your hours?", "What are your business hours?", "What are your opening hours?", "What hours are you open?", "When are you open?", "What time do you open?", "What time do you close?", "Are you open 24/7?", "Are you open weekends?", "Are you open on weekends?", "Are you open at night?", "Are you open now?", "Are you open tonight?", "Are you open today?", "Do you work after hours?", "Do you take calls after hours?", "Can I call at night?", "Can I call any time?", "Can I call anytime?", "Do you take calls on weekends?", ...["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].flatMap((day) => [`Are you open ${day}?`, `Are you open on ${day}?`])],
    "We're open 24/7. We take calls any time, every day, including nights and weekends.", ownerSource),
  entry("free-estimates", ["Are estimates free?", "Do you offer free estimates?", "Do you give free estimates?", "Are quotes free?", "Can I get a free estimate?"],
    "Estimates are free. Price depends on the job after the shop owner sees photos or the work on site. Send photos or call for a quote.", ownerSource),
  entry("estimate-fee", ["Do you charge for estimates?", "Do you charge for a quote?"],
    "No. Estimates are free. Send photos or call for a quote.", ownerSource),
  entry("job-pricing", ["What is the price?", "What are your prices?", "How much?", "How much does it cost?", "How much does a gate repair cost?", "How much to fix a gate?", "What would it run?", "How much is your hourly welding rate?", "What is the minimum mobile callout charge?", "How do you price jobs?", "What do you charge?"],
    "Estimates are free. Price depends on the job. The shop owner sets it after seeing photos or the work on site. Send photos or call for a quote.", ownerSource),
  entry("shop-insurance", ["Are you insured?", "Is your company insured?", "Does the shop have insurance?", "Do you carry insurance?"],
    "Yes. We're insured. Businesses can request a certificate of insurance.", ownerSource),
  entry("insurance-certificate", ["Can you send a certificate of insurance?", "Can you provide a certificate of insurance?", "Can our business get a certificate of insurance?", "Can you provide a COI?"],
    "Yes. We can provide a certificate of insurance to businesses on request.", ownerSource),
  entry("work-warranty", ["What warranty do you offer?", "What is your warranty?", "What warranty comes with the repair?", "Do you warranty your work?", "Do you offer a warranty?", "Do you stand behind your work?", "Is there a warranty?"],
    "We stand behind our work. If something we welded gives you trouble, call us.", ownerSource),
  entry("payment-methods", ["What payment methods do you accept?", "How can I pay?", "Do you accept credit cards?", "Do you take credit cards?", "Can I pay by credit card?", "Can I pay by card?", "Do you accept cards?", "Do you take cards?", "Do you accept cash?", "Do you take cash?", "Can I pay cash?", "Do you accept checks?", "Do you take checks?", "Can I pay by check?", "Do you accept Venmo?", "Do you take Venmo?", "Can I pay with Venmo?", "Is cash or a credit card okay?"],
    "We accept cash, card, check and Venmo.", ownerSource),
  entry("job-deposits", ["What deposit do you require?", "Do you take deposits?", "Do you require a deposit?", "Is a deposit needed for larger jobs?", "How much is the deposit?"],
    "We take deposits on larger jobs. Talk to the shop about your job.", ownerSource),
  entry("commercial-payment-terms", ["What are your commercial payment terms?", "Can businesses get invoiced?", "Do you offer invoicing for businesses?", "Can commercial terms be arranged?"],
    "Commercial terms can be arranged, talk to the shop.", ownerSource),
  entry("net-30-not-promised", ["Do you offer net 30 terms for commercial customers?", "Do you promise net-30?", "Can you guarantee net-30 terms?"],
    "No. We don't promise net-30. Commercial terms can be arranged, talk to the shop.", ownerSource),
  entry("travel-beyond-cities", ["How far is your travel radius?", "How far do you travel?", "What is your travel limit?", "What is your service radius?", "Do you travel beyond these cities?", "Do you travel outside your service area?", "Can you travel further?"],
    "We travel beyond these cities. Tell us where the job is and we'll let you know.", ownerSource),
  entry("no-fixed-travel-limit", ["Do you have a fixed travel limit?", "Do you have a fixed service radius?", "Do you have a fixed 100-mile service radius?"],
    "No. We travel beyond these cities. Tell us where the job is and we'll let you know.", ownerSource),
  entry("job-lead-time", ["What is your lead time?", "What is your current lead time?", "How long is your wait list?", "How soon can you start?", "How long will I have to wait?"],
    "We don't run a long wait list. Jobs are worked as they come in.", ownerSource),
  entry("no-long-wait-list", ["Do you have a long wait list?", "Is there a wait list?"],
    "No. We don't run a long wait list. Jobs are worked as they come in.", ownerSource),
  entry("shop-drop-offs", ["Can I drop off without an appointment?", "Can I drop off a part without an appointment?", "Can I drop off work without an appointment?", "Can I bring work to the shop any time?", "Can I bring a part by?", "Do you take drop-offs?"],
    "Yes. Bring it by any time. Calling ahead helps us be ready for you.", ownerSource),
  entry("drop-off-appointment", ["Do I need an appointment to drop off work?", "Do I need an appointment to bring a part by?"],
    "No. Bring it by any time. Calling ahead helps us be ready for you.", ownerSource),
  entry("mobile-service", ["Do you offer mobile welding?", "Do you do mobile welding?", "Do you offer on-site welding?", "Do you come to the job site?", "Do you come out to the job?", "Do you bring welding equipment to my job site?"],
    "We bring the rig when the metal is better repaired where it sits.", serviceSource("mobile-welding")),
  entry("mobile-shop-fit", ["Should I bring my part to the shop or use mobile welding?"],
    "Access, material condition, weather, fire risk, power and repair method determine whether mobile or shop work fits.", serviceSource("mobile-welding")),
  entry("mobile-shop-conditions", ["What could make a mobile repair better suited to the shop?"],
    "Access, material condition, weather, fire risk, power and repair method can make shop work the better option.", serviceSource("mobile-welding")),
  entry("mobile-access", ["What access information do you need before a road call?"],
    "Include the job-site address, access restrictions and desired timing.", serviceSource("mobile-welding")),
  entry("mobile-photos", ["What photos should I send for a mobile welding quote?", "What pictures should I send for mobile welding?", ...reviewedParaphrases["mobile-photos"]],
    "Send full-item and close-up photos, location, access restrictions and desired timing through the website contact form or shop email.", serviceSource("mobile-welding")),
  entry("trailer-parts", ["Do you work on utility trailer ramps and fenders?", "Do you repair trailers?"],
    "We repair trailer ramps, fenders, brackets, hangers and attachment points.", serviceSource("trailer-welding-repair")),
  entry("trailer-details", ["What trailer details should I send before repair?"],
    "Include the trailer type, approximate capacity, location, prior repairs and whether it can be moved.", serviceSource("trailer-welding-repair")),
  entry("gate-parts", ["Do you repair sagging steel driveway gates?", "Do you repair gates?"],
    "We repair sagging steel and iron gate frames, hinges, latches, posts and brackets.", serviceSource("gate-repair")),
  entry("gate-electrical-boundary", ["Do you repair gate motors and electrical openers?"],
    "No. We repair gate metal; motor, operator and electrical work belongs with the installer.", serviceSource("gate-repair")),
  entry("gate-hinge-details", ["What do you need to know about a broken gate hinge?", ...reviewedParaphrases["gate-hinge-details"]],
    "Send the gate type, approximate size, location and whether it can be unhung.", serviceSource("gate-repair")),
  entry("equipment-parts", ["Do you repair machinery frames and brackets?", "Do you repair equipment?"],
    "We repair machinery frames, brackets, guards, supports and attachments.", serviceSource("equipment-repair")),
  entry("equipment-details", ["What information do you need about a failed equipment attachment?"],
    "Share the equipment make and model, failed component, photos, location and timing.", serviceSource("equipment-repair")),
  entry("equipment-repeat-failure", ["Why does the same equipment bracket keep cracking?"],
    "Repeated failure can point to load, alignment, fatigue or design issues; we review the surrounding assembly before recommending reinforcement.", serviceSource("equipment-repair")),
  entry("architectural-parts", ["Do you fabricate steel railings and stair components?", "Do you do architectural welding?"],
    "We fabricate steel railings, guardrails and stair components.", serviceSource("architectural-welding")),
  entry("architectural-drawings", ["Can I send architectural drawings and finish requirements?"],
    "Send drawings, dimensions, finish requirements and site photos.", serviceSource("architectural-welding")),
  entry("architectural-installation", ["Is installation automatically included with architectural metalwork?"],
    "No. Installation depends on access, anchoring, site readiness and project location; we confirm the final scope with you.", serviceSource("architectural-welding")),
  entry("fabrication-sketches", ["Do you make custom brackets and frames from sketches?", "Can you work from a dimensioned sketch for a custom bracket?", "Do you do custom fabrication?"],
    "We work from drawings, sketches, measurements or samples to build custom brackets and frames.", serviceSource("custom-fabrication")),
  entry("gas-meter-manifolds", ["Can you fabricate gas meter manifolds?", ...reviewedParaphrases["gas-meter-manifolds"]],
    "We fabricate gas meter manifolds; we review the exact scope before accepting the work.", "BRAND-BRIEF.md (Approved secondary capabilities); lib/service-pages.ts (custom-fabrication)"),
  entry("fabrication-one-off", ["Do you consider one-off or short-run fabrication?"],
    "One-off and specialized projects are considered when scope, material, dimensions and intended use are clear.", serviceSource("custom-fabrication")),
  entry("fabrication-measurements", ["What measurements help with a custom fabrication quote?", "What dimensions do you need for custom fabrication?", ...reviewedParaphrases["fabrication-measurements"]],
    "Send a dimensioned sketch, material, quantity, finish, tolerances and installation needs.", serviceSource("custom-fabrication")),
  entry("mailboxes", ["Do you build custom steel mailbox supports?", "Do you make custom mailboxes?"],
    "We fabricate custom steel mailbox supports, clusters and brackets.", serviceSource("custom-metal-products")),
  entry("planters", ["Do you make metal planter boxes to fit a space?", "Do you make custom steel planter boxes?"],
    "We build custom metal planter boxes sized for the space.", serviceSource("custom-metal-products")),
  entry("planter-measurements", ["What measurements should I send for a planter box?"],
    "Provide length, width, height, quantity, placement photos, finish preference and installation needs.", serviceSource("custom-metal-products")),
  entry("boats", ["Do you work on aluminum boats?", "Do you repair aluminum boats?", "Do you weld aluminum boats?", "Do you weld aluminum and repair boats?"],
    "We handle aluminum boat repair; we review the exact scope before accepting the work.", "BRAND-BRIEF.md (Approved secondary capabilities); app/page.tsx (FAQs)"),
  entry("stainless-countertops", ["Do you fabricate stainless countertops?"],
    "We handle stainless countertops; we review the exact scope before accepting the work.", "BRAND-BRIEF.md (Approved secondary capabilities)"),
  entry("steel-aluminum-planters", ["Can you build large steel and aluminum planters?"],
    "We handle large steel or aluminum planters; we review the exact scope before accepting the work.", "BRAND-BRIEF.md (Approved secondary capabilities)"),
  entry("supported-metals", ["What metals do you work with?", "Do you weld steel aluminum and stainless?"],
    "We work on steel and iron gates, weld aluminum and repair aluminum boats, and fabricate stainless countertops.", "lib/service-pages.ts (gate-repair); app/page.tsx (FAQs); BRAND-BRIEF.md (Approved secondary capabilities)"),
  entry("quote-equipment-model", ["Should I include the equipment make and model?"],
    "Yes. Send the equipment make and model and the failed component if known.", serviceSource("equipment-repair")),
  entry("quote-full-closeup", ["Do you need close-up and full-item photos?", "What photos do you need?", "What photos should I send?", "What photos?", ...reviewedParaphrases["quote-full-closeup"]],
    "Yes. Send the full item and close-ups of the failure.", serviceSource("mobile-welding")),
  entry("quote-prior-repairs", ["Should I mention earlier repairs and rust?"],
    "Yes. Mention prior repairs, visible bending, corrosion and how the failure occurred.", "lib/service-pages.ts (trailer-welding-repair; equipment-repair)"),
  entry("quote-drawings", ["How do I send drawings and dimensions?"],
    "Send drawings and dimensions through the website contact form or shop email.", "lib/service-pages.ts (custom-fabrication); components/mainstreet-contact.tsx; lib/assistant/turn.ts (photo and drawing channels)"),
  entry("chat-photos", ["Can I upload a picture directly in this chat?", "Can I send photos in chat?", "Can I upload photos here?", ...reviewedParaphrases["chat-photos"]],
    "No. Chat doesn't accept photo uploads; use the website contact form or shop email.", "lib/assistant/turn.ts (photo and drawing channels); components/mainstreet-contact.tsx (Photos)"),
  entry("quote-start", ["How do I get a quote?", "What should I send for a quote?"],
    "Send the location, a short description, and clear photos of the full item and the problem area. Add dimensions or a drawing if you have them.", "app/page.tsx (FAQs); components/mainstreet-contact.tsx"),
  entry("quote-photo-limits", ["What photo files can I upload?", "How many photos can I upload?"],
    "The quote form takes up to 5 optional JPG, PNG, WebP, GIF, HEIC or HEIF photos. Keep each photo at 3 MB or less and the total at 4 MB or less.", "components/mainstreet-contact.tsx (photo validation)"),
  entry("shop-location", ["Where is your welding shop?", "What is your address?", "Where are you located?"],
    "We're at 533 W Baddour Pkwy, Lebanon, TN 37087.", "app/service-areas/page.tsx; BRAND-BRIEF.md (Existing business details)"),
  entry("shop-contact", ["How do I reach you?", "How can I contact the shop?", "What is your phone number?", "What is your email?"],
    `Call ${ASSISTANT_SHOP_PHONE.display}, use the [website quote form](${ASSISTANT_QUOTE_FORM}), or email ${ASSISTANT_SHOP_EMAIL}.`, "lib/shop-contact.ts; lib/shop-phone-shared.ts; lib/assistant/contact.ts; components/mainstreet-contact.tsx"),
  entry("service-list", ["What services do you offer?", "What do you do?"],
    "We do mobile welding, trailer and equipment repair, gate repair, architectural metal, custom fabrication, mailboxes and planters. We also repair aluminum boats and fabricate stainless countertops.", "lib/service-pages.ts; BRAND-BRIEF.md (Approved secondary capabilities)"),
  entry("small-large-jobs", ["Do you take both small and large work?", "Do you take small jobs?"],
    "We handle local repairs and larger fabrication work.", "app/page.tsx (FAQs)"),
  entry("customer-page", ["How do I follow my job?", "What is the private customer page?"],
    "Active jobs have a private customer page with job notes, photos, documents and the quote, invoice and payment link.", "app/page.tsx (ms-job-glass-copy)"),
  ...serviceAreas.map((area) => entry(`area-${area.toLowerCase()}`, [
    `Do you provide mobile welding in ${area}?`, `Do you offer on-site mobile welding in ${area}?`,
    `Do you serve ${area}?`, `Do you do mobile welding in ${area}?`,
  ], `Yes. We work in ${area}; the job scope, location and schedule determine the trip.`, "lib/service-areas.ts; app/service-areas/page.tsx (travel scope)")),
  entry("listed-areas", ["What areas do you serve?", "What cities do you serve?"],
    `We work in ${serviceAreas.slice(0, -1).join(", ")} and ${serviceAreas.at(-1)}. We travel beyond these cities. Tell us where the job is and we'll let you know.`, ownerSource),
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
  for (const answer of assistantAnswers) {
    const pattern = answer.patterns.find((pattern) => normalizeAssistantAnswer(pattern) === question)
    if (!pattern) continue
    // Existing questions keep their grammar-based opening. Reviewed alternatives
    // omit Yes/No because their wording can change the question's polarity.
    const yesNo = answer.id !== "mobile-shop-fit" && !reviewedParaphrases[answer.id]?.includes(pattern) && yesNoQuestion.test(pattern)
    const opening = /^(?:Yes|No)\.\s*/
    return {
      ...answer,
      answer: yesNo
        ? opening.test(answer.answer) ? answer.answer : `Yes. ${answer.answer}`
        : answer.answer.replace(opening, ""),
    }
  }
  // A single ordinary price question gets the owner's estimate policy even
  // when the job wording varies. Extra clauses, dates, unknown materials and
  // requests for a person keep the existing review and safety boundaries.
  const priceQuestion = message.replace(/\[INTERNAL TEST\]/gi, "").trim()
  const priceWords = normalizeAssistantAnswer(priceQuestion).split(" ")
  const knownPriceWord = /^(?:how|much|what|is|are|the|a|an|your|you|do|does|would|will|could|can|costs?|price|pricing|charges?|rates?|fees?|minimum|call|out|callout|mileage|travel|mobile|hourly|welding|weld|repairs?|fix|fabricate|fabrication|jobs?|work|for|to|it|this|my|our|of|on|at|per|shop|in|with|me|steel|aluminum|aluminium|stainless|iron|gates?|trailers?|equipment|frames?|hinges?|ramps?|fenders?|brackets?|railings?|countertops?|planters?|mailboxes?|boats?|manifolds?|custom|small|large|broken|cracked|damaged|welder|estimate|quote|get|need|about|average|typical|labor|labour|feet|foot|inches?|\d+)$/
  if (/^(?:(?:hi|hello|hey)[,\s]+)?(?:how much\b|what\b.{0,55}\b(?:cost|price|pricing|rates?|charges?|fees?|minimum|call[ -]?out|mileage)\b)/i.test(priceQuestion)
    && !/[.;!\n]|\?(?=\s*\S)/.test(priceQuestion)
    && priceWords.every((word) => knownPriceWord.test(word))) {
    return assistantAnswers.find((answer) => answer.id === "job-pricing")
  }
  return undefined
}

// Sourced exceptions apply only to the complete approved answer, never to a
// model assertion sharing some of its vocabulary. Added clauses fail closed.
export function isSourcedAssistantAnswer(reply: string, answer: AssistantAnswer | undefined): boolean {
  return Boolean(answer && normalizeAssistantAnswer(reply) === normalizeAssistantAnswer(answer.answer))
}
