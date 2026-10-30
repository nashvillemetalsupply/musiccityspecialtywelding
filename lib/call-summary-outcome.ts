import type { CallSummary } from "./call-summary-shared.ts"

// Keep the board's display-only formatter separate from runtime validation.
// The type import is erased; this module never initializes the Zod schema.
export function outcomeLine(summary: CallSummary, leadId: number | null) {
  if (summary.auto === "filed") return "Repeat caller. Filed to their open job."
  if (leadId != null || summary.auto === "saved") return "Saved as a job. It is on the tracker."
  if (summary.is_job === "no") return summary.not_job_reason ? `${summary.not_job_reason}. Left in calls to save.` : "Left in calls to save."
  if (summary.auto === "failed") return "The save did not go through. It is in calls to save."
  return "Could not tell if it is a job. Left in calls to save."
}
