"use client"

import type { ButtonHTMLAttributes, PointerEvent as ReactPointerEvent, ReactNode } from "react"
import { useRef, useState } from "react"
import { useFormStatus } from "react-dom"
import { safeActionMovement } from "@/lib/shop-brain-invariants.mjs"

type Point = { x: number; y: number }

function useScrollSafePress() {
  const start = useRef<Point | null>(null)
  const canceled = useRef(false)
  function pointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    start.current = { x: event.clientX, y: event.clientY }
    canceled.current = false
  }
  function pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!start.current) return
    if (safeActionMovement(start.current.x, start.current.y, event.clientX, event.clientY)) canceled.current = true
  }
  function pointerCancel() {
    start.current = null
    canceled.current = true
  }
  function consumeCanceled() {
    const value = canceled.current
    start.current = null
    canceled.current = false
    return value
  }
  return { pointerDown, pointerMove, pointerCancel, consumeCanceled }
}

export function SafeSubmitButton({
  children,
  pendingLabel = "Working…",
  className = "",
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; pendingLabel?: string }) {
  const { pending } = useFormStatus()
  const press = useScrollSafePress()
  return <button
    {...props}
    type="submit"
    className={`ops-safe-action ${className}`.trim()}
    disabled={pending || props.disabled}
    aria-busy={pending}
    onPointerDown={press.pointerDown}
    onPointerMove={press.pointerMove}
    onPointerCancel={press.pointerCancel}
    onClick={(event) => {
      if (press.consumeCanceled()) { event.preventDefault(); event.stopPropagation(); return }
      onClick?.(event)
    }}
  >{pending ? pendingLabel : children}</button>
}

export function SafeActionButton({
  children,
  busyLabel = "Working…",
  onAction,
  className = "",
  disabled = false,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type" | "onClick"> & {
  children: ReactNode
  busyLabel?: string
  onAction: () => Promise<void> | void
}) {
  const [busy, setBusy] = useState(false)
  const press = useScrollSafePress()
  return <button
    {...props}
    type="button"
    className={`ops-safe-action ${className}`.trim()}
    disabled={busy || disabled}
    aria-busy={busy}
    onPointerDown={press.pointerDown}
    onPointerMove={press.pointerMove}
    onPointerCancel={press.pointerCancel}
    onClick={async (event) => {
      if (press.consumeCanceled()) { event.preventDefault(); return }
      if (busy || disabled) return
      setBusy(true)
      try { await onAction() } finally { setBusy(false) }
    }}
  >{busy ? busyLabel : children}</button>
}
