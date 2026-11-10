import Image from "next/image"
import Link from "next/link"
import { ArrowUpRight, MapPin } from "lucide-react"
import {
  Gusset,
  PlateStamp,
  TennesseeMap,
  Torch,
  WeldSeam,
} from "@/components/weldment"
import { Footer } from "@/components/footer"
import { MainstreetContact } from "@/components/mainstreet-contact"
import { MobileQuickActions } from "@/components/mobile-quick-actions"
import { Navbar } from "@/components/navbar"
import { ShopActions } from "@/components/shop-actions"
import { createPublicMetadata, publicDefaultDescription, publicDefaultTitle } from "@/lib/public-metadata"
import { getShopPhone } from "@/lib/shop-contact"
import "./homepage-polish.css"

export const metadata = createPublicMetadata({
  title: publicDefaultTitle,
  description: publicDefaultDescription,
  canonical: "/",
})

const services = [
  {
    title: "Mobile welding",
    mobileTitleLines: ["Mobile welding"],
    line: "The metal stays put. We bring the rig.",
    detail: "On-site welding and repair for trucks, trailers, equipment, aluminum, structures, and working metal across Middle Tennessee. No towing required.",
    href: "/services/mobile-welding",
    image: "/images/owner-work/IMG_20260225_135845.webp",
    alt: "Installed steel balcony railing completed on-site by Music City Specialty Welding",
  },
  {
    title: "Trailer welding & repair",
    mobileTitleLines: ["Trailer welding", "& repair"],
    line: "Frames, ramps, and the steel carrying the load.",
    detail: "Frames, crossmembers, ramps, fenders, brackets, and attachment points evaluated around the load they still have to carry.",
    href: "/services/trailer-welding-repair",
    image: "/images/owner-work/trailer-repair.webp",
    alt: "Trailer undergoing structural welding repair",
  },
  {
    title: "Equipment repair",
    mobileTitleLines: ["Equipment", "repair"],
    line: "Get the working metal back in shape.",
    detail: "Failed brackets, machinery frames, guards, supports, and attachments repaired around how the equipment moves, mounts, and works.",
    href: "/services/equipment-repair",
    image: "/images/optimized/Service 04.webp",
    alt: "Welding repair on working industrial equipment",
  },
  {
    title: "Architectural metal",
    mobileTitleLines: ["Architectural", "metal"],
    line: "Railings and stairs fitted to the space.",
    detail: "Railings, stairs, supports, and architectural steel with clean welds and a precise fit in the real space.",
    href: "/services/architectural-welding",
    image: "/images/optimized/Service 02.webp",
    alt: "Finished black steel railing on a Tennessee property",
  },
  {
    title: "Specialty fabrication",
    mobileTitleLines: ["Specialty", "fabrication"],
    line: "Built from the drawing or the job in front of us.",
    detail: "One-offs, manifolds, frames, brackets, signage, and built-to-spec work made for the job in front of us.",
    href: "/services/custom-fabrication",
    image: "/images/optimized/speciality_welding.webp",
    alt: "Custom fabricated gas manifold installed on a commercial building",
  },
  {
    title: "Custom metalwork",
    mobileTitleLines: ["Custom", "metalwork"],
    line: "Mailboxes and planters made for the property.",
    detail: "Mailboxes, cluster units, planters, and exterior steel sized for the property, not a retail shelf.",
    href: "/services/custom-metal-products",
    image: "/images/optimized/planter picture.webp",
    alt: "Custom weathered steel planter boxes on a rooftop terrace",
  },
]

const adVerifiedCapabilities = [
  "Aluminum & boat welding",
  "Structural welding repair",
  "Custom steel fabrication",
  "Planters & streetscape",
  "Wrought-iron mailboxes",
  "Stainless countertops",
  "Gas meter manifolds",
]

const faqs = [
  {
    question: "How do I reach you?",
    answer:
      "Call the shop. Tell us what needs work and where it is. You can also use Ask the shop to send the job details.",
  },
  {
    question: "Do you come to the job site?",
    answer:
      "Yes. We handle on-site welding and repair. Tell us the location, material, and access so we can work out the plan.",
  },
  {
    question: "What should I send for a quote?",
    answer:
      "Send the location, a short description, and clear photos of the full item and the problem area. Add dimensions or a drawing if you have them. You do not need to know the metal or welding process.",
  },
  {
    question: "Do you take both small and large work?",
    answer:
      "Yes. We handle local repairs and larger fabrication work. Call and tell us what is in front of you.",
  },
  {
    question: "Do you weld aluminum and repair boats?",
    answer:
      "Yes. We handle aluminum welding and boat repair. Send clear photos of the damage and the full boat so we can assess the job.",
  },
  {
    question: "How far do you travel?",
    answer:
      "We are based in Lebanon and serve Greater Nashville and surrounding Middle Tennessee communities. Travel depends on the location and scope, so call to confirm the fit.",
  },
  {
    question: "Why is pricing not listed?",
    answer:
      "Material, damage, dimensions, and access change the work. We need the job details before we can quote it.",
  },
]

