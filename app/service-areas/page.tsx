import type { Metadata } from "next"
import Link from "next/link"
import { ArrowUpRight, MapPin, Phone } from "lucide-react"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { MobileQuickActions } from "@/components/mobile-quick-actions"

export const metadata: Metadata = {
  title: "Mobile Welding Service Area",
  description: "Mobile welding service from Lebanon across Nashville and surrounding Middle Tennessee communities. Project scope and travel determine availability.",
  alternates: { canonical: "/service-areas" },
  openGraph: { url: "/service-areas" },
}

const areas = ["Lebanon", "Nashville", "Franklin", "Murfreesboro", "Gallatin", "Hendersonville", "Clarksville", "Antioch"]

export default function ServiceAreasPage() {
  return (
    <>
      <Navbar />
      <main className="ms-site ms-subpage ms-area-page">
        <section className="ms-area-hero">
          <h1 className="ms-display">Middle Tennessee is the shop floor.</h1>
          <div>
            <p>We leave Lebanon for metal that is better fixed where it sits. Job size, access, urgency, travel, and safe working conditions decide the plan, not a neat circle on a map.</p>
            <div className="ms-hero-actions">
              <a className="ms-button ms-button-primary" href="tel:6158104910"><Phone aria-hidden="true" />Call 24/7</a>
              <Link className="ms-text-link" href="/#contact">Send the address <ArrowUpRight aria-hidden="true" /></Link>
            </div>
          </div>
        </section>

        <section className="ms-area-cities" aria-label="Primary service areas">
          <p><MapPin aria-hidden="true" />Based at 533 W Baddour Pkwy, Lebanon, Tennessee.</p>
          <div>{areas.map((area) => <strong className="ms-display" key={area}>{area}</strong>)}</div>
          <span>Outside this list? Larger and specialized work can travel farther. Call with the exact address and scope.</span>
        </section>

        <section className="ms-area-travel">
          <h2 className="ms-display">What makes a road call work.</h2>
          <ul>
            <li><strong>The metal stays put.</strong><span>Moving the equipment or structure would cost more time or create more risk.</span></li>
            <li><strong>We can reach it safely.</strong><span>There is workable access for the rig, welding equipment, and hot work.</span></li>
            <li><strong>The scope earns the trip.</strong><span>Photos, dimensions, location, and timing tell us what the road call actually needs.</span></li>
            <li><strong>Shop work comes first when it should.</strong><span>Some jobs travel better after pieces are cut, fitted, or built in Lebanon.</span></li>
          </ul>
        </section>

        <section className="ms-subclose">
          <h2 className="ms-display">Send the pin. Show the metal.</h2>
          <div>
            <p>We&apos;ll tell you straight whether the job fits the route.</p>
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
