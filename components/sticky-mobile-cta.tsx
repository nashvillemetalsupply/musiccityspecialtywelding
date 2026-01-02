"use client"

import { Phone } from "lucide-react"
import { Button } from "@/components/ui/button"

export function StickyMobileCTA() {
  const scrollToContact = () => {
    const element = document.getElementById("contact")
    if (element) {
      element.scrollIntoView({ behavior: "smooth" })
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-background border-t border-border shadow-2xl">
      <div className="container mx-auto px-4 py-3">
        <div className="flex gap-3">
          <a
            href="tel:6158104910"
            className="flex-1 flex items-center justify-center gap-2 bg-muted hover:bg-muted/80 text-secondary font-semibold py-3.5 px-4 rounded-xl transition-all"
          >
            <Phone className="h-5 w-5" />
            <span>Call Now</span>
          </a>
          <Button
            onClick={scrollToContact}
            className="flex-1 bg-primary hover:bg-primary/90 text-white font-semibold py-3.5 px-4 rounded-xl shadow-lg"
          >
            Request Quote
          </Button>
        </div>
      </div>
    </div>
  )
}

