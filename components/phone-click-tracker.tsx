"use client"

import { useEffect } from "react"

import { ADS_PHONE_CONVERSION_SEND_TO } from "@/lib/measurement"

export function PhoneClickTracker() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("utm_source") === "internal-verify" || params.get("utm_medium") === "e2e") return

    function trackPhoneClick(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Element)) return
      const link = target.closest<HTMLAnchorElement>('a[href^="tel:"]')
      if (!link || typeof window.gtag !== "function") return
      window.gtag("event", "phone_click", {
        link_url: link.href,
        link_text: link.textContent?.trim().slice(0, 100) ?? "",
        page_location: window.location.href,
      })
      if (ADS_PHONE_CONVERSION_SEND_TO) {
        window.gtag("event", "conversion", { send_to: ADS_PHONE_CONVERSION_SEND_TO })
      }
    }

    document.addEventListener("click", trackPhoneClick)
    return () => document.removeEventListener("click", trackPhoneClick)
  }, [])

  return null
}
