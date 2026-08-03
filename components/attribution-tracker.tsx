"use client"

import { useEffect } from "react"
import { captureAttribution } from "@/lib/attribution"

// Captures first-touch campaign attribution on the landing page load.
export function AttributionTracker() {
  useEffect(() => {
    captureAttribution()
  }, [])
  return null
}
