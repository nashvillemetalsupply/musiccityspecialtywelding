type SmsProjectionLink = {
  leadId?: number | string | null
  personId?: number | string | null
}

export function resumeSmsProjection(input: {
  messageReceipt?: SmsProjectionLink | null
  priorEvent?: (SmsProjectionLink & { createdLead?: boolean | null }) | null
}): {
  projected: boolean
  leadId: number | null
  personId: number | null
  createdLead: boolean
}
