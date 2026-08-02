import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { StickyMobileCTA } from "@/components/sticky-mobile-cta"
import { servicePageBySlug, servicePages } from "@/lib/service-pages"

type PageProps = { params: Promise<{ slug: string }> }

export function generateStaticParams() {
  return servicePages.map(({ slug }) => ({ slug }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const service = servicePageBySlug.get(slug)
  if (!service) return {}

  return {
    title: service.shortTitle,
    description: service.metaDescription,
    alternates: { canonical: `/services/${service.slug}` },
    openGraph: {
      url: `/services/${service.slug}`,
      title: service.title,
      description: service.metaDescription,
      images: [{ url: service.image, alt: service.imageAlt }],
    },
  }
}

export default async function ServicePage({ params }: PageProps) {
  const { slug } = await params
  const service = servicePageBySlug.get(slug)
  if (!service) notFound()

  const schema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: service.shortTitle,
    description: service.metaDescription,
    url: `https://musiccityspecialtywelding.com/services/${service.slug}`,
    areaServed: "Middle Tennessee",
    provider: { "@id": "https://musiccityspecialtywelding.com/#business" },
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-background pb-20 pt-24 sm:pt-28 lg:pb-0 lg:pt-32">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
        <section className="container mx-auto px-4 py-12 sm:px-6 lg:px-12 lg:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-7">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">{service.eyebrow}</p>
              <h1 className="mt-4 font-serif text-4xl font-bold leading-tight text-secondary sm:text-5xl">{service.title}</h1>
              <p className="mt-6 max-w-3xl text-lg leading-relaxed text-muted-foreground">{service.intro}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/#contact" className="inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-6 font-semibold text-white hover:bg-primary/90">
                  Request a quote
                </Link>
                <a href="tel:6158104910" className="inline-flex min-h-12 items-center justify-center rounded-md border border-border px-6 font-semibold text-secondary hover:bg-muted">
                  Call (615) 810-4910
                </a>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-border lg:col-span-5">
              <img
                src={service.image}
                alt={service.imageAlt}
                width={1000}
                height={750}
                className="aspect-[4/3] h-full w-full object-cover"
                loading="eager"
                fetchPriority="high"
                decoding="async"
              />
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-muted/30 py-14 sm:py-20">
          <div className="container mx-auto grid gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:px-12">
            <div>
              <h2 className="font-serif text-3xl font-bold text-secondary">Common requests</h2>
              <ul className="mt-6 space-y-3 text-muted-foreground">
                {service.commonJobs.map((item) => (
                  <li key={item} className="flex gap-3"><span className="text-primary">✓</span><span>{item}</span></li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="font-serif text-3xl font-bold text-secondary">A good fit when</h2>
              <ul className="mt-6 space-y-3 text-muted-foreground">
                {service.goodFit.map((item) => (
                  <li key={item} className="flex gap-3"><span className="text-primary">✓</span><span>{item}</span></li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="container mx-auto grid gap-12 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:px-12 lg:py-24">
          <div className="lg:col-span-5">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Get a useful answer faster</p>
            <h2 className="mt-3 font-serif text-3xl font-bold text-secondary">What to include with your request</h2>
            <ol className="mt-7 space-y-5">
              {service.details.map((item, index) => (
                <li key={item} className="flex gap-4 text-muted-foreground">
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-primary text-sm font-bold text-white">{index + 1}</span>
                  <span className="pt-1">{item}</span>
                </li>
              ))}
            </ol>
            <Link href="/service-areas" className="mt-8 inline-flex min-h-11 items-center font-semibold text-primary hover:text-primary/80">Review the service area</Link>
          </div>
          <div className="lg:col-span-7">
            <h2 className="font-serif text-3xl font-bold text-secondary">Frequently asked questions</h2>
            <div className="mt-6 divide-y divide-border rounded-xl border border-border px-5 sm:px-7">
              {service.faqs.map((faq) => (
                <details key={faq.question} className="py-5">
                  <summary className="cursor-pointer list-none font-semibold text-secondary">{faq.question}</summary>
                  <p className="mt-3 leading-relaxed text-muted-foreground">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-secondary px-4 py-14 text-center text-white sm:px-6">
          <h2 className="font-serif text-3xl font-bold">Have photos and project details ready?</h2>
          <p className="mx-auto mt-3 max-w-2xl text-white/70">Send the location, scope, timing, and clear photos so we can determine the right next step.</p>
          <Link href="/#contact" className="mt-7 inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-7 font-semibold text-white hover:bg-primary/90">Start a quote request</Link>
        </section>
      </main>
      <Footer />
      <StickyMobileCTA />
    </>
  )
}
