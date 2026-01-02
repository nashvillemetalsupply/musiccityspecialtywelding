import { Navbar } from "@/components/navbar"
import { Hero } from "@/components/hero"
import { Services } from "@/components/services"
import { Contact } from "@/components/contact"
import { TrustSignals } from "@/components/trust-signals"
import { Footer } from "@/components/footer"
import { StickyMobileCTA } from "@/components/sticky-mobile-cta"

export default function Page() {
  return (
    <main className="min-h-screen pb-20 lg:pb-0">
      <Navbar />
      <Hero />
      <Services />
      <Contact />
      <TrustSignals />
      <Footer />
      <StickyMobileCTA />
    </main>
  )
}
