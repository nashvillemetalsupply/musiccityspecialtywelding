import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft, Phone } from "lucide-react"
import { Footer } from "@/components/footer"
import { MobileQuickActions } from "@/components/mobile-quick-actions"
import { Navbar } from "@/components/navbar"
import { getShopPhone } from "@/lib/shop-contact"

export const metadata: Metadata = {
  title: "Page Not Found",
  robots: { index: false, follow: false },
}

export default function NotFound() {
  const shopPhone = getShopPhone()

  return (
    <>
      <Navbar />
      <main id="main-content" className="ms-site ms-lost">
        <div className="ms-lost-ticket">
          <span className="ms-lost-kicker">Wrong turn // no job ticket here</span>
          <p className="ms-lost-code" aria-hidden="true">404</p>
          <h1>That piece isn&apos;t on the rack.</h1>
          <p>The page may have moved. The shop has not—we still answer the phone.</p>
          <div className="ms-lost-actions">
            <Link href="/"><ArrowLeft aria-hidden="true" /> Back to the shop</Link>
            <a href={shopPhone.href}><Phone aria-hidden="true" /> Call {shopPhone.display}</a>
          </div>
        </div>
      </main>
      <Footer />
      <MobileQuickActions quoteHref="/#contact" phoneHref={shopPhone.href} />
    </>
  )
}
