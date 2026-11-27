import { createHash } from "node:crypto";
import { Resend, type CreateEmailOptions } from "resend";
import { get } from "@vercel/blob";
import { getSql } from "@/lib/db";
import { recordEvent } from "@/lib/events";

export type DurableEmailState = "accepted" | "failed" | "unknown" | "pending";
export type DurableEmailResult = {
  state: DurableEmailState;
  error: string;
  receiptEventId: number | null;
};

export type FrozenQuoteEmail = {
  message: CreateEmailOptions;
  photos?: { pathname: string; filename: string; size: number }[];
};

type QuoteEmailIntent = { id: number; frozen_payload: string | null; created_at: string };
type QuoteEmailInput = {
  resend: Resend;
  leadId: number;
  personId: number | null;
  intent: string;
  audience: "shop" | "customer";
};

const QUOTE_EMAIL_RETRY_MS = 23 * 60 * 60 * 1000;

export function emailReceiptUnavailable(error: unknown): DurableEmailResult {
  console.error("Quote email receipt persistence failed:", error);
  return { state: "unknown", error: "Email provider response was not confirmed.", receiptEventId: null };
}

async function resumeEventId(kind: string, externalId: string) {
  const rows = (await getSql()`
    SELECT id FROM events
    WHERE kind = ${kind}::text AND external_id = ${externalId}::text
    LIMIT 1`) as { id: number }[];
  return Number(rows[0]?.id) || null;
}

async function readQuoteEmailIntent(intent: string) {
  const [row] = (await getSql()`
    SELECT id, detail->>'frozenPayload' AS frozen_payload, recorded_at AS created_at FROM events
    WHERE kind = ${"email.out"}::text AND external_id = ${intent}::text
    LIMIT 1`) as QuoteEmailIntent[];
  return row;
}

async function readQuoteEmailReceipts(leadId: number, sourceEventId: number) {
  return (await getSql()`
    SELECT kind, id, occurred_at, detail->>'payloadHash' AS payload_hash,
      detail->>'attemptEventId' AS attempt_event_id, detail->>'attemptNumber' AS attempt_number,
      detail->>'idempotencyKey' AS idempotency_key, detail->>'providerStatus' AS provider_status,
      detail->>'requestNotSent' = 'true' AS request_not_sent
    FROM events
    WHERE kind = ANY(ARRAY['email.attempt','email.accepted','email.delivered','email.failed','email.unknown']::text[])
      AND detail->>'sourceEventId' = ${String(sourceEventId)}::text
      AND lead_id = ${leadId}::bigint
    ORDER BY occurred_at, id`) as {
    kind: string; id: number; occurred_at: string; payload_hash: string | null;
    attempt_event_id: string | null; attempt_number: string | null;
    idempotency_key: string | null; provider_status: string | null; request_not_sent: boolean | null;
  }[];
}

function definitiveRejection(status: number) {
  return status >= 400 && status < 500 && ![408, 409, 429].includes(status);
}

function quoteEmailHistory(receipts: Awaited<ReturnType<typeof readQuoteEmailReceipts>>) {
  // Acceptance fulfills the intent even when another request is still in flight.
  const accepted = receipts.some(({ kind }) => kind === "email.accepted" || kind === "email.delivered");
  const attempts = receipts.filter(({ kind }) => kind === "email.attempt");
  const rejected = new Set(receipts.filter(({ kind, provider_status, request_not_sent }) =>
    kind === "email.failed" && (request_not_sent || definitiveRejection(Number(provider_status)))
  ).map(({ attempt_event_id }) => Number(attempt_event_id)));
  // An unknown receipt ends the individual request, but leaves its provider
  // outcome ambiguous. A different request's rejection cannot settle it.
  const unresolved = attempts.find(({ id }) => !rejected.has(Number(id)));
  const lastAttemptNumber = attempts.reduce((latest, { attempt_number }) => Math.max(latest, Number(attempt_number ?? 1)), 0);
  return { accepted, unresolved, lastAttemptNumber };
}

function olderThanRetryWindow(timestamp: string) {
  return !(Date.now() - new Date(timestamp).getTime() < QUOTE_EMAIL_RETRY_MS);
}

function unconfirmed(input: QuoteEmailInput, sourceEventId: number): DurableEmailResult {
  console.error("Quote email left for reconciliation:", { leadId: input.leadId, audience: input.audience });
  return { state: "unknown", error: "Email provider response was not confirmed.", receiptEventId: sourceEventId };
}

