"use client"

import { track } from "@vercel/analytics"

// Owner-only feature taps, so the next change to the board is built on what
// he actually uses rather than a guess. Names only, never content: no
// customer, no number, no money, no job id ever rides on an event.
//
// Crew are never counted. JobControl mounts the analytics script only for the
// owner and only flips this switch for the owner, so a crew tap is a no-op
// before it reaches the SDK. That is the repo's no-surveillance rule, kept at
// the source, not in a dashboard filter.
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
  try {
    track(name, detail)
  } catch (error) {
    // Analytics is decoration on the board, never a dependency of it. A
    // blocked or missing script must not stop the tap it was counting.
    console.warn("Usage event dropped:", name, error)
  }
}
