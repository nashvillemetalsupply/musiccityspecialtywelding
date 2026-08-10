"use client"

import { useRef } from "react"
import { FALLBACK_SHOP_PHONE_DISPLAY, FALLBACK_SHOP_PHONE_HREF } from "@/lib/shop-phone-shared"

export function MainstreetMenu({ homeHref = "", phoneHref = FALLBACK_SHOP_PHONE_HREF, phoneDisplay = FALLBACK_SHOP_PHONE_DISPLAY }: { homeHref?: string; phoneHref?: string; phoneDisplay?: string }) {
  const menuRef = useRef<HTMLDetailsElement>(null)

  function closeMenu() {
    if (menuRef.current) menuRef.current.open = false
  }

  return (
    <details className="ms-menu" ref={menuRef}>
      <summary aria-label="Open navigation"><span></span><span></span></summary>
      <div className="ms-menu-panel">
        <a href={`${homeHref}#work`} onClick={closeMenu}>The work</a>
        <a href={`${homeHref}#services`} onClick={closeMenu}>What we weld</a>
        <a href={`${homeHref}#job-glass`} onClick={closeMenu}>Customer Page</a>
        <a href={`${homeHref}#contact`} onClick={closeMenu}>Show us the job</a>
        <a href={phoneHref} onClick={closeMenu}>Call {phoneDisplay}</a>
      </div>
    </details>
  )
}
