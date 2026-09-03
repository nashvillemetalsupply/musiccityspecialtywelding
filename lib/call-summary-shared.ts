import { z } from "zod"

// The browser-safe half of the call read: the shape and the sentence that
// says what happened. Nothing here touches the database, the model, or push.
// board.tsx is a client component and imports from here; importing from
// call-summary.ts pulled web-push into the browser bundle and broke the build
// on 2026-09-03.

// Parse loosely, store tightly. The first backfill lost four calls to a
// detail of 81 characters and a null need -- a model that wrote a good
// summary and got told it was invalid. `scrub` below is where lengths are
// enforced, by cutting, not by refusing.
export const callSummarySchema = z.object({
  caller_name: z.string().max(400).nullable().describe("The caller's name or company if they said it. Null if not said."),
  need: z.string().max(2000).nullable().transform((value) => value ?? "").describe("One plain sentence: what the caller wants done. Empty string only if the call had no request."),
  details: z.array(z.string().max(400)).max(12).catch([]).describe("Sizes, material, quantity, part names, as said. No prices. At most five short items."),
  where_when: z.string().max(600).nullable().describe("Location, drop-off or on-site, and any timing the caller gave. Null if none."),
  is_job: z.enum(["yes", "no", "unsure"]).catch("unsure").describe("yes for welding or fabrication work. no for wrong numbers, vendors, spam, or personal calls."),
  not_job_reason: z.string().max(400).nullable().describe("Why this is not a job, in a few words, when is_job is no. Otherwise null."),
  next_question: z.string().max(600).nullable().describe("The one thing the shop still needs to ask before quoting. Null if nothing is missing."),
})

// What the read did with the call once it was written down. Stored beside
// the read so the board can say what happened, not guess from other rows.
export type CallOutcome = "saved" | "filed" | "left" | "already" | "failed"
export type CallSummary = z.output<typeof callSummarySchema> & { auto?: CallOutcome }

export function outcomeLine(summary: CallSummary, leadId: number | null) {
  if (summary.auto === "filed") return "Repeat caller. Filed to their open job."
  if (leadId != null || summary.auto === "saved") return "Saved as a job. It is on the tracker."
  if (summary.is_job === "no") return summary.not_job_reason ? `${summary.not_job_reason}. Left in calls to save.` : "Left in calls to save."
  if (summary.auto === "failed") return "The save did not go through. It is in calls to save."
  return "Could not tell if it is a job. Left in calls to save."
}

