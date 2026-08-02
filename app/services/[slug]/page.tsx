import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowUpRight, Phone } from "lucide-react"
import { notFound } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { MobileQuickActions } from "@/components/mobile-quick-actions"
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
      <main className="ms-site ms-subpage" data-service={service.slug}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />

        <section className="ms-subhero">
          <div className="ms-subhero-copy">
            <h1 className="ms-display">{service.title}</h1>
            <p>{service.intro}</p>
            <div className="ms-hero-actions">
              <a className="ms-button ms-button-primary" href="tel:6158104910"><Phone aria-hidden="true" />Call 24/7</a>
              <Link className="ms-text-link" href="/#contact">Show us the job <ArrowUpRight aria-hidden="true" /></Link>
            </div>
          </div>
          <figure className="ms-subhero-media">
            <Image src={service.image} alt={service.imageAlt} fill priority fetchPriority="high" sizes="(max-width: 900px) 100vw, 46vw" />
          </figure>
        </section>

        <section className="ms-subscope">
          <div>
            <h2 className="ms-display">What we handle.</h2>
            <ul>{service.commonJobs.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
          <div>
            <h2 className="ms-display">A good fit when.</h2>
            <ul>{service.goodFit.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        </section>

        <section className="ms-subplan">
          <div className="ms-subplan-lead">
            <h2 className="ms-display">Help us see the whole job.</h2>
            <p>Clear information gets you a useful answer faster. Send what you have; we&apos;ll ask for what is missing.</p>
            <Link href="/service-areas">Check the service area <ArrowUpRight aria-hidden="true" /></Link>
          </div>
          <ul>{service.details.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>

        <section className="ms-subfaq">
          <h2 className="ms-display">Straight answers.</h2>
          <div>
            {service.faqs.map((faq) => (
              <details key={faq.question}>
                <summary>{faq.question}<i aria-hidden="true">+</i></summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="ms-subclose">
          <h2 className="ms-display">Tell us what the metal is doing.</h2>
          <div>
            <p>Photos. Location. Timing. The honest version of what happened.</p>
            <a href="tel:6158104910"><small>Open 24/7</small>(615) 810-4910</a>
            <Link href="/#contact">Send the job <ArrowUpRight aria-hidden="true" /></Link>
          </div>
        </section>
      </main>
      <Footer />
      <MobileQuickActions quoteHref="/#contact" />
    </>
  )
}
