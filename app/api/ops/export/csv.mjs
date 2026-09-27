export const COLUMNS = [
  "public_id", "created_at", "first_name", "last_name", "phone", "email",
  "service", "message", "preferred_contact", "photo_count", "source", "gclid",
  "utm_source", "utm_medium", "utm_campaign", "landing_page", "referrer",
  "status", "status_reason", "first_response_at", "first_response_channel",
  "estimate_value_cents", "quoted_at", "won_at", "lost_at", "revenue_cents",
  "completed_at", "review_requested_at", "review_received",
  "email_delivery_status", "notes", "is_test",
]

const EXPORT_PAGE_SIZE = 500

export function ownerExportRefusal(operator) {
  if (operator?.role === "owner") return null
  return new Response("Owner access required.", { status: operator ? 403 : 401 })
}

function csvCell(value) {
  if (value === null || value === undefined) return ""
  let s = String(value)
  // Guard spreadsheet formula injection.
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

function streamCsv({ columns, filename, loadPage, rowToCsv, cursorFor }) {
  const encoder = new TextEncoder()
  let cursor = null
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`${columns.join(",")}\r\n`))
    },
    async pull(controller) {
      try {
        const rows = await loadPage(cursor)
        for (const row of rows) controller.enqueue(encoder.encode(`${rowToCsv(row)}\r\n`))
        if (rows.length < EXPORT_PAGE_SIZE) {
          controller.close()
          return
        }
        cursor = cursorFor(rows[rows.length - 1])
      } catch (error) {
        controller.error(error)
      }
    },
  })

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}

async function loadLeadPage(sql, cursor) {
  const selectedColumns = [...COLUMNS, "id", "created_at::text AS cursor_created_at"].join(", ")
  const query = cursor
    ? `SELECT ${selectedColumns} FROM leads
       WHERE is_test = false
         AND (created_at, id) < ($1::timestamptz, $2::bigint)
       ORDER BY created_at DESC, id DESC
       LIMIT $3::int`
    : `SELECT ${selectedColumns} FROM leads
       WHERE is_test = false
       ORDER BY created_at DESC, id DESC
       LIMIT $1::int`
  const values = cursor
    ? [cursor.timestamp, cursor.id, EXPORT_PAGE_SIZE]
    : [EXPORT_PAGE_SIZE]
  return sql.query(query, values)
}

async function loadGoogleConversionPage(sql, cursor) {
  const query = cursor
    ? `SELECT id, gclid, won_at, revenue_cents, won_at::text AS cursor_won_at FROM leads
       WHERE status = 'won' AND gclid <> '' AND won_at IS NOT NULL AND is_test = false
         AND (won_at, id) > ($1::timestamptz, $2::bigint)
       ORDER BY won_at ASC, id ASC
       LIMIT $3::int`
    : `SELECT id, gclid, won_at, revenue_cents, won_at::text AS cursor_won_at FROM leads
       WHERE status = 'won' AND gclid <> '' AND won_at IS NOT NULL AND is_test = false
       ORDER BY won_at ASC, id ASC
       LIMIT $1::int`
  const values = cursor
    ? [cursor.timestamp, cursor.id, EXPORT_PAGE_SIZE]
    : [EXPORT_PAGE_SIZE]
  return sql.query(query, values)
}

function googleConversionCsvRow(row) {
  const time = new Date(row.won_at).toISOString().replace("T", " ").slice(0, 19)
  const value = row.revenue_cents === null ? "" : (row.revenue_cents / 100).toFixed(2)
  return `${csvCell(row.gclid)},Won Job (Offline),${time}+00:00,${value},USD`
}

export function createExportResponse(sql, format = "full") {
  if (format === "google-oci") {
    return streamCsv({
      columns: [
        "Google Click ID", "Conversion Name", "Conversion Time", "Conversion Value", "Conversion Currency",
      ],
      filename: `mcsw-google-offline-conversions-${new Date().toISOString().slice(0, 10)}.csv`,
      loadPage: (cursor) => loadGoogleConversionPage(sql, cursor),
      rowToCsv: googleConversionCsvRow,
      cursorFor: (row) => ({ timestamp: row.cursor_won_at, id: row.id }),
    })
  }

  return streamCsv({
    columns: COLUMNS,
    filename: `mcsw-leads-${new Date().toISOString().slice(0, 10)}.csv`,
    loadPage: (cursor) => loadLeadPage(sql, cursor),
    rowToCsv: (row) => COLUMNS.map((column) => csvCell(row[column])).join(","),
    cursorFor: (row) => ({ timestamp: row.cursor_created_at, id: row.id }),
  })
}
