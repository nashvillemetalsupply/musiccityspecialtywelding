import { FALLBACK_SHOP_PHONE_DISPLAY, FALLBACK_SHOP_PHONE_HREF, type ShopPhone } from "../shop-phone-shared.ts"

// Browser-safe contact fallback. Server callers pass getShopPhone() so the
// assistant follows the same configured tracking number as the public page.
export function assistantShopPhone(phone?: Pick<ShopPhone, "display" | "href">): Readonly<Pick<ShopPhone, "display" | "href">> {
  return Object.freeze({ display: phone?.display ?? FALLBACK_SHOP_PHONE_DISPLAY, href: phone?.href ?? FALLBACK_SHOP_PHONE_HREF })
}

export const ASSISTANT_SHOP_EMAIL = "sales@musiccityspecialtywelding.com"
export const ASSISTANT_QUOTE_FORM = "/#contact"
export type AssistantHandoffReason = "human" | "unknown" | "model-error" | "rate-limit"

// Explain the missing fact rather than making every concern sound like the
// same failed answer. These sentences promise no policy, capability or date.
export function assistantHandoffOpening(customerText = ""): string {
  const message = customerText.split("\n").at(-1) ?? customerText
  if (/\b(?:payment|pay|deposit|cash|credit|debit|financ|net 30|installment)\w*/i.test(message)) return "The shop needs to confirm payment terms for the job."
  if (/\b(?:price|pricing|cost|quote|estimate|rate|charge|how much|mileage)\w*\b|\[owner-only money\]/i.test(message)) return "The shop needs the job details before it can price the work."
  if (/\b(?:warrant\w*|guarantee\w*)\b/i.test(message)) return "The shop needs to explain the terms for that repair."
  if (/\b(?:licens\w*|insur\w*|bonded|AWS|CWI|certif\w*)\b/i.test(message)) return "The shop needs to confirm the credentials your project calls for."
  if (/\b(?:hours?|Sunday|Saturday|weekend|tonight|tomorrow|today|lead time|after.hours|emergency|arrive|book|appointment|Friday|available|availability)\b/i.test(message)) return "The shop needs to check the calendar before giving you a date."
  if (/\b(?:travel|radius|Bowling Green|Knoxville|Chattanooga|Louisville|anywhere in|all of Tennessee)\b/i.test(message)) return "The shop needs the location and job scope to confirm the trip."
  if (/\b(?:cast iron|cast aluminum|titanium|magnesium|dissimilar|alloy)\b/i.test(message)) return "That material needs a closer review before the shop confirms the work."
  if (/\b(?:ASME|pressure|propane|fuel|underwater|aerospace|food.safe|food.grade)\b/i.test(message)) return "That work needs specialist requirements checked by the shop."
  if (/\b(?:powder|coat\w*|CNC|machining|laser|plating|waterjet)\b/i.test(message)) return "The shop needs to confirm that process before taking the work."
  if (/\b(?:owner|person|someone|somebody|connect|representative|human)\b/i.test(message)) return "You can take the job straight to a person at the shop."
  if (/\b(?:unavailable|empty answer|assistant returns)\b/i.test(message)) return "The shop can pick up where this chat leaves off."
  if (/\b(?:intercom|engine|welding gas|welding wire|apply|classes|gold|pizza|sponsor|poem|unsubscribe|sellers)\b/i.test(message)) return "That question falls outside the welding details published here."
  if (/\b(?:trailer|hitch|tongue|fork|forklift|structural|beam|safety|safe|tow|capacity|load rating|DIY|myself)\b/i.test(message)) return "The damage and intended use need an inspection before a repair decision."
  return "The shop needs a closer look at that particular job."
}

export function assistantContactReply(phone: { display: string; href: string }, customerText = "", question = "What callback number should the shop use?"): string {
  if (assistantSpanish(customerText)) return `Una persona del taller debe confirmar el trabajo. [Llama al taller al ${phone.display}](${phone.href}). ${assistantQuestionInSpanish(question)} [Formulario de presupuesto](${ASSISTANT_QUOTE_FORM}) o [Correo ${ASSISTANT_SHOP_EMAIL}](mailto:${ASSISTANT_SHOP_EMAIL}).`
  return `${assistantHandoffOpening(customerText)} [Call the shop at ${phone.display}](${phone.href}). ${question} [Quote form](${ASSISTANT_QUOTE_FORM}) or [Email ${ASSISTANT_SHOP_EMAIL}](mailto:${ASSISTANT_SHOP_EMAIL}).`
}

