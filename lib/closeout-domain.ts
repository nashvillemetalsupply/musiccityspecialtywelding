const COMPLETION_VALUES = new Set(["complete", "partial"])
const FIT_VALUES = new Set(["fit", "adjusted", "not-checked"])
const REWORK_VALUES = new Set(["yes", "no"])

function normalizedSentence(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

function inferCompletion(lower) {
  if (/\b(still need|remaining|not (?:finished|complete)|partial|left to)\b/.test(lower)) return "partial"
  if (/\b(finished|complete|completed|done)\b/.test(lower)) return "complete"
  return "partial"
}

function inferFit(lower) {
  if (/\b(not checked|didn['’]t check|fit unknown)\b/.test(lower)) return "not-checked"
  if (/\b(adjusted|adjustment|tuned|shimm?ed)\b/.test(lower)) return "adjusted"
  if (/\bfit(?:s|ted)?\s+(?:good|well)|good fit\b/.test(lower)) return "fit"
  return "not-checked"
}

function inferExtraTrips(lower) {
  if (/\bno (?:extra|additional|return) trips?\b/.test(lower)) return 0
  const numeric = lower.match(/\b(\d+)\s+(?:extra|additional|return) trips?\b/)
  if (numeric) return Number(numeric[1])
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5 }
  const word = lower.match(/\b(one|two|three|four|five)\s+(?:extra|additional|return) trips?\b/)
  return word ? words[word[1]] : 0
}

function inferRework(lower) {
  if (/\bno\b[^.!?]{0,40}\brework\b/.test(lower)) return "no"
  if (/\b(rework|reworked|redid|re-did|remade)\b/.test(lower)) return "yes"
  return "no"
}

function inferRemainingWork(source) {
  const match = source.match(/\b(?:still need(?:s|ed)?(?: to)?|remaining(?: work)?(?: is|:)?|left to)\s+([^.!?]+)/i)
  return match ? normalizedSentence(match[1]) : ""
}

function inferAsBuiltDifferences(source) {
  const match = source.match(/\b(?:reworked|adjusted|changed|moved|remade)\s+([^.!?]+)/i)
  return match ? normalizedSentence(match[0]) : ""
}

export function deriveCloseoutDraft(sourceWords) {
  const source = normalizedSentence(sourceWords)
  const lower = source.toLowerCase()
  return Object.freeze({
    completion: inferCompletion(lower),
    fit: inferFit(lower),
    extraTrips: inferExtraTrips(lower),
    rework: inferRework(lower),
    asBuiltDifferences: inferAsBuiltDifferences(source),
    remainingWork: inferRemainingWork(source),
    sourceWords: source,
    reviewed: false,
  })
}

export function validateCloseoutReview(review) {
  if (review?.reviewed !== true) throw new Error("Review the closeout outcomes before filing completion.")
  if (!COMPLETION_VALUES.has(review.completion)) throw new TypeError("Choose whether the work is complete or partial.")
  if (!FIT_VALUES.has(review.fit)) throw new TypeError("Choose the final fit outcome.")
  if (!Number.isInteger(Number(review.extraTrips)) || Number(review.extraTrips) < 0) {
    throw new TypeError("Extra trips must be a whole number of zero or more.")
  }
  if (!REWORK_VALUES.has(review.rework)) throw new TypeError("Choose whether rework happened.")
  const remainingWork = normalizedSentence(review.remainingWork)
  const sourceWords = normalizedSentence(review.sourceWords)
  if (!sourceWords) throw new Error("Say or type the one-breath closeout before review.")
  if (review.completion === "complete" && remainingWork) throw new Error("Complete cannot include remaining work. Keep the job partial.")
  if (review.completion === "partial" && !remainingWork) throw new Error("Partial work needs a short remaining-work note.")
  return Object.freeze({
    completion: review.completion,
    fit: review.fit,
    extraTrips: Number(review.extraTrips),
    rework: review.rework,
    asBuiltDifferences: normalizedSentence(review.asBuiltDifferences),
    remainingWork,
    sourceWords,
    reviewed: true,
  })
}
