import { getSql } from "@/lib/db"
import { normalizePaymentReversalInput } from "@/lib/payment-reversal.mjs"

export type QuickBooksPaymentInput = {
  leadId: number
  sourceEventId: number
  occurredAt: string
  amountCents: number | null
  invoiceNumber: string | null
  invoiceTotalCents: number | null
  balanceCents: number | null
  explicitFullPayment: boolean
  isTest: boolean
  actorType?: "operator" | "system"
  actorId?: string | number | null
  body: string
}

export type QuickBooksPaymentResult = {
  receiptEventId: number
  paidEventId: number | null
  paidTotalCents: number
  fullyPaid: boolean
  duplicate: boolean
}

export type PaymentReversalInput = {
  leadId: number
  operatorId: string | number
  amountCents: number
  reason: string
  idempotencyKey: string
}

export type PaymentReversalResult = {
  eventId: number
  netPaidCents: number
  duplicate: boolean
}

// Project one authenticated QuickBooks receipt through the same locked balance
// that manual cash/check/card receipts update. The immutable receipt is written
// before the lead projection inside one statement, so neither arrival order nor
// a crash can lose money already recorded in Shop Brain.
export async function applyQuickBooksPayment(input: QuickBooksPaymentInput): Promise<QuickBooksPaymentResult> {
  const sql = getSql()
  const amountCents = Number.isFinite(Number(input.amountCents)) ? Math.max(0, Number(input.amountCents)) : 0
  const invoiceTotalCents = Number.isFinite(Number(input.invoiceTotalCents)) && Number(input.invoiceTotalCents) > 0
    ? Number(input.invoiceTotalCents)
    : null
  const receiptExternalId = `quickbooks-payment:${input.sourceEventId}`
  const paidExternalId = `quickbooks-paid:${input.sourceEventId}`
  const actorType = input.actorType ?? "system"
  const actorId = String(input.actorId ?? "")
  const body = `${input.isTest ? "[INTERNAL TEST] " : ""}${input.body}`

  const rows = (await sql`
    WITH target AS MATERIALIZED (
      SELECT id, person_id, is_test,
        COALESCE(paid_amount_cents, 0::bigint) AS current_paid_cents,
        invoice_total_cents, revenue_cents
      FROM leads
      WHERE id = ${input.leadId}::bigint AND is_test = ${input.isTest}::boolean
      FOR UPDATE
    ), existing_receipt AS MATERIALIZED (
      SELECT e.id, e.lead_id, e.kind, e.detail,
        EXISTS (
          SELECT 1 FROM events reversal
          WHERE reversal.kind = 'payment.reversed' AND reversal.lead_id = e.lead_id
            AND reversal.id > e.id
        ) AS reversed_after,
        (e.kind = 'invoice.paid' OR lower(COALESCE(e.detail->>'fullyPaid', 'false')) = 'true') AS fully_paid
      FROM events e
      WHERE e.lead_id = ${input.leadId}::bigint
        AND e.kind = ANY(ARRAY['invoice.payment-received','invoice.paid']::text[])
        AND (
          e.external_id = ${receiptExternalId}::text
          OR e.detail->>'sourceEventId' = ${String(input.sourceEventId)}::text
        )
      ORDER BY CASE WHEN e.kind = 'invoice.payment-received' THEN 0 ELSE 1 END, e.id ASC
      LIMIT 1
    ), calculation AS MATERIALIZED (
      SELECT t.*,
        t.current_paid_cents + ${amountCents}::bigint AS paid_total_cents,
        COALESCE(t.invoice_total_cents, ${invoiceTotalCents}::bigint) AS trusted_total_cents,
        (${input.explicitFullPayment}::boolean OR ${input.balanceCents === 0}::boolean OR (
          COALESCE(t.invoice_total_cents, ${invoiceTotalCents}::bigint) IS NOT NULL
          AND t.current_paid_cents + ${amountCents}::bigint >= COALESCE(t.invoice_total_cents, ${invoiceTotalCents}::bigint)
        )) AS fully_paid
      FROM target t
    ), receipt_write AS (
      INSERT INTO events (
        occurred_at, kind, actor_type, actor_id, lead_id, person_id,
        external_id, body, crew_body, detail
      )
      SELECT ${input.occurredAt}::timestamptz, 'invoice.payment-received'::text,
        ${actorType}::text, ${actorId}::text, c.id, c.person_id,
        ${receiptExternalId}::text, ${body}::text, NULL::text,
        jsonb_build_object(
          'sourceEventId', ${input.sourceEventId}::bigint,
          'amountCents', ${amountCents}::bigint,
          'paidTotalCents', c.paid_total_cents,
          'invoiceNumber', ${input.invoiceNumber}::text,
          'invoiceTotalCents', c.trusted_total_cents,
          'balanceCents', ${input.balanceCents}::bigint,
          'fullyPaid', c.fully_paid,
          'provider', 'quickbooks'::text,
          'isTest', c.is_test
        )
      FROM calculation c
      WHERE NOT EXISTS (SELECT 1 FROM existing_receipt)
      ON CONFLICT (kind, external_id) WHERE external_id <> '' DO NOTHING
      RETURNING id, lead_id, detail
    ), receipt_scope AS MATERIALIZED (
      SELECT w.id, w.lead_id,
        (w.detail->>'paidTotalCents')::bigint AS paid_total_cents,
        (w.detail->>'fullyPaid')::boolean AS fully_paid
      FROM receipt_write w
      UNION ALL
      SELECT e.id, e.lead_id,
        CASE WHEN e.reversed_after THEN t.current_paid_cents
          ELSE (e.detail->>'paidTotalCents')::bigint END AS paid_total_cents,
        CASE WHEN e.reversed_after THEN
          (t.invoice_total_cents IS NOT NULL AND t.current_paid_cents >= t.invoice_total_cents)
          ELSE e.fully_paid END AS fully_paid
      FROM existing_receipt e JOIN target t ON t.id = e.lead_id
      WHERE COALESCE(e.detail->>'paidTotalCents', '') ~ '^[0-9]+$'
        AND NOT EXISTS (SELECT 1 FROM receipt_write)
    ), projection_write AS (
      UPDATE leads l SET
        paid_amount_cents = GREATEST(COALESCE(l.paid_amount_cents, 0::bigint), r.paid_total_cents),
        invoice_total_cents = COALESCE(l.invoice_total_cents, ${invoiceTotalCents}::bigint),
        paid_at = CASE WHEN r.fully_paid THEN COALESCE(l.paid_at, ${input.occurredAt}::timestamptz) ELSE l.paid_at END,
        revenue_cents = CASE WHEN r.fully_paid THEN COALESCE(l.revenue_cents, COALESCE(l.invoice_total_cents, ${invoiceTotalCents}::bigint, r.paid_total_cents)) ELSE l.revenue_cents END,
        status = CASE WHEN r.fully_paid THEN 'won' ELSE l.status END,
        won_at = CASE WHEN r.fully_paid THEN COALESCE(l.won_at, ${input.occurredAt}::timestamptz) ELSE l.won_at END,
        updated_at = now()
      FROM target t CROSS JOIN receipt_scope r
      WHERE l.id = t.id AND r.lead_id = t.id
      RETURNING l.id
    ), paid_write AS (
      INSERT INTO events (
        occurred_at, kind, actor_type, actor_id, lead_id, person_id,
        external_id, body, crew_body, detail
      )
      SELECT ${input.occurredAt}::timestamptz, 'invoice.paid'::text,
        ${actorType}::text, ${actorId}::text, t.id, t.person_id,
        ${paidExternalId}::text, ${body}::text, NULL::text,
        jsonb_build_object(
          'sourceEventId', ${input.sourceEventId}::bigint,
          'paymentReceiptEventId', r.id,
          'amountCents', ${amountCents}::bigint,
          'paidTotalCents', r.paid_total_cents,
          'invoiceNumber', ${input.invoiceNumber}::text,
          'fullyPaid', true,
          'provider', 'quickbooks'::text,
          'isTest', t.is_test
        )
      FROM target t CROSS JOIN receipt_scope r CROSS JOIN projection_write p
      WHERE r.fully_paid
        AND NOT EXISTS (SELECT 1 FROM existing_receipt e WHERE e.kind = 'invoice.paid')
      ON CONFLICT (kind, external_id) WHERE external_id <> '' DO NOTHING
      RETURNING id
    ), paid_scope AS (
      SELECT id FROM paid_write
      UNION ALL
      SELECT e.id FROM events e
      WHERE e.kind = 'invoice.paid' AND (
          e.external_id = ${paidExternalId}::text
          OR (e.lead_id = ${input.leadId}::bigint
            AND e.detail->>'sourceEventId' = ${String(input.sourceEventId)}::text)
        )
        AND NOT EXISTS (SELECT 1 FROM paid_write)
      LIMIT 1
    )
    SELECT r.id AS receipt_event_id,
      (SELECT id FROM paid_scope LIMIT 1) AS paid_event_id,
      r.paid_total_cents, r.fully_paid,
      NOT EXISTS (SELECT 1 FROM receipt_write) AS duplicate
    FROM receipt_scope r CROSS JOIN projection_write p
    LIMIT 1`) as Array<{
      receipt_event_id: number
      paid_event_id: number | null
      paid_total_cents: number
      fully_paid: boolean
      duplicate: boolean
    }>

  if (rows[0]) return {
    receiptEventId: Number(rows[0].receipt_event_id),
    paidEventId: rows[0].paid_event_id ? Number(rows[0].paid_event_id) : null,
    paidTotalCents: Number(rows[0].paid_total_cents),
    fullyPaid: Boolean(rows[0].fully_paid),
    duplicate: Boolean(rows[0].duplicate),
  }

  // A simultaneous duplicate can lose the INSERT race after this statement's
  // snapshot. The winning statement has already projected it; read that
  // immutable receipt instead of adding the amount a second time.
  const replay = (await sql`
    SELECT e.id, e.detail,
      (SELECT paid.id FROM events paid
       WHERE paid.kind = 'invoice.paid' AND paid.external_id = ${paidExternalId}::text
       LIMIT 1) AS paid_event_id
    FROM events e
    WHERE e.kind = 'invoice.payment-received'
      AND e.external_id = ${receiptExternalId}::text
      AND e.lead_id = ${input.leadId}::bigint
    LIMIT 1`) as Array<{ id: number; detail: Record<string, unknown>; paid_event_id: number | null }>
  if (!replay[0] || !Number.isFinite(Number(replay[0].detail?.paidTotalCents))) {
    throw new Error("QuickBooks payment receipt could not be projected.")
  }
  return {
    receiptEventId: Number(replay[0].id),
    paidEventId: replay[0].paid_event_id ? Number(replay[0].paid_event_id) : null,
    paidTotalCents: Number(replay[0].detail.paidTotalCents),
    fullyPaid: replay[0].detail.fullyPaid === true,
    duplicate: true,
  }
}