export async function sendDurableQuoteEmail(input: QuoteEmailInput & {
  photosDurable?: boolean;
  buildPayload: () => FrozenQuoteEmail | Promise<FrozenQuoteEmail>;
}): Promise<DurableEmailResult> {
  let intent: QuoteEmailIntent | undefined;
  try {
    intent = await readQuoteEmailIntent(input.intent);
    if (!intent) {
      const frozen = await input.buildPayload();
      frozen.message.tags = [
        { name: "quote_intent", value: input.intent.replace(":", "-") },
        { name: "audience", value: input.audience },
      ];
      const frozenPayload = JSON.stringify(frozen);
      const createdAt = new Date().toISOString();
      const id = await recordEvent({
        kind: "email.out",
        occurredAt: createdAt,
        actorType: "system",
        leadId: input.leadId,
        personId: input.personId,
        externalId: input.intent,
        body: `Quote ${input.audience === "shop" ? "shop alert" : "customer receipt"} queued.`,
        crewBody: `Quote ${input.audience === "shop" ? "shop alert" : "customer receipt"} queued.`,
        detail: {
          audience: input.audience,
          subject: frozen.message.subject,
          deliveryStatus: "pending",
          frozenPayload,
        },
      });
      intent = id ? { id, frozen_payload: frozenPayload, created_at: createdAt } : await readQuoteEmailIntent(input.intent);
    }
    if (!intent) throw new Error("Quote email intent unavailable.");
  } catch (error) {
    console.error("Quote email could not be prepared:", error);
    return { state: "pending", error: "Quote email needs a storage retry.", receiptEventId: intent ? Number(intent.id) : null };
  }
  return sendFrozenQuoteEmail(input, intent, input.photosDurable !== false);
}

export async function recoverUnattemptedQuoteEmail(input: Omit<QuoteEmailInput, "resend">, intent: QuoteEmailIntent) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Quote email recovery requires a configured provider.");
  return sendFrozenQuoteEmail({ ...input, resend: new Resend(apiKey) }, intent, true, true);
}