export function assistantQuestionInSpanish(question: string): string {
  if (/What needs welding/.test(question)) return "¿Qué necesita soldadura o reparación?"
  if (/What name/.test(question)) return "¿A qué nombre está el trabajo?"
  if (/callback number/.test(question)) return "¿Qué número debe usar el taller para contactarte?"
  if (/What time works/.test(question)) return "¿Qué horario prefieres para una llamada?"
  if (/What material/.test(question)) return "¿De qué material es, si lo sabes?"
  if (/approximate size/.test(question)) return "¿Qué tamaño aproximado tiene?"
  if (/Where is the job/.test(question)) return "¿Dónde está el trabajo?"
  if (/When are you hoping/.test(question)) return "¿Para cuándo necesitas el trabajo?"
  if (/thickness/.test(question)) return "¿Qué espesor tiene el metal, si lo sabes?"
  if (/indoors/.test(question)) return "¿El trabajo está en interiores o al aire libre?"
  if (/carry a load/.test(question)) return "¿La pieza soporta carga o es decorativa?"
  if (/photo/.test(question)) return `¿Puedes enviar una foto general y una de cerca por el formulario web o a ${ASSISTANT_SHOP_EMAIL}?`
  return "¿Qué más debe saber el taller antes de revisar el trabajo?"
}

export function assistantSpanish(text: string): boolean {
  return /[¿¡]|\b(?:hola|español|necesito|quiero|soldar|soldadura|cu[aá]nto|precio|puerta|persona real)\b/i.test(text)
}

// Match requests for a person, not job evidence such as "someone hit my gate"
// or an "operator platform" on a piece of equipment.
const HUMAN = /\b(?:human|a person|real person|owner|representative|real (?:man|woman)|talk (?:to|with)|speak (?:to|with)|(?:connect|transfer)\s+me|put\s+me\s+through|put\s+(?:someone|somebody)\s+on\s+(?:the\s+)?line|(?:want|need|get|reach|connect|transfer|ask for)\s+(?:(?:a|an|the|to)\s+)?(?:person|someone|somebody|operator(?!\s+(?:platform|bracket|guard|cab|seat)))|(?:humano|persona real)|hablar con (?:una? )?(?:persona|alguien))\b|^\s*(?:person|operator|someone|somebody)(?:\s+please)?\s*[.!?]?\s*$/i
const PRICE = /\b(?:price|prices|pricing|cost|costs|quote|estimate|rates?|charge|charges|how much|what (?:would|will|does) it run|precio|precios|cotizaci[oó]n|cu[aá]nto cuesta|presupuesto)\b|[$£€]|\[owner-only money\]/i
const DATE_QUESTION = /\b(?:when (?:can|could|will|would|are)|(?:can|could|will|would) (?:you|we|the shop).*(?:today|tomorrow|this week|next week|by |finish|start|schedule)|availability|available|appointment|opening hours|what (?:time|days).*open)\b/i
const UNKNOWN_REPLY = /\b(?:can(?:not|'t|’t)|could(?:not|n't|n’t)|unable to|don(?:'t|’t) know|not sure|unsure|unknown|not (?:in|covered by) (?:our|the) (?:knowledge|information))\b|\b(?:shop|person|someone)\b.{0,60}\b(?:confirm|review|answer|check)\b/i
const UNAVAILABLE_ASSISTANT = /\b(?:assistant|chat(?:bot)?|bot)\b.{0,35}\b(?:unavailable|offline|not (?:working|responding)|down)\b|\b(?:unavailable|offline)\b.{0,20}\b(?:assistant|chat(?:bot)?|bot)\b/i

const SERVICE_WORKER = /\b(?:a person|someone|somebody)\s+(?:to|who (?:can|could|will))\s+(?:weld|repair|fix|fabricate|build|install)\b/gi
export function assistantServiceWorkerRequest(message: string): boolean {
  return message.replace(SERVICE_WORKER, "a welder") !== message
}

export function assistantHandoffReason(message: string, reply = "", modelHandoff?: unknown): AssistantHandoffReason | null {
  if (modelHandoff === "model-error" || modelHandoff === "rate-limit") return modelHandoff
  // Remove only the worker noun phrase. Explicit talk/transfer intent elsewhere
  // in the same message still takes priority over service intent.
  if (HUMAN.test(message.replace(SERVICE_WORKER, "a welder")) || modelHandoff === "human" && !assistantServiceWorkerRequest(message)) return "human"
  if (UNAVAILABLE_ASSISTANT.test(message) || PRICE.test(message) || DATE_QUESTION.test(message) || UNKNOWN_REPLY.test(reply)
    || modelHandoff === "unknown") return "unknown"
  return null
}

export function extractAssistantContact(messages: ReadonlyArray<{ role: string; content: string }>): {
  callback_phone: string | null; email: string | null
} {
  let callback_phone: string | null = null
  let email: string | null = null
  for (const message of messages) {
    if (message.role !== "user") continue
    for (const phone of message.content.match(/(?<!\d)(?:\+?1[ .-]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[ .-]?[2-9]\d{2}[ .-]?\d{4}(?!\d)/g) ?? []) {
      callback_phone = `+1${phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "")}`
    }
    for (const candidate of message.content.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+/gi) ?? []) {
      if (candidate.length <= 254 && candidate.toLowerCase() !== ASSISTANT_SHOP_EMAIL.toLowerCase()) email = candidate
    }
  }
  return { callback_phone, email }
}
