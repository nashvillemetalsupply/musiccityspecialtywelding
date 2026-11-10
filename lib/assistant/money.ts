// Match the call-summary storage boundary, including other common written
// currency forms. Keep dimensions and callback numbers intact.
const NUMBER_WORD = "(?:a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)"
const SPANISH_NUMBER = "(?:un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis[eé]is|diecisiete|dieciocho|diecinueve|veinte|veinti\\w+|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos|mil|mill[oó]n|millones)"
const MONEY = new RegExp([
  /[$£€]\s*\d[\d,]*(?:\.\d+)?(?:\s*[kKmM]\b)?/.source,
  /\b(?:USD|GBP|EUR)\s*\d[\d,]*(?:\.\d+)?/.source,
  /\b\d[\d,]*(?:\.\d+)?\s*(?:dollars?|bucks?|USD|GBP|EUR|euros?|d[oó]lar(?:es)?|pesos?|centavos?)\b/.source,
  `\\b${NUMBER_WORD}(?:[ -]+(?:and|${NUMBER_WORD}))*[ -]+(?:dollars?|bucks?|euros?)\\b`,
  `\\b${SPANISH_NUMBER}(?:[ -]+(?:y|${SPANISH_NUMBER}))*[ -]+(?:d[oó]lar(?:es)?|pesos?|euros?|centavos?)\\b`,
].join("|"), "gi")

export function stripAssistantMoney(text: string): string {
  return text.replace(MONEY, "[owner-only money]").replace(/\s+/g, " ").trim()
}
