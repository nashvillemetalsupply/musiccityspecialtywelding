"use client"

export type Attribution = {
  gclid: string
  utm_source: string
  utm_medium: string
  utm_campaign: string
  utm_term: string
  utm_content: string
  landing_page: string
  page_referrer: string
}

const STORAGE_KEY = "mcsw_attribution"
const TRACKED_PARAMS = [
  "gclid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const

function emptyAttribution(): Attribution {
  return {
    gclid: "",
    utm_source: "",
    utm_medium: "",
    utm_campaign: "",
    utm_term: "",
    utm_content: "",
    landing_page: "",
    page_referrer: "",
  }
}

// First-touch attribution: capture campaign parameters on the landing page and
// keep them for the session so a lead submitted from any page keeps its source.
export function captureAttribution(): Attribution {
  if (typeof window === "undefined") return emptyAttribution()
  if (window.location.pathname === "/ops" || window.location.pathname.startsWith("/ops/") || window.location.pathname === "/j" || window.location.pathname.startsWith("/j/")) {
    return emptyAttribution()
  }
  try {
    const params = new URLSearchParams(window.location.search)
    const currentIsVerification = params.get("utm_source")?.toLowerCase() === "internal-verify"
      || params.get("utm_medium")?.toLowerCase() === "e2e"
    const stored = window.sessionStorage.getItem(STORAGE_KEY)
    let existing: Attribution = stored ? JSON.parse(stored) : emptyAttribution()
    const storedIsVerification = existing.utm_source.toLowerCase() === "internal-verify"
      || existing.utm_medium.toLowerCase() === "e2e"
    if (currentIsVerification || storedIsVerification) {
      window.sessionStorage.removeItem(STORAGE_KEY)
      if (currentIsVerification) return emptyAttribution()
      existing = emptyAttribution()
    }

    let changed = false
    for (const key of TRACKED_PARAMS) {
      const value = params.get(key)?.slice(0, 200) ?? ""
      if (value && !existing[key]) {
        existing[key] = value
        changed = true
      }
    }
    if (!existing.landing_page) {
      existing.landing_page = (window.location.pathname + window.location.search).slice(0, 500)
      changed = true
    }
    if (!existing.page_referrer && document.referrer) {
      try {
        if (new URL(document.referrer).hostname !== window.location.hostname) {
          existing.page_referrer = document.referrer.slice(0, 500)
          changed = true
        }
      } catch {
        // ignore malformed referrers
      }
    }
    if (changed) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(existing))
    return existing
  } catch {
    return emptyAttribution()
  }
}