function FrameGussets() {
  return (
    <>
      <Gusset className="wm-gusset tl" />
      <Gusset className="wm-gusset tr" />
      <Gusset className="wm-gusset br" />
      <Gusset className="wm-gusset bl" />
    </>
  )
}

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer },
  })),
}

export default function Page() {
  const shopPhone = getShopPhone()
  return (
    <div className="ms-site ms-home">
      <script
        id="faq-schema"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <Navbar home />

      <main id="main-content">
        <section className="ms-hero" id="home">
          <div className="ms-hero-copy sw-signwall">
            <h1 className="sw-sign" aria-label="Music City Specialty Welding, Nashville mobile welding, on-site repair, and custom fabrication across Middle Tennessee">
              <span className="sw-line-sm">Music City</span>
              <span className="sw-line-lg">Specialty</span>
              <span className="sw-line-lg">
                Weld<i className="sw-buzz" style={{ fontStyle: "normal" }}>i</i>ng
              </span>
            </h1>
            <p className="sw-paint">
              Metal problem? <em>We get it.</em>
            </p>
            <p className="ms-hero-deck">
              Nashville mobile welding, on-site repair, and custom fabrication across Middle Tennessee.
            </p>
            <ShopActions phoneHref={shopPhone.href} className="ms-hero-actions" />
            <p className="ms-hero-phone">{shopPhone.display}</p>
          </div>

          <div className="ms-hero-media" aria-label="Music City Specialty Welding at work">
            <div className="sw-tin" aria-hidden="true">
              <small>Lebanon · Tennessee</small>
              <strong>Welding Shop</strong>
            </div>
            <figure className="ms-hero-image ms-hero-image-main wm-frame">
              <span className="sw-tape-tl" aria-hidden="true" />
              <span className="sw-tape-tr" aria-hidden="true" />
              <Image
                src="/images/optimized/welder-1600.webp"
                alt="Music City Specialty Welding fabricating a steel frame in the shop"
                fill
                sizes="(max-width: 899px) min(calc(100vw - 2rem), 34rem), (min-width: 1280px) min(42vw, 40rem), 46vw"
                priority
                fetchPriority="high"
              />
            </figure>
          </div>
        </section>

        <div className="ms-badge-strip" aria-label="Shop facts">
          <span className="ms-sticker">Shop + mobile welding</span>
          <span className="ms-sticker">Steel · Aluminum · Stainless</span>
          <span className="ms-sticker">Middle Tennessee</span>
        </div>

        <WeldSeam id="wm-bead-proof" />

        <section className="ms-work" id="work" aria-labelledby="work-title">
          <PlateStamp id="PLT-01" name="The work" className="is-ink" />
          <Torch className="wm-art" style={{ width: "9rem", top: "4.5rem", right: "4%", color: "var(--mx-ink)", opacity: 0.14 }} />
          <div className="ms-section-intro ms-reveal">
            <h2 className="ms-display" id="work-title">Good welds don&apos;t need a sales pitch.</h2>
            <p>
              Trailer repairs, fitted steel, and custom metalwork. These are jobs we have done in the shop and on-site.
            </p>
          </div>

          <div className="ms-work-grid">
            <figure className="ms-work-shot ms-work-shot-a ms-reveal wm-frame"><FrameGussets />
              <Image src="/images/owner-work/IMG_20260625_160502986_HDR.webp" alt="Mobile trailer undergoing repairs and custom modifications" fill quality={60} sizes="(max-width: 639px) calc(100vw - 2rem), (max-width: 1023px) 46vw, 31vw" />
              <figcaption><strong>Mobile trailer repairs and customizations.</strong></figcaption>
            </figure>
            <figure className="ms-work-shot ms-work-shot-b ms-reveal wm-frame"><FrameGussets />
              <Image src="/images/owner-work/stainless-worktable.webp" alt="Finished custom stainless steel worktable and sink installed in a Middle Tennessee workspace" fill quality={60} sizes="(max-width: 639px) calc(100vw - 2rem), (max-width: 1023px) 46vw, 31vw" />
              <figcaption><strong>Stainless worktable and sink, fitted to the room.</strong></figcaption>
            </figure>
            <figure className="ms-work-shot ms-work-shot-c ms-reveal wm-frame"><FrameGussets />
              <Image src="/images/owner-work/steel-frame-onsite.webp" alt="Steel canopy frame being fitted and welded on-site" fill quality={60} sizes="(max-width: 639px) calc(100vw - 2rem), (max-width: 1023px) 46vw, 31vw" />
              <figcaption><strong>Steel frame, fitted and welded on-site.</strong></figcaption>
            </figure>
            <figure className="ms-work-shot ms-work-shot-d ms-reveal wm-frame"><FrameGussets />
              <Image src="/images/owner-work/staircase-onsite.webp" alt="On-site aluminum staircase TIG welding repair" fill quality={60} sizes="(max-width: 639px) calc(100vw - 2rem), (max-width: 1023px) 46vw, 31vw" />
              <figcaption><strong>On-site aluminum TIG welding repair.</strong></figcaption>
            </figure>
            <figure className="ms-work-shot ms-work-shot-e ms-reveal wm-frame"><FrameGussets />
              <Image src="/images/owner-work/IMG_20250527_141244.webp" alt="Large custom steel gate fitted at a Middle Tennessee job site" fill quality={60} sizes="(max-width: 639px) calc(100vw - 2rem), (max-width: 1023px) 46vw, 31vw" />
              <figcaption><strong>Steel gate, hung level where it sits.</strong></figcaption>
            </figure>
            <figure className="ms-work-shot ms-work-shot-f ms-reveal wm-frame"><FrameGussets />
              <Image src="/images/owner-work/little-brick-church.webp" alt="Custom-made metal signage installed on a brick church" fill quality={60} sizes="(max-width: 639px) calc(100vw - 2rem), (max-width: 1023px) 46vw, 31vw" />
              <figcaption><strong>Custom-made signage, built to fit.</strong></figcaption>
            </figure>
          </div>

          <p className="ms-work-statement ms-display ms-reveal">
            <span className="ms-work-statement-line">Show the weld.</span>
            <span className="ms-work-statement-accent">Then talk.</span>
          </p>

          <div className="sw-proof-row">
            <p className="sw-proof-note">
              Every photo on this wall is our own work.
            </p>
            <a
              className="ms-text-link"
              href="https://www.facebook.com/profile.php?id=939156675945316"
              target="_blank"
              rel="noreferrer"
            >
              More work on Facebook <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
        </section>

        <WeldSeam id="wm-bead-services" />

        <section className="ms-services" id="services" aria-labelledby="services-title">
          <PlateStamp id="PLT-02" name="What we weld" />
          <div className="ms-services-heading ms-reveal">
            <h2 className="ms-display" id="services-title">What needs welded?</h2>
            <p>Repairs and fabrication for homes, job sites, and working equipment.</p>
          </div>

          <div className="ms-service-list">
            {services.map((service) => (
              <article className="ms-service-row ms-reveal" key={service.title}>
                <div className="ms-service-copy">
                  <h3
                    className={service.mobileTitleLines.length > 1 ? "ms-service-title-long" : undefined}
                    aria-label={service.title}
                  >
                    {service.mobileTitleLines.map((line, index) => (
                      <span className="ms-service-title-line" key={line}>
                        {line}{index < service.mobileTitleLines.length - 1 ? " " : ""}
                      </span>
                    ))}
                  </h3>
                  <strong>{service.line}</strong>
                  <p>{service.detail}</p>
                  <Link href={service.href}>
                    {service.title} details <ArrowUpRight aria-hidden="true" />
                  </Link>
                </div>
                <figure className="ms-service-image">
                  <Image src={service.image} alt={service.alt} fill quality={60} sizes="(max-width: 859px) calc(100vw - 2rem), 26rem" />
                </figure>
              </article>
            ))}
          </div>

          <aside className="ms-capability-board ms-reveal" id="capabilities" aria-labelledby="capability-title">
            <div>
              <h3 className="ms-display" id="capability-title">More from the shop.</h3>
              <p>Need something else welded or built? Call with the details so we can see if it fits.</p>
            </div>
            <ul>
              {adVerifiedCapabilities.map((capability) => <li key={capability}>{capability}</li>)}
            </ul>
          </aside>
        </section>

        <WeldSeam id="wm-bead-capabilities" />

        <section className="ms-get-it" id="approach" aria-label="We understand the job">
          <div className="ms-get-it-pin">
            <div className="ms-problem-lines ms-display" aria-hidden="true">
              <span>Gate won’t close.</span>
              <span>Trailer won’t roll.</span>
              <span>Drawing needs steel.</span>
            </div>
            <h2 className="ms-display">We get it.</h2>
            <p>Tell us what broke or what needs built. We&apos;ll work out the next step with you.</p>
          </div>
        </section>

        <WeldSeam id="wm-bead-process" />

        <section className="ms-process" id="process" aria-labelledby="process-title">
          <PlateStamp id="PLT-03" name="The plan" />
          <div className="ms-process-lead ms-reveal">
            <h2 className="ms-display" id="process-title">Start with the job.</h2>
          </div>
          <ol className="ms-process-list">
            <li className="ms-reveal"><strong>Call the shop.</strong><p>Tell us what broke, what needs built, and where it sits.</p></li>
            <li className="ms-reveal"><strong>Show the job.</strong><p>Send photos, dimensions, location, timing, or the drawing.</p></li>
            <li className="ms-reveal"><strong>Work out the plan.</strong><p>We review the scope and talk through shop work or an on-site repair.</p></li>
          </ol>
          <ShopActions phoneHref={shopPhone.href} className="ms-section-actions" />
        </section>

        <WeldSeam id="wm-bead-customer-page" />

        <section className="ms-job-glass" id="job-glass" aria-labelledby="job-glass-title">
          <div className="ms-job-glass-copy ms-reveal">
            <span className="ms-job-glass-kicker">Customer page</span>
            <h2 className="ms-display" id="job-glass-title">Keep up with the work.</h2>
            <p className="ms-job-glass-lead">Active jobs have a private customer page. Open the link to see updates and paperwork without an app or password.</p>
            <ul>
              <li><strong>The plan</strong><span>Job status and updates from the shop.</span></li>
              <li><strong>The work</strong><span>Status and approved progress photos from the crew doing it.</span></li>
              <li><strong>The paperwork</strong><span>Quote, invoice, and payment link in one clean place.</span></li>
            </ul>
          </div>

          <figure className="ms-job-glass-demo" aria-label="Example private customer job page">
            <span className="ms-job-glass-clip" aria-hidden="true" />
            <figcaption><strong>Example customer page</strong><small>Private job link</small></figcaption>
            <div className="ms-job-glass-title"><small>Your job</small><strong>Driveway gate repair</strong><span>Lebanon · Tennessee</span></div>
            <div className="ms-job-glass-promise"><small>Job status</small><strong>In progress</strong><span>Updates from the shop</span></div>
            <div className="ms-job-glass-route" aria-label="Job progress">
              <span className="is-done">Received</span><span className="is-done">Quoted</span><span className="is-done">Scheduled</span><span className="is-now">In progress</span><span>Finished</span>
            </div>
            <div className="ms-job-glass-progress">
              <Image src="/images/owner-work/IMG_20250723_161108.webp" alt="Steel frame fitted square on the fabrication table" width={360} height={480} sizes="(max-width: 760px) 5.8rem, 7.5rem" />
              <p><small>Example shop update</small><strong>Frame fitted square. Hinge stock is next.</strong></p>
            </div>
            <div className="ms-job-glass-footer"><span>Questions about the job?</span><span>Call the shop</span></div>
          </figure>
        </section>

        <WeldSeam id="wm-bead-area" />

        <section className="ms-territory" id="service-area" aria-labelledby="territory-title">
          <PlateStamp id="PLT-04" name="Territory" className="is-ink" />
          <div className="ms-territory-map" aria-hidden="true">
            <TennesseeMap className="wm-tn" />
            <span className="wm-tn-star-label">★ Lebanon, the shop</span>
            <strong><span>Middle</span><span>Tennessee</span></strong>
            <small>Shop work in Lebanon<br />Mobile welding in Middle Tennessee</small>
          </div>
          <div className="ms-territory-copy ms-reveal">
            <h2 className="ms-display" id="territory-title">Lebanon shop. Middle Tennessee work.</h2>
            <p>We serve Greater Nashville and surrounding Middle Tennessee communities. Travel depends on the job. Call with the location and scope.</p>
            <div className="ms-city-list" aria-label="Service areas">
              <span>Nashville</span><span>Lebanon</span><span>Franklin</span><span>Murfreesboro</span><span>Gallatin</span><span>Hendersonville</span><span>Clarksville</span>
            </div>
            <p className="ms-location"><MapPin aria-hidden="true" /> 533 W Baddour Pkwy, Lebanon, TN 37087</p>
          </div>
        </section>

        <WeldSeam id="wm-bead-faq" />

        <section className="ms-faq" id="faq" aria-labelledby="faq-title">
          <PlateStamp id="PLT-05" name="Straight answers" />
          <div className="ms-faq-heading ms-reveal">
            <h2 className="ms-display" id="faq-title">Straight answers.</h2>
          </div>
          <div className="ms-faq-list">
            {faqs.map((item) => (
              <details className="ms-reveal" key={item.question}>
                <summary>{item.question}<i aria-hidden="true">+</i></summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <WeldSeam id="wm-bead-contact" />

        <MainstreetContact phoneHref={shopPhone.href} phoneDisplay={shopPhone.display} />
      </main>

      <WeldSeam id="wm-bead-footer" />

      <Footer home />

      <MobileQuickActions phoneHref={shopPhone.href} />
    </div>
  )
}
