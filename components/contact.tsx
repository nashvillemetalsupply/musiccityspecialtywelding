"use client"

import type React from "react"
import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Phone, MapPin, Clock, Mail, ArrowRight, X } from "lucide-react"

export function Contact() {
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    service: "",
    message: "",
    preferredContact: "",
    photos: null as FileList | null,
  })
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const firstNameInputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // Auto-focus first field when form enters viewport
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && firstNameInputRef.current) {
            // Small delay to ensure smooth scroll completes
            setTimeout(() => {
              firstNameInputRef.current?.focus()
            }, 500)
            observer.disconnect()
          }
        })
      },
      { threshold: 0.3 }
    )

    if (formRef.current) {
      observer.observe(formRef.current)
    }

    return () => observer.disconnect()
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Progressive completion: only require firstName and phone
    if (!formData.firstName || !formData.phone) {
      alert("Please provide at least your first name and phone number.")
      return
    }
    console.log("Form submitted:", formData)
    // Here you would typically send to your backend
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    if (e.target.type === 'file') {
      const fileInput = e.target as HTMLInputElement
      setFormData({
        ...formData,
        photos: fileInput.files,
      })
    } else {
      setFormData({
        ...formData,
        [e.target.name]: e.target.value,
      })
    }
  }

  return (
    <section id="contact" className="py-16 sm:py-24 lg:py-32 bg-background relative overflow-x-hidden">
      {/* Background Elements */}
      <div className="absolute top-1/4 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl"></div>
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl"></div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-12 relative">
        <div className="max-w-7xl mx-auto">
          {/* Section Header - Simplified */}
          <div className="max-w-3xl mb-8 sm:mb-12 text-center mx-auto">
            <h2 className="font-serif font-semibold text-secondary mb-3 sm:mb-4 leading-[1.1] tracking-tight" style={{ fontSize: 'clamp(1.5rem, 3vw + 0.5rem, 2.5rem)' }}>
              Let's discuss your project
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground">
              Get a fast, no-obligation quote.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 sm:gap-12">
            {/* Contact Info - Compact list */}
            <div className="space-y-4">
              <ul className="space-y-3 text-sm sm:text-base">
                <li>
                  <a href="tel:6158104910" className="text-secondary hover:text-primary font-medium">
                    (615) 810-4910
                  </a>
                  <span className="text-muted-foreground text-xs ml-2">24/7 emergencies</span>
                </li>
                <li>
                  <a href="mailto:Sales@musiccityspecialtywelding.com" className="text-secondary hover:text-primary break-all">
                    Sales@musiccityspecialtywelding.com
                  </a>
                </li>
                <li className="text-muted-foreground">
                  533 W Baddour Pkwy, Lebanon, TN 37087
                </li>
                <li className="text-muted-foreground">
                  Mon - Fri: 7:00 AM - 6:00 PM (CT)
                </li>
              </ul>
            </div>

            {/* Contact Form */}
            <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 lg:p-8 shadow-xl border border-border">
              <form ref={formRef} onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-4">
                  <div>
                    <label className="block text-sm font-medium text-secondary mb-2">First Name <span className="text-muted-foreground font-normal">*</span></label>
                    <input
                      ref={firstNameInputRef}
                      type="text"
                      name="firstName"
                      value={formData.firstName}
                      onChange={handleChange}
                      autoComplete="given-name"
                      className="w-full px-4 py-4 sm:py-3.5 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-secondary mb-2">Last Name <span className="text-muted-foreground font-normal">(optional)</span></label>
                    <input
                      type="text"
                      name="lastName"
                      value={formData.lastName}
                      onChange={handleChange}
                      autoComplete="family-name"
                      className="w-full px-4 py-4 sm:py-3.5 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-secondary mb-2">Email <span className="text-muted-foreground font-normal">(optional)</span></label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    autoComplete="email"
                    className="w-full px-4 py-4 sm:py-3.5 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-secondary mb-2">Phone <span className="text-muted-foreground font-normal">*</span></label>
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    autoComplete="tel"
                    className="w-full px-4 py-4 sm:py-3.5 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-secondary mb-2">Service Needed</label>
                  <select
                    name="service"
                    value={formData.service}
                    onChange={handleChange}
                    className="w-full px-4 py-4 sm:py-3.5 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base"
                  >
                    <option value="">Select a service</option>
                    <option>Architectural Welding & Fabrication</option>
                    <option>Mobile Welding (On-Site)</option>
                    <option>Equipment Repair & Maintenance</option>
                    <option>Specialty Fabrication</option>
                    <option>Not Sure / Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-secondary mb-2">Project Details <span className="text-muted-foreground font-normal">(optional)</span></label>
                  <textarea
                    name="message"
                    value={formData.message}
                    onChange={handleChange}
                    rows={4}
                    placeholder="Briefly describe your project, location, and timeline (if known)."
                    className="w-full px-4 py-4 sm:py-3.5 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none text-base"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-secondary mb-2">Preferred contact method</label>
                  <select
                    name="preferredContact"
                    value={formData.preferredContact}
                    onChange={handleChange}
                    className="w-full px-4 py-4 sm:py-3.5 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base"
                  >
                    <option value="">Select preferred method</option>
                    <option value="text">Text</option>
                    <option value="call">Call</option>
                    <option value="email">Email</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-secondary mb-2">Upload photos <span className="text-muted-foreground font-normal">(optional)</span></label>
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-border rounded-xl cursor-pointer bg-muted/30 hover:bg-muted/50 transition-colors">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <svg className="w-8 h-8 mb-2 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <p className="mb-2 text-sm text-muted-foreground"><span className="font-semibold">Click to upload</span> or drag and drop</p>
                      <p className="text-xs text-muted-foreground">PNG, JPG, GIF (optional)</p>
                    </div>
                    <input
                      type="file"
                      name="photos"
                      onChange={handleChange}
                      multiple
                      accept="image/*"
                      className="hidden"
                    />
                  </label>
                </div>

                <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 sm:p-4 space-y-1">
                  <p className="text-sm font-medium text-secondary text-center">
                    Most quotes sent within 1 business day.
                  </p>
                  <p className="text-xs sm:text-sm text-muted-foreground text-center">
                    Emergency requests handled immediately.
                  </p>
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full bg-primary hover:bg-primary/90 text-white h-14 rounded-xl shadow-lg text-base font-semibold"
                >
                  Request a Quote
                </Button>
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <button
            onClick={() => setLightboxImage(null)}
            className="absolute top-4 right-4 text-white hover:text-primary transition-colors p-2"
            aria-label="Close lightbox"
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={lightboxImage}
            alt="Welding work - enlarged view"
            className="max-w-full max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </section>
  )
}