// Reversals append a compensating financial event. The lead's paid amount is a
// projection of net money received, so lock and reduce that projection in the
// same statement as the immutable ledger event.
export async function applyPaymentReversal(input: PaymentReversalInput): Promise<PaymentReversalResult> {
  const normalized = normalizePaymentReversalInput(input.amountCents, input.reason)
  const amountCents = normalized.amountCents
  const reason = normalized.reason
  const idempotencyKey = String(input.idempotencyKey ?? "").trim()
  if (!/^[a-zA-Z0-9:_-]{12,180}$/.test(idempotencyKey)) throw new Error("The reversal receipt is missing. Reload this work order before recording the reversal.")
  const body = `Payment reversed: $${(amountCents / 100).toFixed(2)}. Reason: ${reason}`
  const sql = getSql()
  const rows = (await sql`
    WITH target AS MATERIALIZED (
      SELECT id, person_id, is_test,
        COALESCE(paid_amount_cents, 0::bigint) AS current_paid_cents,
        invoice_total_cents
      FROM leads
      WHERE id = ${input.leadId}::bigint
      FOR UPDATE
    ), calculation AS MATERIALIZED (
      SELECT t.*, t.current_paid_cents - ${amountCents}::bigint AS net_paid_cents
      FROM target t
      WHERE t.current_paid_cents >= ${amountCents}::bigint
        AND NOT EXISTS (
          SELECT 1 FROM events e
          WHERE e.kind = 'payment.reversed' AND e.external_id = ${idempotencyKey}::text
        )
    ), reversal_write AS (
      INSERT INTO events (
        kind, actor_type, actor_id, lead_id, person_id, external_id, body, crew_body, detail
      )
      SELECT 'payment.reversed'::text, 'operator'::text, ${String(input.operatorId)}::text,
        c.id, c.person_id, ${idempotencyKey}::text,
        CASE WHEN c.is_test THEN '[INTERNAL TEST] '::text ELSE ''::text END || ${body}::text,
        NULL::text,
        jsonb_build_object(
          'amountCents', ${amountCents}::bigint,
          'reason', ${reason}::text,
          'previousNetPaidCents', c.current_paid_cents,
          'netPaidCents', c.net_paid_cents,
          'manual', true,
          'isTest', c.is_test
        )
      FROM calculation c
      ON CONFLICT (kind, external_id) WHERE external_id <> '' DO NOTHING
      RETURNING id, lead_id
    ), projection_write AS (
      UPDATE leads l SET
        paid_amount_cents = c.net_paid_cents,
        paid_at = CASE
          WHEN c.invoice_total_cents IS NOT NULL AND c.net_paid_cents >= c.invoice_total_cents THEN l.paid_at
          ELSE NULL
        END,
        updated_at = now()
      FROM calculation c JOIN reversal_write e ON e.lead_id = c.id
      WHERE l.id = c.id
      RETURNING e.id AS event_id, l.paid_amount_cents AS net_paid_cents
    )
    SELECT event_id, net_paid_cents FROM projection_write LIMIT 1`) as Array<{
      event_id: number
      net_paid_cents: number
    }>

  if (rows[0]) return {
    eventId: Number(rows[0].event_id),
    netPaidCents: Number(rows[0].net_paid_cents),
    duplicate: false,
  }

  const replay = (await sql`
    SELECT id, lead_id, detail->>'netPaidCents' AS net_paid_cents
    FROM events
    WHERE kind = 'payment.reversed' AND external_id = ${idempotencyKey}::text
    LIMIT 1`) as Array<{ id: number; lead_id: number | null; net_paid_cents: string | null }>
  if (replay[0]) {
    if (Number(replay[0].lead_id) !== input.leadId) throw new Error("That reversal receipt was used by another work order.")
    return {
      eventId: Number(replay[0].id),
      netPaidCents: Number(replay[0].net_paid_cents) || 0,
      duplicate: true,
    }
  }
  throw new Error("The reversal cannot exceed the current net paid amount.")
}
