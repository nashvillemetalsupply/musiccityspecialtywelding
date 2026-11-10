import type { AssistantFields, AssistantMessage } from "./turn.ts"
import { ASSISTANT_SHOP_EMAIL } from "./contact.ts"

export function nextAssistantQuestion(fields: AssistantFields, conversation: AssistantMessage[] = []): string {
  if (!fields.need) return "What needs welding or repair?"
  if (!fields.name) return "What name should the shop use?"
  if (!fields.callback_phone) return "What callback number should the shop use?"
  if (!fields.callback_window) return "What time works for a callback?"
  if (!fields.material_size) return "What material is it?"
  if (!/\b(?:steel|aluminum|aluminium|stainless|iron|metal|acero|aluminio|inoxidable|hierro|unknown|unsure)\b|don['’]t know|do not know|no s[eé]|desconozco/i.test(fields.material_size)) return "What material is it, if you know?"
  if (!/\d|\b(?:small|large|pequeñ[oa]|grande|unknown|unsure)\b|don['’]t know|do not know|no s[eé]|desconozco/i.test(fields.material_size)
    && !conversation.some((message) => message.role === "assistant" && /approximate size|dimensions|tamaño aproximado|dimensiones/i.test(message.content))) return "What approximate size is it?"
  if (!fields.location) return "Where is the job?"
  if (!fields.timing) return "When are you hoping to have the work done?"
  const evidence = conversation.filter((message) => message.role === "user").map((message) => message.content).join(" ")
  const asked = conversation.filter((message) => message.role === "assistant").map((message) => message.content).join(" ")
  if (!/\b(?:thick|thickness|gauge|espesor|grosor|calibre|ga\b|\d+\s*\/\s*\d+)\b/i.test(evidence) && !/thick|espesor|grosor/i.test(asked)) return "What thickness is the metal, if you know?"
  if (!/\b(?:indoors?|outdoors?|inside|outside|interiores|exteriores|afuera|dentro)\b|aire libre/i.test(evidence) && !/indoor|outdoor|interiores|aire libre/i.test(asked)) return "Is the work indoors or outdoors?"
  if (!/\b(?:structural|cosmetic|load|support|weight|decorative|estructural|carga|peso|decorativ[oa])\b/i.test(evidence) && !/structural|cosmetic|load|carga|decorativa/i.test(asked)) return "Does the part carry a load or serve a cosmetic purpose?"
  if (!/photo|picture|image|drawing|sketch|fotos?|im[aá]gen|planos?|dibujos?/i.test(evidence + asked)) return `Can you share a full-item photo and a close-up using the website contact form or ${ASSISTANT_SHOP_EMAIL}?`
  return "What else should the shop know before reviewing the job?"
}
