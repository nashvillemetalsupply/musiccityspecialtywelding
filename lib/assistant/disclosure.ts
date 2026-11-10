// Disclosure belongs to the application. Remove whole model introduction
// sentences before reply limits and the application's first-turn prefix run.
export function stripAssistantSelfDisclosure(reply: string): string {
  return reply.split(/(?<!\b(?:A\.I|I\.A)\.)(?<=[.!?]["'”’*_]*)(?=\s|$)/iu).map((sentence) => sentence.trim())
    .filter((sentence) => {
      const introduction = sentence.replace(/^[\s"'“”‘’*_]+/u, "").replace(/\bA\.I\./gi, "AI").replace(/\bI\.A\./gi, "IA")
      const selfReference = /^(?:(?:hi|hello|hola|buenos días|buenas tardes|buenas noches)[,:\s-]*)?(?:i(?:['’]m|\s+am)\b|(?:yo\s+)?soy\b|as\s+(?:an?|your)\b|como\s+(?:(?:un[ao]?|tu|su)\s+)?asistente\b)/i.test(introduction)
      const assistant = /\b(?:assistant|asistente)\b/i.test(introduction)
      const automated = /\b(?:automated|AI|virtual|artificial intelligence|automatizad[oa]|autom[áa]tic[oa]|IA|inteligencia artificial)\b/i.test(introduction)
      return !(selfReference && assistant && automated)
    }).filter(Boolean).join(" ")
}
