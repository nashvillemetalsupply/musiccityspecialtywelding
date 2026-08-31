import { getSql } from "@/lib/db"

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
        (e.detail->>'paidTotalCents')::bigint AS paid_total_cents,
        e.fully_paid
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
