"use client"

import { useEffect, useState } from "react"
import { Phone } from "lucide-react"

export function MobileQuickActions({ quoteHref = "#contact" }: { quoteHref?: string }) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const trigger = document.querySelector<HTMLElement>(".ms-hero-actions")

    if (!trigger) {
      const frame = window.requestAnimationFrame(() => setIsVisible(true))
      return () => window.cancelAnimationFrame(frame)
    }

    let frame = 0
    const updateVisibility = () => {
      frame = 0
      const shouldShow = trigger.getBoundingClientRect().bottom <= 0
      setIsVisible((current) => current === shouldShow ? current : shouldShow)
    }
    const scheduleVisibilityUpdate = () => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(updateVisibility)
    }

    scheduleVisibilityUpdate()
    window.addEventListener("scroll", scheduleVisibilityUpdate, { passive: true })
    window.addEventListener("resize", scheduleVisibilityUpdate)
    window.addEventListener("orientationchange", scheduleVisibilityUpdate)
    window.addEventListener("pageshow", scheduleVisibilityUpdate)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener("scroll", scheduleVisibilityUpdate)
      window.removeEventListener("resize", scheduleVisibilityUpdate)
      window.removeEventListener("orientationchange", scheduleVisibilityUpdate)
      window.removeEventListener("pageshow", scheduleVisibilityUpdate)
    }
  }, [])

  return (
    <div
      className={`ms-mobile-cta${isVisible ? " is-visible" : ""}`}
      aria-label="Quick actions"
      aria-hidden={!isVisible}
      inert={!isVisible}
    >
      <a href="tel:6158104910">
        <Phone aria-hidden="true" />
        <span><small>Open 24/7</small>Call now</span>
      </a>
      <a href={quoteHref}>Quote</a>
    </div>
  )
}
