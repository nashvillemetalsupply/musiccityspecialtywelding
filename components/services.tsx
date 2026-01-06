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
    <section id="services" className="py-12 sm:py-16 md:py-20 lg:py-24 xl:py-32 bg-muted overflow-x-hidden">
      <div className="container mx-auto px-4 sm:px-5 md:px-6 lg:px-8 xl:px-12">
        {/* Section header - editorial style */}
        <div className="max-w-4xl mb-8 sm:mb-12 md:mb-16 lg:mb-20 xl:mb-32">
          <div className="text-xs sm:text-sm uppercase tracking-[0.2em] sm:tracking-[0.3em] text-muted-foreground font-medium mb-3 sm:mb-4 md:mb-6">Our Expertise</div>
          <h2 className="font-serif font-bold text-secondary leading-[1.1] tracking-tight mb-4 sm:mb-6 md:mb-8 max-w-5xl" style={{ fontSize: 'clamp(1.75rem, 5vw + 0.75rem, 4rem)' }}>
            <span className="block">Complete Welding Solutions</span>
            <span className="block font-medium text-muted-foreground mt-1 sm:mt-2" style={{ fontSize: 'clamp(1.25rem, 3vw + 0.5rem, 2.5rem)' }}>for Commercial & Industrial Work</span>
          </h2>
          <p className="text-sm sm:text-base md:text-lg lg:text-xl xl:text-2xl text-muted-foreground leading-relaxed max-w-2xl border-l-2 border-primary pl-3 sm:pl-4 md:pl-6 lg:pl-8 mb-4 sm:mb-6">
          From initial planning to final weld, we handle repairs, fabrication, and on-site work with a focus on durability and clean execution.
          </p>
          
          {/* Proof Strip */}
          <div className="mb-4 sm:mb-6 md:mb-8 space-y-2 sm:space-y-3">
            <div className="flex flex-wrap gap-x-2 sm:gap-x-3 md:gap-x-4 gap-y-1.5 sm:gap-y-2 text-xs sm:text-sm font-medium text-muted-foreground">
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

        {/* MOBILE LAYOUT - Card structure */}
        <div className="lg:hidden space-y-6">
          {services.map((service, index) => (
            <div key={index} className="bg-white rounded-lg p-5 space-y-4 shadow-sm border border-border">
              {/* Service Name */}
              <div className="relative">
                <h3 className="font-serif font-bold text-xl text-secondary leading-tight pr-12">
                  {service.title}
                  {service.subtitle && (
                    <span className="block text-base text-muted-foreground font-serif italic mt-1">
                      {service.subtitle}
                    </span>
                  )}
                </h3>
                {/* Number watermark - hidden on mobile, desktop only */}
                <div className="hidden lg:block absolute top-0 right-0 font-serif text-4xl text-primary/10 font-bold leading-none">
                  {service.number}
                </div>
              </div>

              {/* 1-2 line value statement */}
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
                {service.description}
              </p>

              {/* Bullet points - Max 3, short, verb-led */}
              <ul className="space-y-1">
                {service.features.slice(0, 3).map((feature, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-primary mt-0.5 flex-shrink-0">•</span>
                    <span className="leading-tight">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* Optional image - AFTER text, locked sizing for consistency */}
              <div className="w-full overflow-hidden rounded-lg mt-4" style={{ maxHeight: '35vh', aspectRatio: '4/3' }}>
                <img 
                  src={
                    index === 0 ? "/images/Service 02.jpg" :
                    index === 1 ? "/images/Service 03.jpg" :
                    index === 2 ? "/images/Service 04.jpg" :
                    index === 3 ? "/images/Service 05.jpg" :
                    "/images/image.jpeg"
                  } 
                  alt={service.title} 
                  className="w-full h-full object-cover" 
                  style={{ maxHeight: '35vh', objectFit: 'cover', aspectRatio: '4/3' }}
                  loading="lazy"
                />
              </div>

              {/* Additional info if exists */}
              {service.availability && (
                <p className="text-xs text-muted-foreground/80 italic">
                  {service.availability}
                </p>
              )}
              {service.serviceRadius && (
                <p className="text-xs text-muted-foreground/80 italic">
                  {service.serviceRadius}
                </p>
              )}
              {service.qualifying && (
                <p className="text-xs text-muted-foreground/80 italic">
                  {service.qualifying}
                </p>
              )}
              {service.specAuthority && (
                <p className="text-xs text-muted-foreground/80 italic">
                  {service.specAuthority}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* DESKTOP LAYOUT - Original asymmetric editorial layout with strict visual rhythm */}
        <div className="hidden lg:block space-y-20">
          {services.map((service, index) => (
            <div
              key={index}
              className={`grid grid-cols-12 gap-12 items-start ${
                index % 2 === 0 ? "" : "grid-flow-dense"
              }`}
            >
              <div className={`col-span-7 space-y-6 ${index % 2 === 0 ? "" : "col-start-6"}`}>
                <div className="flex items-start gap-6">
                  <div className="font-serif text-7xl text-primary/30 font-bold leading-none flex-shrink-0">
                    {service.number}
                  </div>
                  <div className="pt-2 flex-1">
                    <h3 className="font-serif font-bold text-5xl text-secondary leading-tight mb-2">
                      {service.title}
                    </h3>
                    {service.subtitle && (
                      <div className="text-2xl text-muted-foreground font-serif italic mb-6">
                        {service.subtitle}
                      </div>
                    )}
                    <p className="text-lg text-muted-foreground leading-relaxed mb-8">{service.description}</p>

                    {service.qualifying && (
                      <p className="text-sm text-muted-foreground/80 italic mb-6">
                        {service.qualifying}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-3 mb-4">
                      {service.features.map((feature, i) => (
                        <div key={i} className="px-4 py-2 bg-background border border-border text-sm font-medium">
                          {feature}
                        </div>
                      ))}
                    </div>

                    {service.availability && (
                      <p className="text-sm text-muted-foreground/80 italic mt-2">
                        {service.availability}
                      </p>
                    )}
                    {service.serviceRadius && (
                      <p className="text-sm text-muted-foreground/80 italic mt-1">
                        {service.serviceRadius}
                      </p>
                    )}
                    {service.specAuthority && (
                      <p className="text-sm text-muted-foreground/80 italic mt-2">
                        {service.specAuthority}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className={`col-span-5 ${index % 2 === 0 ? "" : "col-start-1 row-start-1"}`}>
                <div className="relative h-96 rounded-xl overflow-hidden">
                  <img 
                    src={
                      index === 0 ? "/images/Service 02.jpg" :
                      index === 1 ? "/images/Service 03.jpg" :
                      index === 2 ? "/images/Service 04.jpg" :
                      index === 3 ? "/images/Service 05.jpg" :
                      "/images/image.jpeg"
                    } 
                    alt={service.title} 
                    className="w-full h-full object-cover shadow-xl" 
                    loading="lazy"
                  />
                  <div className="absolute top-6 right-6 bg-primary text-white w-16 h-16 flex items-center justify-center rounded">
                    <span className="font-serif text-2xl font-bold">{service.number}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA removed - only hero, form, and sticky CTAs on mobile */}
      </div>
    </section>
  )
}
