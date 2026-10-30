/** A completed send only consumes the draft it actually submitted. */
export function draftAfterReplyDelivery(current: string, submitted: string | null): string {
  return submitted !== null && current === submitted ? "" : current
}
