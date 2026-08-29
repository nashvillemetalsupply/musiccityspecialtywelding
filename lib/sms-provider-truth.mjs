function persistedId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * Chooses the immutable/event projection first, then the already-linked raw
 * provider receipt. Only a truly raw, unprojected receipt may resolve a
 * conversation from current customer state.
 */
export function resumeSmsProjection({ messageReceipt, priorEvent }) {
  const leadId = persistedId(priorEvent?.leadId) ?? persistedId(messageReceipt?.leadId)
  const personId = persistedId(priorEvent?.personId) ?? persistedId(messageReceipt?.personId)
  return {
    projected: Boolean(priorEvent || leadId || personId),
    leadId,
    personId,
    createdLead: Boolean(priorEvent?.createdLead),
  }
}
