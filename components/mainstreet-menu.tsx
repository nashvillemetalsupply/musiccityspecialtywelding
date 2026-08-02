"use client"

import { useRef } from "react"

export function MainstreetMenu({ homeHref = "" }: { homeHref?: string }) {
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
        <a href={`${homeHref}#contact`} onClick={closeMenu}>Show us the job</a>
        <a href="tel:6158104910" onClick={closeMenu}>Call (615) 810-4910</a>
      </div>
    </details>
  )
}
