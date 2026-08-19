"use client"

import Link from "next/link"
import { Menu as MenuIcon, X as CloseIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { PushToggle } from "./push-toggle"
import { ShopDock } from "./shop-dock"

export function MoreMenu({ role, vapidPublicKey, voiceReady }: { role: "owner" | "crew"; vapidPublicKey: string; voiceReady: boolean }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (["#radio", "#handset"].includes(window.location.hash)) setOpen(true)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])
  useEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const previous = document.body.style.overflow
    const pageSurfaces = [...document.querySelectorAll<HTMLElement>(".jobs-root main")]
    for (const surface of pageSurfaces) surface.inert = true
    document.body.style.overflow = "hidden"
    trigger?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (event.key !== "Tab") return
      const focusable = [...(trigger ? [trigger] : []), ...(panelRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? [])]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener("keydown", keydown)
    return () => {
      document.body.style.overflow = previous
      for (const surface of pageSurfaces) surface.inert = false
      window.removeEventListener("keydown", keydown)
      trigger?.focus()
    }
  }, [open])
  const close = () => setOpen(false)
  return <>
    <button ref={triggerRef} className="ops-more-trigger" type="button" aria-label={open ? "Close menu" : "Open menu"} aria-haspopup="dialog" aria-expanded={open} aria-controls="ops-more-panel" onClick={() => open ? close() : setOpen(true)}><span className="ops-menu-icon" aria-hidden="true"><MenuIcon className="is-menu" /><CloseIcon className="is-close" /></span></button>
    {open && <div className="ops-more-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <aside ref={panelRef} className="ops-more-panel" id="ops-more-panel" role="dialog" aria-modal="true" aria-labelledby="ops-more-title">
        <header><div><span>MCSW</span><h2 id="ops-more-title">Menu</h2></div></header>
        <nav aria-label="MCSW sections">
          {/* The redesigned board. /ops is untouched and stays the default, so
              going back is a matter of not following this link. */}
          <Link href="/board" onClick={close}>Job Control (new)</Link>
          <Link href="/ops?view=updates" onClick={close}>Updates</Link>
          <Link href="/ops?view=promises" onClick={close}>Promises</Link>
          <Link href="/ops?view=regulars" onClick={close}>Regular Customers</Link>
          <Link href="/ops#active-jobs" onClick={close}>Search Jobs</Link>
          {role === "owner" && <Link href="/ops/analytics" onClick={close}>Analytics</Link>}
          <Link href="/ops/install" onClick={close}>Install MCSW Jobs</Link>
          {role === "owner" && <Link href="/ops/shop" onClick={close}>Settings</Link>}
        </nav>
        <ShopDock voiceReady={voiceReady} />
        <div className="ops-more-account">
          <PushToggle vapidPublicKey={vapidPublicKey} />
          <form action="/api/ops/logout" method="post"><button type="submit">Sign out</button></form>
        </div>
      </aside>
    </div>}
  </>
}
