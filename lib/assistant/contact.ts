// Browser-safe contact fallback. It must work without the model or an API.
export const ASSISTANT_SHOP_EMAIL = "Sales@musiccityspecialtywelding.com"
export const ASSISTANT_QUOTE_FORM = "/#contact"
export type AssistantHandoffReason = "human" | "unknown" | "model-error" | "rate-limit"

export function assistantContactReply(phone: { display: string; href: string }, customerText = "", question = "What callback number should the shop use?"): string {
  if (assistantSpanish(customerText)) return `Una persona del taller debe confirmar el trabajo. [Llama al taller al ${phone.display}](${phone.href}). ${assistantQuestionInSpanish(question)} [Formulario de presupuesto](${ASSISTANT_QUOTE_FORM}) o [Correo ${ASSISTANT_SHOP_EMAIL}](mailto:${ASSISTANT_SHOP_EMAIL}).`
  return `A person at the shop can help. [Call the shop at ${phone.display}](${phone.href}). ${question} [Quote form](${ASSISTANT_QUOTE_FORM}) or [Email ${ASSISTANT_SHOP_EMAIL}](mailto:${ASSISTANT_SHOP_EMAIL}).`
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

export function assistantHandoffReason(message: string, reply = "", modelHandoff?: unknown): AssistantHandoffReason | null {
  if (modelHandoff === "model-error" || modelHandoff === "rate-limit") return modelHandoff
  if (HUMAN.test(message) || modelHandoff === "human") return "human"
  if (PRICE.test(message) || DATE_QUESTION.test(message) || UNKNOWN_REPLY.test(reply)
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
