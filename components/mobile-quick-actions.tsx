"use client"

import { useEffect, useState } from "react"
import { Phone } from "lucide-react"

export function MobileQuickActions({ quoteHref = "#contact" }: { quoteHref?: string }) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const trigger = document.querySelector<HTMLElement>(".ms-hero-actions")

    if (!trigger || !("IntersectionObserver" in window)) {
      const frame = window.requestAnimationFrame(() => setIsVisible(true))
      return () => window.cancelAnimationFrame(frame)
    }

    const observer = new IntersectionObserver(([entry]) => {
      setIsVisible(!entry.isIntersecting && entry.boundingClientRect.bottom < 0)
    }, { rootMargin: "-24px 0px 0px" })

    observer.observe(trigger)
    return () => observer.disconnect()
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
