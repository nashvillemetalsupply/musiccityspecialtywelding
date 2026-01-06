"use client"

import { useState, useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Menu, X, Phone } from "lucide-react"

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20)
    }
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  const scrollToSection = (id: string) => {
    setIsMobileMenuOpen(false)
    
    if (pathname === "/") {
      // We're on the home page, just scroll
      const element = document.getElementById(id)
      if (element) {
        element.scrollIntoView({ behavior: "smooth" })
      }
    } else {
      // We're on another page, navigate to home with hash
      router.push(`/#${id}`)
    }
  }

  const handleLogoClick = (e: React.MouseEvent) => {
    if (pathname === "/") {
      e.preventDefault()
      scrollToSection("home")
    }
    setIsMobileMenuOpen(false)
  }

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled ? "bg-background/95 backdrop-blur-md shadow-sm py-2 sm:py-3 md:py-4" : "bg-background/80 backdrop-blur-sm py-3 sm:py-4 md:py-6"
      }`}
    >
      <div className="container mx-auto px-4 sm:px-5 md:px-6 lg:px-8 xl:px-12">
        <div className="flex items-center justify-between">
          {/* Logo - editorial minimalist */}
          <Link 
            href="/"
            onClick={handleLogoClick}
            className="flex items-center gap-2 sm:gap-3 md:gap-4 group relative touch-manipulation"
            style={{ minHeight: '44px' }}
            aria-label="Go to home"
          >
            <div className="relative">
              <img 
                src="/images/mcs_welding_logo.png" 
                alt="Music City Specialty Welding Logo" 
                className="h-7 sm:h-8 md:h-10 lg:h-12 w-auto translate-y-1"
              />
            </div>
          </Link>

          {/* Desktop Navigation - minimal and spaced */}
          <div className="hidden lg:flex items-center gap-8 xl:gap-12">
            <button
              onClick={() => scrollToSection("services")}
              className="text-sm text-foreground/60 hover:text-foreground transition-colors tracking-wide uppercase touch-manipulation"
              style={{ minHeight: '44px', display: 'inline-flex', alignItems: 'center' }}
            >
              Services
            </button>
            <button
              onClick={() => scrollToSection("contact")}
              className="text-sm text-foreground/60 hover:text-foreground transition-colors tracking-wide uppercase touch-manipulation"
              style={{ minHeight: '44px', display: 'inline-flex', alignItems: 'center' }}
            >
              Contact
            </button>
            <div className="w-px h-6 bg-border"></div>
            <a 
              href="tel:6158104910" 
              className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors touch-manipulation"
              style={{ minHeight: '44px' }}
            >
              <Phone className="h-4 w-4" />
              (615) 810-4910
            </a>
            <Button
              onClick={() => scrollToSection("contact")}
              size="lg"
              className="bg-primary hover:bg-primary/90 active:bg-primary/95 text-white h-10 sm:h-11 px-6 sm:px-8 font-medium touch-manipulation"
              style={{ minHeight: '44px' }}
            >
              Get Quote
            </Button>
          </div>

          {/* Mobile Menu Button - Only visible on mobile/tablet, hidden on desktop */}
          <button
            className="flex lg:hidden text-foreground hover:text-primary active:text-primary/80 transition-colors touch-manipulation"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle menu"
            style={{ minHeight: '44px', minWidth: '44px', alignItems: 'center', justifyContent: 'center' }}
          >
            {isMobileMenuOpen ? <X className="h-6 w-6 sm:h-7 sm:w-7" /> : <Menu className="h-6 w-6 sm:h-7 sm:w-7" />}
          </button>
        </div>

        {/* Mobile Navigation - Only visible on mobile/tablet */}
        {isMobileMenuOpen && (
          <div className="flex lg:hidden flex-col pt-6 sm:pt-8 pb-4 sm:pb-6 border-t border-border mt-4 sm:mt-6">
            <div className="flex flex-col gap-4 sm:gap-6">
              <button
                onClick={() => scrollToSection("services")}
                className="text-left text-base sm:text-lg text-foreground/70 hover:text-foreground active:text-foreground transition-colors uppercase tracking-wide touch-manipulation py-2"
                style={{ minHeight: '44px' }}
              >
                Services
              </button>
              <button
                onClick={() => scrollToSection("contact")}
                className="text-left text-base sm:text-lg text-foreground/70 hover:text-foreground active:text-foreground transition-colors uppercase tracking-wide touch-manipulation py-2"
                style={{ minHeight: '44px' }}
              >
                Contact
              </button>
              <a 
                href="tel:6158104910" 
                className="flex items-center gap-2 text-base sm:text-lg text-primary font-medium hover:text-primary/80 active:text-primary/60 transition-colors touch-manipulation py-2"
                style={{ minHeight: '44px' }}
              >
                <Phone className="h-5 w-5" />
                (615) 810-4910
              </a>
              <Button
                onClick={() => scrollToSection("contact")}
                className="w-full bg-primary hover:bg-primary/90 active:bg-primary/95 text-white h-12 sm:h-14 font-semibold touch-manipulation"
                style={{ minHeight: '48px' }}
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
