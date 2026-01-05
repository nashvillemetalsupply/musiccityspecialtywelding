"use client"

import { Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePathname, useRouter } from "next/navigation"

export function StickyMobileCTA() {
  const pathname = usePathname()
  const router = useRouter()

  const scrollToContact = () => {
    if (pathname === "/") {
      // We're on the home page, just scroll
      const element = document.getElementById("contact")
      if (element) {
        element.scrollIntoView({ behavior: "smooth" })
      }
    } else {
      // We're on another page, navigate to home with hash
      router.push("/#contact")
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-background border-t-2 border-primary safe-area-inset-bottom">
      <div className="container mx-auto px-4 py-2.5">
        <div className="flex gap-2">
          <a
            href="tel:6158104910"
            className="flex-1 flex items-center justify-center gap-2 bg-muted hover:bg-muted/80 active:bg-muted/70 text-secondary font-semibold py-2.5 px-3 rounded-lg transition-all touch-manipulation"
            style={{ minHeight: '44px' }}
          >
            <Phone className="h-4 w-4" />
            <span className="text-sm">Call Now</span>
          </a>
          <Button
            onClick={scrollToContact}
            className="flex-1 bg-primary hover:bg-primary/90 active:bg-primary/95 text-white font-semibold py-2.5 px-3 rounded-lg touch-manipulation"
            style={{ minHeight: '44px' }}
          >
            <span className="text-sm">Request Quote</span>
          </Button>
        </div>
      </div>
    </div>
  )
}

