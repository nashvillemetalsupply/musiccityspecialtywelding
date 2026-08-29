import { getSql } from "@/lib/db"
import { listOperators } from "@/lib/operators"
import { sendPushToOperator } from "@/lib/push"
import { isDefinitiveTwilioError, sendSms, twilioCallbackUrl, twilioSmsConfigured } from "@/lib/twilio"
import { getOperatorById, getOperatorByPhone } from "@/lib/operators"
import { formatSmsBody, normalizeUsPhone } from "@/lib/shop-brain-invariants.mjs"
import { clampPageToTotal, normalizePage } from "@/lib/pagination"
import { redactCrewText } from "@/lib/visibility"

export type NotificationPriority = "interrupt" | "digest"
export type NotificationStock = "white" | "green" | "manila" | "red" | "people"

export type NotificationRow = {
  id: number
  created_at: string
  operator_id: number | null
  priority: NotificationPriority
  stock: NotificationStock
  title: string
  body: string
  url: string
  sent_at: string | null
  read_at: string | null
  coalesced: boolean
  source_event_id: number | null
  owner_only: boolean
  action_kind: string
  action_detail: Record<string, unknown>
  budget_exempt: boolean
  sms_only: boolean
  source_kind: string | null
}

function centralMinuteOfDay() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date())
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0)
  return hour * 60 + minute
}

