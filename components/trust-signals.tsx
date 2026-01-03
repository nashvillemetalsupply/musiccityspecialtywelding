export function TrustSignals() {
  return (
    <section className="py-8 sm:py-10 md:py-12 lg:py-16 bg-muted/50 border-y border-border">
      <div className="container mx-auto px-4 sm:px-5 md:px-6 lg:px-8 xl:px-12">
        <div className="max-w-5xl mx-auto">
          {/* MOBILE: 2-column grid, tighter spacing */}
          <div className="lg:hidden grid grid-cols-2 gap-3 text-center">
            <div className="space-y-1">
              <div className="text-base font-serif font-bold text-primary">✓</div>
              <div className="text-xs font-medium text-secondary leading-tight">Serving Greater Nashville</div>
            </div>
            <div className="space-y-1">
              <div className="text-base font-serif font-bold text-primary">✓</div>
              <div className="text-xs font-medium text-secondary leading-tight">Licensed & Insured</div>
            </div>
            <div className="space-y-1">
              <div className="text-base font-serif font-bold text-primary">✓</div>
              <div className="text-xs font-medium text-secondary leading-tight">Commercial & Industrial Clients</div>
            </div>
            <div className="space-y-1">
              <div className="text-base font-serif font-bold text-primary">✓</div>
              <div className="text-xs font-medium text-secondary leading-tight">Trusted by Contractors & Facilities</div>
            </div>
          </div>

          {/* DESKTOP: 4-column grid */}
          <div className="hidden lg:grid lg:grid-cols-4 gap-8 text-center">
            <div className="space-y-3">
              <div className="text-4xl font-serif font-bold text-primary">✓</div>
              <div className="text-base font-medium text-secondary leading-snug">Serving Greater Nashville</div>
            </div>
            <div className="space-y-3">
              <div className="text-4xl font-serif font-bold text-primary">✓</div>
              <div className="text-base font-medium text-secondary leading-snug">Licensed & Insured</div>
            </div>
            <div className="space-y-3">
              <div className="text-4xl font-serif font-bold text-primary">✓</div>
              <div className="text-base font-medium text-secondary leading-snug">Commercial & Industrial Clients</div>
            </div>
            <div className="space-y-3">
              <div className="text-4xl font-serif font-bold text-primary">✓</div>
              <div className="text-base font-medium text-secondary leading-snug">Trusted by contractors, facilities, and municipalities</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

