"use client"

import { useEffect, useState } from "react"

export function PaidMoment({ slipId, title, body }: { slipId: number; title: string; body: string }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const key = `mcsw-paid-${slipId}`
    if (localStorage.getItem(key)) return
    const frame = window.requestAnimationFrame(() => setShow(true))
    return () => window.cancelAnimationFrame(frame)
  }, [slipId])
  if (!show) return null
  return <aside className="ops-paid-moment" aria-live="polite">
    <span>Payment update</span>
    <strong>Paid</strong>
    <div><h2>{title}</h2><p>{body}</p></div>
    <button type="button" onClick={() => { localStorage.setItem(`mcsw-paid-${slipId}`, "1"); setShow(false) }}>Got it</button>
  </aside>
}
