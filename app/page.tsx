import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowDownRight, ArrowUpRight, MapPin, Phone } from "lucide-react"
import {
  Gusset,
  PlateStamp,
  ShopCrest,
  TennesseeMap,
  Torch,
  WeldSeam,
} from "@/components/weldment"
import { MainstreetContact } from "@/components/mainstreet-contact"
import { MainstreetMenu } from "@/components/mainstreet-menu"
import { MobileQuickActions } from "@/components/mobile-quick-actions"

export const metadata: Metadata = {
  title: "Mobile Welding & Fabrication | Nashville & Lebanon, TN",
  description:
    "Open 24/7 for mobile and shop welding, trailer and equipment repair, architectural metalwork, and custom fabrication across Greater Nashville and Middle Tennessee.",
  alternates: { canonical: "/" },
  openGraph: { url: "/" },
}

const services = [
  {
    title: "Mobile welding",
    mobileTitleLines: ["Mobile welding"],
    line: "The metal stays put. We bring the rig.",
    detail: "On-site welding and repair for trucks, trailers, equipment, aluminum, structures, and working metal across Middle Tennessee. No towing required.",
    href: "/services/mobile-welding",
    image: "/images/owner-work/IMG_20260225_135845.jpg",
    alt: "Installed steel balcony railing completed on-site by Music City Specialty Welding",
  },
  {
    title: "Trailer & equipment repair",
    mobileTitleLines: ["Trailer & equipment", "repair"],
    line: "Downtime costs more than steel.",
    detail: "Frames, ramps, liftgates, failed brackets, machinery, and attachments repaired around the real damage and the work they still have to do.",
    href: "/services/equipment-repair",
    image: "/images/owner-work/IMG_20250809_180018.jpg",
    alt: "Trailer frame and axle exposed during structural welding repair",
  },
  {
    title: "Architectural metal",
    mobileTitleLines: ["Architectural", "metal"],
    line: "Built to look right. Built to stay put.",
    detail: "Railings, stairs, supports, and architectural steel built to code with clean welds and a precise fit in the real space.",
    href: "/services/architectural-welding",
    image: "/images/optimized/Service 02.webp",
    alt: "Finished black steel railing on a Tennessee property",
  },
  {
    title: "Specialty fabrication",
    mobileTitleLines: ["Specialty", "fabrication"],
    line: "If the catalog had it, you would not be calling.",
    detail: "One-offs, manifolds, frames, brackets, signage, and built-to-spec work made for the job in front of us.",
    href: "/services/custom-fabrication",
    image: "/images/optimized/speciality_welding.webp",
    alt: "Custom fabricated gas manifold installed on a commercial building",
  },
  {
    title: "Custom metalwork",
    mobileTitleLines: ["Custom", "metalwork"],
    line: "Useful first. Good-looking for a long time.",
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
    question: "Are you really open 24/7?",
    answer:
      "Yes. The shop takes calls 24 hours a day, seven days a week. Call first so we can understand the job, location, access, and timing before we make the plan.",
  },
  {
    question: "Do you come to the job site?",
    answer:
      "Yes. We handle mobile welding when the equipment or metalwork is better repaired where it sits. Location, access, material, and safe working conditions determine the plan.",
  },
  {
    question: "What should I send for a quote?",
    answer:
      "Send the location, a short description, rough dimensions, timing, and clear photos of the full item and the problem area. If you do not know the metal or process, that is fine.",
  },
  {
    question: "Do you take both small and large work?",
    answer:
      "Yes. The shop sees local repairs, commercial work, equipment, architectural metal, and defined fabrication projects. Call and tell us what is in front of you.",
  },
  {
    question: "Do you weld aluminum and repair boats?",
    answer:
      "Yes. We handle aluminum welding, including cracked hulls and structural boat repairs. Send clear photos of the damage and the full boat so we can assess access, material, and the right repair plan.",
  },
  {
    question: "How far do you travel?",
    answer:
      "We are based in Lebanon and serve Greater Nashville and surrounding Middle Tennessee communities. Travel depends on the location and scope, so call to confirm the fit.",
  },
  {
    question: "Why is pricing not listed?",
    answer:
      "Because a crack, drawing, access point, and material can change the job. We quote the actual scope, not a number designed to get a click.",
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

export default function Page() {
  return (
    <div className="ms-site">
      <a className="ms-skip" href="#main-content">Skip to the work</a>

      <header className="ms-nav" aria-label="Main navigation">
        <Link className="ms-brand" href="#home">
          <span className="ms-brand-badge">
            <Image
              src="/images/optimized/mcs_welding_logo.webp"
              alt=""
              width={240}
              height={160}
              priority
              fetchPriority="high"
              sizes="64px"
              unoptimized
            />
          </span>
          <span className="ms-brand-words">
            <strong>Music City</strong>
            <span>Specialty Welding</span>
          </span>
        </Link>

        <nav className="ms-nav-links" aria-label="Desktop navigation">
          <a href="#work">The work</a>
          <a href="#services">What we weld</a>
          <a href="#contact">Show us the job</a>
        </nav>

        <a className="ms-nav-call" href="tel:6158104910">
          <Phone aria-hidden="true" />
          <span>
            <small>Open 24/7</small>
            (615) 810-4910
          </span>
        </a>

        <MainstreetMenu />
      </header>

      <main id="main-content">
        <section className="ms-hero" id="home">
          <div className="ms-hero-copy sw-signwall">
            <h1 className="sw-sign" aria-label="Music City Specialty Welding">
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
              24/7 mobile welding across Nashville and Middle Tennessee. Trucks, trailers, equipment, aluminum, structural steel, and built-to-spec shop fabrication.
            </p>
            <div className="ms-hero-actions">
              <a className="sw-plank" href="tel:6158104910">
                <small>call the shop — day or night</small>
                <strong>(615) 810-4910</strong>
              </a>
              <a className="ms-text-link" href="#contact">
                Show us the job <ArrowDownRight aria-hidden="true" />
              </a>
            </div>
          </div>

          <div className="ms-hero-media" aria-label="Music City Specialty Welding at work">
            <div className="sw-tin" aria-hidden="true">
              <small>Lebanon · Tennessee</small>
              <strong>Open 24 Hours</strong>
            </div>
            <figure className="ms-hero-image ms-hero-image-main wm-frame">
              <span className="sw-tape-tl" aria-hidden="true" />
              <span className="sw-tape-tr" aria-hidden="true" />
              <Image
                src="/images/welder.webp"
                alt="Music City Specialty Welding fabricating a steel frame in the shop"
                fill
                priority
                fetchPriority="high"
                sizes="(max-width: 900px) 94vw, 60vw"
              />
            </figure>
          </div>
        </section>

        <div className="ms-badge-strip" aria-label="Shop facts">
          <span className="ms-sticker is-gold">Shop + road rig</span>
          <span className="ms-sticker is-red">Call anytime</span>
          <span className="ms-sticker">Steel · Aluminum · Stainless</span>
          <span className="ms-sticker is-blue">Middle Tennessee</span>
          <span className="ms-sticker is-arc">(615) 810-4910</span>
        </div>

        <WeldSeam />

        <section className="ms-work" id="work">
          <PlateStamp id="PLT-01" name="The work" className="is-ink" />
          <Torch className="wm-art" style={{ width: "9rem", top: "4.5rem", right: "4%", color: "var(--mx-ink)", opacity: 0.14 }} />
          <div className="ms-section-intro ms-reveal">
            <h2 className="ms-display">Good welds don&apos;t need a sales pitch.</h2>
            <p>
              Look close. The work tells you whether a shop understands fit, finish, load, access, and the part nobody planned for.
            </p>
          </div>

          <div className="ms-work-grid">
            <figure className="ms-work-shot ms-work-shot-a ms-reveal wm-frame"><FrameGussets />
              <Image src="/images/owner-work/IMG_20260625_160502986_HDR.jpg" alt="Finished custom mobile food-service trailer fabrication" fill sizes="(max-width: 767px) 88vw, 46vw" />
              <figcaption><strong>Food-service trailer build.</strong></figcaption>
            </figure>
            <figure className="ms-work-shot ms-work-shot-b ms-reveal wm-frame"><FrameGussets />
              <Image src="/images/owner-work/IMG_20260522_234850864_HDR.jpg" alt="Custom stainless steel sink fabricated to fit existing commercial equipment" fill sizes="(max-width: 767px) 70vw, 27vw" />
              <figcaption><strong>Fitted stainless sink.</strong></figcaption>
            </figure>
            <figure className="ms-work-shot ms-work-shot-c ms-reveal wm-frame"><FrameGussets />
              <Image src="/images/owner-work/IMG_20250723_161108.jpg" alt="Steel frame being fitted and fabricated in the Music City Specialty Welding shop" fill sizes="(max-width: 767px) 78vw, 31vw" />
              <figcaption><strong>Shop-fabricated steel frame.</strong></figcaption>
            </figure>
            <figure className="ms-work-shot ms-work-shot-d ms-reveal wm-frame"><FrameGussets />
              <Image src="/images/owner-work/IMG_3994.jpg" alt="Music City Specialty Welding crew completing a commercial on-site installation" fill sizes="(max-width: 640px) 78vw, 34vw" />
              <figcaption><strong>Commercial on-site install.</strong></figcaption>
            </figure>
            <figure className="ms-work-shot ms-work-shot-e ms-reveal wm-frame"><FrameGussets />
              <Image src="/images/owner-work/IMG_20250527_141244.jpg" alt="Large custom steel gate fitted at a Middle Tennessee job site" fill sizes="(max-width: 640px) 100vw, 50vw" />
              <figcaption><strong>Steel gate, fit on-site.</strong></figcaption>
            </figure>
            <figure className="ms-work-shot ms-work-shot-f ms-reveal wm-frame"><FrameGussets />
              <Image src="/images/owner-work/a2b524d8-f0c3-41b7-b35b-da986fd8fe3c.jpg" alt="Custom-cut steel letters being welded on the fabrication table" fill sizes="(max-width: 640px) 82vw, 46vw" />
              <figcaption><strong>Custom-cut steel letters.</strong></figcaption>
            </figure>
          </div>

          <p className="ms-work-statement ms-display ms-reveal">
            <span className="ms-work-statement-line">Show the weld.</span>
            <span className="ms-work-statement-accent">Then talk.</span>
          </p>
        </section>

        <WeldSeam />

        <section className="ms-services" id="services">
          <PlateStamp id="PLT-02" name="What we weld" />
          <div className="ms-services-heading ms-reveal">
            <h2 className="ms-display">Almost anything metal.</h2>
            <p>Homeowner fix. Commercial deadline. Equipment down. A drawing that needs to become steel.</p>
          </div>

          <div className="ms-service-list">
            {services.map((service) => (
              <article className="ms-service-row ms-reveal" key={service.title}>
                <div className="ms-service-copy">
                  <h3
                    className={service.title === "Trailer & equipment repair" ? "ms-service-title-long" : undefined}
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
                    See this work <ArrowUpRight aria-hidden="true" />
                  </Link>
                </div>
                <figure className="ms-service-image">
                  <Image src={service.image} alt={service.alt} fill sizes="(max-width: 767px) 92vw, 32vw" />
                </figure>
              </article>
            ))}
          </div>

          <aside className="ms-capability-board ms-reveal" id="capabilities" aria-labelledby="capability-title">
            <div>
              <h3 className="ms-display" id="capability-title">Your job isn&apos;t weird. It&apos;s just metal.</h3>
              <p>These are in the shop&apos;s wheelhouse too. Call with the problem; we&apos;ll tell you straight if it fits.</p>
            </div>
            <ul>
              {adVerifiedCapabilities.map((capability) => <li key={capability}>{capability}</li>)}
            </ul>
            <a className="ms-button ms-button-primary" href="tel:6158104910">
              <Phone aria-hidden="true" /> Ask the shop
            </a>
          </aside>
        </section>

        <WeldSeam />

        <section className="ms-get-it" id="approach" aria-label="We understand the job">
          <div className="ms-get-it-pin">
            <div className="ms-problem-lines ms-display" aria-hidden="true">
              <span>Gate won’t close.</span>
              <span>Trailer won’t roll.</span>
              <span>Drawing needs steel.</span>
            </div>
            <h2 className="ms-display">We get it.</h2>
            <p>Tell us what broke or what needs built. We&apos;ll take it from there.</p>
          </div>
        </section>

        <WeldSeam />

        <section className="ms-process" id="process" aria-labelledby="process-title">
          <PlateStamp id="PLT-03" name="The plan" />
          <div className="ms-process-lead ms-reveal">
            <h2 className="ms-display" id="process-title">Call. Show. Get it done.</h2>
          </div>
          <ol className="ms-process-list">
            <li className="ms-reveal"><strong>Call the shop.</strong><p>Tell us what broke, what needs built, and where it sits.</p></li>
            <li className="ms-reveal"><strong>Show the job.</strong><p>Send photos, dimensions, location, timing, or the drawing.</p></li>
            <li className="ms-reveal"><strong>Get a real plan.</strong><p>We quote the scope, not a number designed to get a click.</p></li>
          </ol>
          <a className="ms-process-call" href="tel:6158104910">
            <span>Start with a call</span>
            <strong>(615) 810-4910</strong>
            <ArrowUpRight aria-hidden="true" />
          </a>
        </section>

        <WeldSeam />

        <section className="ms-territory" id="service-area" aria-labelledby="territory-title">
          <PlateStamp id="PLT-04" name="Territory" className="is-ink" />
          <div className="ms-territory-map" aria-hidden="true">
            <TennesseeMap className="wm-tn" />
            <span className="wm-tn-star-label">★ Lebanon — the shop</span>
            <strong><span>Middle</span><span>Tennessee</span></strong>
            <small>Shop work in Lebanon<br />Road rig everywhere else</small>
          </div>
          <div className="ms-territory-copy ms-reveal">
            <h2 className="ms-display" id="territory-title">Shop work or we come to you.</h2>
            <p>Travel depends on the job. Call with the location and scope; we&apos;ll tell you if it fits.</p>
            <div className="ms-city-list" aria-label="Service areas">
              <span>Nashville</span><span>Lebanon</span><span>Franklin</span><span>Murfreesboro</span><span>Gallatin</span><span>Hendersonville</span><span>Clarksville</span>
            </div>
            <p className="ms-location"><MapPin aria-hidden="true" /> 533 W Baddour Pkwy, Lebanon, TN 37087</p>
          </div>
        </section>

        <WeldSeam />

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

        <WeldSeam />

        <MainstreetContact />
      </main>

      <WeldSeam />

      <footer className="ms-footer">
        <ShopCrest className="wm-art wm-crest" style={{ width: "7.5rem", top: "2.6rem", right: "6%", opacity: 0.35 }} />
        <div className="ms-footer-mark">
          <Image src="/images/optimized/mcs_welding_logo.webp" alt="Music City Specialty Welding" width={240} height={160} sizes="96px" unoptimized />
          <p className="ms-display">Built here.<br />Fixed where it sits.</p>
        </div>
        <div className="ms-footer-contact">
          <div className="ms-footer-call">
            <strong>Open 24/7</strong>
            <a href="tel:6158104910">Call the shop · (615) 810-4910</a>
          </div>
          <a href="mailto:Sales@musiccityspecialtywelding.com">Sales@musiccityspecialtywelding.com</a>
          <span>533 W Baddour Pkwy<br />Lebanon, TN 37087</span>
        </div>
        <div className="ms-footer-meta">
          <span>© {new Date().getFullYear()} Music City Specialty Welding</span>
          <div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><a href="https://www.facebook.com/people/Music-City-Specialty-Welding/61585337136685/" target="_blank" rel="noreferrer">Facebook</a></div>
        </div>
      </footer>

      <MobileQuickActions />
    </div>
  )
}
