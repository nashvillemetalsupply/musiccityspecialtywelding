import { Navbar } from "@/components/navbar"
import { Hero } from "@/components/hero"
import { Services } from "@/components/services"
import { Contact } from "@/components/contact"
import { TrustSignals } from "@/components/trust-signals"
import { Footer } from "@/components/footer"
import { StickyMobileCTA } from "@/components/sticky-mobile-cta"
import { HomePageWrapper } from "@/components/home-page-wrapper"

export default function Page() {
  return (
    <HomePageWrapper>
      <main className="min-h-screen pb-20 sm:pb-24 lg:pb-0 overflow-x-hidden">
        <Navbar />
        <Hero />
        <Services />
        <Contact />
        <TrustSignals />
        <Footer />
        <StickyMobileCTA />
      </main>
    </HomePageWrapper>
  )
}
