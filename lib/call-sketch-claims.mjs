// The other half of the shop's ears.
//
// Two things read every call transcript. `deriveCallSketch` is a pile of
// regexes written against imagined phrasings; the AI extractor in `extract.ts`
// is a language model reading the whole conversation at once. On the same
// transcripts, the extractor wins, and it has been winning into a table nobody
// showed. On the shop's one real customer gate call it recorded
// `gate_width: "26 inches"`, `gate_height: "8 inches"` and
// `gate_material: "steel"`; the regex engine took the first two only as
// hedges and the material not at all.
//
// So the sketch reads both. The extractor's facts are free-form — the same
// measurement has come back as `gate_width`, `gate_width_inches` and
// `gate_frame_tubing_width` across three calls — so nothing here matches a
// predicate by name. It matches by what the name is about.
//
// Everything this produces is `uncertain`, always, and that is not a hedge
// about model quality. It is the product rule: speech recognition output is
// never promoted to confirmed geometry, and DXF export stays locked until the
// owner reviews the numbers himself. `assign` in call-sketch-live.mjs refuses
// to lower a fact's truth, so a measurement the customer stated plainly enough
// for the regexes to catch outranks anything here.

const INCHES_PER_FOOT = 12

// Order matters: the first pattern that matches a predicate owns it, so the
// narrow readings are tested before the broad ones.
const PREDICATE_PATTERNS = [
  // An opening is the hole in the fence, not the gate that hangs in it. The
  // extractor reports both; only the finished piece is the width.
  { key: "width", pattern: /opening/i, opening: true },
  { key: "stockSize", pattern: /tub(?:e|ing)|stock|wall_thickness/i },
  { key: "railCount", pattern: /rail/i },
  { key: "hingeSide", pattern: /hinge/i },
  { key: "latchSide", pattern: /latch/i },
  { key: "swing", pattern: /swing/i },
  { key: "material", pattern: /material|metal_type/i },
  { key: "width", pattern: /width|wide/i },
  { key: "height", pattern: /height|tall|high/i },
]

const NUMERIC_KEYS = new Set(["width", "height", "stockSize", "railCount"])
const SIDE_KEYS = new Set(["hingeSide", "latchSide"])

// "26 inches", "2 inches", "47.5 inches", 48, "3", "6 feet", "1 1/2 inch".
function toInches(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  const text = String(raw ?? "").toLowerCase().trim()
  if (!text) return null
  const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)/)
  const fraction = text.match(/^(\d+)\/(\d+)/)
  const plain = text.match(/-?\d+(?:\.\d+)?/)
  let value = null
  if (mixed) value = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  else if (fraction) value = Number(fraction[1]) / Number(fraction[2])
  else if (plain) value = Number(plain[0])
  if (value == null || !Number.isFinite(value)) return null
  if (/\b(feet|foot|ft)\b|'/.test(text)) value *= INCHES_PER_FOOT
  return value
}

function toSide(raw) {
  const text = String(raw ?? "").toLowerCase()
  if (/\bleft\b/.test(text)) return "left"
  if (/\bright\b/.test(text)) return "right"
  return null
}

function toWords(raw) {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim()
  return text ? text.slice(0, 60) : null
}

// A claim reads as this call describing a gate when the extractor filed it
// under one. `gate_` is tested first, so the "frame" inside `gate_frame_rails`
// is part of the gate and not a rectangular frame of its own.
function kindFromPredicates(predicates) {
  if (predicates.some((predicate) => /^gate(_|$)/i.test(predicate))) return "gate"
  if (predicates.some((predicate) => /^(frame|panel)(_|$)/i.test(predicate))) return "frame"
  return null
}

/**
 * Reads a call's extracted claims into sketch facts. Returns a plain object of
 * sketch keys to values — no truth, no evidence; the caller decides how to
 * fold them in.
 */
export function sketchValuesFromClaims(rows) {
  const claims = Array.isArray(rows) ? rows : []
  const chosen = {}
  const evidence = {}
  const openingOnly = {}
  for (const row of claims) {
    const predicate = String(row?.predicate ?? "")
    if (!predicate) continue
    const match = PREDICATE_PATTERNS.find((candidate) => candidate.pattern.test(predicate))
    if (!match) continue
    const key = match.key
    let value = null
    if (NUMERIC_KEYS.has(key)) value = toInches(row.value)
    else if (SIDE_KEYS.has(key)) value = toSide(row.value)
    else value = toWords(row.value)
    if (value == null || value === "") continue
    if (key === "railCount") value = Math.min(8, Math.max(0, Math.round(value)))
    // The opening is only the width when no finished width was ever given.
    if (match.opening) {
      if (openingOnly[key] == null) { openingOnly[key] = value; evidence[`opening:${key}`] = predicate }
      continue
    }
    if (chosen[key] == null) { chosen[key] = value; evidence[key] = predicate }
  }
  for (const [key, value] of Object.entries(openingOnly)) {
    if (chosen[key] == null) { chosen[key] = value; evidence[key] = evidence[`opening:${key}`] }
  }
  const kind = kindFromPredicates(claims.map((row) => String(row?.predicate ?? "")))
  if (kind && chosen.kind == null) { chosen.kind = kind; evidence.kind = "gate_*" }
  return { values: chosen, evidence }
}

/**
 * Folds a call's claims into a spec, without ever overruling what the call
 * itself stated. Returns a new spec; the input is untouched.
 */
export function mergeClaimFacts(spec, rows) {
  const { values, evidence } = sketchValuesFromClaims(rows)
  // A measurement belongs to the thing it measures. One caller described
  // stainless tanks and the extractor filed
  // `customer_mentioned_product_width_narrow: "34.75 inches"` — a real width,
  // of no gate. Unless this call described a gate or a frame, its numbers are
  // not this drawing's numbers, and they stay in the fallback list where the
  // call put them.
  const describesShape = values.kind != null || spec?.kind?.value != null
  if (!describesShape) return spec
  const merged = { ...spec }
  let changed = false
  for (const [key, value] of Object.entries(values)) {
    const current = merged[key]
    // Only an unknown slot. A stated or confirmed fact is the call's own word
    // and a second uncertain reading of it is noise; an existing uncertain one
    // already came from the transcript, which is closer to the customer.
    if (!current || current.truth !== "unknown" || current.value != null) continue
    merged[key] = {
      value,
      truth: "uncertain",
      evidence: `heard on the call (${evidence[key]})`,
      track: "",
      sequenceId: null,
    }
    changed = true
  }
  return changed ? merged : spec
}
