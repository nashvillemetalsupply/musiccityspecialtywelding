import { getSql } from "@/lib/db"
import { normalizeRecentDeliveryErrors, type DeliveryErrorRow, type RecentDeliveryError } from "@/lib/delivery-errors.mjs"

export async function listRecentDeliveryErrors(): Promise<RecentDeliveryError[]> {
  const sql = getSql()
  const rows = await sql`
    SELECT recent.occurred_at, recent.title, recent.error, recent.is_test
    FROM (
      SELECT COALESCE(n.delivery_last_attempt_at, n.created_at) AS occurred_at,
        n.title, n.delivery_error AS error,
        (
          COALESCE(l.is_test, false)
          OR COALESCE(p.is_test, false)
          OR lower(COALESCE(e.detail->>'isTest', 'false')) = 'true'
          OR lower(COALESCE(n.action_detail->>'isTest', 'false')) = 'true'
          OR EXISTS (
            SELECT 1 FROM calls c
            WHERE e.kind = ANY(ARRAY['call.in','call.missed','call.answered']::text[])
              AND c.twilio_sid = split_part(COALESCE(e.external_id, ''), ':', 1)
              AND (
                lower(COALESCE(c.detail->>'isTest', 'false')) = 'true'
                OR COALESCE(c.detail->>'callerName', '') LIKE '%[INTERNAL TEST]%'
              )
          )
        ) AS is_test
      FROM notifications n
      LEFT JOIN events e ON e.id = n.source_event_id
      LEFT JOIN leads l ON l.id = e.lead_id
      LEFT JOIN people p ON p.id = e.person_id
      WHERE n.delivery_error <> ''
        AND COALESCE(n.delivery_last_attempt_at, n.created_at) >= now() - interval '24 hours'
    ) recent
    WHERE recent.is_test = false
    ORDER BY recent.occurred_at DESC
    LIMIT 20` as DeliveryErrorRow[]
  return normalizeRecentDeliveryErrors(rows)
}
