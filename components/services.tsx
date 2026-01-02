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

        {/* Services grid - asymmetric editorial layout */}
        <div className="space-y-12 sm:space-y-16">
          {services.map((service, index) => (
            <div
              key={index}
              className={`grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start ${
                index % 2 === 0 ? "" : "lg:grid-flow-dense"
              }`}
            >
              {/* Text content - alternating 6/7 columns */}
              <div className={`lg:col-span-7 space-y-6 order-2 lg:order-1 ${index % 2 === 0 ? "" : "lg:col-start-6"}`}>
                <div className="flex items-start gap-6">
                  <div className="font-serif text-6xl lg:text-7xl text-primary/30 font-bold leading-none">
                    {service.number}
                  </div>
                  <div className="pt-2 flex-1">
                    <h3 className="font-serif font-bold text-2xl sm:text-3xl lg:text-4xl xl:text-5xl text-secondary leading-tight mb-2">
                      {service.title}
                    </h3>
                    {service.subtitle && (
                      <div className="text-lg sm:text-xl lg:text-2xl text-muted-foreground font-serif italic mb-4 sm:mb-6">
                        {service.subtitle}
                      </div>
                    )}
                    <p className="text-base sm:text-lg text-muted-foreground leading-relaxed mb-6 sm:mb-8">{service.description}</p>

                    {/* Qualifying line for service 05 */}
                    {service.qualifying && (
                      <p className="text-sm text-muted-foreground/80 italic mb-6">
                        {service.qualifying}
                      </p>
                    )}

                    {/* Features list */}
                    <div className="flex flex-wrap gap-3 mb-4">
                      {service.features.map((feature, i) => (
                        <div key={i} className="px-4 py-2 bg-background border border-border text-sm font-medium">
                          {feature}
                        </div>
                      ))}
                    </div>

                    {/* Availability line for service 03 */}
                    {service.availability && (
                      <p className="text-sm text-muted-foreground/80 italic mt-2">
                        {service.availability}
                      </p>
                    )}

                    {/* Service radius for service 03 */}
                    {service.serviceRadius && (
                      <p className="text-sm text-muted-foreground/80 italic mt-1">
                        {service.serviceRadius}
                      </p>
                    )}

                    {/* Spec authority for service 05 */}
                    {service.specAuthority && (
                      <p className="text-sm text-muted-foreground/80 italic mt-2">
                        {service.specAuthority}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Image - alternating 5 columns */}
              <div className={`lg:col-span-5 order-1 lg:order-2 ${index % 2 === 0 ? "" : "lg:col-start-1 lg:row-start-1"}`}>
                <div className="relative aspect-[4/3] lg:aspect-auto lg:h-96">
                  <img 
                    src={
                      index === 0 ? "/images/welding_staircase.png" :
                      index === 1 ? "/images/welding_hero_2.png" :
                      index === 2 ? "/images/04_equipment_repair.png" :
                      index === 3 ? "/images/05_specialty_fabrication.png" :
                      "/images/image.jpeg"
                    } 
                    alt={service.title} 
                    className="w-full h-full object-cover shadow-xl" 
                    loading="lazy"
                  />
                  {/* Number overlay on image */}
                  <div className="absolute top-6 right-6 bg-primary text-white w-16 h-16 flex items-center justify-center">
                    <span className="font-serif text-2xl font-bold">{service.number}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA at end of services section */}
        <div className="mt-12 sm:mt-16 lg:mt-20 xl:mt-32 text-center max-w-2xl mx-auto">
          <p className="text-base sm:text-lg text-muted-foreground mb-4 sm:mb-6">
            Have a project or repair need?
            <br />
            Get a quote or talk through your scope.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              onClick={scrollToContact}
              size="lg"
              className="bg-primary hover:bg-primary/90 text-white h-14 px-8 sm:px-10 text-base font-medium shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all duration-300 hover:scale-105 w-full sm:w-auto"
            >
              Request a Quote
            </Button>
            <Button
              onClick={scrollToContact}
              size="lg"
              variant="outline"
              className="h-14 px-8 sm:px-10 text-base font-medium bg-transparent hover:bg-muted transition-all duration-300 w-full sm:w-auto"
            >
              Discuss Your Project
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
