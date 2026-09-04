export const ADS_CONVERSION_SEND_TO =
  process.env.NEXT_PUBLIC_GOOGLE_ADS_SEND_TO?.trim() ||
  "AW-17817632790/CZF4CMyQhPEbEJaAjrBC"

export const GA_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() || ""

// The shop's busiest channel is the phone: 30 leads in the eleven days from
// 2026-08-24 were almost all calls, and Google Ads recorded none of them,
// because a tel: tap reaches GA4 only. Set this once a "Calls from website
// visits" conversion action exists in account 747-818-3137 and the tap becomes
// a bidding signal; empty until then, and the tap stays GA4-only.
export const ADS_PHONE_CONVERSION_SEND_TO =
  process.env.NEXT_PUBLIC_GOOGLE_ADS_PHONE_SEND_TO?.trim() || ""

type MeasurementWindow = Window & {
  dataLayer?: unknown[]
  gtag?: (...args: unknown[]) => void
}

// A conversion the browser drops is gone: there is no retry and nothing
// server-side records the miss. Gating these events on `window.gtag` dropped
// every one of them from 2026-08-24 -- GA4 kept firing enhanced-measurement
// form_start while generate_lead and the Ads conversion fired zero times,
// including on 2026-08-25 when the submission did save lead #161. Enhanced
// measurement comes from gtag.js and needs no shim; our events did, and the
// shim is what was missing.
//
// gtag.js replays whatever is already in dataLayer when it loads, so pushing
// unconditionally is strictly safer than skipping: at worst the event waits.
export function queueMeasurementEvent(name: string, params: Record<string, unknown>) {
  if (typeof window === "undefined") return
  const target = window as MeasurementWindow
  target.dataLayer = target.dataLayer || []
  if (typeof target.gtag !== "function") {
    target.gtag = function gtag() {
      target.dataLayer!.push(arguments)
    }
  }
  target.gtag("event", name, params)
}
