import { getSql } from "@/lib/db"
import { normalizeRecentDeliveryErrors, type DeliveryErrorRow, type RecentDeliveryError } from "@/lib/delivery-errors.mjs"
import type { AlertFailureRow, HealthDeliveryErrorRow } from "@/lib/alert-failure-classifier.mjs"

// The Updates page shows owners every recent delivery error, including the
// ones health treats as diagnostic. Health reads listHealthDeliveryErrors.
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

// Same window and test classifier as listRecentDeliveryErrors, plus what the
// classifier needs: whether another operator's copy of the same alert
// (notifyAll writes one row per owner under one dedupe_key) was accepted or
// delivered, the alert's source, and the last Twilio error code on file.
export async function listHealthDeliveryErrors(): Promise<HealthDeliveryErrorRow[]> {
  const sql = getSql()
  return await sql`
    SELECT recent.occurred_at, recent.title, recent.error, recent.is_test,
      recent.operator_id, recent.source, recent.provider_error_code, recent.sibling_delivered
    FROM (
      SELECT COALESCE(n.delivery_last_attempt_at, n.created_at) AS occurred_at,
        n.title, n.delivery_error AS error, n.operator_id,
        COALESCE(n.action_detail->>'source', '') AS source,
        COALESCE(n.delivery_history->-1->'payload'->>'code', '') AS provider_error_code,
        EXISTS (
          SELECT 1 FROM notifications sibling
          WHERE n.dedupe_key <> ''
            AND sibling.dedupe_key = n.dedupe_key
            AND sibling.operator_id IS DISTINCT FROM n.operator_id
            AND sibling.delivery_status = ANY(ARRAY['accepted','delivered']::text[])
        ) AS sibling_delivered,
        (
          n.is_test
          OR COALESCE(l.is_test, false)
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
    LIMIT 20` as HealthDeliveryErrorRow[]
}

// Dead, unread, non-test alerts from the last year: the rows health used to
// count directly. summarizeDeadNotifications decides which of them count.
export async function listDeadNotificationRows(): Promise<AlertFailureRow[]> {
  const sql = getSql()
  return await sql`
    SELECT n.id, n.operator_id, n.created_at, n.delivery_error AS error,
      COALESCE(n.action_detail->>'source', '') AS source,
      COALESCE(n.delivery_history->-1->'payload'->>'code', '') AS provider_error_code,
      EXISTS (
        SELECT 1 FROM notifications sibling
        WHERE n.dedupe_key <> ''
          AND sibling.dedupe_key = n.dedupe_key
          AND sibling.operator_id IS DISTINCT FROM n.operator_id
          AND sibling.delivery_status = ANY(ARRAY['accepted','delivered']::text[])
      ) AS sibling_delivered
    FROM notifications n
    LEFT JOIN events e ON e.id = n.source_event_id
    LEFT JOIN leads l ON l.id = e.lead_id
    LEFT JOIN people p ON p.id = e.person_id
    WHERE n.delivery_status = 'dead' AND n.read_at IS NULL
      AND n.created_at >= now() - interval '1 year'
      AND n.is_test = false
      AND COALESCE(l.is_test, false) = false
      AND COALESCE(p.is_test, false) = false
      AND lower(COALESCE(e.detail->>'isTest', 'false')) <> 'true'
      AND lower(COALESCE(n.action_detail->>'isTest', 'false')) <> 'true'
    ORDER BY n.created_at DESC LIMIT 10000` as AlertFailureRow[]
}
