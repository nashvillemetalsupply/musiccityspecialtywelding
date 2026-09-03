import { BOARD_WEIGHTS } from "./shop-brain-invariants.mjs"

function sqlSignalWeight(kind, hoursLate, weights) {
  const base = weights.signal[kind]
  if (!base) return 0
  const late = Math.max(0, Number(hoursLate) || 0)
  return base * Math.min(
    weights.latenessCapMultiple,
    1 + late / weights.latenessHalfLifeHours,
  )
}

// Mirrors: jsonb_agg(... ORDER BY weight DESC, priority ASC) in needs.
export function boardSignalsFromCandidates(rows, weights = BOARD_WEIGHTS) {
  return rows
    .map((row) => ({
      kind: row.kind,
      reason: row.reason,
      hoursLate: row.hours_late,
      weight: sqlSignalWeight(row.kind, row.hours_late, weights),
      priority: row.priority,
    }))
    .sort((a, b) => b.weight - a.weight || a.priority - b.priority)
    .map((signal) => ({
      kind: signal.kind,
      reason: signal.reason,
      hoursLate: signal.hoursLate,
      weight: signal.weight,
    }))
}

// Mirrors: the signal_counts CTE — count(DISTINCT lead_id) per kind, over
// candidates joined to board, then defaulted so every kind reports a number.
export function signalCountsFromCandidates(rows, boardLeadIds) {
  const onBoard = new Set(boardLeadIds)
  const seen = { waiting: new Set(), noreply: new Set(), promise: new Set(), followup: new Set(), bounced: new Set() }
  for (const row of rows) {
    if (!onBoard.has(row.lead_id)) continue
    seen[row.kind]?.add(row.lead_id)
  }
  return Object.fromEntries(Object.entries(seen).map(([kind, ids]) => [kind, ids.size]))
}

// Mirrors the two ordered array_agg expressions that preserve the row selected
// by the legacy DISTINCT ON (lead_id) ordering.
export function aggregateNeedFromCandidates(rows) {
  const selected = rows.slice().sort((a, b) =>
    a.priority - b.priority || String(a.waiting_since).localeCompare(String(b.waiting_since))
  )[0]
  return {
    reason: selected?.reason,
    waitingSince: selected?.waiting_since,
  }
}

// Mirrors: round(signal_weight + value_points + repeat_points)::int in board.
export function sqlScoreParity(job, weights = BOARD_WEIGHTS) {
  const signalWeightTotal = (job.signals ?? [])
    .reduce((total, signal) => total + sqlSignalWeight(signal.kind, signal.hoursLate, weights), 0)
  const valueCents = Math.max(0, Number(job.valueCents) || 0)
  const priorJobs = Math.max(0, Number(job.priorJobs) || 0)
  const valuePoints = Math.min(weights.valueCapPoints, valueCents / weights.valueDivisorCents)
  const repeatPoints = Math.min(weights.repeatCapPoints, priorJobs * weights.repeatPointsPerPriorJob)
  return Math.round(signalWeightTotal + valuePoints + repeatPoints)
}

export function orderBoardFixtures(rows, order = "stage", weights = BOARD_WEIGHTS) {
  // Mirrors the SQL CASE, whose ELSE arm catches both ready and closed.
  const stageRank = { attention: 0, shop: 1, waiting: 2, ready: 3, closed: 3 }
  return rows
    .map((row) => ({ ...row, boardScore: sqlScoreParity(row, weights) }))
    .sort((a, b) => {
      if (order === "weight") {
        return b.boardScore - a.boardScore
          || a.boardSince.localeCompare(b.boardSince)
          || b.id - a.id
      }
      if (order === "newest") {
        // Mirrors: created_at DESC NULLS LAST, id DESC.
        return (a.createdAt == null ? 1 : 0) - (b.createdAt == null ? 1 : 0)
          || String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))
          || b.id - a.id
      }
      if (order === "oldest") {
        // Mirrors: board_since ASC NULLS LAST, id DESC. A job with no wait
        // timestamp sorts last, exactly as NULLS LAST does in SQL.
        return (a.boardSince == null ? 1 : 0) - (b.boardSince == null ? 1 : 0)
          || String(a.boardSince ?? "").localeCompare(String(b.boardSince ?? ""))
          || b.id - a.id
      }
      return stageRank[a.boardStage] - stageRank[b.boardStage]
        || (a.boardStage === "attention" ? a.boardSince.localeCompare(b.boardSince) : 0)
        || b.updatedAt.localeCompare(a.updatedAt)
        || b.id - a.id
    })
    .map((row) => row.id)
}
