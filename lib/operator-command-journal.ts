import { recordEvent } from "@/lib/events"
import { OPERATOR_COMMAND_EVENT_KIND, type OperatorCommandVerb } from "@/lib/sms-operator-commands"
import type { Operator } from "@/lib/operators"

export type OperatorCommandOutcome = "done" | "refused" | "unmatched" | "not-understood"

// Shared by S81's inbound SMS path and the authenticated CRM entry form.
// Both doors preserve the same immutable event shape and business tag.
export async function journalOperatorCommand(input: {
  operator: Operator
  sid: string
  body: string
  messageId: number | null
  verb: OperatorCommandVerb | null
  leadId: number | null
  outcome: OperatorCommandOutcome
  reply: string
  amountCents?: number | null
  business?: string | null
  count?: number | null
}) {
  await recordEvent({
    kind: OPERATOR_COMMAND_EVENT_KIND,
    actorType: "operator",
    actorId: input.operator.id,
    leadId: input.leadId,
    externalId: input.sid,
    body: input.body,
    detail: {
      messageId: input.messageId,
      operatorId: input.operator.id,
      verb: input.verb,
      outcome: input.outcome,
      amountCents: input.amountCents ?? null,
      // S81: business tag for non-CRM businesses; absent means welding.
      ...(input.business ? { business: input.business, count: input.count ?? null } : {}),
      reply: input.reply,
    },
  })
}
