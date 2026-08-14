"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { ArrowUpRight, Camera, Phone, X } from "lucide-react"
import { captureAttribution } from "@/lib/attribution"
import { ADS_CONVERSION_SEND_TO, GA_MEASUREMENT_ID } from "@/lib/measurement"
import { FALLBACK_SHOP_PHONE_DISPLAY, FALLBACK_SHOP_PHONE_HREF } from "@/lib/shop-phone-shared"

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

const allowedPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"])
const maxPhotoCount = 5
const maxPhotoSize = 3 * 1024 * 1024
const maxTotalPhotoSize = 4 * 1024 * 1024

type QuoteForm = {
  firstName: string
  phone: string
  service: string
  message: string
  email: string
  company: string
  textConsent: boolean
}

const emptyForm: QuoteForm = {
  firstName: "",
  phone: "",
  service: "",
  message: "",
  email: "",
  company: "",
  textConsent: false,
}

export function MainstreetContact({ phoneHref = FALLBACK_SHOP_PHONE_HREF, phoneDisplay = FALLBACK_SHOP_PHONE_DISPLAY }: { phoneHref?: string; phoneDisplay?: string }) {
  const [formData, setFormData] = useState<QuoteForm>(emptyForm)
  const [photoFiles, setPhotoFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle")
  const [message, setMessage] = useState("")
  const previewsRef = useRef<string[]>([])
  // Keep one durable identity for every user submission attempt. A network
  // retry must resume the same job and provider sends, not manufacture a
  // duplicate lead. Rotate it only after the server confirms success.
  const intakeKeyRef = useRef("")

  useEffect(() => {
    previewsRef.current = previews
  }, [previews])

  useEffect(() => {
    return () => previewsRef.current.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  const updateField = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData((current) => ({ ...current, [event.target.name]: event.target.value }))
    if (status !== "idle") setStatus("idle")
  }

  const addPhotos = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ""
    if (!selected.length) return

    const nextFiles: File[] = []
    const nextPreviews: string[] = []
    let totalSize = photoFiles.reduce((sum, file) => sum + file.size, 0)
    let validation = ""

    for (const file of selected) {
      if (photoFiles.length + nextFiles.length >= maxPhotoCount) {
        validation = `Up to ${maxPhotoCount} photos.`
        break
      }
      if (!allowedPhotoTypes.has(file.type)) {
        validation = "Use JPG, PNG, WebP, GIF, HEIC, or HEIF photos."
        continue
      }
      if (file.size > maxPhotoSize) {
        validation = "Each photo must be 3 MB or smaller."
        continue
      }
      if (totalSize + file.size > maxTotalPhotoSize) {
        validation = "Photos must total 4 MB or less."
        continue
      }
      nextFiles.push(file)
      nextPreviews.push(URL.createObjectURL(file))
      totalSize += file.size
    }

    setPhotoFiles((current) => [...current, ...nextFiles])
    setPreviews((current) => [...current, ...nextPreviews])
    if (validation) {
      setStatus("error")
      setMessage(validation)
    }
  }

  const removePhoto = (index: number) => {
    URL.revokeObjectURL(previews[index])
    setPreviews((current) => current.filter((_, itemIndex) => itemIndex !== index))
    setPhotoFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!formData.firstName.trim() || !formData.phone.trim() || !formData.service) {
      setStatus("error")
      setMessage("Add your name, phone, and the kind of job.")
      return
    }

    setIsSubmitting(true)
    setStatus("idle")
    setMessage("")

    const payload = new FormData()
    if (!intakeKeyRef.current) intakeKeyRef.current = crypto.randomUUID()
    payload.append("intakeKey", intakeKeyRef.current)
    payload.append("firstName", formData.firstName)
    payload.append("lastName", "")
    payload.append("phone", formData.phone)
    payload.append("service", formData.service)
    payload.append("message", formData.message)
    payload.append("email", formData.email)
    payload.append("preferredContact", "Call")
    payload.append("company", formData.company)
    if (formData.textConsent) payload.append("textConsent", "yes")
    const attribution = captureAttribution()
    for (const [key, value] of Object.entries(attribution)) {
      if (value) payload.append(key, value)
    }
    photoFiles.forEach((file) => payload.append("photos", file))

    try {
      const response = await fetch("/api/quote", { method: "POST", body: payload })
      const contentType = response.headers.get("content-type")
      if (!contentType?.includes("application/json")) throw new Error("The server returned an invalid response.")
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || "The request did not go through.")

      if (GA_MEASUREMENT_ID && window.gtag) {
        window.gtag("event", "generate_lead", {
          send_to: GA_MEASUREMENT_ID,
          lead_source: "website_quote_form",
          service_requested: formData.service,
        })
      }
      if (ADS_CONVERSION_SEND_TO && window.gtag) {
        window.gtag("event", "conversion", { send_to: ADS_CONVERSION_SEND_TO })
      }

      previews.forEach((url) => URL.revokeObjectURL(url))
      setPreviews([])
      setPhotoFiles([])
      setFormData(emptyForm)
      intakeKeyRef.current = ""
      setStatus("success")
      setMessage("Got it. We’ll review the job and call you back. If it cannot wait, call now. We’re open 24/7.")
    } catch (error) {
      setStatus("error")
      setMessage(error instanceof Error ? error.message : "The request did not go through. Call the shop instead.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="ms-contact" id="contact" aria-labelledby="contact-title">
      <div className="ms-contact-lead">
        <h2 className="ms-display" id="contact-title">Show us the job.</h2>
        <p>Three things get this moving: your name, your number, and what the metal needs.</p>
        <a className="ms-contact-call" href={phoneHref}>
          <Phone aria-hidden="true" />
          <span><small>Open 24/7</small><strong>{phoneDisplay}</strong></span>
          <ArrowUpRight aria-hidden="true" />
        </a>
      </div>

      <form className="ms-quote-form" onSubmit={submit} noValidate>
        <div className="ms-form-heading">
          <span>Work order</span>
          <span className="wm-order-no">Nº assigned on receipt</span>
          <small>Required fields marked *</small>
        </div>

        <div className="ms-field">
          <label htmlFor="quote-name">Your name *</label>
          <input id="quote-name" name="firstName" value={formData.firstName} onChange={updateField} autoComplete="given-name" required />
        </div>

        <div className="ms-field">
          <label htmlFor="quote-phone">Phone *</label>
          <input id="quote-phone" name="phone" type="tel" inputMode="tel" value={formData.phone} onChange={updateField} autoComplete="tel" required />
        </div>

        <div className="ms-field">
          <label htmlFor="quote-service">What kind of job? *</label>
          <select id="quote-service" name="service" value={formData.service} onChange={updateField} required>
            <option value="">Pick the closest fit</option>
            <option>Mobile Welding (On-Site)</option>
            <option>Trailer / Truck Welding Repair</option>
            <option>Equipment & Structural Repair</option>
            <option>Architectural Welding & Fabrication</option>
            <option>Specialty Fabrication</option>
            <option>Aluminum / Boat Welding</option>
            <option>Custom Wrought Iron Mailboxes</option>
            <option>Custom Metal Planter Boxes</option>
            <option>Stainless Countertops / Manifolds</option>
            <option>Not Sure / Other</option>
          </select>
        </div>

        <div className="ms-field ms-field-wide">
          <label htmlFor="quote-details">What are we looking at?</label>
          <textarea id="quote-details" name="message" value={formData.message} onChange={updateField} rows={4} placeholder="What broke or needs built? Add the location and timing if you know them." />
        </div>

        <div className="ms-field">
          <label htmlFor="quote-email">Email <span>optional</span></label>
          <input id="quote-email" name="email" type="email" inputMode="email" value={formData.email} onChange={updateField} autoComplete="email" />
        </div>

        <div className="ms-field ms-upload-field">
          <span className="ms-upload-label">Photos <i>optional</i></span>
          <label className="ms-upload" htmlFor="quote-photos">
            <Camera aria-hidden="true" />
            <span><strong>Add job photos</strong><small>Up to 5 / 4 MB total</small></span>
          </label>
          <input id="quote-photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" multiple onChange={addPhotos} />
        </div>

        <label className="ms-text-consent" htmlFor="quote-text-consent">
          <input
            id="quote-text-consent"
            name="textConsent"
            type="checkbox"
            checked={formData.textConsent}
            onChange={(event) => setFormData((current) => ({ ...current, textConsent: event.target.checked }))}
          />
          <span><strong>Text me about this job <i>optional</i></strong><small>By checking this box, you agree to receive recurring customer-care and job-update text messages from Music City Specialty Welding about this request. Message frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is optional and is not a condition of purchase. See our <a href="/privacy">privacy policy</a> and <a href="/terms">terms</a>.</small></span>
        </label>

        {previews.length > 0 && (
          <div className="ms-previews" aria-label="Selected photos">
            {previews.map((preview, index) => (
              <div key={preview}>
                {/* Blob previews intentionally use a regular image element. */}
                <img src={preview} alt={`Selected job photo ${index + 1}`} />
                <button type="button" onClick={() => removePhoto(index)} aria-label={`Remove photo ${index + 1}`}><X aria-hidden="true" /></button>
              </div>
            ))}
          </div>
        )}

        <input className="ms-honeypot" name="company" value={formData.company} onChange={updateField} tabIndex={-1} autoComplete="off" aria-hidden="true" />

        {status !== "idle" && (
          <p className={`ms-form-status ${status === "success" ? "is-success" : "is-error"}`} role={status === "error" ? "alert" : "status"}>{message}</p>
        )}

        <button className="ms-submit" type="submit" disabled={isSubmitting}>
          <span>{isSubmitting ? "Sending the job…" : "Send the job"}</span>
          <ArrowUpRight aria-hidden="true" />
        </button>
        <p className="ms-form-fallback">If the form fights you, call <a href={phoneHref}>{phoneDisplay}</a>.</p>
      </form>
    </section>
  )
}
