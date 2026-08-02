"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"

export function Footer() {
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
    <footer className="bg-secondary text-white py-4 lg:py-16 relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-0 left-1/4 w-32 h-32 sm:w-48 sm:h-48 md:w-64 md:h-64 bg-white rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 w-32 h-32 sm:w-48 sm:h-48 md:w-64 md:h-64 bg-white rounded-full blur-3xl"></div>
      </div>

      <div className="container mx-auto px-4 sm:px-5 md:px-6 lg:px-8 xl:px-12 relative">
        <div className="max-w-7xl mx-auto">
          {/* MOBILE LAYOUT - Compressed aggressively */}
          <div className="lg:hidden space-y-4">
            <Link href="/" className="text-center block hover:opacity-80 transition-opacity">
              <div className="font-serif font-semibold text-sm leading-none mb-1">Music City Specialty Welding</div>
              <div className="text-[10px] text-white/60">Mobile • Shop • On-site</div>
            </Link>
            
            <div className="text-center space-y-1 text-xs text-white/70">
              <div>
                <a href="tel:6158104910" className="hover:text-white">(615) 810-4910</a>
              </div>
              <div className="text-white/60">Open 24 hours</div>
            </div>

            <div className="border-t border-white/10 pt-3 text-center">
              <a
                href="https://www.facebook.com/people/Music-City-Specialty-Welding/61585337136685/"
                target="_blank"
                rel="noopener noreferrer"
                className="mb-2 inline-block text-[11px] text-white/70 hover:text-white"
              >
                Facebook
              </a>
              <p className="text-[10px] text-white/50">
                &copy; {new Date().getFullYear()} Music City Specialty Welding
              </p>
            </div>
          </div>

          {/* DESKTOP LAYOUT - Original structure */}
          <div className="hidden lg:block">
            <div className="grid grid-cols-4 gap-12 mb-12">
              {/* Company Info */}
              <div className="col-span-2">
                <Link href="/" className="flex items-center gap-3 mb-6 hover:opacity-80 transition-opacity">
                  <div className="w-14 h-14 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-white font-bold text-xl">MC</span>
                  </div>
                  <div>
                    <div className="font-serif font-semibold text-xl leading-none">Music City</div>
                    <div className="text-xs text-white/70 tracking-widest uppercase mt-1">
                      Specialty Welding
                    </div>
                  </div>
                </Link>

                <p className="text-base text-white/70 leading-relaxed mb-6 max-w-md">
                  Mobile welding and fabrication services throughout Nashville and surrounding areas.
                  On-site and shop work built around the documented project scope.
                </p>

                <div className="space-y-3 text-sm text-white/70 mb-6">
                  <div>Urgent work considered when availability allows</div>
                  <div className="text-white/60">Mobile • Shop • On-site</div>
                </div>

                <button
                  onClick={scrollToContact}
                  className="inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-medium
                             bg-primary/80 text-white hover:bg-primary
                             transition-all shadow-lg shadow-primary/20
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                             touch-manipulation"
                  style={{ minHeight: '44px' }}
                >
                  Request a Quote
                </button>
              </div>

              {/* Contact */}
              <div>
                <h3 className="font-semibold text-lg mb-6">Contact</h3>
                <ul className="space-y-3 text-sm text-white/70">
                  <li>
                    <a href="tel:6158104910" className="hover:text-white transition-colors">
                      (615) 810-4910
                    </a>
                  </li>
                  <li>
                    <a
                      href="mailto:Sales@musiccityspecialtywelding.com"
                      className="hover:text-white transition-colors break-all"
                    >
                      Sales@musiccityspecialtywelding.com
                    </a>
                  </li>
                  <li className="pt-2 text-white/70">
                    533 W Baddour Pkwy
                    <br />
                    Lebanon, TN 37087
                  </li>
                </ul>
              </div>

              {/* Hours */}
              <div>
                <h3 className="font-semibold text-lg mb-6">Hours</h3>
                <ul className="space-y-3 text-sm text-white/70">
                  <li>Monday - Sunday</li>
                  <li>Open 24 hours</li>
                  <li className="pt-2">Urgent work: call to confirm</li>
                </ul>
              </div>
            </div>

            {/* Bottom Bar */}
            <div className="border-t border-white/10 pt-8 flex justify-between items-center">
              <p className="text-sm text-white/50">
                &copy; {new Date().getFullYear()} Music City Specialty Welding. All rights reserved.
              </p>
              <div className="flex gap-6 text-sm text-white/50">
                <a
                  href="https://www.facebook.com/people/Music-City-Specialty-Welding/61585337136685/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  Facebook
                </a>
                <a href="/privacy" className="hover:text-white transition-colors">
                  Privacy Policy
                </a>
                <a href="/terms" className="hover:text-white transition-colors">
                  Terms of Service
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
