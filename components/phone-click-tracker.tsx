"use client"

import { useEffect } from "react"

import { captureAttribution } from "@/lib/attribution"
import { dniDisplay, dniNumber, paidChannelForVisit } from "@/lib/dni.mjs"
import { ADS_PHONE_CONVERSION_SEND_TO, queueMeasurementEvent } from "@/lib/measurement"

// Dynamic number insertion. A visitor who arrived from an ad is shown that
// channel's own Twilio number, which is the only way a phone call ever gets
// attributed -- a form carries gclid, a call carries nothing but the number
// dialled. Inert until the numbers are bought and the variables are set.
function insertTrackingNumber(root: ParentNode) {
  const attribution = captureAttribution()
  const channel = paidChannelForVisit({
    gclid: attribution.gclid,
    utmSource: attribution.utm_source,
    landingPage: attribution.landing_page,
  })
  if (!channel) return
  const e164 = dniNumber(channel)
  if (!e164) return
  const display = dniDisplay(channel)
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href^="tel:"]')) {
    link.href = `tel:${e164}`
    // Only rewrite the label when the label IS a phone number. Desktop readers
    // dial what they see, and "Call the shop" must not become a number.
    const text = link.textContent?.trim() ?? ""
    if (display && text && /^[\d\s().+-]{7,}$/.test(text)) link.textContent = display
  }
}

export function PhoneClickTracker() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("utm_source") === "internal-verify" || params.get("utm_medium") === "e2e") return

    insertTrackingNumber(document)

    function trackPhoneClick(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Element)) return
      const link = target.closest<HTMLAnchorElement>('a[href^="tel:"]')
      if (!link) return
      // Again at click time, so a link rendered after mount -- a client-side
      // navigation, a dialog -- still dials the tracking number.
      insertTrackingNumber(document)
      queueMeasurementEvent("phone_click", {
        link_url: link.href,
        link_text: link.textContent?.trim().slice(0, 100) ?? "",
        page_location: window.location.href,
      })
      if (ADS_PHONE_CONVERSION_SEND_TO) {
        queueMeasurementEvent("conversion", { send_to: ADS_PHONE_CONVERSION_SEND_TO })
      }
    }

    document.addEventListener("click", trackPhoneClick)
    return () => document.removeEventListener("click", trackPhoneClick)
  }, [])

  return null
}
