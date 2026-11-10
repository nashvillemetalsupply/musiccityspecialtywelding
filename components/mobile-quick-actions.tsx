"use client"

import { useEffect, useState } from "react"
import { Phone } from "lucide-react"
import { FALLBACK_SHOP_PHONE_HREF } from "@/lib/shop-phone-shared"
import { AskShopButton } from "@/components/shop-actions"

export function MobileQuickActions({ phoneHref = FALLBACK_SHOP_PHONE_HREF }: { phoneHref?: string }) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const trigger = document.querySelector<HTMLElement>(".ms-hero-actions")

    if (!trigger) {
      const frame = window.requestAnimationFrame(() => setIsVisible(true))
      return () => window.cancelAnimationFrame(frame)
    }

    // Direct evaluation on every scroll/resize event. No animation-frame
    // dependency: rAF pauses in hidden or battery-throttled tabs.
    const updateVisibility = () => {
      const shouldShow = trigger.getBoundingClientRect().bottom <= 0
      setIsVisible((current) => (current === shouldShow ? current : shouldShow))
    }

    updateVisibility()
    window.addEventListener("scroll", updateVisibility, { passive: true })
    window.addEventListener("resize", updateVisibility)
    window.addEventListener("orientationchange", updateVisibility)
    window.addEventListener("pageshow", updateVisibility)

    return () => {
      window.removeEventListener("scroll", updateVisibility)
      window.removeEventListener("resize", updateVisibility)
      window.removeEventListener("orientationchange", updateVisibility)
      window.removeEventListener("pageshow", updateVisibility)
    }
  }, [])

  return (
    <div
      className={`ms-mobile-cta${isVisible ? " is-visible" : ""}`}
      aria-label="Quick actions"
      aria-hidden={!isVisible}
      inert={!isVisible}
    >
      <a className="ms-button ms-button-primary" href={phoneHref}>
        <Phone aria-hidden="true" />
        <span>Call the shop</span>
      </a>
      <AskShopButton />
    </div>
  )
}
