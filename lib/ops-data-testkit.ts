// Mirrors signal_counts: count distinct on-board jobs per signal kind, then
// provide an explicit zero for each kind that is absent from the result set.
export function signalCountsFromCandidates(rows: Array<{ lead_id: number; kind: "waiting" | "noreply" | "promise" | "followup" | "bounced" }>, boardLeadIds: Iterable<number>): Record<string, number> {
  const onBoard = new Set(boardLeadIds)
  const seen = { waiting: new Set(), noreply: new Set(), promise: new Set(), followup: new Set(), bounced: new Set() }
  for (const row of rows) {
    if (onBoard.has(row.lead_id)) seen[row.kind]?.add(row.lead_id)
  }
  return Object.fromEntries(Object.entries(seen).map(([kind, ids]) => [kind, ids.size]))
}