export async function notify(input: {
  operatorId: number
  priority: NotificationPriority
  stock?: NotificationStock
  title: string
  body?: string
  crewBody?: string
  url?: string
  sourceEventId?: number | null
  capExempt?: boolean
  quietHoursExempt?: boolean
  smsFallback?: boolean
  smsOnly?: boolean
  ownerOnly?: boolean
  actionKind?: string
  actionDetail?: Record<string, unknown>
  dedupeKey?: string
}) {
  const recipient = await getOperatorById(input.operatorId)
  if (!recipient || (input.ownerOnly && recipient.role !== "owner")) {
    return { id: 0, sent: false, reason: "not-for-role" as const }
  }
  const sql = getSql()
  // Test traffic may be recorded and exercised end-to-end, but it may never
  // cross the operator-alert boundary. Enforce that here—the only alert gate—
  // so a future ingestion path cannot accidentally buzz a real person.
  if (input.sourceEventId) {
    const source = (await sql`
      SELECT (
        COALESCE(l.is_test, false)
        OR COALESCE(p.is_test, false)
        OR lower(COALESCE(e.detail->>'isTest', 'false')) = 'true'
      ) AS is_test
      FROM events e
      LEFT JOIN leads l ON l.id = e.lead_id
      LEFT JOIN people p ON p.id = e.person_id
      WHERE e.id = ${input.sourceEventId}::bigint
      LIMIT 1`) as { is_test: boolean }[]
    if (source[0]?.is_test) return { id: 0, sent: false, reason: "internal-test" as const }
  }
  const storedBody = recipient.role === "crew"
    ? redactCrewText(input.crewBody ?? (input.sourceEventId ? "Open the work order for the crew-safe copy." : input.body ?? ""))
    : input.body ?? ""
  const dedupeKey = input.dedupeKey
    ? input.dedupeKey.slice(0, 240)
    : input.sourceEventId
      ? input.priority === "interrupt"
        ? `source:${input.sourceEventId}:interrupt`
        : `source:${input.sourceEventId}:${input.priority}:${input.stock ?? "white"}:${input.title.slice(0, 120)}`
      : ""
  const rows = (await sql`
    INSERT INTO notifications (
      operator_id, priority, stock, title, body, url, source_event_id, owner_only, dedupe_key,
      action_kind, action_detail, budget_exempt, delivery_status, quiet_hours_exempt, sms_fallback,
      sms_only
    ) VALUES (
      ${input.operatorId}::bigint,
      ${input.priority}::text,
      ${input.stock ?? "white"}::text,
      ${input.title.slice(0, 120)}::text,
      ${storedBody.slice(0, 500)}::text,
      ${(input.url ?? "").slice(0, 500)}::text,
      ${input.sourceEventId ?? null}::bigint,
      ${input.ownerOnly ?? false}::boolean,
      ${dedupeKey}::text,
      ${input.actionKind ?? ""}::text,
      ${JSON.stringify(input.actionDetail ?? {})}::jsonb,
      ${input.capExempt ?? false}::boolean,
      ${input.priority === "digest" ? "filed" : "pending"}::text,
      ${input.quietHoursExempt ?? false}::boolean,
      ${input.smsFallback ?? false}::boolean,
      ${input.smsOnly ?? false}::boolean
    ) ON CONFLICT (operator_id, dedupe_key) WHERE dedupe_key <> '' DO NOTHING
    RETURNING id`) as { id: number }[]
  if (!rows[0]) {
    if (input.priority === "interrupt" && input.sourceEventId) {
      await sql`
        UPDATE notifications SET
          stock = CASE WHEN ${input.stock ?? "white"}::text = 'red' THEN 'red' ELSE stock END,
          title = CASE WHEN ${input.stock ?? "white"}::text = 'red' THEN ${input.title.slice(0, 120)}::text ELSE title END,
          body = CASE WHEN ${input.stock ?? "white"}::text = 'red' THEN ${storedBody.slice(0, 500)}::text ELSE body END
        WHERE operator_id = ${input.operatorId}::bigint AND dedupe_key = ${dedupeKey}::text`
    }
    return { id: 0, sent: false, reason: "duplicate" as const }
  }
  const id = Number(rows[0].id)
  if (input.priority === "digest") return { id, sent: false, reason: "filed" as const }

  const centralMinute = centralMinuteOfDay()
  if (!input.quietHoursExempt && (centralMinute >= 19 * 60 || centralMinute < 6 * 60 + 30)) {
    await sql`UPDATE notifications SET delivery_status = 'filed' WHERE id = ${id}::bigint`
    return { id, sent: false, reason: "quiet-hours" as const }
  }

  if (!input.capExempt) {
    const reserved = (await sql`
      WITH held AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(${input.operatorId}::bigint)
      ), used AS MATERIALIZED (
        SELECT count(*)::int AS count
        FROM notifications, held
        WHERE operator_id = ${input.operatorId}::bigint
          AND priority = 'interrupt' AND budget_exempt = false AND coalesced = false
          AND (
            (sent_at IS NOT NULL AND timezone('America/Chicago', sent_at)::date = timezone('America/Chicago', now())::date)
            OR (interrupt_reserved_at IS NOT NULL AND interrupt_reserved_at > now() - interval '5 minutes'
              AND timezone('America/Chicago', interrupt_reserved_at)::date = timezone('America/Chicago', now())::date)
          )
      ), claim AS (
        UPDATE notifications SET interrupt_reserved_at = now()
        WHERE id = ${id}::bigint AND (SELECT count FROM used) < 3
        RETURNING id
      )
      SELECT EXISTS(SELECT 1 FROM claim) AS reserved`) as { reserved: boolean }[]
    if (!reserved[0]?.reserved) {
      const coalesced = (await sql`
        WITH held AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(${input.operatorId}::bigint)
        )
        UPDATE notifications SET coalesced = true, interrupt_reserved_at = now()
        FROM held
        WHERE id = ${id}::bigint
          AND NOT EXISTS (
            SELECT 1 FROM notifications
            WHERE operator_id = ${input.operatorId}::bigint
              AND priority = 'interrupt' AND coalesced = true
              AND (
                (sent_at IS NOT NULL AND timezone('America/Chicago', sent_at)::date = timezone('America/Chicago', now())::date)
                OR (interrupt_reserved_at > now() - interval '5 minutes'
                  AND timezone('America/Chicago', interrupt_reserved_at)::date = timezone('America/Chicago', now())::date)
              )
          )
        RETURNING id`) as { id: number }[]
      if (coalesced[0]) {
        const claimed = (await sql`
          UPDATE notifications SET delivery_status = 'sending', delivery_attempts = delivery_attempts + 1,
            delivery_last_attempt_at = now(), delivery_next_attempt_at = NULL, delivery_error = ''
          WHERE id = ${id}::bigint AND sent_at IS NULL AND delivery_status = 'pending'
          RETURNING id`) as { id: number }[]
        if (!claimed[0]) return { id, sent: false, reason: "already-claimed" as const }
        const push = await sendPushToOperator(input.operatorId, {
          title: "More happened. Check Updates.",
          body: "Updates has the details. Nothing was dropped.",
          url: "/board/updates",
        })
        if (push.sent > 0) {
          await sql`
            UPDATE notifications SET sent_at = now(), interrupt_reserved_at = NULL,
              delivery_status = CASE WHEN delivery_status IN ('delivered','dead') THEN delivery_status ELSE 'accepted' END,
              delivery_last_attempt_at = now()
            WHERE id = ${id}::bigint`
        } else {
          await sql`
            UPDATE notifications SET coalesced = false, interrupt_reserved_at = NULL,
              delivery_status = 'retry',
              delivery_last_attempt_at = now(), delivery_next_attempt_at = now() + interval '10 minutes',
              delivery_error = 'No registered push channel accepted the coalesced alert.'
            WHERE id = ${id}::bigint`
        }
      } else {
        await sql`UPDATE notifications SET delivery_status = 'filed' WHERE id = ${id}::bigint`
      }
      return { id, sent: false, reason: "daily-cap" as const }
    }
  }

  const claimed = (await sql`
    UPDATE notifications SET delivery_status = 'sending', delivery_attempts = delivery_attempts + 1,
      delivery_last_attempt_at = now(), delivery_next_attempt_at = NULL
    WHERE id = ${id}::bigint AND sent_at IS NULL AND delivery_status = 'pending'
    RETURNING id`) as { id: number }[]
  if (!claimed[0]) return { id, sent: false, reason: "already-claimed" as const }

  const push = input.smsOnly
    ? { sent: 0 }
    : await sendPushToOperator(input.operatorId, {
        title: input.title,
        body: storedBody,
        url: input.url ?? "/ops",
      })
  let sent = push.sent > 0
  let smsDeliveryUnknown = false
  const wantsSms = input.smsOnly || (!sent && input.smsFallback)
  // Why the SMS leg did not send. Every `interrupt` that parks for retry used to
  // record the same generic sentence, and the re-claim above used to blank it, so
  // the real reason was destroyed twice over. Owner-cell alerts were failing on
  // attempt one 100% of the time and no row could say why.
  let smsFailure = ""
  if (wantsSms) {
    if (!twilioSmsConfigured()) {
      smsFailure = "SMS channel not configured: TWILIO_SMS_ENABLED, messaging service, or webhook base URL is missing."
    } else {
      const operators = await listOperators()
      const operator = operators.find((item) => Number(item.id) === input.operatorId)
      if (!operator?.cell_phone) {
        smsFailure = `Operator ${input.operatorId} has no cell_phone on file.`
      } else {
        const smsBody = formatSmsBody({ title: input.title, body: storedBody, url: input.url, smsOnly: input.smsOnly })
        try {
          const sms = await sendSms({
            to: operator.cell_phone,
            body: smsBody,
            statusCallback: twilioCallbackUrl(`/api/twilio/notification-status?notification=${id}`),
          })
          await sql`UPDATE notifications SET provider_message_sid = COALESCE(provider_message_sid, ${sms.sid}::text),
            provider_status = COALESCE(provider_status, ${sms.status}::text) WHERE id = ${id}::bigint`
          sent = true
        } catch (error) {
          smsFailure = `Twilio send failed: ${error instanceof Error ? error.message : String(error)}`
          smsDeliveryUnknown = !isDefinitiveTwilioError(error)
        }
      }
    }
  }
  if (smsDeliveryUnknown) {
    await sql`UPDATE notifications SET sent_at = now(), interrupt_reserved_at = NULL,
      delivery_status = 'unknown',
      delivery_last_attempt_at = now(), delivery_next_attempt_at = NULL,
      delivery_error = ${`SMS fallback may have been accepted; automatic repeat is quarantined. ${smsFailure}`.trim().slice(0, 500)}::text,
      stock = 'red', title = left('Check alert delivery - ' || title, 120)
      WHERE id = ${id}::bigint`
    return { id, sent: false, reason: "delivery-unknown" as const }
  } else if (sent) {
    await sql`UPDATE notifications SET sent_at = now(), interrupt_reserved_at = NULL,
      delivery_status = CASE WHEN delivery_status IN ('delivered','dead') THEN delivery_status ELSE 'accepted' END,
      delivery_last_attempt_at = now(),
      delivery_error = CASE WHEN delivery_status = 'dead' THEN delivery_error ELSE '' END
      WHERE id = ${id}::bigint`
  } else {
    await sql`UPDATE notifications SET interrupt_reserved_at = NULL, delivery_status = 'retry',
      delivery_last_attempt_at = now(),
      delivery_next_attempt_at = now() + interval '10 minutes',
      delivery_error = ${(smsFailure || "No registered push or SMS fallback channel accepted the alert.").slice(0, 500)}::text
      WHERE id = ${id}::bigint`
  }
  return { id, sent, reason: sent ? ("sent" as const) : ("no-channel" as const) }
}

