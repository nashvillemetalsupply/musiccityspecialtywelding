"use client"

import Image from "next/image"
import { useEffect, useRef, useState } from "react"

type DeferredWorkImageProps = { src: string; alt: string; sizes: string }

// Observe the full photo slot, not an empty zero-height marker. The figure owns
// its aspect ratio throughout, so mounting a photo never changes the layout.
export function observeWorkImage(slot: Element, load: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    load()
    return () => {}
  }
  let active = true
  const observer = new IntersectionObserver((entries) => {
    if (!active || !entries.some((entry) => entry.isIntersecting)) return
    active = false
    observer.disconnect()
    load()
  }, { rootMargin: "240px", threshold: 0 })
  observer.observe(slot)
  return () => { active = false; observer.disconnect() }
}

export function DeferredWorkImage({ src, alt, sizes }: DeferredWorkImageProps) {
  const slot = useRef<HTMLSpanElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (slot.current) return observeWorkImage(slot.current, () => setReady(true))
  }, [])

  return <span ref={slot} role="img" aria-label={alt} style={{ position: "absolute", inset: 0, display: "block" }}>
    {ready && <Image src={src} alt={alt} fill quality={60} sizes={sizes} />}
    <noscript>
      {/* A genuine photo remains available when JavaScript is disabled. */}
      <img src={src} alt={alt} sizes={sizes} loading="lazy" decoding="async" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
    </noscript>
  </span>
}
