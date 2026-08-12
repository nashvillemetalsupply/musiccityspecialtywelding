const CUSTOMER_FACTS = Object.freeze({
  "opening.clear_width": "Clear opening",
  "gate_leaf.finished_width": "Finished gate width",
  "gate_leaf.finished_height": "Finished gate height",
  "frame.stock_size": "Frame stock",
  "frame.rail_count": "Inside rails",
  "gate.hinge_side": "Hinge side",
  "gate.latch_side": "Latch side",
  "frame.material": "Material",
  "gate.finish": "Finish",
})

function factMap(sheet) {
  return new Map((sheet?.facts ?? []).map((fact) => [String(fact.factKey), fact]))
}

function requiredFact(facts, factKey) {
  const fact = facts.get(factKey)
  if (!fact) throw new Error(`Build Sheet is missing ${factKey}.`)
  return fact
}

function numericFact(facts, factKey) {
  const fact = requiredFact(facts, factKey)
  const value = Number(fact.value)
  if (!Number.isFinite(value)) throw new TypeError(`${factKey} must be a number.`)
  return value
}

function positiveNumericFact(facts, factKey) {
  const value = numericFact(facts, factKey)
  if (value <= 0) throw new RangeError(`${factKey} must be a positive number.`)
  return value
}

function sideFact(facts, factKey) {
  const value = String(requiredFact(facts, factKey).value).toLowerCase()
  if (!['left', 'right'].includes(value)) throw new RangeError(`${factKey} must be left or right.`)
  return value
}

export function projectBuildDrawing(sheet) {
  const facts = factMap(sheet)
  const sourceBuildSheetNumber = Number(sheet?.number)
  if (!Number.isInteger(sourceBuildSheetNumber) || sourceBuildSheetNumber <= 0) {
    throw new TypeError("A numbered locked Build Sheet is required.")
  }
  const width = positiveNumericFact(facts, "gate_leaf.finished_width")
  const height = positiveNumericFact(facts, "gate_leaf.finished_height")
  const stockSize = positiveNumericFact(facts, "frame.stock_size")
  const railCount = numericFact(facts, "frame.rail_count")
  if (!Number.isInteger(railCount) || railCount < 0 || railCount > 8) {
    throw new RangeError("frame.rail_count must be an integer between 0 and 8.")
  }
  if (stockSize * 2 >= Math.min(width, height)) {
    throw new RangeError("frame.stock_size must leave positive inside-frame geometry.")
  }
  return Object.freeze({
    sourceBuildSheetNumber,
    width,
    height,
    stockSize,
    railCount,
    hingeSide: sideFact(facts, "gate.hinge_side"),
    latchSide: sideFact(facts, "gate.latch_side"),
    fabricationReady: sheet?.fabrication?.ready === true,
  })
}

function displayValue(fact) {
  const unit = String(fact.unit ?? "").trim()
  if (!unit || unit === "count") return String(fact.value)
  const safeUnit = ["in", "inch", "inches"].includes(unit.toLowerCase()) ? "in" : unit
  return `${fact.value} ${safeUnit}`
}

function safeScope(sheet) {
  const facts = factMap(sheet)
  const material = String(facts.get("frame.material")?.value ?? "metal").trim().toLowerCase()
  return `${material || "metal"} gate`
}

export function createCustomerBuildProjection({ sheet, customerConfirmations = [] } = {}) {
  if (!sheet || !Number.isInteger(Number(sheet.number))) throw new TypeError("A locked Build Sheet is required.")
  const confirmations = new Map(customerConfirmations.map((response) => [
    Number(response.claimId),
    response,
  ]))
  const facts = (sheet.facts ?? []).flatMap((fact) => {
    const label = CUSTOMER_FACTS[fact.factKey]
    if (!label) return []
    const response = confirmations.get(Number(fact.id))
    return [{
      claimId: Number(fact.id),
      factKey: String(fact.factKey),
      label,
      value: displayValue(fact),
      reference: String(fact.reference ?? ""),
      state: response?.state === "accepted" ? "customer-confirmed"
        : response?.state === "corrected" ? "customer-correction-proposed"
          : String(fact.decisionState ?? "shop-confirmed"),
      respondedAt: response?.respondedAt ? String(response.respondedAt) : null,
    }]
  })
  let drawing = null
  try {
    const projected = projectBuildDrawing(sheet)
    drawing = {
      sourceBuildSheetNumber: projected.sourceBuildSheetNumber,
      width: projected.width,
      height: projected.height,
      stockSize: projected.stockSize,
      railCount: projected.railCount,
      hingeSide: projected.hingeSide,
      latchSide: projected.latchSide,
    }
  } catch {
    drawing = null
  }
  return Object.freeze({
    buildSheetNumber: Number(sheet.number),
    lockedAt: String(sheet.lockedAt ?? ""),
    scope: safeScope(sheet),
    drawing,
    facts,
  })
}

export function createCrewBuildProjection({ sheet, paperwork = [] } = {}) {
  return Object.freeze({
    buildSheetNumber: Number(sheet?.number),
    lockedAt: String(sheet?.lockedAt ?? ""),
    drawing: projectBuildDrawing(sheet),
    facts: createCustomerBuildProjection({ sheet }).facts.map(({ claimId, factKey, label, value, reference, state }) => ({
      claimId,
      factKey,
      label,
      value,
      reference,
      state,
    })),
    paperwork: paperwork.flatMap((item) => {
      if (item.status !== "current" || item.issueState !== "current") return []
      if (Number(item.sourceBuildSheetNumber) !== Number(sheet?.number)) return []
      return [{
        id: Number(item.id),
        label: String(item.label),
        sourceBuildSheetNumber: Number(item.sourceBuildSheetNumber),
      }]
    }),
  })
}

export function buildClarificationForSketch(spec = {}) {
  const width = spec?.width
  if (!Number.isFinite(Number(width?.value))) return null
  const evidence = String(width?.evidence ?? "").toLowerCase()
  if (/\b(clear\s+opening|opening\s+(?:width|size)|finished\s+(?:gate|width))\b/.test(evidence)) return null
  return Object.freeze({
    question: `Ask if ${Number(width.value)} inches is the opening or the finished gate.`,
    reason: "It changes hinge clearance, material, and fit.",
  })
}
