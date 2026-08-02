"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { ArrowUpRight, Camera, Phone, X } from "lucide-react"
import { ADS_CONVERSION_SEND_TO, GA_MEASUREMENT_ID } from "@/lib/measurement"

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
}

const emptyForm: QuoteForm = {
  firstName: "",
  phone: "",
  service: "",
  message: "",
  email: "",
  company: "",
}

export function MainstreetContact() {
  const [formData, setFormData] = useState<QuoteForm>(emptyForm)
  const [photoFiles, setPhotoFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle")
  const [message, setMessage] = useState("")
  const previewsRef = useRef<string[]>([])

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
    payload.append("firstName", formData.firstName)
    payload.append("lastName", "")
    payload.append("phone", formData.phone)
    payload.append("service", formData.service)
    payload.append("message", formData.message)
    payload.append("email", formData.email)
    payload.append("preferredContact", "Call")
    payload.append("company", formData.company)
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
        <p className="ms-kicker">Your turn</p>
        <h2 className="ms-display" id="contact-title">Show us the job.</h2>
        <p>Three things get this moving: your name, your number, and what the metal needs.</p>
        <a className="ms-contact-call" href="tel:6158104910">
          <Phone aria-hidden="true" />
          <span><small>Open 24/7</small><strong>(615) 810-4910</strong></span>
          <ArrowUpRight aria-hidden="true" />
        </a>
        <div className="ms-contact-note">
          <span>Mobile + shop work</span>
          <span>Greater Nashville</span>
          <span>Calls answered 24/7</span>
        </div>
      </div>

      <form className="ms-quote-form" onSubmit={submit} noValidate>
        <div className="ms-form-heading">
          <span>Quote request</span>
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
            <span><strong>Add job photos</strong><small>Up to 5 · 4 MB total</small></span>
          </label>
          <input id="quote-photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" multiple onChange={addPhotos} />
        </div>

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
        <p className="ms-form-fallback">If the form fights you, call <a href="tel:6158104910">(615) 810-4910</a>.</p>
      </form>
    </section>
  )
}
