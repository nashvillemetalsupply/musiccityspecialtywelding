import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { ArrowUpRight } from "lucide-react"
import { notFound } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { CriticalImage } from "@/components/critical-image"
import { MainstreetContact } from "@/components/mainstreet-contact-section"
import { MobileQuickActions } from "@/components/mobile-quick-actions"
import { createPublicMetadata } from "@/lib/public-metadata"
import { buildServiceStructuredData, servicePageBySlug, servicePages } from "@/lib/service-pages"
import { getShopPhone } from "@/lib/shop-contact"
import { ShopActions } from "@/components/shop-actions"

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

  const structuredData = buildServiceStructuredData(service)

  return (
    <>
      <Navbar />
      <main id="main-content" className="ms-site ms-subpage" data-service={service.slug}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData.service) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData.breadcrumbList) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData.faqPage) }} />

        <nav className="ms-breadcrumb" aria-label="Breadcrumb">
          <Link href="/">Home</Link><span aria-hidden="true">/</span>
          <Link href="/#services">Services</Link><span aria-hidden="true">/</span>
          <span aria-current="page">{service.shortTitle}</span>
        </nav>

        <section className="ms-subhero" id="service">
          <div className="ms-subhero-copy">
            <span className="ms-subhero-eyebrow">{service.eyebrow}</span>
            <h1 className="ms-display">{service.title}</h1>
            <p>{service.intro}</p>
            <ShopActions phoneHref={shopPhone.href} className="ms-hero-actions" />
          </div>
          <figure className="ms-subhero-media">
            <CriticalImage src={service.image} alt={service.imageAlt} fill priority fetchPriority="high" sizes="(max-width: 900px) 100vw, 46vw" />
          </figure>
        </section>

        <Suspense fallback={null}>
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
            <p>Send photos, dimensions, and the location. We&apos;ll ask for what&apos;s missing.</p>
            <Link href="/service-areas">Check the service area <ArrowUpRight aria-hidden="true" /></Link>
          </div>
          <ul>{service.details.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>

        <aside className="ms-subglass">
          <div><span>Your job</span><strong>One private link.</strong></div>
          <p>Once the job is active, your customer page holds job updates, approved progress photos, and paperwork.</p>
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

        <nav className="ms-breadcrumb" aria-label="Other services">
          <span>Other work</span>
          {servicePages.filter((other) => other.slug !== service.slug).map((other) => (
            <Link key={other.slug} href={`/services/${other.slug}`}>{other.shortTitle}</Link>
          ))}
        </nav>

        <MainstreetContact phoneHref={shopPhone.href} phoneDisplay={shopPhone.display} />
        </Suspense>
      </main>
      <Footer />
      <MobileQuickActions phoneHref={shopPhone.href} />
    </>
  )
}
