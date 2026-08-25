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
  // the finished piece is shown as the ambiguity, not as a measurement. Two
  // different doubts used to collapse into that one sentence — a width is also
  // uncertain when the customer hedged it ("about 26 inches wide"), and asking
  // "opening or finished?" about a number nobody called an opening is a
  // question the call already answered. Only an opening is asked about.
  if (key === "width" && fact.truth === "uncertain" && /\bopening\b/i.test(String(fact.evidence ?? ""))) {
    return "Opening or finished?"
  }
  // Every hedged measurement reads the same way, in the slot and on the paper.
  // Marking only the width meant a height the shop had merely overheard was
  // printed as flatly as one the customer gave on the record.
  if (MEASURED_KEYS.has(key)) {
    const measurement = formatShopInches(Number(fact.value))
    return fact.truth === "uncertain" ? `≈ ${measurement}` : measurement
  }
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
  // Nothing described is not a gate. The label used to announce one over an
  // empty sheet on every signed-out render.
  if (!hasDrawing(spec)) return "Empty call sketch. Nothing has been described on this call yet."
  const kind = spec?.kind?.value === "frame" ? "frame" : "gate"
  const missing = PANEL_FACT_KEYS
    .filter((key) => key !== "kind" && !factIsAnswered(spec?.[key]))
    .map((key) => PANEL_FACT_LABELS[key].toLowerCase())
  if (!missing.length) return `Rough call sketch of a ${kind}. Every fact on it was heard on the call.`
  return `Rough call sketch of a ${kind}. ${sentenceList(missing)} ${missing.length === 1 ? "is" : "are"} still unstated, marked with question marks.`
}

// The drawing carries three dimension marks. A fact nobody has given stays a
// question mark on the paper; a hedged one is drawn as the approximation it
// is. Throwing the hedge away entirely printed "?" over a gate the customer
// had in fact measured — "about 26 inches wide" is not nothing.
export function dimensionMark(fact) {
  if (!fact || fact.value == null) return "?"
  const text = formatShopInches(Number(fact.value))
  return fact.truth === "uncertain" ? `≈ ${text}` : text
}

// --- the drawing itself ----------------------------------------------------
//
// The board's sketch tile said "Every answer that comes back edits it" over an
// SVG whose every coordinate was a literal. The same 144 x 92 box with the
// same two dashed rails appeared whether the call described a four-foot gate,
// a tall narrow frame, or a trailer axle, and the aria label said "gate" over
// a picture that never drew one. Only the three dimension marks ever moved.
//
// These are the numbers that box is drawn from. The defaults reproduce the
// original tile exactly, so a call that has stated nothing looks the way it
// always did; a stated width and height redraw it to its real proportion.
const TILE = Object.freeze({ w: 244, h: 172 })
const BOX = Object.freeze({ w: 144, h: 92 })
const CENTRE_X = 124

// A hedged measurement is still a measurement. The panel counts only answers,
// but the paper draws everything the call gave it — marked as what it is.
function heardValue(spec, key) {
  const fact = spec?.[key]
  return fact && fact.value != null ? fact.value : null
}

function isHedged(spec, key) {
  return spec?.[key]?.truth === "uncertain" && spec[key].value != null
}

// Is there anything on this call to draw? A kind by itself is enough to start
// a sheet; so is a width and a height with no noun attached to them. Neither
// one being present means the call was about something else, and the tile
// stays the blank grid it claims to be.
export function hasDrawing(spec) {
  if (heardValue(spec, "kind") != null) return true
  return heardValue(spec, "width") != null && heardValue(spec, "height") != null
}

export function sketchGeometry(spec) {
  const isGate = heardValue(spec, "kind") !== "frame"
  const width = Number(heardValue(spec, "width")) || null
  const height = Number(heardValue(spec, "height")) || null
  let w = BOX.w
  let h = BOX.h
  if (width && height) {
    const scale = Math.min(BOX.w / width, BOX.h / height)
    w = Math.max(24, Math.round(width * scale))
    h = Math.max(24, Math.round(height * scale))
  }
  // The mockup's box sits two pixels right of centre, which leaves the stock
  // mark room outside the right rail. Redrawn boxes keep that same centre.
  const x = Math.round(CENTRE_X - w / 2)
  const y = Math.round((TILE.h - h) / 2)
  const midY = y + h / 2
  // Stock is drawn to scale only when there is a scale to draw it to. Without
  // a stated width the tile has no inches-per-pixel, so the wall keeps the
  // mockup's weight rather than inventing one.
  const stock = Number(heardValue(spec, "stockSize")) || null
  const stroke = stock && width ? Math.min(14, Math.max(2, Math.round(stock * (w / width)))) : 3
  // A stated rail count is drawn solid — that is a decision. An unstated one
  // keeps the mockup's two dashed ghosts, which say "this is still a question".
  const statedRails = heardValue(spec, "railCount")
  const railCount = statedRails == null ? 2 : Math.min(8, Math.max(0, Math.round(Number(statedRails))))
  const rails = Array.from({ length: railCount }, (_, index) =>
    Math.round(y + (h * (index + 1)) / (railCount + 1)))
  // Hardware is a fabrication detail, and a hedged one is a question, not a
  // hinge. Only an answered side puts iron on the paper.
  const hingeSide = isGate && factIsAnswered(spec?.hingeSide) ? spec.hingeSide.value : null
  const latchSide = isGate && factIsAnswered(spec?.latchSide) ? spec.latchSide.value : null
  const outside = (side) => (side === "left" ? x - stroke * 0.9 : x + w + stroke * 0.9)
  return {
    isGate,
    hasDrawing: hasDrawing(spec),
    // A box drawn from hedged numbers is drawn as a hedge.
    outlineUncertain: isHedged(spec, "width") || isHedged(spec, "height"),
    x, y, w, h, stroke,
    rails,
    railsStated: factIsAnswered(spec?.railCount),
    hinge: hingeSide ? { x: outside(hingeSide), ys: [y + h * 0.27, y + h * 0.73], r: Math.max(3, stroke * 0.8) } : null,
    latch: latchSide ? { x: outside(latchSide), y: midY, size: Math.max(4, stroke) } : null,
    // Width along the bottom, height up the left, stock outside the right rail.
    widthDim: `M${x} ${y + h + 18}h${w}M${x} ${y + h + 10}v16M${x + w} ${y + h + 10}v16`,
    heightDim: `M${x - 18} ${y}v${h}M${x - 26} ${y}h16M${x - 26} ${y + h}h16`,
    widthText: { x: x + w / 2, y: y + h + 34 },
    heightText: { x: x - 26, y: midY + 4 },
    stockText: { x: x + w + 24, y: midY + 4 },
  }
}
