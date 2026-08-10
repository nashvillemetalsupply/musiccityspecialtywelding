import { getSql } from "@/lib/db"
import type { OperatorRole } from "@/lib/operators"
import { clampPageToTotal, normalizePage } from "@/lib/pagination"

export type WallCommitment = {
  id: number
  lead_id: number | null
  summary: string
  due_at: string | null
  confidence: number
  confirmed_by: number | null
  source_event_id: number
  first_name: string
  last_name: string
}

export type RegularAccount = {
  person_id: number
  label: string
  company: string
  job_count: number
  live_count: number
}

export async function listWallCommitments(role: OperatorRole, options: { page?: number; pageSize?: number } = {}): Promise<{ items: WallCommitment[]; total: number; page: number; pageSize: number; hasNext: boolean }> {
  const sql = getSql()
  const requestedPage = normalizePage(options.page)
  const pageSize = Math.min(Math.max(Math.floor(options.pageSize ?? 12), 1), 50)
  const offset = (requestedPage - 1) * pageSize
  const rows = (await sql`
    SELECT c.id, c.lead_id,
      CASE WHEN ${role}::text = 'owner' THEN c.summary
        ELSE COALESCE(c.crew_summary, 'Promise detail is owner-only until MCSW Jobs prepares a crew-safe copy.') END AS summary,
      c.due_at, c.confidence, c.confirmed_by,
      c.source_event_id, COALESCE(l.first_name, '') AS first_name,
      COALESCE(l.last_name, '') AS last_name,
      count(*) OVER()::int AS total_count
    FROM commitments c
    LEFT JOIN leads l ON l.id = c.lead_id
    WHERE c.status = 'open'
      AND (c.due_at IS NULL OR c.due_at < now() + interval '1 day')
      AND (l.is_test = false OR l.is_test IS NULL)
    ORDER BY c.due_at ASC NULLS LAST, c.created_at DESC
    LIMIT ${pageSize + 1}::bigint OFFSET ${offset}::bigint`) as Array<WallCommitment & { total_count: number }>
  const total = Number(rows[0]?.total_count ?? 0)
  if (rows.length === 0 && requestedPage > 1) {
    const firstPage = await listWallCommitments(role, { page: 1, pageSize: 1 })
    if (firstPage.total === 0) return { items: [], total: 0, page: 1, pageSize, hasNext: false }
    return listWallCommitments(role, { page: clampPageToTotal(requestedPage, firstPage.total, pageSize), pageSize })
  }
  const hasNext = rows.length > pageSize
  const items = rows.slice(0, pageSize).map(({ total_count, ...item }) => { void total_count; return item })
  return { items, total, page: requestedPage, pageSize, hasNext }
}

export async function listTicketDueCommitments(leadIds: number[], role: OperatorRole) {
  const ids = [...new Set(leadIds.filter((id) => Number.isInteger(id) && id > 0))]
  if (!ids.length) return [] as WallCommitment[]
  const sql = getSql()
  return (await sql`
    SELECT DISTINCT ON (c.lead_id) c.id, c.lead_id,
      CASE WHEN ${role}::text = 'owner' THEN c.summary
        ELSE COALESCE(c.crew_summary, 'Promise detail is owner-only until MCSW Jobs prepares a crew-safe copy.') END AS summary,
      c.due_at, c.confidence, c.confirmed_by, c.source_event_id,
      COALESCE(l.first_name, '') AS first_name, COALESCE(l.last_name, '') AS last_name
    FROM commitments c JOIN leads l ON l.id = c.lead_id
    WHERE c.lead_id = ANY(${ids}::bigint[]) AND c.status = 'open'
      AND (c.due_at IS NULL OR c.due_at < now() + interval '1 day')
      AND l.is_test = false
    ORDER BY c.lead_id, c.due_at ASC NULLS LAST, c.created_at DESC`) as WallCommitment[]
}

export async function listRegularAccounts(options: { page?: number; pageSize?: number; query?: string } = {}): Promise<{ items: RegularAccount[]; total: number; page: number; pageSize: number; hasNext: boolean }> {
  const sql = getSql()
  const requestedPage = normalizePage(options.page)
  const pageSize = Math.min(Math.max(Math.floor(options.pageSize ?? 10), 1), 50)
  const offset = (requestedPage - 1) * pageSize
  const query = options.query?.trim().slice(0, 100) ?? ""
  const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`
  const rows = (await sql`
    SELECT p.account_key,
      min(p.id)::bigint AS person_id,
      COALESCE(max(NULLIF(p.company, '')), max(NULLIF(p.display_name, '')), 'Regular') AS label,
      COALESCE(max(NULLIF(p.company, '')), '') AS company,
      count(l.id)::int AS job_count,
      count(l.id) FILTER (WHERE l.completed_at IS NULL AND l.status NOT IN ('lost','spam'))::int AS live_count,
      max(COALESCE(l.updated_at, p.created_at)) AS last_job_at,
      bool_or(p.is_regular) AS forced,
      count(*) OVER()::int AS total_count
    FROM people p
    LEFT JOIN leads l ON l.person_id = p.id AND l.is_test = false
    WHERE p.merged_into IS NULL AND p.is_test = false AND p.account_key <> ''
    GROUP BY p.account_key
    HAVING (count(l.id) >= 2 OR bool_or(p.is_regular))
      AND (${query}::text = '' OR bool_or(p.company ILIKE ${pattern}::text OR p.display_name ILIKE ${pattern}::text OR p.account_key ILIKE ${pattern}::text))
    ORDER BY count(l.id) DESC, max(COALESCE(l.updated_at, p.created_at)) DESC
    LIMIT ${pageSize + 1}::bigint OFFSET ${offset}::bigint`) as Array<RegularAccount & { account_key: string; total_count: number }>
  const total = Number(rows[0]?.total_count ?? 0)
  if (rows.length === 0 && requestedPage > 1) {
    const firstPage = await listRegularAccounts({ ...options, page: 1, pageSize: 1 })
    if (firstPage.total === 0) return { items: [], total: 0, page: 1, pageSize, hasNext: false }
    return listRegularAccounts({ ...options, page: clampPageToTotal(requestedPage, firstPage.total, pageSize), pageSize })
  }
  const hasNext = rows.length > pageSize
  const items = rows.slice(0, pageSize).map(({ total_count, ...row }) => {
    void total_count
    return { ...row, person_id: Number(row.person_id), job_count: Number(row.job_count), live_count: Number(row.live_count) }
  })
  return { items, total, page: requestedPage, pageSize, hasNext }
}
