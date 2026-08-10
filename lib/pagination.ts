export function normalizePage(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 1
  return Math.max(1, Math.floor(numeric))
}

export function pageCountForTotal(total: unknown, pageSize: unknown) {
  const numericTotal = Number(total)
  const numericPageSize = Number(pageSize)
  const safeTotal = Number.isFinite(numericTotal) ? Math.max(0, Math.floor(numericTotal)) : 0
  const safePageSize = Number.isFinite(numericPageSize) ? Math.max(1, Math.floor(numericPageSize)) : 1
  return Math.max(1, Math.ceil(safeTotal / safePageSize))
}

export function clampPageToTotal(page: unknown, total: unknown, pageSize: unknown) {
  return Math.min(normalizePage(page), pageCountForTotal(total, pageSize))
}
