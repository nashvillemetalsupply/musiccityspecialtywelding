"use client"

import { useRef, type KeyboardEvent } from "react"
import { FALLBACK_SHOP_PHONE_DISPLAY, FALLBACK_SHOP_PHONE_HREF } from "@/lib/shop-phone-shared"
import { AskShopButton } from "@/components/shop-actions"

export function MainstreetMenu({ homeHref = "", phoneHref = FALLBACK_SHOP_PHONE_HREF, phoneDisplay = FALLBACK_SHOP_PHONE_DISPLAY }: { homeHref?: string; phoneHref?: string; phoneDisplay?: string }) {
  const menuRef = useRef<HTMLDetailsElement>(null)
  const summaryRef = useRef<HTMLElement>(null)

  function closeMenu() {
    if (menuRef.current) menuRef.current.open = false
  }

  function closeMenuAndRestoreFocus() {
    closeMenu()
    summaryRef.current?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== "Escape" || !menuRef.current?.open) return
    event.preventDefault()
    closeMenuAndRestoreFocus()
  }

  return (
    <details className="ms-menu" ref={menuRef} onKeyDown={handleKeyDown}>
      <summary ref={summaryRef} aria-label="Open navigation"><span></span><span></span></summary>
      <button className="ms-menu-backdrop" type="button" tabIndex={-1} aria-label="Close navigation" onClick={closeMenuAndRestoreFocus} />
      <div className="ms-menu-panel">
        <a href={`${homeHref}#work`} onClick={closeMenu}>The work</a>
        <a href={`${homeHref}#services`} onClick={closeMenu}>What we weld</a>
        <a href={`${homeHref}#job-glass`} onClick={closeMenu}>Your job</a>
        <a className="ms-button ms-button-primary" href={phoneHref} onClick={closeMenu} aria-label={`Call the shop at ${phoneDisplay}`}>Call the shop</a>
        <AskShopButton onClick={closeMenu} />
      </div>
    </details>
  )
}
