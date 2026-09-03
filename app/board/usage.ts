"use client"

// Owner-only feature taps, so the next change to the board is built on what
// he actually uses rather than a guess. Names only, never content: no
// customer, no number, no money, no job id ever rides on a tap. The one
// detail allowed is the stage tab's own name, folded into the tap name.
//
// Counted first party (POST /api/ops/usage into usage_taps): Vercel Web
// Analytics on the Hobby plan carries no custom events, and a paid plan for
// ten counters is the wrong trade. Page views still go to Vercel, free.
//
// Crew are never counted. JobControl flips this switch only for the owner,
// and the route refuses anyone else besides. That is the repo's
// no-surveillance rule, kept at the source, not in a dashboard filter.
export const TAPS = {
  callsOpen: "calls-open",
  callSave: "call-save",
  callNotJob: "call-not-job",
  callReview: "call-review",
  transcriptOpen: "lastcall-transcript",
  heardPrice: "heard-price",
  stageTab: "stage-tab",
  jobOpen: "job-open",
  jobExpand: "job-expand",
  search: "search",
} as const

export type Tap = (typeof TAPS)[keyof typeof TAPS]

let enabled = false

export function enableUsage(owner: boolean) {
  enabled = owner
}

export function tapped(name: Tap, detail?: { stage?: string }) {
  if (!enabled) return
  const payload = JSON.stringify({ name: detail?.stage ? `${name}:${detail.stage}` : name })
  try {
    // sendBeacon survives the navigation most of these taps start; the fetch
    // is the fallback for browsers that refuse a beacon.
    if (!navigator.sendBeacon?.("/api/ops/usage", new Blob([payload], { type: "application/json" }))) {
      void fetch("/api/ops/usage", { method: "POST", body: payload, headers: { "Content-Type": "application/json" }, keepalive: true })
    }
  } catch (error) {
    // Counting is decoration on the board, never a dependency of it. A tap
    // that cannot be counted still does what it was for.
    console.warn("Usage tap dropped:", name, error)
  }
}
