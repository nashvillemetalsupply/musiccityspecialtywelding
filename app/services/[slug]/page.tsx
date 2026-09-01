import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowUpRight, Phone } from "lucide-react"
import { notFound } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { MobileQuickActions } from "@/components/mobile-quick-actions"
import { createPublicMetadata } from "@/lib/public-metadata"
import { servicePageBySlug, servicePages } from "@/lib/service-pages"
import { getShopPhone } from "@/lib/shop-contact"

type PageProps = { params: Promise<{ slug: string }> }

export function generateStaticParams() {
  return servicePages.map(({ slug }) => ({ slug }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const service = servicePageBySlug.get(slug)
  if (!service) return {}

  return createPublicMetadata({
    title: service.seoTitle,
    description: service.metaDescription,
    canonical: `/services/${service.slug}`,
    socialTitle: service.title,
    image: {
      url: service.image,
      alt: service.imageAlt,
    },
  })
}

export default async function ServicePage({ params }: PageProps) {
  const { slug } = await params
  const service = servicePageBySlug.get(slug)
  if (!service) notFound()
  const shopPhone = getShopPhone()

  const schema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: service.shortTitle,
    description: service.metaDescription,
    url: `https://musiccityspecialtywelding.com/services/${service.slug}`,
    areaServed: "Middle Tennessee",
    provider: { "@id": "https://musiccityspecialtywelding.com/#business" },
  }
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://musiccityspecialtywelding.com/" },
      { "@type": "ListItem", position: 2, name: "Services", item: "https://musiccityspecialtywelding.com/#services" },
      { "@type": "ListItem", position: 3, name: service.shortTitle, item: `https://musiccityspecialtywelding.com/services/${service.slug}` },
    ],
  }

  return (
    <>
      <Navbar />
      <main id="main-content" className="ms-site ms-subpage" data-service={service.slug}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

        <nav className="ms-breadcrumb" aria-label="Breadcrumb">
          <Link href="/">Home</Link><span aria-hidden="true">/</span>
          <Link href="/#services">Services</Link><span aria-hidden="true">/</span>
          <span aria-current="page">{service.shortTitle}</span>
        </nav>

        <section className="ms-subhero">
          <div className="ms-subhero-copy">
            <span className="ms-subhero-eyebrow">{service.eyebrow}</span>
            <h1 className="ms-display">{service.title}</h1>
            <p>{service.intro}</p>
            <div className="ms-hero-actions">
              <a className="ms-button ms-button-primary" href={shopPhone.href}><Phone aria-hidden="true" />Call 24/7</a>
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

        <aside className="ms-subglass">
          <div><span>Your private Customer Page</span><strong>No portal. No password. No chasing.</strong></div>
          <p>Once the job is active, one private link carries the promise, live status, approved progress photos, and paperwork.</p>
          <Link href="/#job-glass">See how it works <ArrowUpRight aria-hidden="true" /></Link>
        </aside>

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
            <a href={shopPhone.href}><small>Open 24/7</small>{shopPhone.display}</a>
            <Link href="/#contact">Send the job <ArrowUpRight aria-hidden="true" /></Link>
          </div>
        </section>
      </main>
      <Footer />
      <MobileQuickActions quoteHref="/#contact" phoneHref={shopPhone.href} />
    </>
  )
}
