"use client"

import { useEffect, useRef } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { jobFragmentScrollTarget, revealJobFragment } from "./job-fragment"

/** Keep Price and incoming job links useful when detail sections start closed. */
export function JobFragmentNavigation() {
  const marker = useRef<HTMLSpanElement>(null)
  const pathname = usePathname()
  const search = useSearchParams().toString()

  useEffect(() => {
    const root = marker.current?.closest<HTMLElement>(".job-page")
    const dock = root?.querySelector<HTMLElement>(".job-action-spine")
    if (!root || !dock) return
    let frame = 0
    const keepFocusClear = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        if (!root.getClientRects().length) return
        const target = root.ownerDocument.activeElement
        if (!(target instanceof HTMLElement) || !root.contains(target) || dock.contains(target)) return
        const bounds = target.getBoundingClientRect()
        const dockBounds = dock.getBoundingClientRect()
        const headerBottom = root.closest(".ops-frame")?.querySelector(":scope > .ops-top")?.getBoundingClientRect().bottom ?? 0
        // A section can be larger than the clear viewport; moving it again
        // would undo the deliberate start position of a fragment jump.
        if (bounds.height > dockBounds.top - headerBottom - 32) return
        if (bounds.bottom > dockBounds.top - 16 || bounds.top < headerBottom + 16) {
          target.scrollIntoView({ block: "nearest", behavior: "instant" })
        }
      })
    }
    const measure = () => {
      root.style.setProperty("--job-dock-height", `${Math.ceil(dock.getBoundingClientRect().height)}px`)
      keepFocusClear()
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(dock)
    root.addEventListener("focusin", keepFocusClear)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
      root.removeEventListener("focusin", keepFocusClear)
      root.style.removeProperty("--job-dock-height")
    }
  }, [pathname])

  useEffect(() => {
    const root = marker.current?.closest<HTMLElement>(".job-page")
    if (!root) return
    let frame = 0
    const reveal = (fragment = window.location.hash) => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        if (!root.getClientRects().length) return
        const target = revealJobFragment(root, fragment)
        if (!target) return
        jobFragmentScrollTarget(root, target).scrollIntoView({ block: "start", behavior: "instant" })
        target.focus({ preventScroll: true })
      })
    }
    const followLocation = () => reveal()
    const followLink = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return
      const url = new URL(link.href, window.location.href)
      if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.search === window.location.search && url.hash) {
        // Also runs when this exact hash is already selected and a person has
        // since closed the drawer; browsers do not fire hashchange then.
        reveal(url.hash)
      }
    }
    reveal()
    root.addEventListener("click", followLink)
    window.addEventListener("hashchange", followLocation)
    window.addEventListener("popstate", followLocation)
    return () => {
      window.cancelAnimationFrame(frame)
      root.removeEventListener("click", followLink)
      window.removeEventListener("hashchange", followLocation)
      window.removeEventListener("popstate", followLocation)
    }
  }, [pathname, search])

  return <span ref={marker} hidden aria-hidden="true" />
}
