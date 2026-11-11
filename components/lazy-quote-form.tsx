"use client"

import { useEffect, useRef, useState, type ComponentType } from "react"

type QuoteFormProps = { phoneHref: string; phoneDisplay: string }
type FormComponent = ComponentType<QuoteFormProps>

export function createQuoteFormLoader(importForm: () => Promise<{ QuoteForm: FormComponent }>) {
  let pending: Promise<FormComponent> | null = null
  return () => pending ??= importForm().then((module) => module.QuoteForm).catch((error) => {
    pending = null
    throw error
  })
}

const loadQuoteForm = createQuoteFormLoader(() => import("./mainstreet-contact"))

// Start after a paint and an idle opportunity, or sooner when the contact area
// is approaching the viewport. Both triggers share one import and disconnect.
export function scheduleQuoteForm(slot: Element, load: () => void): () => void {
  let active = true
  let frame = 0
  let idle = 0
  let observer: IntersectionObserver | undefined
  const cleanup = () => {
    active = false
    cancelAnimationFrame(frame)
    if (idle && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle)
    observer?.disconnect()
  }
  const start = () => {
    if (!active) return
    cleanup()
    load()
  }
  frame = requestAnimationFrame(() => {
    if (!active) return
    if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(start, { timeout: 2000 })
    else frame = requestAnimationFrame(start)
  })
  if (typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) start()
    }, { rootMargin: "800px", threshold: 0 })
    observer.observe(slot)
  }
  return cleanup
}

export function LazyQuoteForm({ phoneHref, phoneDisplay }: QuoteFormProps) {
  const slot = useRef<HTMLDivElement>(null)
  const alive = useRef(false)
  const [Form, setForm] = useState<FormComponent | null>(null)
  const [failed, setFailed] = useState(false)
  const mount = () => {
    setFailed(false)
    void loadQuoteForm().then((LoadedForm) => {
      if (alive.current) setForm(() => LoadedForm)
    }).catch(() => { if (alive.current) setFailed(true) })
  }
  useEffect(() => {
    alive.current = true
    const cancel = slot.current ? scheduleQuoteForm(slot.current, mount) : () => {}
    return () => { alive.current = false; cancel() }
  }, [])

  // Once mounted, this component type and position never change. No editable
  // SSR fields are replaced, and typed values or autofill stay in the real form.
  if (Form) return <Form phoneHref={phoneHref} phoneDisplay={phoneDisplay} />
  return <div ref={slot} className="ms-quote-form" role="group" aria-label="Job details" aria-busy={!failed} style={{ minHeight: failed ? "auto" : "40rem", alignContent: "start" }}>
    <div className="ms-form-heading"><span>Job details</span><small>{failed ? "Try again or call the shop" : "Opening the form"}</small></div>
    <p className="ms-field-wide" role={failed ? "alert" : "status"}>{failed ? "The job form didn't load. Try again, call the shop, or email the details." : "The job form is loading."}</p>
    {failed && <button className="ms-button ms-button-secondary" type="button" onClick={mount}>Try again</button>}
    <p className="ms-form-fallback ms-field-wide">You can also call <a href={phoneHref}>{phoneDisplay}</a> or <a href="mailto:sales@musiccityspecialtywelding.com">email the shop</a>.</p>
  </div>
}
