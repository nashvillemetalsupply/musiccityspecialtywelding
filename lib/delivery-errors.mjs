const RECENT_ERROR_WINDOW_MS = 24 * 60 * 60 * 1000

export function normalizeRecentDeliveryErrors(rows, nowMs = Date.now()) {
  const cutoff = nowMs - RECENT_ERROR_WINDOW_MS
  return rows
    .filter((row) => {
      const timestamp = new Date(row.occurred_at).getTime()
      return !row.is_test
        && Number.isFinite(timestamp)
        && timestamp >= cutoff
        && timestamp <= nowMs
        && typeof row.error === "string"
        && row.error.trim() !== ""
        && ![row.title, row.error].some((value) => value?.includes("[INTERNAL TEST]"))
    })
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
    .slice(0, 20)
    .map((row) => ({
      at: new Date(row.occurred_at).toISOString(),
      title: String(row.title || "Delivery issue").slice(0, 120),
      error: row.error.slice(0, 500),
    }))
}