async function sendFrozenQuoteEmail(
  input: QuoteEmailInput, intent: QuoteEmailIntent, photosDurable: boolean, onlyIfNeverAttempted = false,
): Promise<DurableEmailResult> {
  const sourceEventId = Number(intent.id);
  let attemptEventId: number;
  let idempotencyKey: string;
  let payload: CreateEmailOptions;
  const receipt = {
    actorType: "system" as const,
    leadId: input.leadId,
    personId: input.personId,
  };
  try {
    const receipts = await readQuoteEmailReceipts(input.leadId, sourceEventId);
    const initial = quoteEmailHistory(receipts);
    if (initial.accepted) return { state: "accepted", error: "", receiptEventId: sourceEventId };
    // Legacy intents without a frozen payload could already have sent.
    if (!intent.frozen_payload || (initial.unresolved && olderThanRetryWindow(initial.unresolved.occurred_at))) {
      return unconfirmed(input, sourceEventId);
    }
    if (onlyIfNeverAttempted && initial.lastAttemptNumber) return unconfirmed(input, sourceEventId);
    if (!photosDurable) throw new Error("Quote photo verification needs a retry.");

    const frozen = JSON.parse(intent.frozen_payload) as FrozenQuoteEmail;
    const hash = createHash("sha256").update(intent.frozen_payload);
    const attachments = await Promise.all((frozen.photos ?? []).map(async ({ pathname, filename, size }) => {
      const blob = await get(pathname, { access: "private" });
      if (!blob || blob.statusCode !== 200 || blob.blob.size !== size) throw new Error("Saved quote photo unavailable.");
      return { filename, content: Buffer.from(await new Response(blob.stream).arrayBuffer()) };
    }));
    for (const { content } of attachments) hash.update(content);
    const payloadHash = hash.digest("hex");
    const changed = (history: typeof receipts) => history.some(({ payload_hash }) => payload_hash && payload_hash !== payloadHash);
    if (changed(receipts)) throw new Error("Saved quote email payload changed.");
    payload = { ...frozen.message, attachments: attachments.length ? attachments : undefined };

    // Blob reads and a concurrent submission may have advanced the history.
    const current = await readQuoteEmailReceipts(input.leadId, sourceEventId);
    const { accepted, unresolved, lastAttemptNumber } = quoteEmailHistory(current);
    if (accepted) return { state: "accepted", error: "", receiptEventId: sourceEventId };
    if (onlyIfNeverAttempted && (lastAttemptNumber || olderThanRetryWindow(intent.created_at))) return unconfirmed(input, sourceEventId);
    if (unresolved && olderThanRetryWindow(unresolved.occurred_at)) return unconfirmed(input, sourceEventId);
    if (changed(current)) throw new Error("Saved quote email payload changed.");
    const attemptNumber = unresolved ? Number(unresolved.attempt_number ?? 1) : lastAttemptNumber + 1;
    const audienceKey = input.audience === "shop" ? "quote-owner" : "quote-customer";
    idempotencyKey = unresolved?.idempotency_key || `${audienceKey}:${input.leadId}:attempt:${attemptNumber}`;
    const attemptedAt = new Date().toISOString();
    const attemptId = await recordEvent({
      kind: "email.attempt",
      occurredAt: attemptedAt,
      actorType: "system",
      leadId: input.leadId,
      personId: input.personId,
      body: "Quote email send attempted.",
      detail: {
        sourceEventId, audience: input.audience, attemptNumber, idempotencyKey, payloadHash, attemptedAt,
        ...(onlyIfNeverAttempted ? { recovery: true } : {}),
      },
    });
    if (!attemptId) throw new Error("Quote email attempt could not be saved.");
    attemptEventId = attemptId;

    // A delayed contender may record its attempt after another request has
    // moved to a new key. Its earlier key must never be sent in that case.
    const latest = await readQuoteEmailReceipts(input.leadId, sourceEventId);
    const afterAttempt = quoteEmailHistory(latest);
    if (afterAttempt.accepted || afterAttempt.lastAttemptNumber > attemptNumber
      || (afterAttempt.unresolved && olderThanRetryWindow(afterAttempt.unresolved.occurred_at))
      || (onlyIfNeverAttempted && olderThanRetryWindow(intent.created_at)) || changed(latest)) {
      await recordEvent({
        ...receipt,
        kind: "email.failed",
        externalId: `request-failed:${attemptEventId}`,
        body: "Quote email attempt stopped before contacting the provider.",
        crewBody: "Email attempt stopped before contacting the provider.",
        detail: { sourceEventId, audience: input.audience, attemptEventId, requestNotSent: true },
      });
      if (afterAttempt.accepted) return { state: "accepted", error: "", receiptEventId: sourceEventId };
      if (changed(latest)) throw new Error("Saved quote email payload changed.");
      return unconfirmed(input, sourceEventId);
    }
  } catch (error) {
    console.error("Quote email could not be prepared:", error);
    return { state: "pending", error: "Quote email needs a storage retry.", receiptEventId: sourceEventId };
  }

  let providerEmailId: string | undefined;
  const detail = { sourceEventId, audience: input.audience, attemptEventId };
  try {
    const { data, error } = await input.resend.emails.send(payload, { idempotencyKey });
    providerEmailId = data?.id;
    if (error) {
      const message = error.message || "Email provider did not accept the message.";
      const status = error.statusCode ?? 0;
      if (providerEmailId || !definitiveRejection(status)) throw new Error(message);
      const failureEventId = await recordEvent({
        ...receipt,
        kind: "email.failed",
        externalId: `request-failed:${attemptEventId}`,
        body: message,
        crewBody: "Email provider rejected the message.",
        detail: { ...detail, providerStatus: status },
      });
      if (!failureEventId) throw new Error("Quote email rejection could not be saved.");
      return { state: "failed", error: message, receiptEventId: failureEventId };
    }
    if (!providerEmailId) throw new Error("Email provider responded without an acceptance receipt.");
    const acceptance = {
      ...receipt,
      kind: "email.accepted" as const,
      body: "Email accepted by the delivery provider.",
      crewBody: "Email accepted by the delivery provider.",
      detail: { ...detail, providerEmailId },
    };
    let acceptanceEventId = await recordEvent({ ...acceptance, externalId: providerEmailId });
    if (!acceptanceEventId) {
      // A concurrent callback or retry may already own the canonical provider
      // receipt. This request still needs its own linked outcome.
      const externalId = `request-accepted:${attemptEventId}`;
      acceptanceEventId = await recordEvent({ ...acceptance, externalId }) || await resumeEventId("email.accepted", externalId);
    }
    if (!acceptanceEventId) throw new Error("Quote email acceptance could not be saved.");
    return { state: "accepted", error: "", receiptEventId: acceptanceEventId };
  } catch (error) {
    // A transport exception or receipt write failure may hide a completed send.
    const message = error instanceof Error ? error.message : "Email provider response was lost.";
    const unknownEventId = await recordEvent({
      ...receipt,
      kind: "email.unknown",
      externalId: `request-unknown:${attemptEventId}`,
      body: message,
      crewBody: "Email provider response was not confirmed.",
      detail: { ...detail, providerEmailId },
    });
    return { state: "unknown", error: message, receiptEventId: unknownEventId || sourceEventId };
  }
}
