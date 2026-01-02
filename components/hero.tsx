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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 lg:gap-12 items-center">
          {/* Left: Large Typography Block - Takes 7 columns */}
          <div className="lg:col-span-7 space-y-4 sm:space-y-6 relative z-10">
            <div className="space-y-3 sm:space-y-4">
              {/* Editorial number accent */}
              <div className="flex items-start gap-3 sm:gap-4 lg:gap-6">
  <div className={`font-serif text-5xl sm:text-6xl lg:text-7xl xl:text-8xl text-primary font-bold leading-none flex-shrink-0 transition-all duration-1000 ${
    isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-8'
  } relative`}>
    <span className="absolute inset-0 bg-primary/5 rounded-lg blur-xl -z-10"></span>
    01
  </div>

  <div className={`pt-4 space-y-3 transition-all duration-1000 delay-200 ${
    isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
  }`}>
    <div className="text-xs sm:text-sm uppercase tracking-[0.3em] sm:tracking-[0.4em] text-muted-foreground font-medium">
      Serving Greater Nashville
    </div>

    <h1 className={`font-serif font-bold text-secondary leading-[1.1] tracking-tight transition-all duration-1000 delay-300 ${
      isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
    }`}
    style={{ fontSize: 'clamp(2rem, 4vw + 1rem, 4.5rem)' }}>
      <span className="block">Mobile Welding</span>
      <span className="block">&amp; Fabrication</span>
      <span className="block text-primary italic mt-1">
        Across Nashville
      </span>
    </h1>
    {/* Decision acceleration copy */}
    <p className={`text-base sm:text-lg lg:text-xl font-medium text-secondary mt-3 sm:mt-4 transition-all duration-1000 delay-400 ${
      isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
    }`}>
      Fast, on-site welding for equipment, facilities, and fabrication
    </p>
  </div>
</div>


              <p className="text-sm sm:text-base lg:text-lg xl:text-xl text-muted-foreground leading-relaxed max-w-2xl pl-4 sm:pl-8 lg:pl-16 xl:pl-32 border-l-2 border-primary">Get professional mobile welding services throughout the greater Nashville area. Our certified technicians come directly to you, handling everything from on-site repairs to custom fabrication with dependable workmanship.
              </p>
            </div>

            {/* Editorial-style CTA section */}
            <div className="pl-0 sm:pl-8 lg:pl-16 xl:pl-32 space-y-4 mt-6 sm:mt-4">
              <div className="flex flex-col sm:flex-row gap-4">
                <Button
                  size="lg"
                  onClick={scrollToContact}
                  className="bg-primary hover:bg-primary/90 text-white h-14 sm:h-16 px-8 sm:px-12 text-base font-medium shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all duration-300 hover:scale-105 w-full sm:w-auto"
                >
                  Request Quote
                </Button>
                <a href="tel:6158104910" className="w-full sm:w-auto">
                  <Button size="lg" variant="outline" className="h-14 sm:h-16 px-6 sm:px-8 text-base font-medium gap-2 bg-transparent hover:bg-muted/50 transition-all duration-300 w-full sm:w-auto">
                    <Phone className="h-5 w-5" />
                    (615) 810-4910
                  </Button>
                </a>
              </div>

              {/* Stats in editorial layout */}
              <div className="grid grid-cols-3 gap-3 sm:gap-4 lg:gap-6 pt-6 max-w-lg">
                <div className="border-l-2 border-foreground pl-2 sm:pl-4" aria-label="10+ Years of experience">
                  <div className="font-serif text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground">10+</div>
                  <div className="text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground mt-1 sm:mt-2 flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                    <span>Years</span>
                  </div>
                </div>
                <div className="border-l-2 border-foreground pl-2 sm:pl-4" aria-label="100+ Projects completed">
                  <div className="font-serif text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground">100+</div>
                  <div className="text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground mt-1 sm:mt-2 flex items-center gap-1">
                    <Briefcase className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                    <span>Projects</span>
                  </div>
                </div>
                <div className="border-l-2 border-foreground pl-2 sm:pl-4" aria-label="24/7 Available for emergencies">
                  <div className="font-serif text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground">24/7</div>
                  <div className="text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground mt-1 sm:mt-2 flex items-center gap-1">
                    <CheckCircle className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                    <span>Available</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Overlapping Images - Takes 5 columns */}
          <div className="lg:col-span-5 relative aspect-[4/3] lg:aspect-auto lg:h-[700px] mt-6 sm:mt-8 lg:mt-0">
            {/* Main large image - intentionally positioned with top spacing for visual breathing room */}
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

            {/* Overlapping smaller image - intentionally stacked with precise overlap positioning */}
            <div className={`absolute bottom-8 left-[8%] w-[58%] aspect-[4/3] z-20 bg-white p-2 shadow-2xl transition-all duration-1000 delay-700 hover:rotate-1 hover:shadow-3xl ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}>
              <div className="w-full h-full">
                <img src="/images/mobile_hero_2.png" alt="Welding detail work" className="w-full h-full object-cover rounded-sm" loading="lazy" />
              </div>
              {/* Editorial caption overlay */}
              <div className="absolute bottom-4 left-4 right-4 bg-primary text-white p-4">
                <div className="text-xs uppercase tracking-wider mb-1">Mobile Service</div>
                <div className="font-serif text-lg font-semibold">We come to you</div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </section>
  )
}