export async function notifyOwnerCellSms(input: {
  title: string
  body?: string
  url?: string
  sourceEventId?: number | null
  capExempt?: boolean
  quietHoursExempt?: boolean
  dedupeKey?: string
}) {
  const ownerCell = normalizeUsPhone(process.env.OWNER_CELL_PHONE ?? "")
  const recipient = ownerCell ? await getOperatorByPhone(ownerCell) : null
  if (!recipient || recipient.role !== "owner") {
    return { id: 0, sent: false, reason: "not-for-role" as const }
  }
  return notify({
    operatorId: recipient.id,
    priority: "interrupt",
    stock: "white",
    smsOnly: true,
    ownerOnly: true,
    ...input,
  })
}

export async function notifyAll(input: Omit<Parameters<typeof notify>[0], "operatorId">) {
  const operators = await listOperators()
  return Promise.all(operators.filter((operator) => !input.ownerOnly || operator.role === "owner").map((operator) => notify({ ...input, operatorId: operator.id })))
}

export async function retryPendingInterrupts(limit = 10) {
  const sql = getSql()
  await sql`
    UPDATE notifications SET sent_at = COALESCE(sent_at, now()), interrupt_reserved_at = NULL,
      delivery_status = 'unknown', delivery_next_attempt_at = NULL,
      delivery_error = 'A delivery attempt stopped before acknowledgement; the provider may have accepted it, so automatic repeat is quarantined.',
      stock = 'red', title = left('Check alert delivery - ' || title, 120)
    WHERE priority = 'interrupt' AND sent_at IS NULL AND delivery_status = 'sending'
      AND delivery_last_attempt_at < now() - interval '10 minutes'`
  const candidates = (await sql`
    SELECT id, operator_id, title, body, url, budget_exempt, quiet_hours_exempt, sms_fallback, sms_only
    FROM notifications
    WHERE priority = 'interrupt' AND sent_at IS NULL AND delivery_attempts < 5
      AND (
        (delivery_status = 'retry' AND (delivery_next_attempt_at IS NULL OR delivery_next_attempt_at <= now()))
        OR (delivery_status = 'pending' AND created_at < now() - interval '10 minutes')
      )
    ORDER BY COALESCE(delivery_next_attempt_at, created_at) ASC
    LIMIT ${Math.min(Math.max(limit, 1), 20)}::bigint`) as Array<{
      id: number; operator_id: number | null; title: string; body: string; url: string
      budget_exempt: boolean; quiet_hours_exempt: boolean; sms_fallback: boolean; sms_only: boolean
    }>
  let sent = 0
  let dead = 0
  for (const row of candidates) {
    if (!row.operator_id) continue
    const minute = centralMinuteOfDay()
    if (!row.quiet_hours_exempt && (minute >= 19 * 60 || minute < 6 * 60 + 30)) continue
    const claimed = (await sql`
      UPDATE notifications SET delivery_status = 'sending', delivery_attempts = delivery_attempts + 1,
        delivery_last_attempt_at = now(), delivery_next_attempt_at = NULL, delivery_error = ''
      WHERE id = ${row.id}::bigint AND sent_at IS NULL AND delivery_attempts < 5
        AND (delivery_status = 'retry' OR (delivery_status = 'pending' AND created_at < now() - interval '10 minutes'))
      RETURNING id`) as { id: number }[]
    if (!claimed[0]) continue
    if (!row.budget_exempt) {
      const reserved = (await sql`
        WITH held AS MATERIALIZED (SELECT pg_advisory_xact_lock(${row.operator_id}::bigint)), used AS MATERIALIZED (
          SELECT count(*)::int AS count FROM notifications, held
          WHERE operator_id = ${row.operator_id}::bigint AND priority = 'interrupt'
            AND budget_exempt = false AND coalesced = false
            AND (
              (sent_at IS NOT NULL AND timezone('America/Chicago', sent_at)::date = timezone('America/Chicago', now())::date)
              OR (interrupt_reserved_at IS NOT NULL AND interrupt_reserved_at > now() - interval '5 minutes'
                AND timezone('America/Chicago', interrupt_reserved_at)::date = timezone('America/Chicago', now())::date)
            )
        ), reservation AS (
          UPDATE notifications SET interrupt_reserved_at = now() WHERE id = ${row.id}::bigint AND (SELECT count FROM used) < 3 RETURNING id
        ) SELECT EXISTS(SELECT 1 FROM reservation) AS reserved`) as { reserved: boolean }[]
      if (!reserved[0]?.reserved) {
        const coalesced = (await sql`
          WITH held AS MATERIALIZED (SELECT pg_advisory_xact_lock(${row.operator_id}::bigint))
          UPDATE notifications SET coalesced = true, interrupt_reserved_at = now()
          FROM held
          WHERE id = ${row.id}::bigint AND NOT EXISTS (
            SELECT 1 FROM notifications
            WHERE operator_id = ${row.operator_id}::bigint AND priority = 'interrupt' AND coalesced = true
              AND (
                (sent_at IS NOT NULL AND timezone('America/Chicago', sent_at)::date = timezone('America/Chicago', now())::date)
                OR (interrupt_reserved_at > now() - interval '5 minutes'
                  AND timezone('America/Chicago', interrupt_reserved_at)::date = timezone('America/Chicago', now())::date)
              )
          ) RETURNING id`) as { id: number }[]
        if (!coalesced[0]) {
          await sql`UPDATE notifications SET delivery_status = 'filed', delivery_error = 'Daily interrupt budget was already full.' WHERE id = ${row.id}::bigint`
          continue
        }
        const summary = await sendPushToOperator(row.operator_id, { title: "More happened. Check Updates.", body: "The details are saved. Nothing was dropped.", url: "/board/updates#wire" })
        if (summary.sent > 0) {
          sent += 1
          await sql`UPDATE notifications SET sent_at = now(), interrupt_reserved_at = NULL,
            delivery_status = CASE WHEN delivery_status IN ('delivered','dead') THEN delivery_status ELSE 'accepted' END,
            delivery_last_attempt_at = now(), delivery_next_attempt_at = NULL, delivery_error = ''
            WHERE id = ${row.id}::bigint`
        } else {
          const summaryFailed = (await sql`UPDATE notifications SET coalesced = false, interrupt_reserved_at = NULL,
            delivery_last_attempt_at = now(),
            delivery_status = CASE WHEN delivery_attempts >= 5 THEN 'dead' ELSE 'retry' END,
            delivery_next_attempt_at = CASE WHEN delivery_attempts >= 5 THEN NULL ELSE now() + interval '30 minutes' END,
            delivery_error = 'The coalesced alert could not reach a registered push channel.',
            stock = CASE WHEN delivery_attempts >= 5 THEN 'red' ELSE stock END
            WHERE id = ${row.id}::bigint RETURNING delivery_status`) as { delivery_status: string }[]
          if (summaryFailed[0]?.delivery_status === "dead") dead += 1
        }
        continue
      }
    }
    const push = row.sms_only
      ? { sent: 0 }
      : await sendPushToOperator(row.operator_id, { title: row.title, body: row.body, url: row.url || "/ops" })
    let delivered = push.sent > 0
    let smsDeliveryUnknown = false
    const wantsSms = row.sms_only || (!delivered && row.sms_fallback)
    if (wantsSms && twilioSmsConfigured()) {
      const recipient = await getOperatorById(row.operator_id)
      if (recipient?.cell_phone) {
        const smsBody = formatSmsBody({ title: row.title, body: row.body, url: row.url, smsOnly: row.sms_only })
        try {
          const sms = await sendSms({
            to: recipient.cell_phone,
            body: smsBody,
            statusCallback: twilioCallbackUrl(`/api/twilio/notification-status?notification=${row.id}`),
          })
          await sql`UPDATE notifications SET provider_message_sid = COALESCE(provider_message_sid, ${sms.sid}::text),
            provider_status = COALESCE(provider_status, ${sms.status}::text) WHERE id = ${row.id}::bigint`
          delivered = true
        } catch (error) {
          smsDeliveryUnknown = !isDefinitiveTwilioError(error)
        }
      }
    }
    if (smsDeliveryUnknown) {
      await sql`UPDATE notifications SET sent_at = now(), interrupt_reserved_at = NULL,
        delivery_status = 'unknown',
        delivery_last_attempt_at = now(), delivery_next_attempt_at = NULL,
        delivery_error = 'SMS fallback may have been accepted; automatic repeat is quarantined.',
        stock = 'red', title = left('Check alert delivery - ' || title, 120)
        WHERE id = ${row.id}::bigint`
    } else if (delivered) {
      sent += 1
      await sql`UPDATE notifications SET sent_at = now(), interrupt_reserved_at = NULL,
        delivery_status = CASE WHEN delivery_status IN ('delivered','dead') THEN delivery_status ELSE 'accepted' END,
        delivery_last_attempt_at = now(), delivery_next_attempt_at = NULL,
        delivery_error = CASE WHEN delivery_status = 'dead' THEN delivery_error ELSE '' END
        WHERE id = ${row.id}::bigint`
    } else {
      const failed = (await sql`UPDATE notifications SET interrupt_reserved_at = NULL,
        delivery_last_attempt_at = now(),
        delivery_status = CASE WHEN delivery_attempts >= 5 THEN 'dead' ELSE 'retry' END,
        delivery_next_attempt_at = CASE WHEN delivery_attempts >= 5 THEN NULL ELSE now() + (LEAST(240, 10 * power(2, delivery_attempts - 1))::int || ' minutes')::interval END,
        delivery_error = 'No configured alert channel accepted this retry.',
        stock = CASE WHEN delivery_attempts >= 5 THEN 'red' ELSE stock END,
        title = CASE WHEN delivery_attempts >= 5 THEN left('Alert delivery failed - ' || title, 120) ELSE title END
        WHERE id = ${row.id}::bigint RETURNING delivery_status`) as { delivery_status: string }[]
      if (failed[0]?.delivery_status === "dead") dead += 1
    }
  }
  return { attempted: candidates.length, sent, dead }
}

