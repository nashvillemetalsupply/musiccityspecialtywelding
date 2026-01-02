export function Footer() {
  return (
    <footer className="bg-secondary text-white py-16 relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-0 left-1/4 w-64 h-64 bg-white rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-white rounded-full blur-3xl"></div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-12 relative">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 md:gap-12 mb-12">
            {/* Company Info */}
            <div className="lg:col-span-2">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-14 h-14 bg-primary rounded-full flex items-center justify-center">
                  <span className="text-white font-bold text-xl">MC</span>
                </div>
                <div>
                  <div className="font-serif font-semibold text-xl leading-none">Music City</div>
                  <div className="text-xs text-white/70 tracking-widest uppercase mt-1">
                    Specialty Welding
                  </div>
                </div>
              </div>

              <p className="text-white/70 leading-relaxed mb-6 max-w-md">
                Professional mobile welding and fabrication services throughout Nashville and surrounding areas.
                Bringing expert craftsmanship directly to you.
              </p>

              <div className="space-y-3 text-sm text-white/70 mb-6">
                <div>Available 24/7 for emergency service</div>
                <div className="text-white/60">Licensed • Insured • Commercial-grade work</div>
              </div>

              {/* Footer CTA */}
              <a
                href="#contact"
                className="inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-medium
                           bg-primary/80 text-white hover:bg-primary
                           transition-all shadow-lg shadow-primary/20
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              >
                Request a Quote
              </a>
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
                <li className="pt-2">
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
                <li>Monday - Friday</li>
                <li>7:00 AM - 6:00 PM (CT)</li>
                <li className="pt-2">Emergency services available 24/7</li>
              </ul>
            </div>
          </div>

          {/* Bottom Bar */}
          <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm text-white/50">
              &copy; {new Date().getFullYear()} Music City Specialty Welding. All rights reserved.
            </p>
            <div className="flex gap-6 text-sm text-white/50">
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
    </footer>
  )
}
