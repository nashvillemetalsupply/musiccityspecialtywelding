"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Phone, Clock, Briefcase, CheckCircle } from "lucide-react"

export function Hero() {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    setIsVisible(true)
  }, [])

  const scrollToContact = () => {
    const element = document.getElementById("contact")
    if (element) {
      element.scrollIntoView({ behavior: "smooth" })
    }
  }

  return (
    <section id="home" className="relative min-h-screen flex items-center overflow-x-hidden pt-20 lg:pt-24">
      {/* Visual separator gradient */}
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-border to-transparent hidden lg:block -translate-x-1/2" style={{ left: 'calc(58.333% - 1px)' }}></div>
      
      <div className="container mx-auto px-4 sm:px-6 lg:px-12 xl:px-16 py-6 sm:py-8 lg:py-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-12 items-start">
          {/* Left: Typography Block */}
          <div className="lg:col-span-7 space-y-4 lg:space-y-6 relative z-10">
            {/* Mobile-first structure: Label, Heading, Value Prop, CTA */}
            <div className="space-y-3 lg:space-y-4">
              <div className={`text-xs sm:text-sm uppercase tracking-widest text-muted-foreground font-medium transition-all duration-1000 delay-100 ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}>
                Serving Greater Nashville
              </div>

              <h1 className={`font-serif font-bold text-secondary leading-[1.1] tracking-tight transition-all duration-1000 delay-200 ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}
              style={{ fontSize: 'clamp(2rem, 5vw + 0.5rem, 4rem)' }}>
                Mobile Welding &amp; Fabrication
              </h1>

              <p className={`text-base sm:text-lg font-medium text-secondary transition-all duration-1000 delay-300 ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}>
                Fast, on-site commercial &amp; industrial welding
              </p>

              {/* Single CTA - removed phone button, sticky CTA handles that */}
              <div className={`pt-2 transition-all duration-1000 delay-400 ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}>
                <Button
                  size="lg"
                  onClick={scrollToContact}
                  className="bg-primary hover:bg-primary/90 text-white h-12 sm:h-14 px-8 text-base font-semibold shadow-lg w-full sm:w-auto"
                >
                  Request Quote
                </Button>
              </div>
            </div>
          </div>

          {/* Right: Image - Mobile first, max 45vh */}
          <div className="lg:col-span-5 relative">
            {/* Mobile: Simple single image with height cap */}
            <div className="lg:hidden max-h-[45vh] rounded-lg overflow-hidden shadow-xl">
              <img
                src="/images/welder.webp"
                alt="Professional welding craftsmanship"
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>

            {/* Desktop: Overlapping images */}
            <div className="hidden lg:block relative aspect-[4/3] lg:aspect-auto lg:h-[700px]">
              <div className={`absolute top-8 right-0 w-[85%] aspect-[4/3] z-10 transition-all duration-1000 delay-500 ${
                isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'
              }`}>
                <div className="w-full h-full">
                  <img
                    src="/images/welder.webp"
                    alt="Professional welding craftsmanship"
                    className="w-full h-full object-cover shadow-2xl rounded-sm"
                    loading="lazy"
                  />
                </div>
              </div>
              <div className={`absolute bottom-8 left-[8%] w-[58%] aspect-[4/3] z-20 bg-white p-2 shadow-2xl transition-all duration-1000 delay-700 hover:rotate-1 hover:shadow-3xl ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
              }`}>
                <div className="w-full h-full">
                  <img src="/images/mobile_hero_2.png" alt="Welding detail work" className="w-full h-full object-cover rounded-sm" loading="lazy" />
                </div>
                <div className="absolute bottom-4 left-4 right-4 bg-primary text-white p-4">
                  <div className="text-xs uppercase tracking-wider mb-1">Mobile Service</div>
                  <div className="font-serif text-lg font-semibold">We come to you</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Description paragraph - moved below image on mobile */}
        <div className={`mt-6 lg:mt-8 max-w-2xl transition-all duration-1000 delay-500 ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}>
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
            Get professional mobile welding services throughout the greater Nashville area. Our certified technicians come directly to you, handling everything from on-site repairs to custom fabrication with dependable workmanship.
          </p>
        </div>

        {/* Stats - simplified, no icons, secondary weight */}
        <div className={`mt-6 lg:mt-8 grid grid-cols-3 gap-4 max-w-lg transition-all duration-1000 delay-600 ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}>
          <div className="text-center lg:text-left" aria-label="10+ Years of experience">
            <div className="font-serif text-2xl sm:text-3xl font-bold text-muted-foreground/70">10+</div>
            <div className="text-xs text-muted-foreground/60 mt-1">Years</div>
          </div>
          <div className="text-center lg:text-left" aria-label="100+ Projects completed">
            <div className="font-serif text-2xl sm:text-3xl font-bold text-muted-foreground/70">100+</div>
            <div className="text-xs text-muted-foreground/60 mt-1">Projects</div>
          </div>
          <div className="text-center lg:text-left" aria-label="24/7 Available for emergencies">
            <div className="font-serif text-2xl sm:text-3xl font-bold text-muted-foreground/70">24/7</div>
            <div className="text-xs text-muted-foreground/60 mt-1">Available</div>
          </div>
        </div>
      </div>
    </section>
  )
}