export async function listWire(operatorId: number, role: "owner" | "crew", options: { unreadOnly?: boolean; page?: number; pageSize?: number; query?: string } = {}): Promise<{ items: NotificationRow[]; total: number; page: number; pageSize: number; hasNext: boolean }> {
  const sql = getSql()
  const unreadOnly = options.unreadOnly ?? true
  const requestedPage = normalizePage(options.page)
  const pageSize = Math.min(Math.max(Math.floor(options.pageSize ?? 50), 1), 100)
  const offset = (requestedPage - 1) * pageSize
  const query = options.query?.trim().slice(0, 100) ?? ""
  const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`
  const rows = (await sql`
    SELECT n.*, source.kind AS source_kind, count(*) OVER()::int AS total_count FROM notifications n
    LEFT JOIN events source ON source.id = n.source_event_id
    WHERE (n.operator_id IS NULL OR n.operator_id = ${operatorId}::bigint)
      AND (
        (${unreadOnly}::boolean = true AND n.read_at IS NULL) OR
        (${unreadOnly}::boolean = false AND n.read_at IS NOT NULL)
      )
      AND (${role}::text = 'owner' OR n.owner_only = false)
      AND (${query}::text = '' OR n.title ILIKE ${pattern}::text OR n.body ILIKE ${pattern}::text)
    ORDER BY n.created_at DESC
    LIMIT ${pageSize + 1}::bigint OFFSET ${offset}::bigint`) as Array<NotificationRow & { total_count: number }>
  const total = Number(rows[0]?.total_count ?? 0)
  if (rows.length === 0 && requestedPage > 1) {
    const firstPage = await listWire(operatorId, role, { ...options, page: 1, pageSize: 1 })
    if (firstPage.total === 0) return { items: [], total: 0, page: 1, pageSize, hasNext: false }
    return listWire(operatorId, role, { ...options, page: clampPageToTotal(requestedPage, firstPage.total, pageSize), pageSize })
  }
  const hasNext = rows.length > pageSize
  const items = rows.slice(0, pageSize).map(({ total_count, ...item }) => { void total_count; return item })
  return { items, total, page: requestedPage, pageSize, hasNext }
}

export async function countUnreadWire(operatorId: number, role: "owner" | "crew") {
  const sql = getSql()
  const rows = (await sql`
    SELECT count(*)::int AS count FROM notifications
    WHERE (operator_id IS NULL OR operator_id = ${operatorId}::bigint)
      AND read_at IS NULL
      AND (${role}::text = 'owner' OR owner_only = false)`) as { count: number }[]
  return Number(rows[0]?.count ?? 0)
}

export async function markWireRead(operatorId: number, ids: number[]) {
  if (!ids.length) return
  const sql = getSql()
  await sql`
    UPDATE notifications SET read_at = COALESCE(read_at, now())
    WHERE operator_id = ${operatorId}::bigint AND id = ANY(${ids.slice(0, 50)}::bigint[])`
}
