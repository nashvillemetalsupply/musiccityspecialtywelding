const REFERENCE_QUESTION = Object.freeze({
  question: "Ask if 48 inches is the opening or the finished gate.",
  reason: "It changes hinge clearance, material, and fit.",
})

const FACT_LABELS = Object.freeze({
  "opening.clear_width": "Clear opening",
  "gate_leaf.finished_width": "Finished width",
  "gate_leaf.finished_height": "Finished height",
  "frame.stock_size": "Stock size",
  "frame.rail_count": "Inside rails",
  "gate.hinge_side": "Hinge side",
  "gate.latch_side": "Latch side",
  "frame.material": "Material",
  "gate.finish": "Finish",
})

const REQUIRED_GATE_FACTS = Object.freeze([
  { factKey: "gate_leaf.finished_width", critical: true },
  { factKey: "gate_leaf.finished_height", critical: true },
  { factKey: "frame.stock_size", critical: true },
  { factKey: "frame.rail_count", critical: true },
  { factKey: "gate.hinge_side", critical: true },
  { factKey: "gate.latch_side", critical: true },
  { factKey: "gate.finish", critical: false },
])

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

function activeDecisionByClaim(decisions) {
  const active = new Map()
  for (const decision of [...decisions].sort((left, right) => {
    const time = String(left.decidedAt ?? "").localeCompare(String(right.decidedAt ?? ""))
    return time || Number(left.id ?? 0) - Number(right.id ?? 0)
  })) active.set(Number(decision.claimId), decision)
  return active
}

function comparableValue(claim) {
  if (typeof claim.value !== "number" || !Number.isFinite(claim.value)) return `text:${String(claim.value)}`
  const unit = String(claim.unit ?? "").trim().toLowerCase()
  if (["ft", "foot", "feet"].includes(unit)) return `in:${claim.value * 12}`
  if (["in", "inch", "inches"].includes(unit)) return `in:${claim.value}`
  return `${unit}:${claim.value}`
}

export function deriveBuildDraft({ claims = [], decisions = [] } = {}) {
  const activeDecisions = activeDecisionByClaim(decisions)
  const visibleClaims = claims.filter((claim) => activeDecisions.get(Number(claim.id))?.state !== "rejected")
  const interpretationGroups = new Map()
  for (const claim of visibleClaims) {
    if (!claim.interpretationGroup) continue
    const group = interpretationGroups.get(claim.interpretationGroup) ?? []
    group.push(claim)
    interpretationGroups.set(claim.interpretationGroup, group)
  }

  const conflicts = []
  for (const [key, group] of interpretationGroups) {
    const confirmed = group.filter((claim) => activeDecisions.get(Number(claim.id))?.state === "shop-confirmed")
    if (group.length > 1 && confirmed.length !== 1) {
      conflicts.push({
        key,
        kind: "unresolved-reference",
        claimIds: group.map((claim) => Number(claim.id)).sort((left, right) => left - right),
      })
    }
  }


  const factGroups = new Map()
  for (const claim of visibleClaims) {
    if (claim.interpretationGroup) continue
    const key = `${claim.factKey}:${claim.reference ?? ""}`
    const group = factGroups.get(key) ?? []
    group.push(claim)
    factGroups.set(key, group)
  }
  for (const [key, group] of factGroups) {
    if (new Set(group.map(comparableValue)).size <= 1) continue
    const confirmed = group.filter((claim) => activeDecisions.get(Number(claim.id))?.state === "shop-confirmed")
    if (confirmed.length === 1) continue
    conflicts.push({
      key,
      kind: "different-values",
      claimIds: group.map((claim) => Number(claim.id)).sort((left, right) => left - right),
    })
  }

  const factRows = visibleClaims.map((claim) => {
    const decisionState = activeDecisions.get(Number(claim.id))?.state
    return {
      ...claim,
      label: FACT_LABELS[claim.factKey] ?? claim.factKey,
      state: decisionState === "shop-confirmed" ? "confirmed"
        : decisionState === "working-number" ? "working-number"
          : "heard-on-call",
    }
  })
  for (const requirement of REQUIRED_GATE_FACTS) {
    if (visibleClaims.some((claim) => claim.factKey === requirement.factKey)) continue
    factRows.push({
      factKey: requirement.factKey,
      label: FACT_LABELS[requirement.factKey] ?? requirement.factKey,
      state: "still-need",
      critical: requirement.critical,
    })
  }
  const fabricationBlockers = []
  for (const requirement of REQUIRED_GATE_FACTS.filter((fact) => fact.critical)) {
    const matching = factRows.filter((fact) => fact.factKey === requirement.factKey)
    if (matching.some((fact) => fact.state === "confirmed")) continue
    if (!matching.length || matching.every((fact) => fact.state === "still-need")) {
      fabricationBlockers.push(`${FACT_LABELS[requirement.factKey]}: Still need.`)
    } else if (matching.some((fact) => fact.state === "working-number")) {
      fabricationBlockers.push(`${FACT_LABELS[requirement.factKey]} is a Working number.`)
    } else {
      fabricationBlockers.push(`${FACT_LABELS[requirement.factKey]} is not shop-confirmed.`)
    }
  }

  return {
    claims: visibleClaims,
    decisions: [...activeDecisions.values()],
    conflicts,
    recommendedQuestion: conflicts.length ? { ...REFERENCE_QUESTION } : null,
    factRows,
    fabrication: {
      ready: conflicts.length === 0 && fabricationBlockers.length === 0,
      blockers: fabricationBlockers,
    },
  }
}

