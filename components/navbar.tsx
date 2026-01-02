"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Menu, X, Phone } from "lucide-react"

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20)
    }
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id)
    if (element) {
      element.scrollIntoView({ behavior: "smooth" })
      setIsMobileMenuOpen(false)
    }
  }

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled ? "bg-background/95 backdrop-blur-md shadow-sm py-3 sm:py-4" : "bg-background/80 backdrop-blur-sm py-4 sm:py-6"
      }`}
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-12">
        <div className="flex items-center justify-between">
          {/* Logo - editorial minimalist */}
          <button onClick={() => scrollToSection("home")} className="flex items-center gap-4 group relative">
            <div className="relative">
              <img 
                src="/images/music_city_logo.png" 
                alt="Music City Specialty Welding Logo" 
                className="h-8 sm:h-10 lg:h-12 w-auto translate-y-1"
              />
              {/* Underline at 70-75% width, left-aligned to "SPECIALTY WELDING" */}
              <div className="absolute bottom-0 left-0 h-0.5 bg-primary w-[72%]"></div>
            </div>
          </button>

          {/* Desktop Navigation - minimal and spaced */}
          <div className="hidden lg:flex items-center gap-12">
            <button
              onClick={() => scrollToSection("services")}
              className="text-sm text-foreground/60 hover:text-foreground transition-colors tracking-wide uppercase"
            >
              Services
            </button>
            <button
              onClick={() => scrollToSection("contact")}
              className="text-sm text-foreground/60 hover:text-foreground transition-colors tracking-wide uppercase"
            >
              Contact
            </button>
            <div className="w-px h-6 bg-border"></div>
            <a href="tel:6158104910" className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Phone className="h-4 w-4" />
              (615) 810-4910
            </a>
            <Button
              onClick={() => scrollToSection("contact")}
              size="lg"
              className="bg-primary hover:bg-primary/90 text-white h-11 px-8 font-medium"
            >
              Get Quote
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="lg:hidden text-foreground"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {/* Mobile Navigation */}
        {isMobileMenuOpen && (
          <div className="lg:hidden pt-8 pb-6 border-t border-border mt-6">
            <div className="flex flex-col gap-6">
              <button
                onClick={() => scrollToSection("services")}
                className="text-left text-lg text-foreground/70 hover:text-foreground transition-colors uppercase tracking-wide"
              >
                Services
              </button>
              <button
                onClick={() => scrollToSection("contact")}
                className="text-left text-lg text-foreground/70 hover:text-foreground transition-colors uppercase tracking-wide"
              >
                Contact
              </button>
              <a href="tel:6158104910" className="flex items-center gap-2 text-lg text-primary font-medium">
                <Phone className="h-5 w-5" />
                (615) 810-4910
              </a>
              <Button
                onClick={() => scrollToSection("contact")}
                className="w-full bg-primary hover:bg-primary/90 text-white h-12"
              >
                Get Quote
              </Button>
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}
