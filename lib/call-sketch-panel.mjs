import { formatShopInches } from "./call-sketch-dxf.mjs"

// The seven facts the board's sketch panel shows. `swing` and `material` are
// real facts on the spec but the panel does not carry them, so the answered
// count is out of seven and not out of nine.
export const PANEL_FACT_KEYS = Object.freeze([
  "kind", "width", "height", "stockSize", "railCount", "hingeSide", "latchSide",
])

export const PANEL_FACT_LABELS = Object.freeze({
  kind: "Kind",
  width: "Width",
  height: "Height",
  stockSize: "Stock size",
  railCount: "Rails",
  hingeSide: "Hinge side",
  latchSide: "Latch side",
})

// What has to be on the sheet before a number can be put against it. The same
// four gate `deriveCallSketch` requires of every kind before review.
const PRICING_KEYS = Object.freeze(["kind", "width", "height", "stockSize"])
const PRICING_WORDS = Object.freeze({ kind: "kind", width: "width", height: "height", stockSize: "stock" })

const MEASURED_KEYS = new Set(["width", "height", "stockSize"])

function sentenceList(words) {
  if (words.length < 2) return words.join("")
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
}

// An uncertain fact is a question, not an answer. The mockup's width — heard
// as an opening measurement — is the case this exists for: it must never
// count toward the answered total.
export function factIsAnswered(fact) {
  return Boolean(fact) && fact.value != null && (fact.truth === "stated" || fact.truth === "confirmed")
}

export function answeredFactCount(spec) {
  return PANEL_FACT_KEYS.filter((key) => factIsAnswered(spec?.[key])).length
}

// The three classes the sheet already styles. No CSS is added for this.
export function factTone(fact) {
  if (factIsAnswered(fact)) return "said"
  if (fact?.truth === "uncertain" && fact.value != null) return "ambig"
  return "none"
}

export function factText(key, fact) {
  if (!fact || fact.value == null) return "Not stated"
  // The mockup's deliberate rendering: a width that could be the opening or
  // the finished piece is shown as the ambiguity, not as a measurement.
  if (key === "width" && fact.truth === "uncertain") return "Opening or finished?"
  if (MEASURED_KEYS.has(key)) return formatShopInches(Number(fact.value))
  const text = String(fact.value)
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function pricingGap(spec) {
  return PRICING_KEYS.filter((key) => !factIsAnswered(spec?.[key])).map((key) => PRICING_WORDS[key])
}

export function pricingSentence(spec) {
  const missing = pricingGap(spec)
  if (!missing.length) return ""
  return `it needs ${sentenceList(missing)} before it can be priced`
}

export function sketchAriaLabel(spec) {
  const kind = spec?.kind?.value === "frame" ? "frame" : "gate"
  const missing = PANEL_FACT_KEYS
    .filter((key) => key !== "kind" && !factIsAnswered(spec?.[key]))
    .map((key) => PANEL_FACT_LABELS[key].toLowerCase())
  if (!missing.length) return `Rough call sketch of a ${kind}. Every fact on it was heard on the call.`
  return `Rough call sketch of a ${kind}. ${sentenceList(missing)} ${missing.length === 1 ? "is" : "are"} still unstated, marked with question marks.`
}

// The drawing carries three dimension marks. A fact that is not an answer
// stays a question mark on the paper.
export function dimensionMark(fact) {
  return factIsAnswered(fact) ? formatShopInches(Number(fact.value)) : "?"
}
