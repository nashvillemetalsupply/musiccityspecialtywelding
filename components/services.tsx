"use client"

import { Button } from "@/components/ui/button"

export function Services() {
  const scrollToContact = () => {
    const element = document.getElementById("contact")
    if (element) {
      element.scrollIntoView({ behavior: "smooth" })
    }
  }

  const services = [
    {
      number: "02",
      title: "Architectural Welding",
      subtitle: "& Fabrication",
      description:
        "Custom metalwork that combines structural strength with refined design. From railings to stair systems, we fabricate code-compliant steel for long-term commercial use.",
      features: ["Custom Design", "Structural Fabrication", "Architectural Details"],
      availability: null,
      qualifying: null,
    },
    {
      number: "03",
      title: "Mobile Welding. Fixed On-Site.",
      subtitle: "",
      description:
        "We come to your site to repair equipment, structural failures, and broken components — fast, clean, and done right the first time.",
      features: ["24/7 Emergency Service", "Industrial & Commercial Equipment", "Rapid On-Site Response"],
      availability: "Typical response: Same-day or next-day availability",
      serviceRadius: "Service radius varies by project scope.",
      qualifying: null,
    },
    {
      number: "04",
      title: "Equipment Repair & Maintenance",
      subtitle: "",
      description:
        "Reliable repair and maintenance for industrial equipment, machinery, and production assets. From scheduled maintenance to urgent repairs, we help minimize downtime and keep production moving.",
      features: ["Industrial Grade", "Preventive Care", "Minimal Downtime"],
      availability: null,
      qualifying: null,
    },
    {
      number: "05",
      title: "Specialty Fabrication",
      subtitle: "& Custom Work",
      description:
        "Expert fabrication of gas manifolds, streetscape poles, custom signage, and specialized metalwork—built to exact specifications, drawings, and real-world installation requirements.",
      features: ["Built-to-Spec", "Drawing-Driven", "Industrial Materials"],
      availability: null,
      qualifying: "Ideal for municipalities, utilities, contractors, and industrial facilities.",
      specAuthority: "Built to drawings, tolerances, and installation requirements.",
    },
  ]

  return (
    <section id="services" className="py-24 lg:py-32 bg-muted overflow-x-hidden">
      <div className="container mx-auto px-4 sm:px-6 lg:px-12">
        {/* Section header - editorial style */}
        <div className="max-w-4xl mb-12 sm:mb-16 lg:mb-20 xl:mb-32">
          <div className="text-xs sm:text-sm uppercase tracking-[0.2em] sm:tracking-[0.3em] text-muted-foreground font-medium mb-4 sm:mb-6">Our Expertise</div>
          <h2 className="font-serif font-bold text-secondary leading-[1.1] tracking-tight mb-6 sm:mb-8 max-w-5xl" style={{ fontSize: 'clamp(1.75rem, 4vw + 0.75rem, 4rem)' }}>
            <span className="block">Complete Welding Solutions</span>
            <span className="block font-medium text-muted-foreground mt-1" style={{ fontSize: 'clamp(1.25rem, 2.5vw + 0.5rem, 2.5rem)' }}>for Commercial & Industrial Work</span>
          </h2>
          <p className="text-base sm:text-lg lg:text-xl xl:text-2xl text-muted-foreground leading-relaxed max-w-2xl border-l-2 border-primary pl-4 sm:pl-6 lg:pl-8 mb-4 sm:mb-6">
          From initial planning to final weld, we handle repairs, fabrication, and on-site work with a focus on durability and clean execution.
          </p>
          
          {/* Proof Strip */}
          <div className="mb-6 sm:mb-8 space-y-2 sm:space-y-3">
            <div className="flex flex-wrap gap-x-3 sm:gap-x-4 gap-y-1.5 sm:gap-y-2 text-xs sm:text-sm font-medium text-muted-foreground">
              <span>Licensed & Insured</span>
              <span className="hidden sm:inline">•</span>
              <span>Commercial-Grade Work</span>
              <span className="hidden sm:inline">•</span>
              <span className="break-words">Serving Greater Nashville</span>
              <span className="hidden sm:inline">•</span>
              <span className="break-words">Same/Next-Day Response (when available)</span>
            </div>
            <div className="text-[10px] sm:text-xs text-muted-foreground/70">
              Contractors • Facilities • Utilities • Municipalities
            </div>
          </div>
        </div>

        {/* Services grid - Mobile-first: heading, description, chips, image */}
        <div className="space-y-10 sm:space-y-12 lg:space-y-16">
          {services.map((service, index) => (
            <div
              key={index}
              className={`grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-12 items-start ${
                index % 2 === 0 ? "" : "lg:grid-flow-dense"
              }`}
            >
              {/* Text content - Mobile order: heading, description, chips */}
              <div className={`lg:col-span-7 space-y-4 ${index % 2 === 0 ? "" : "lg:col-start-6"}`}>
                {/* Heading with reduced section number */}
                <div className="relative">
                  <div className="font-serif text-3xl sm:text-4xl lg:text-5xl text-primary/10 sm:text-primary/15 font-bold leading-none absolute -left-2 sm:-left-4 top-0">
                    {service.number}
                  </div>
                  <div className="pl-8 sm:pl-12">
                    <h3 className="font-serif font-bold text-xl sm:text-2xl lg:text-3xl xl:text-4xl text-secondary leading-tight mb-2">
                      {service.title}
                      {service.subtitle && (
                        <span className="text-muted-foreground font-serif italic"> {service.subtitle}</span>
                      )}
                    </h3>
                  </div>
                </div>

                {/* Description - 2-3 lines max */}
                <p className="text-sm sm:text-base text-muted-foreground leading-relaxed max-w-2xl">
                  {service.description}
                </p>

                {/* Chips - 2-column grid, label style */}
                {service.features && service.features.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 sm:gap-3">
                    {service.features.map((feature, i) => (
                      <div key={i} className="px-3 py-1.5 sm:px-4 sm:py-2 bg-muted/50 text-xs sm:text-sm text-muted-foreground rounded-md">
                        {feature}
                      </div>
                    ))}
                  </div>
                )}

                {/* Additional info - compact */}
                {service.qualifying && (
                  <p className="text-xs sm:text-sm text-muted-foreground/70 italic">
                    {service.qualifying}
                  </p>
                )}
                {service.availability && (
                  <p className="text-xs sm:text-sm text-muted-foreground/70 italic">
                    {service.availability}
                  </p>
                )}
                {service.serviceRadius && (
                  <p className="text-xs sm:text-sm text-muted-foreground/70 italic">
                    {service.serviceRadius}
                  </p>
                )}
                {service.specAuthority && (
                  <p className="text-xs sm:text-sm text-muted-foreground/70 italic">
                    {service.specAuthority}
                  </p>
                )}
              </div>

              {/* Image - optional on mobile, max 45vh */}
              <div className={`lg:col-span-5 ${index % 2 === 0 ? "" : "lg:col-start-1 lg:row-start-1"}`}>
                <div className="relative max-h-[45vh] lg:max-h-none lg:aspect-auto lg:h-96 rounded-lg overflow-hidden">
                  <img 
                    src={
                      index === 0 ? "/images/welding_staircase.png" :
                      index === 1 ? "/images/welding_hero_2.png" :
                      index === 2 ? "/images/04_equipment_repair.png" :
                      index === 3 ? "/images/05_specialty_fabrication.png" :
                      "/images/image.jpeg"
                    } 
                    alt={service.title} 
                    className="w-full h-full object-cover" 
                    loading="lazy"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Single CTA at end of services section */}
        <div className="mt-10 sm:mt-12 lg:mt-16 text-center max-w-2xl mx-auto">
          <Button
            onClick={scrollToContact}
            size="lg"
            className="bg-primary hover:bg-primary/90 text-white h-14 px-8 text-base font-semibold shadow-lg w-full sm:w-auto"
          >
            Request a Quote
          </Button>
        </div>
      </div>
    </section>
  )
}
