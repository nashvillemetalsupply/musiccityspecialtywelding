"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

export function HomePageWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  useEffect(() => {
    // Only handle hash navigation on the home page
    if (pathname === "/") {
      const hash = window.location.hash
      if (hash) {
        // Wait for page to fully load, then scroll
        const scrollToHash = () => {
          const id = hash.substring(1) // Remove the #
          const element = document.getElementById(id)
          if (element) {
            element.scrollIntoView({ behavior: "smooth" })
          } else {
            // If element not found yet, try again after a short delay
            setTimeout(scrollToHash, 50)
          }
        }
        
        // Initial delay to ensure DOM is ready
        const timer = setTimeout(scrollToHash, 100)
        return () => clearTimeout(timer)
      }
    }
  }, [pathname])

  return <>{children}</>
}