function competingClaims(claims, target) {
  if (target.interpretationGroup) {
    return claims.filter((claim) => claim.interpretationGroup === target.interpretationGroup)
  }
  return claims.filter((claim) =>
    claim.factKey === target.factKey && String(claim.reference ?? "") === String(target.reference ?? ""),
  )
}

export function applyBuildDecision(state, command) {
  const claimId = Number(command?.claimId)
  const target = state?.claims?.find((claim) => Number(claim.id) === claimId)
  if (!target) throw new RangeError("The proposed fact is not part of this draft.")
  if (!Number.isInteger(Number(command.actorId)) || Number(command.actorId) <= 0) {
    throw new TypeError("An owner is required to decide a build fact.")
  }
  const states = { confirm: "shop-confirmed", working: "working-number", reject: "rejected" }
  const nextState = states[command.kind]
  if (!nextState) throw new TypeError("Build facts can only be confirmed, carried as a working number, or rejected.")
  const base = {
    actorId: Number(command.actorId),
    purpose: String(command.purpose || "build-sheet"),
    decidedAt: String(command.decidedAt || new Date().toISOString()),
  }
  const newDecisions = [{ ...base, claimId, state: nextState }]
  if (nextState !== "rejected") {
    for (const claim of competingClaims(state.claims, target)) {
      if (Number(claim.id) !== claimId) newDecisions.push({ ...base, claimId: Number(claim.id), state: "rejected" })
    }
  }
  const decisions = [...(state.decisions ?? []), ...newDecisions]
  return { newDecisions, draft: deriveBuildDraft({ claims: state.claims, decisions }) }
}

export function lockBuildSheet(input) {
  const draft = deriveBuildDraft(input)
  if (draft.conflicts.length) throw new Error("Resolve every Doesn't match item before locking a Build Sheet.")
  const accepted = new Map(draft.decisions.map((decision) => [Number(decision.claimId), decision]))
  const facts = draft.claims.flatMap((claim) => {
    const decision = accepted.get(Number(claim.id))
    if (!decision || !["shop-confirmed", "working-number"].includes(decision.state)) return []
    return [{ ...claim, decisionState: decision.state }]
  })
  if (!facts.length) throw new Error("Confirm a fact or choose a Working number before locking a Build Sheet.")
  const jobId = Number(input.jobId)
  const sequence = Number(input.sequence)
  if (!Number.isInteger(jobId) || jobId <= 0 || !Number.isInteger(sequence) || sequence <= 0) {
    throw new TypeError("A Build Sheet needs a valid job and sequence number.")
  }
  if (!String(input.idempotencyKey ?? "").trim()) throw new TypeError("A lock receipt is required.")
  return deepFreeze({
    jobId,
    number: sequence,
    idempotencyKey: String(input.idempotencyKey),
    lockedAt: String(input.lockedAt || new Date().toISOString()),
    facts,
    fabrication: { ...draft.fabrication },
  })
}

function sameFactValue(left, right) {
  return comparableValue(left) === comparableValue(right)
}

export function classifyPaperwork({ manifests = [], sourceSheet, draft, releasedSheet = null } = {}) {
  const sourceFacts = new Map((sourceSheet?.facts ?? []).map((fact) => [fact.factKey, fact]))
  const releasedFacts = new Map((releasedSheet?.facts ?? []).map((fact) => [fact.factKey, fact]))
  return manifests.map((manifest) => {
    const dependencies = manifest.dependencies ?? []
    for (const factKey of dependencies) {
      const sourceFact = sourceFacts.get(factKey)
      if (releasedSheet && Number(releasedSheet.number) > Number(manifest.sourceBuildSheetNumber)) {
        const releasedFact = releasedFacts.get(factKey)
        if ((sourceFact || releasedFact) && (!sourceFact || !releasedFact || !sameFactValue(sourceFact, releasedFact))) {
          const measurement = typeof (releasedFact ?? sourceFact)?.value === "number"
          return {
            ...manifest,
            validForSource: true,
            status: measurement ? "old-numbers" : "needs-update",
            reason: `${FACT_LABELS[factKey] ?? factKey} changed.`,
          }
        }
        continue
      }
      const changedProposal = (draft?.claims ?? []).find((claim) =>
        claim.factKey === factKey && (!sourceFact || !sameFactValue(sourceFact, claim)),
      )
      if (changedProposal) {
        return {
          ...manifest,
          validForSource: true,
          status: "hold",
          reason: `${FACT_LABELS[factKey] ?? factKey} change needs review.`,
        }
      }
    }
    return { ...manifest, validForSource: true, status: "current", reason: "" }
  })
}
