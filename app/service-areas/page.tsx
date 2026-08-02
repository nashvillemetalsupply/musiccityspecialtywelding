import type { Metadata } from "next"
import Link from "next/link"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { StickyMobileCTA } from "@/components/sticky-mobile-cta"

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
      <main className="min-h-screen bg-background pb-20 pt-24 sm:pt-28 lg:pb-0 lg:pt-32">
        <section className="container mx-auto px-4 py-14 sm:px-6 lg:px-12 lg:py-20">
          <div className="max-w-4xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Based in Lebanon, serving the region</p>
            <h1 className="mt-4 font-serif text-4xl font-bold text-secondary sm:text-5xl">Mobile welding service across Middle Tennessee</h1>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
              Travel is scheduled around the project, not a rigid radius. Location, job size, site access, urgency, and the work required all affect availability and travel cost. Send the exact job-site address with your request for a useful answer.
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {areas.map((area) => (
              <div key={area} className="rounded-xl border border-border bg-muted/30 p-5">
                <h2 className="font-serif text-xl font-bold text-secondary">{area}, TN</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Mobile service considered based on the project scope, schedule, and site conditions.</p>
              </div>
            ))}
          </div>
        </section>
        <section className="border-y border-border bg-muted/30 py-14">
          <div className="container mx-auto grid gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:px-12">
            <div>
              <h2 className="font-serif text-3xl font-bold text-secondary">What determines travel availability</h2>
              <ul className="mt-6 space-y-3 text-muted-foreground">
                <li>• Project scope and expected time on site</li>
                <li>• Safe access for welding equipment and hot work</li>
                <li>• Urgency and current scheduling</li>
                <li>• Whether shop fabrication is needed before installation</li>
              </ul>
            </div>
            <div>
              <h2 className="font-serif text-3xl font-bold text-secondary">Outside the listed communities?</h2>
              <p className="mt-6 leading-relaxed text-muted-foreground">Larger or specialized work may justify additional travel. Send the address, photos, and scope, or call before assuming the location is outside the service area.</p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link href="/#contact" className="inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-6 font-semibold text-white">Request a quote</Link>
                <a href="tel:6158104910" className="inline-flex min-h-12 items-center justify-center rounded-md border border-border bg-background px-6 font-semibold text-secondary">Call (615) 810-4910</a>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <StickyMobileCTA />
    </>
  )
}
