const NUMBER_WORDS = new Map([
  ["zero", 0], ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
  ["eleven", 11], ["twelve", 12], ["thirteen", 13], ["fourteen", 14], ["fifteen", 15],
  ["sixteen", 16], ["seventeen", 17], ["eighteen", 18], ["nineteen", 19], ["twenty", 20],
  ["thirty", 30], ["forty", 40], ["fifty", 50], ["sixty", 60], ["seventy", 70],
  ["eighty", 80], ["ninety", 90],
])

const UNKNOWN_FACT = Object.freeze({ value: null, truth: "unknown", evidence: "", track: "", sequenceId: null })

function emptyFact() {
  return { ...UNKNOWN_FACT }
}

export function emptyCallSketchSpec() {
  return {
    version: 1,
    kind: emptyFact(),
    width: emptyFact(),
    height: emptyFact(),
    stockSize: emptyFact(),
    railCount: emptyFact(),
    hingeSide: emptyFact(),
    latchSide: emptyFact(),
    swing: emptyFact(),
    material: emptyFact(),
    nextQuestion: "What are we sketching—a gate or a simple rectangular frame?",
    readyForReview: false,
  }
}

function parseNumericValue(raw) {
  const compact = raw.trim()
  if (/^\d+\/\d+$/.test(compact)) {
    const [numerator, denominator] = compact.split("/").map(Number)
    return denominator ? numerator / denominator : null
  }
  const mixed = compact.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  const value = Number(compact)
  return Number.isFinite(value) ? value : null
}

function parseWordValue(raw) {
  const tokens = raw.toLowerCase().replace(/-/g, " ").trim().split(/\s+/)
  let value = 0
  let sawNumber = false
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === "and") continue
    if ((token === "a" || token === "one") && tokens[index + 1] === "half") {
      value += 0.5
      sawNumber = true
      index += 1
      continue
    }
    if (token === "half") {
      value += 0.5
      sawNumber = true
      continue
    }
    if ((token === "a" || token === "one") && tokens[index + 1] === "quarter") {
      value += 0.25
      sawNumber = true
      index += 1
      continue
    }
    if (token === "quarter") {
      value += 0.25
      sawNumber = true
      continue
    }
    const number = NUMBER_WORDS.get(token)
    if (number === undefined) return null
    value += number
    sawNumber = true
  }
  return sawNumber ? value : null
}

