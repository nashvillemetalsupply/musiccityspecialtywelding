export function Footer() {
  return (
    <footer className="bg-secondary text-white py-8 sm:py-10 relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-0 left-1/4 w-64 h-64 bg-white rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-white rounded-full blur-3xl"></div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-12 relative">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 mb-6 sm:mb-8">
            {/* Company Info - Compressed */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center">
                  <span className="text-white font-bold text-base">MC</span>
                </div>
                <div>
                  <div className="font-serif font-semibold text-base leading-none">Music City</div>
                  <div className="text-[10px] text-white/70 tracking-widest uppercase">
                    Specialty Welding
                  </div>
                </div>
              </div>
              <p className="text-xs text-white/60 leading-relaxed">
                Licensed • Insured • Commercial-grade work
              </p>
            </div>

            {/* Contact - Compressed */}
            <div>
              <h3 className="font-semibold text-sm mb-3">Contact</h3>
              <ul className="space-y-1.5 text-xs text-white/70">
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
                <li>533 W Baddour Pkwy, Lebanon, TN 37087</li>
              </ul>
            </div>

            {/* Hours - Compressed */}
            <div>
              <h3 className="font-semibold text-sm mb-3">Hours</h3>
              <ul className="space-y-1.5 text-xs text-white/70">
                <li>Mon - Fri: 7:00 AM - 6:00 PM (CT)</li>
                <li>Emergency: 24/7</li>
              </ul>
            </div>
          </div>

          {/* Bottom Bar - Compressed */}
          <div className="border-t border-white/10 pt-4 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-white/50">
            <p className="text-center sm:text-left">
              &copy; {new Date().getFullYear()} Music City Specialty Welding
            </p>
            <div className="flex gap-4">
              <a href="/privacy" className="hover:text-white transition-colors">
                Privacy
              </a>
              <a href="/terms" className="hover:text-white transition-colors">
                Terms
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
