import { MapPin } from "lucide-react"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { MobileQuickActions } from "@/components/mobile-quick-actions"
import { createPublicMetadata } from "@/lib/public-metadata"
import { getShopPhone } from "@/lib/shop-contact"
import { ShopActions } from "@/components/shop-actions"
import { ServiceAreaChips } from "@/components/service-area-chips"

export const metadata = createPublicMetadata({
  title: "Mobile Welding Service Area",
  description: "Mobile welding service from Lebanon across Nashville and surrounding Middle Tennessee communities. Project scope and travel determine availability.",
  canonical: "/service-areas",
})

export default function ServiceAreasPage() {
  const shopPhone = getShopPhone()
  return (
    <>
      <Navbar />
      <main id="main-content" className="ms-site ms-subpage ms-area-page">
        <section className="ms-area-hero">
          <h1 className="ms-display">Middle Tennessee is the shop floor.</h1>
          <div>
            <p>Based in Lebanon. Serving Greater Nashville and Middle Tennessee. We bring the rig when the metal is better fixed where it sits. Call with the address and scope so we can plan the work.</p>
            <ShopActions phoneHref={shopPhone.href} className="ms-hero-actions" />
          </div>
        </section>

        <section className="ms-area-cities" aria-label="Primary service areas">
          <p><MapPin aria-hidden="true" />533 W Baddour Pkwy, Lebanon, TN 37087.</p>
          <ServiceAreaChips />
          <span>Outside this list? Call with the exact address and scope to check the fit.</span>
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
          <h2 className="ms-display">Tell us where the job sits.</h2>
          <div>
            <p>Share the location, access, and what needs welding. We&apos;ll work out whether it belongs on-site or in the shop.</p>
            <ShopActions phoneHref={shopPhone.href} />
          </div>
        </section>
      </main>
      <Footer />
      <MobileQuickActions phoneHref={shopPhone.href} />
    </>
  )
}
