/** No provider call occurred in this attempt; a durable intent may still require same-key retry. */
export class SmsNotSentError extends Error {
  sameIntentOnly: boolean

  constructor(message: string, sameIntentOnly = false) {
    super(message)
    this.name = "SmsNotSentError"
    this.sameIntentOnly = sameIntentOnly
  }
}

export function isSmsNotSentError(error: unknown): error is SmsNotSentError {
  return error instanceof SmsNotSentError
}

type SmsProjectionLink = {
  leadId?: number | string | null
  personId?: number | string | null
}

function persistedId(value: number | string | null | undefined): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * Chooses the immutable/event projection first, then the already-linked raw
 * provider receipt. Only a truly raw, unprojected receipt may resolve a
 * conversation from current customer state.
 */
export function resumeSmsProjection({ messageReceipt, priorEvent }: {
  messageReceipt?: SmsProjectionLink | null
  priorEvent?: (SmsProjectionLink & { createdLead?: boolean | null }) | null
}) : {
  projected: boolean
  leadId: number | null
  personId: number | null
  createdLead: boolean
} {
  const leadId = persistedId(priorEvent?.leadId) ?? persistedId(messageReceipt?.leadId)
  const personId = persistedId(priorEvent?.personId) ?? persistedId(messageReceipt?.personId)
  return {
    projected: Boolean(priorEvent || leadId || personId),
    leadId,
    personId,
    createdLead: Boolean(priorEvent?.createdLead),
  }
}
