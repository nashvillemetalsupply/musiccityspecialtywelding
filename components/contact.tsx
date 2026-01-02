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
    <section id="contact" className="py-24 sm:py-32 bg-background relative overflow-x-hidden">
      {/* Background Elements */}
      <div className="absolute top-1/4 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl"></div>
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl"></div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-12 relative">
        <div className="max-w-7xl mx-auto">
          {/* Section Header */}
          <div className="max-w-3xl mb-20 text-center mx-auto">
            <div className="inline-block px-4 py-2 bg-primary/10 rounded-full border border-primary/20 mb-6">
              <span className="text-sm font-medium text-primary">Get Started</span>
            </div>
            <h2 className="font-serif font-semibold text-secondary mb-6 leading-tight tracking-tight max-w-4xl mx-auto" style={{ fontSize: 'clamp(2rem, 4vw + 1rem, 4.5rem)' }}>
              Let's discuss your project
            </h2>
            <p className="text-xl text-muted-foreground leading-relaxed">
              Tell us about your project and get a fast, no-obligation quote.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
            {/* Contact Info */}
            <div className="space-y-8">
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <Phone className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <div className="font-semibold text-lg text-secondary mb-1">Phone</div>
                    <a
                      href="tel:6158104910"
                      className="text-muted-foreground hover:text-primary transition-colors text-lg"
                    >
                      (615) 810-4910
                    </a>
                    <div className="text-sm text-muted-foreground mt-1">Available 24/7 for emergencies</div>
                    <div className="text-sm text-muted-foreground mt-1">Same-day or next-day response available</div>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <Mail className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <div className="font-semibold text-lg text-secondary mb-1">Email</div>
                    <a
                      href="mailto:Sales@musiccityspecialtywelding.com"
                      className="text-muted-foreground hover:text-primary transition-colors text-lg break-all"
                    >
                      Sales@musiccityspecialtywelding.com
                    </a>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <MapPin className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <div className="font-semibold text-lg text-secondary mb-1">Location</div>
                    <div className="text-muted-foreground text-lg">
                      533 W Baddour Pkwy
                      <br />
                      Lebanon, TN 37087
                    </div>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <Clock className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <div className="font-semibold text-lg text-secondary mb-1">Hours</div>
                    <div className="text-muted-foreground text-lg">Mon - Fri: 7:00 AM - 6:00 PM (CT)</div>
                  </div>
                </div>
              </div>

              {/* Image Grid */}
              <div className="grid grid-cols-2 gap-4 pt-8">
                <button
                  onClick={() => setLightboxImage("/images/contact_hero_1.png")}
                  className="aspect-[4/3] rounded-2xl overflow-hidden cursor-pointer hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-primary"
                  aria-label="View larger image"
                >
                  <img src="/images/contact_hero_1.png" alt="Welding work" className="w-full h-full object-cover" loading="lazy" />
                </button>
                <button
                  onClick={() => setLightboxImage("/images/contact_heo_2.png")}
                  className="aspect-[4/3] rounded-2xl overflow-hidden cursor-pointer hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-primary"
                  aria-label="View larger image"
                >
                  <img src="/images/contact_heo_2.png" alt="Welding work" className="w-full h-full object-cover" loading="lazy" />
                </button>
              </div>
            </div>

            {/* Contact Form */}
            <div className="bg-white rounded-3xl p-6 sm:p-8 lg:p-10 shadow-2xl border border-border">
              {/* How it works section */}
              <div className="mb-10 pb-10 border-b border-border">
                <h3 className="text-2xl font-serif font-semibold text-secondary mb-6">How it works</h3>
                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">1</div>
                    <div className="text-muted-foreground">Share details + photos</div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">2</div>
                    <div className="text-muted-foreground">We confirm scope + timeline</div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">3</div>
                    <div className="text-muted-foreground">You get a quote (and we schedule)</div>
                  </div>
                </div>
              </div>

              <form ref={formRef} onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
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
                      className="w-full px-4 py-3.5 sm:py-3 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base"
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
                      className="w-full px-4 py-3.5 sm:py-3 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base"
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
                    className="w-full px-4 py-3.5 sm:py-3 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base"
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
                    className="w-full px-4 py-3.5 sm:py-3 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-secondary mb-2">Service Needed</label>
                  <select
                    name="service"
                    value={formData.service}
                    onChange={handleChange}
                    className="w-full px-4 py-3.5 sm:py-3 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base"
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
                    rows={5}
                    placeholder="Briefly describe your project, location, and timeline (if known)."
                    className="w-full px-4 py-3.5 sm:py-3 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none text-base"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-secondary mb-2">Preferred contact method</label>
                  <select
                    name="preferredContact"
                    value={formData.preferredContact}
                    onChange={handleChange}
                    className="w-full px-4 py-3.5 sm:py-3 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base"
                  >
                    <option value="">Select preferred method</option>
                    <option value="text">Text</option>
                    <option value="call">Call</option>
                    <option value="email">Email</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-secondary mb-2">Upload photos <span className="text-muted-foreground font-normal">(optional)</span></label>
                  <input
                    type="file"
                    name="photos"
                    onChange={handleChange}
                    multiple
                    accept="image/*"
                    className="w-full px-4 py-3.5 sm:py-3 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all file:mr-4 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 text-base"
                  />
                </div>

                <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-2">
                  <p className="text-sm font-medium text-secondary text-center">
                    Most quotes sent within 1 business day.
                  </p>
                  <p className="text-sm text-muted-foreground text-center">
                    Emergency requests handled immediately.
                  </p>
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full bg-primary hover:bg-primary/90 text-white h-14 rounded-full shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all duration-300 group text-base"
                >
                  <span>Request a Quote</span>
                  <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Button>
                <p className="text-xs text-muted-foreground text-center mt-4">
                  Commercial-grade work · Licensed & insured
                </p>
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
