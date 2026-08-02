"use client"

import { useEffect } from "react"

type DeferredGoogleTagProps = {
  containerId: string
}

export function DeferredGoogleTag({ containerId }: DeferredGoogleTagProps) {
  useEffect(() => {
    const scriptId = "deferred-google-tag"
    let loaded = false

    function loadTag() {
      if (loaded || document.getElementById(scriptId)) return
      loaded = true

      const script = document.createElement("script")
      script.id = scriptId
      script.async = true
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(containerId)}`
      document.head.appendChild(script)
    }

    const events = ["pointerdown", "keydown", "touchstart", "scroll"] as const
    events.forEach((eventName) =>
      window.addEventListener(eventName, loadTag, { once: true, passive: true })
    )
    const fallback = window.setTimeout(loadTag, 8000)

    return () => {
      window.clearTimeout(fallback)
      events.forEach((eventName) => window.removeEventListener(eventName, loadTag))
    }
  }, [containerId])

  return null
}
