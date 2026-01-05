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
    company: "", // Honeypot field
  })
  const [photoFiles, setPhotoFiles] = useState<File[]>([]) // Store files as array
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle")
  const [errorMessage, setErrorMessage] = useState("")
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Progressive completion: only require firstName and phone
    if (!formData.firstName || !formData.phone) {
      setSubmitStatus("error")
      setErrorMessage("Please provide at least your first name and phone number.")
      return
    }

    // Require service selection
    if (!formData.service) {
      setSubmitStatus("error")
      setErrorMessage("Please select a service needed.")
      return
    }

    setIsSubmitting(true)
    setSubmitStatus("idle")
    setErrorMessage("")

    try {
      // Create FormData to include file uploads
      const formDataToSend = new FormData()
      formDataToSend.append("firstName", formData.firstName)
      formDataToSend.append("lastName", formData.lastName)
      formDataToSend.append("email", formData.email)
      formDataToSend.append("phone", formData.phone)
      formDataToSend.append("service", formData.service)
      formDataToSend.append("message", formData.message)
      formDataToSend.append("preferredContact", formData.preferredContact)
      formDataToSend.append("company", formData.company) // Honeypot
      
      // Append all photo files
      if (photoFiles.length > 0) {
        photoFiles.forEach(file => {
          formDataToSend.append("photos", file)
        })
      }

      const res = await fetch("/api/quote", {
        method: "POST",
        body: formDataToSend, // Don't set Content-Type header - browser will set it with boundary
      })

      const data = await res.json()
      
      if (!res.ok) {
        throw new Error(data?.error || "Failed to submit quote request")
      }

      setSubmitStatus("success")
      // Clean up image preview URLs
      imagePreviews.forEach(url => URL.revokeObjectURL(url))
      setImagePreviews([])
      setPhotoFiles([])
      // Reset form
      setFormData({
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        service: "",
        message: "",
        preferredContact: "",
        company: "",
      })
      // Reset file input
      const fileInput = document.querySelector('input[name="photos"]') as HTMLInputElement
      if (fileInput) {
        fileInput.value = ''
      }
    } catch (err) {
      setSubmitStatus("error")
      setErrorMessage(err instanceof Error ? err.message : "Failed to submit quote request. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    if (e.target.type === 'file') {
      const fileInput = e.target as HTMLInputElement
      const newFiles = fileInput.files
      
      if (newFiles && newFiles.length > 0) {
        // Create preview URLs for newly selected images
        const newPreviews: string[] = []
        const filesToAdd: File[] = []
        
        for (let i = 0; i < newFiles.length; i++) {
          const file = newFiles[i]
          if (file.type.startsWith('image/')) {
            newPreviews.push(URL.createObjectURL(file))
            filesToAdd.push(file)
          }
        }
        
        // Append new previews to existing ones
        setImagePreviews(prev => [...prev, ...newPreviews])
        
        // Append new files to existing files array
        setPhotoFiles(prev => [...prev, ...filesToAdd])
        
        // Reset the file input so user can select more files if needed
        fileInput.value = ''
      }
    } else {
      setFormData({
        ...formData,
        [e.target.name]: e.target.value,
      })
    }
  }

  // Clean up preview URLs when component unmounts or form resets
  useEffect(() => {
    return () => {
      imagePreviews.forEach(url => URL.revokeObjectURL(url))
    }
  }, [imagePreviews])

  const removeImagePreview = (indexToRemove: number) => {
    // Revoke the URL to free memory
    URL.revokeObjectURL(imagePreviews[indexToRemove])
    // Remove from previews
    const newPreviews = imagePreviews.filter((_, index) => index !== indexToRemove)
    setImagePreviews(newPreviews)
    
    // Remove corresponding file from files array
    const newFiles = photoFiles.filter((_, index) => index !== indexToRemove)
    setPhotoFiles(newFiles)
    
    // If all files are removed, clear the file input
    if (newFiles.length === 0) {
      const fileInput = document.querySelector('input[name="photos"]') as HTMLInputElement
      if (fileInput) {
        fileInput.value = ''
      }
    }
  }

  return (
    <section id="contact" className="py-12 sm:py-16 md:py-20 lg:py-24 xl:py-32 bg-background relative overflow-x-hidden">
      {/* Background Elements - Optimized for mobile */}
      <div className="absolute top-1/4 right-0 w-48 h-48 sm:w-64 sm:h-64 md:w-80 md:h-80 lg:w-96 lg:h-96 bg-primary/5 rounded-full blur-3xl"></div>
      <div className="absolute bottom-0 left-0 w-48 h-48 sm:w-64 sm:h-64 md:w-80 md:h-80 lg:w-96 lg:h-96 bg-primary/5 rounded-full blur-3xl"></div>

      <div className="container mx-auto px-4 sm:px-5 md:px-6 lg:px-8 xl:px-12 relative">
        <div className="max-w-7xl mx-auto">
          {/* MOBILE LAYOUT - Clean hierarchy */}
          <div className="lg:hidden space-y-6">
            {/* Headline */}
            <div className="text-center">
              <h2 className="font-serif font-semibold text-secondary mb-2 leading-[1.1] tracking-tight text-2xl">
              Let's discuss your project
            </h2>
              {/* One reassurance line */}
              <p className="text-sm text-muted-foreground">
              Get a fast, no-obligation quote.
            </p>
          </div>

            {/* Form */}
            <div className="bg-white rounded-xl p-5 shadow-xl border border-border">
              <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
                {/* Name */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-secondary mb-1.5">First Name <span className="text-muted-foreground font-normal">*</span></label>
                    <input
                      ref={firstNameInputRef}
                      type="text"
                      name="firstName"
                      value={formData.firstName}
                      onChange={handleChange}
                      autoComplete="given-name"
                      className="w-full px-4 py-3 bg-muted/50 border border-border rounded-lg focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base touch-manipulation"
                      style={{ minHeight: '44px' }}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-secondary mb-1.5">Last Name <span className="text-muted-foreground font-normal">(optional)</span></label>
                    <input
                      type="text"
                      name="lastName"
                      value={formData.lastName}
                      onChange={handleChange}
                      autoComplete="family-name"
                      className="w-full px-4 py-3 bg-muted/50 border border-border rounded-lg focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base touch-manipulation"
                      style={{ minHeight: '44px' }}
                    />
                  </div>
                </div>

                {/* Phone - Required, early in form */}
                <div>
                  <label className="block text-sm font-medium text-secondary mb-1.5">Phone <span className="text-muted-foreground font-normal">*</span></label>
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    autoComplete="tel"
                    className="w-full px-4 py-3 bg-muted/50 border border-border rounded-lg focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base touch-manipulation"
                    style={{ minHeight: '44px' }}
                    inputMode="tel"
                    required
                  />
                </div>

                {/* Service Needed */}
                <div>
                  <label className="block text-sm font-medium text-secondary mb-1.5">Service Needed <span className="text-muted-foreground font-normal">*</span></label>
                  <select
                    name="service"
                    value={formData.service}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-muted/50 border border-border rounded-lg focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base touch-manipulation appearance-none"
                    style={{ minHeight: '44px' }}
                    required
                  >
                    <option value="">Select a service</option>
                    <option>Architectural Welding & Fabrication</option>
                    <option>Mobile Welding (On-Site)</option>
                    <option>Equipment Repair & Maintenance</option>
                    <option>Specialty Fabrication</option>
                    <option>Not Sure / Other</option>
                  </select>
                </div>

                {/* Project Details */}
                <div>
                  <label className="block text-sm font-medium text-secondary mb-1.5">Project Details <span className="text-muted-foreground font-normal">(optional)</span></label>
                  <textarea
                    name="message"
                    value={formData.message}
                    onChange={handleChange}
                    rows={3}
                    placeholder="Briefly describe your project, location, and timeline (if known)."
                    className="w-full px-4 py-3 bg-muted/50 border border-border rounded-lg focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none text-base touch-manipulation"
                    style={{ minHeight: '80px' }}
                  />
                </div>

                {/* Upload Photos */}
                <div>
                  <label className="block text-sm font-medium text-secondary mb-1.5">Upload photos <span className="text-muted-foreground font-normal">(optional)</span></label>
                  <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-border rounded-lg cursor-pointer bg-muted/30 hover:bg-muted/50 active:bg-muted/60 transition-colors touch-manipulation">
                    <div className="flex flex-col items-center justify-center pt-3 pb-3 px-2">
                      <svg className="w-5 h-5 mb-1.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <p className="text-xs text-muted-foreground text-center"><span className="font-semibold">Click to upload</span></p>
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
                  
                  {/* Image Previews */}
                  {imagePreviews.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {imagePreviews.map((preview, index) => (
                        <div key={index} className="relative group">
                          <img
                            src={preview}
                            alt={`Preview ${index + 1}`}
                            className="w-full h-20 object-cover rounded-lg border border-border cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() => setLightboxImage(preview)}
                          />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              removeImagePreview(index)
                            }}
                            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600 transition-colors opacity-0 group-hover:opacity-100"
                            aria-label="Remove image"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Email - Moved to end, optional */}
                <div>
                  <label className="block text-sm font-medium text-secondary mb-1.5">Email <span className="text-muted-foreground font-normal">(optional)</span></label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    autoComplete="email"
                    className="w-full px-4 py-3 bg-muted/50 border border-border rounded-lg focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base touch-manipulation"
                    style={{ minHeight: '44px' }}
                    inputMode="email"
                  />
                </div>

                {/* Honeypot field - hidden from users */}
                <input
                  type="text"
                  name="company"
                  value={formData.company}
                  onChange={handleChange}
                  autoComplete="off"
                  tabIndex={-1}
                  style={{ position: "absolute", left: "-9999px", height: 0, width: 0 }}
                  aria-hidden="true"
                />

                {/* Reassurance text above submit button */}
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                  <p className="text-xs font-medium text-secondary text-center">
                    Most quotes sent within 1 business day.
                  </p>
                </div>

                {/* Success/Error Messages */}
                {submitStatus === "success" && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <p className="text-sm text-green-800 text-center font-medium">
                      Thank you! Your quote request has been submitted. We'll get back to you soon.
                    </p>
                  </div>
                )}
                {submitStatus === "error" && errorMessage && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-sm text-red-800 text-center font-medium">
                      {errorMessage}
                    </p>
                  </div>
                )}

                <Button
                  type="submit"
                  size="lg"
                  disabled={isSubmitting}
                  className="w-full bg-primary hover:bg-primary/90 active:bg-primary/95 text-white h-12 rounded-lg shadow-lg text-base font-semibold touch-manipulation transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ minHeight: '48px' }}
                >
                  {isSubmitting ? "Submitting..." : "Request a Quote"}
                </Button>

                {/* Micro-trust line */}
                <p className="text-xs text-muted-foreground text-center">
                  Emergency requests handled immediately.
                </p>
              </form>
            </div>
          </div>

          {/* DESKTOP LAYOUT - Original structure */}
          <div className="hidden lg:block">
            <div className="max-w-3xl mb-12 text-center mx-auto">
              <h2 className="font-serif font-semibold text-secondary mb-4 leading-[1.1] tracking-tight" style={{ fontSize: 'clamp(1.75rem, 4vw + 0.5rem, 2.5rem)' }}>
                Let's discuss your project
              </h2>
              <p className="text-lg text-muted-foreground">
                Get a fast, no-obligation quote.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-12">
              {/* Contact Info */}
              <div className="space-y-5">
                <div className="bg-white/50 backdrop-blur-sm rounded-2xl p-6 border border-border shadow-sm">
                  <ul className="space-y-4 text-base">
                    <li className="flex items-center gap-2">
                      <a 
                        href="tel:6158104910" 
                        className="text-secondary hover:text-primary font-medium text-lg transition-colors"
                      >
                        (615) 810-4910
                      </a>
                      <span className="text-muted-foreground text-sm">24/7 emergencies</span>
                    </li>
                    <li>
                      <a 
                        href="mailto:Sales@musiccityspecialtywelding.com" 
                        className="text-secondary hover:text-primary break-all transition-colors"
                      >
                        Sales@musiccityspecialtywelding.com
                      </a>
                    </li>
                    <li className="text-muted-foreground flex items-start gap-2">
                      <MapPin className="h-5 w-5 mt-0.5 flex-shrink-0" />
                      <span>533 W Baddour Pkwy, Lebanon, TN 37087</span>
                    </li>
                    <li className="text-muted-foreground flex items-start gap-2">
                      <Clock className="h-5 w-5 mt-0.5 flex-shrink-0" />
                      <span>Mon - Fri: 7:00 AM - 6:00 PM (CT)</span>
                    </li>
                  </ul>
                </div>
              </div>

              {/* Contact Form */}
              <div className="bg-white rounded-3xl p-8 shadow-xl border border-border">
                <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-secondary mb-2">First Name <span className="text-muted-foreground font-normal">*</span></label>
                      <input
                        ref={firstNameInputRef}
                        type="text"
                        name="firstName"
                        value={formData.firstName}
                        onChange={handleChange}
                        autoComplete="given-name"
                        className="w-full px-4 py-3.5 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base"
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
                        className="w-full px-4 py-3.5 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base"
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
                      className="w-full px-4 py-3.5 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base"
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
                      className="w-full px-4 py-3.5 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-secondary mb-2">Service Needed <span className="text-muted-foreground font-normal">*</span></label>
                    <select
                      name="service"
                      value={formData.service}
                      onChange={handleChange}
                      className="w-full px-4 py-3.5 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base appearance-none"
                      required
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
                      className="w-full px-4 py-3.5 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none text-base"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-secondary mb-2">Preferred contact method</label>
                  <select
                    name="preferredContact"
                    value={formData.preferredContact}
                    onChange={handleChange}
                      className="w-full px-4 py-3.5 bg-muted/50 border border-border rounded-xl focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-base appearance-none"
                  >
                    <option value="">Select preferred method</option>
                    <option value="text">Text</option>
                    <option value="call">Call</option>
                    <option value="email">Email</option>
                  </select>
                </div>

                  <div>
                    <label className="block text-sm font-medium text-secondary mb-2">Upload photos <span className="text-muted-foreground font-normal">(optional)</span></label>
                    <label className="flex flex-col items-center justify-center w-full h-36 border-2 border-dashed border-border rounded-xl cursor-pointer bg-muted/30 hover:bg-muted/50 transition-colors">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6 px-2">
                        <svg className="w-8 h-8 mb-2 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <p className="mb-2 text-sm text-muted-foreground text-center"><span className="font-semibold">Click to upload</span> or drag and drop</p>
                        <p className="text-xs text-muted-foreground text-center">PNG, JPG, GIF (optional)</p>
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
                    
                    {/* Image Previews - Desktop */}
                    {imagePreviews.length > 0 && (
                      <div className="mt-4 grid grid-cols-4 gap-3">
                        {imagePreviews.map((preview, index) => (
                          <div key={index} className="relative group">
                            <img
                              src={preview}
                              alt={`Preview ${index + 1}`}
                              className="w-full h-24 object-cover rounded-lg border border-border cursor-pointer hover:opacity-80 transition-opacity"
                              onClick={() => setLightboxImage(preview)}
                            />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                removeImagePreview(index)
                              }}
                              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm hover:bg-red-600 transition-colors opacity-0 group-hover:opacity-100"
                              aria-label="Remove image"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Honeypot field - hidden from users */}
                  <input
                    type="text"
                    name="company"
                    value={formData.company}
                    onChange={handleChange}
                    autoComplete="off"
                    tabIndex={-1}
                    style={{ position: "absolute", left: "-9999px", height: 0, width: 0 }}
                    aria-hidden="true"
                  />

                  {/* Expectation-setting line above button - Desktop only */}
                  <p className="text-xs text-muted-foreground/70 text-center">
                    Most quotes sent within 1 business day. Emergency requests handled immediately.
                  </p>

                  {/* Success/Error Messages */}
                  {submitStatus === "success" && (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                      <p className="text-sm text-green-800 text-center font-medium">
                        Thank you! Your quote request has been submitted. We'll get back to you soon.
                      </p>
                    </div>
                  )}
                  {submitStatus === "error" && errorMessage && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                      <p className="text-sm text-red-800 text-center font-medium">
                        {errorMessage}
                  </p>
                </div>
                  )}

                <Button
                  type="submit"
                  size="lg"
                    disabled={isSubmitting}
                    className="w-full bg-primary hover:bg-primary/90 text-white h-14 rounded-xl shadow-lg text-base font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isSubmitting ? "Submitting..." : "Request a Quote"}
                </Button>

                  {/* Reassurance box below button - Desktop only */}
                  <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-1">
                    <p className="text-sm font-medium text-secondary text-center">
                      Most quotes sent within 1 business day.
                    </p>
                    <p className="text-sm text-muted-foreground text-center">
                      Emergency requests handled immediately.
                    </p>
                  </div>
              </form>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox Modal - Optimized for mobile */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/95 sm:bg-black/90 flex items-center justify-center p-2 sm:p-4 touch-manipulation"
          onClick={() => setLightboxImage(null)}
        >
          <button
            onClick={() => setLightboxImage(null)}
            className="absolute top-2 right-2 sm:top-4 sm:right-4 text-white hover:text-primary active:text-primary/80 transition-colors p-2 sm:p-3 touch-manipulation z-10"
            style={{ minHeight: '44px', minWidth: '44px' }}
            aria-label="Close lightbox"
          >
            <X className="h-6 w-6 sm:h-8 sm:w-8" />
          </button>
          <img
            src={lightboxImage}
            alt="Welding work - enlarged view"
            className="max-w-full max-h-[95vh] sm:max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
            style={{ touchAction: 'none' }}
          />
        </div>
      )}
    </section>
  )
}
