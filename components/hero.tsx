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
    <section id="home" className="relative min-h-screen flex items-center overflow-x-hidden pt-16 sm:pt-20 md:pt-22 lg:pt-24">
      {/* Visual separator gradient */}
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-border to-transparent hidden lg:block -translate-x-1/2" style={{ left: 'calc(58.333% - 1px)' }}></div>
      
      <div className="container mx-auto px-4 sm:px-5 md:px-6 lg:px-12 xl:px-16 py-6 sm:py-8 md:py-10 lg:py-4">
        {/* MOBILE LAYOUT - Completely different structure */}
        <div className="lg:hidden space-y-6">
          {/* Mobile: Image first, 35-40% viewport max */}
          <div className="w-full" style={{ maxHeight: '38vh' }}>
            <img
              src="/images/welder.webp"
              alt="Professional welding craftsmanship"
              className="w-full h-full object-cover object-center rounded-lg shadow-xl"
              style={{ maxHeight: '38vh', objectPosition: 'center 30%' }}
              loading="lazy"
            />
          </div>

          {/* Mobile: Compact copy */}
          <div className="space-y-4">
            <div className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
              Serving Greater Nashville
            </div>

            <h1 className="font-serif font-bold text-secondary leading-[1.1] tracking-tight text-3xl sm:text-4xl">
              Mobile Welding &amp; Fabrication
            </h1>

            <p className="text-base font-medium text-secondary">
              Fast, on-site commercial &amp; industrial welding.
            </p>

            {/* Mobile: Single CTA */}
            <Button
              size="lg"
              onClick={scrollToContact}
              className="bg-primary hover:bg-primary/90 active:bg-primary/95 text-white h-12 w-full text-base font-semibold shadow-lg touch-manipulation"
            >
              Request a Quote
            </Button>

            {/* Mobile: Description below image - tighter copy */}
            <p className="text-sm text-muted-foreground leading-relaxed pt-2">
              Certified technicians come to you — repairs, fabrication, and on-site work.
            </p>
          </div>
        </div>

        {/* DESKTOP LAYOUT - Original structure */}
        <div className="hidden lg:grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7 space-y-8 relative z-10">
            <div className="space-y-6">
              <div className={`text-sm uppercase tracking-widest text-muted-foreground font-medium transition-all duration-1000 delay-100 ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}>
                Serving Greater Nashville
              </div>

              <h1 className={`font-serif font-bold text-secondary leading-[1.1] tracking-tight transition-all duration-1000 delay-200 ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}
              style={{ fontSize: 'clamp(2rem, 6vw + 0.5rem, 4.5rem)' }}>
                <span className="block">Mobile Welding</span>
                <span className="block">&amp; Fabrication</span>
                <span className="block text-primary italic mt-1">
                  Across Nashville
                </span>
              </h1>

              <p className={`text-xl font-medium text-secondary transition-all duration-1000 delay-300 ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}>
                Fast, on-site welding for equipment, facilities, and fabrication
              </p>

              {/* Credibility anchor line - Desktop only */}
              <p className={`text-sm text-muted-foreground/70 transition-all duration-1000 delay-350 ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}>
                Licensed & insured · Commercial-grade work · Fast on-site response
              </p>

              <p className={`text-lg text-muted-foreground leading-relaxed max-w-2xl transition-all duration-1000 delay-400 ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}>
                Get professional mobile welding services throughout the greater Nashville area. Our certified technicians come directly to you, handling everything from on-site repairs to custom fabrication with dependable workmanship.
              </p>
            </div>

            <div className={`space-y-4 transition-all duration-1000 delay-500 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}>
              <div className="flex gap-4">
                <Button
                  size="lg"
                  onClick={scrollToContact}
                  className="bg-primary hover:bg-primary/90 text-white h-14 px-8 text-base font-semibold shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all duration-300"
                >
                  Request Quote
                </Button>
                <a href="tel:6158104910">
                  <Button 
                    size="lg" 
                    variant="outline" 
                    className="h-14 px-6 text-base font-semibold gap-2 bg-background hover:bg-muted border-2"
                  >
                    <Phone className="h-5 w-5" />
                    (615) 810-4910
                  </Button>
                </a>
              </div>

              <div className="grid grid-cols-3 gap-4 pt-6 max-w-lg">
                <div className="text-left" aria-label="10+ Years of experience">
                  <div className="font-serif text-5xl font-extrabold text-foreground">10+</div>
                  <div className="text-sm text-muted-foreground mt-2 flex items-center gap-1.5">
                    <Clock className="h-4 w-4" />
                    <span>Years</span>
                  </div>
                </div>
                <div className="text-left" aria-label="100+ Projects completed">
                  <div className="font-serif text-5xl font-extrabold text-foreground">100+</div>
                  <div className="text-sm text-muted-foreground mt-2 flex items-center gap-1.5">
                    <Briefcase className="h-4 w-4" />
                    <span>Projects</span>
                  </div>
                </div>
                <div className="text-left" aria-label="24/7 Available for emergencies">
                  <div className="font-serif text-5xl font-extrabold text-foreground">24/7</div>
                  <div className="text-sm text-muted-foreground mt-2 flex items-center gap-1.5">
                    <CheckCircle className="h-4 w-4" />
                    <span>Available</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 relative">
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
      </div>
    </section>
  )
}