function measurements(text) {
  const found = []
  const numeric = /(\d+(?:\.\d+|\s+\d+\/\d+)?|\d+\/\d+)\s*(feet|foot|ft\.?|inches|inch|in\.?|["'])/gi
  for (const match of text.matchAll(numeric)) {
    const value = parseNumericValue(match[1])
    if (value == null) continue
    const unit = match[2].toLowerCase()
    found.push({ value: /feet|foot|ft|^'$/.test(unit) ? value * 12 : value, index: match.index ?? 0, raw: match[0] })
  }
  const wordPattern = "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|and|a|half|quarter)"
  const written = new RegExp(`(${wordPattern}(?:[\\s-]+${wordPattern}){0,5})[\\s-]+(feet|foot|ft\\.?|inches|inch|in\\.?)\\b`, "gi")
  for (const match of text.matchAll(written)) {
    const value = parseWordValue(match[1])
    if (value == null) continue
    const unit = match[2].toLowerCase()
    found.push({ value: /feet|foot|ft/.test(unit) ? value * 12 : value, index: match.index ?? 0, raw: match[0] })
  }
  return found.sort((left, right) => left.index - right.index)
}

function nearest(items, index, options = {}) {
  const candidates = items.filter((item) => options.after == null || item.index >= options.after)
  if (!candidates.length) return null
  return candidates.reduce((best, item) => Math.abs(item.index - index) < Math.abs(best.index - index) ? item : best)
}

function measurementForKeyword(items, index) {
  const before = items.filter((item) => item.index <= index)
  return before.length ? before[before.length - 1] : nearest(items, index)
}

function countBefore(text, noun) {
  const expression = new RegExp(`(\\d+|zero|one|two|three|four|five|six|seven|eight)\\s+(?:interior\\s+)?${noun}`, "i")
  const match = text.match(expression)
  if (!match) return null
  const numeric = Number(match[1])
  return Number.isFinite(numeric) ? numeric : NUMBER_WORDS.get(match[1].toLowerCase()) ?? null
}

function truthRank(value) {
  return value === "confirmed" ? 3 : value === "stated" ? 2 : value === "uncertain" ? 1 : 0
}

function assign(spec, key, value, truth, utterance) {
  if (value == null || value === "") return
  const current = spec[key]
  if (truthRank(truth) < truthRank(current.truth)) return
  spec[key] = {
    value,
    truth,
    evidence: utterance.transcript,
    track: utterance.track ?? "",
    sequenceId: Number.isFinite(Number(utterance.sequenceId)) ? Number(utterance.sequenceId) : null,
  }
}

function updateFromUtterance(spec, utterance) {
  const source = String(utterance.transcript ?? "").replace(/\s+/g, " ").trim()
  if (!source) return
  const text = source.toLowerCase().replace(/[–—]/g, "-")
  const values = measurements(text)
  const isQuestion = /\?\s*$/.test(source) || /^(is|are|do|does|did|should|would|will|can|could|what|which|how)\b/.test(text)
  const statedTruth = isQuestion ? "uncertain" : "stated"

  if (!(isQuestion && /\bgate\b/.test(text) && /\b(frame|panel)\b/.test(text))) {
    if (/\bgate\b/.test(text)) assign(spec, "kind", "gate", statedTruth, utterance)
    else if (/\b(frame|panel)\b/.test(text)) assign(spec, "kind", "frame", statedTruth, utterance)
  }

  const pair = text.match(/(\d+(?:\.\d+|\s+\d+\/\d+)?)\s*(?:inches?|in|["'])?\s+(?:wide\s+)?(?:by|x)\s+(\d+(?:\.\d+|\s+\d+\/\d+)?)\s*(?:inches?|in|["'])?/i)
  if (pair && /\b(gate|frame|panel)\b/.test(text)) {
    const pairTruth = isQuestion || /\b(about|roughly|approximately)\b/.test(text) ? "uncertain" : "stated"
    assign(spec, "width", parseNumericValue(pair[1]), pairTruth, utterance)
    assign(spec, "height", parseNumericValue(pair[2]), pairTruth, utterance)
  }

  const actualGateIndex = Math.max(text.indexOf("actual gate"), text.indexOf("gate itself"))
  if (actualGateIndex >= 0) {
    const actual = nearest(values, actualGateIndex, { after: actualGateIndex })
    assign(spec, "width", actual?.value, statedTruth, utterance)
  } else {
    const widthKeyword = /\b(width|wide|opening)\b/.exec(text)
    if (widthKeyword) {
      const width = measurementForKeyword(values, widthKeyword.index)
      const uncertain = isQuestion || /\b(about|roughly|approximately|opening)\b/.test(text)
      assign(spec, "width", width?.value, uncertain ? "uncertain" : "stated", utterance)
    }
  }

  const heightKeyword = /\b(height|tall|high)\b/.exec(text)
  if (heightKeyword) {
    const height = measurementForKeyword(values, heightKeyword.index)
    const uncertain = isQuestion || /\b(about|roughly|approximately)\b/.test(text)
    assign(spec, "height", height?.value, uncertain ? "uncertain" : "stated", utterance)
  }

  const stockKeyword = /\b(square\s+tu(?:be|bing)|tu(?:be|bing)|stock)\b/.exec(text)
  if (stockKeyword) assign(spec, "stockSize", measurementForKeyword(values, stockKeyword.index)?.value, statedTruth, utterance)

  const railCount = countBefore(text, "rails?")
  if (railCount != null) assign(spec, "railCount", Math.min(Math.max(Math.round(railCount), 0), 8), statedTruth, utterance)

  const hingeAfter = text.match(/\bhinge(?:s|d)?(?:\s+(?:it|the\s+gate))?\s+(?:be\s+)?(?:on\s+)?(?:the\s+)?(left|right)\b/i)
  const hingeBefore = text.match(/\b(left|right)(?:\s+side)?\s+hinge(?:s)?\b/i)
  const hinge = hingeAfter ?? hingeBefore
  if (hinge) assign(spec, "hingeSide", hinge[1].toLowerCase(), statedTruth, utterance)
  const latchAfter = text.match(/\blatch(?:es)?(?:\s+(?:it|the\s+gate))?\s+(?:be\s+)?(?:on\s+)?(?:the\s+)?(left|right)\b/i)
  const latchBefore = text.match(/\b(left|right)(?:\s+side)?\s+latch\b/i)
  const latch = latchAfter ?? latchBefore
  if (latch) assign(spec, "latchSide", latch[1].toLowerCase(), statedTruth, utterance)

  const swing = text.match(/\bswings?\s+(?:it\s+)?((?:toward|towards|into|away\s+from|inward|outward|in|out)\b[^,.!?]*)/i)
  if (swing) assign(spec, "swing", swing[1].replace(/^towards\b/, "toward").trim(), statedTruth, utterance)

  const material = text.match(/\b(stainless steel|mild steel|aluminum|steel)\b/i)
  if (material) assign(spec, "material", material[1].toLowerCase(), statedTruth, utterance)
}

function questionFor(spec) {
  if (!spec.kind.value) return "What are we sketching—a gate or a simple rectangular frame?"
  if (!spec.height.value) return "How tall should it be?"
  if (spec.height.truth === "uncertain") return "Is that the finished height?"
  if (!spec.width.value) return "What is the finished width?"
  if (spec.width.truth === "uncertain") return "Is that the opening width or the finished piece itself?"
  if (!spec.stockSize.value) return "What stock size and material should it use?"
  if (spec.stockSize.truth === "uncertain") return "Can you confirm that stock size?"
  if (spec.kind.value === "gate" && spec.railCount.value == null) return "How should the inside be divided—rails, pickets, or open?"
  if (spec.kind.value === "gate" && !spec.hingeSide.value) return "Which side should carry the hinges?"
  if (spec.kind.value === "gate" && !spec.latchSide.value) return "Which side should carry the latch?"
  if (spec.kind.value === "gate" && !spec.swing.value) return "Which way should it swing?"
  return "The basic geometry is captured. Review every fact before exporting."
}

export function deriveCallSketch(utterances = []) {
  const spec = emptyCallSketchSpec()
  for (const utterance of [...utterances].sort((left, right) => Number(left.sequenceId ?? 0) - Number(right.sequenceId ?? 0))) {
    updateFromUtterance(spec, utterance)
  }
  spec.nextQuestion = questionFor(spec)
  const stated = (fact) => fact.value != null && truthRank(fact.truth) >= truthRank("stated")
  spec.readyForReview = Boolean(
    stated(spec.kind) && stated(spec.width) && stated(spec.height) && stated(spec.stockSize) &&
      (spec.kind.value !== "gate" || (stated(spec.railCount) && stated(spec.hingeSide) && stated(spec.latchSide))),
  )
  return spec
}

export function confirmedCallSketch(input, evidence = "Confirmed by shop owner") {
  const spec = emptyCallSketchSpec()
  const utterance = { transcript: evidence, track: "owner", sequenceId: null }
  const kind = input.kind === "frame" ? "frame" : "gate"
  const width = Number(input.width)
  const height = Number(input.height)
  const stockSize = Number(input.stockSize)
  const railCount = Number(input.railCount ?? 0)
  if (![width, height, stockSize].every((value) => Number.isFinite(value) && value > 0)) {
    throw new TypeError("Width, height, and stock size must be positive numbers.")
  }
  if (width > 1_200 || height > 1_200 || stockSize > 24) {
    throw new RangeError("Width, height, and stock size exceed the Call Sketch limits.")
  }
  if (!Number.isInteger(railCount) || railCount < 0 || railCount > 8) {
    throw new RangeError("Interior rails must be a whole number from 0 through 8.")
  }
  if (stockSize * 2 >= Math.min(width, height)) {
    throw new RangeError("Stock size must leave a positive opening inside the frame.")
  }
  assign(spec, "kind", kind, "confirmed", utterance)
  assign(spec, "width", width, "confirmed", utterance)
  assign(spec, "height", height, "confirmed", utterance)
  assign(spec, "stockSize", stockSize, "confirmed", utterance)
  assign(spec, "railCount", railCount, "confirmed", utterance)
  if (kind === "gate") {
    assign(spec, "hingeSide", input.hingeSide === "right" ? "right" : "left", "confirmed", utterance)
    assign(spec, "latchSide", input.latchSide === "left" ? "left" : "right", "confirmed", utterance)
    if (input.swing) assign(spec, "swing", String(input.swing).trim().slice(0, 120), "confirmed", utterance)
  }
  if (input.material) assign(spec, "material", String(input.material).trim().slice(0, 80), "confirmed", utterance)
  spec.nextQuestion = "Owner-confirmed concept sketch. Verify against the job before fabrication."
  spec.readyForReview = true
  return spec
}
