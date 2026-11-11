import type React from "react"
import type { Metadata } from "next"
import { Barlow_Condensed, IBM_Plex_Sans, IBM_Plex_Mono, Permanent_Marker } from "next/font/google"
import { PublicAnalytics } from "@/components/public-analytics"
import { AssistantChatLoader as AssistantChat } from "@/components/assistant-chat-loader"
import { publicDefaultDescription, publicDefaultTitle } from "@/lib/public-metadata"
import { getShopPhone } from "@/lib/shop-contact"
import { serviceAreas } from "@/lib/service-areas"
import "./public-site.css"

const _barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: "900",
  variable: "--font-ms-display",
  display: "swap",
})

const _marker = Permanent_Marker({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-ms-marker",
  display: "optional",
  preload: false,
})

const _plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  // One variable face supplies the required 400/500/600 weights without
  // separate weight requests. The default width remains unchanged.
  weight: "variable",
  variable: "--font-ms-sans",
  display: "swap",
})

const _plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: "500",
  variable: "--font-ms-mono",
  display: "swap",
  preload: false,
})

const googleAnalyticsMeasurementId =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim()

export const metadata: Metadata = {
  metadataBase: new URL("https://musiccityspecialtywelding.com"),
  title: {
    default: publicDefaultTitle,
    template: "%s | Music City Specialty Welding",
  },
  description: publicDefaultDescription,
}

const shopPhone = getShopPhone()
const localBusinessSchema = {
  "@context": "https://schema.org",
  "@type": ["LocalBusiness", "ProfessionalService"],
  "@id": "https://musiccityspecialtywelding.com/#business",
  name: "Music City Specialty Welding",
  legalName: "Neverlift Chassis Works, LLC",
  alternateName: "Music City Specialty Welding",
  url: "https://musiccityspecialtywelding.com/",
  telephone: shopPhone.e164,
  email: "sales@musiccityspecialtywelding.com",
  sameAs: [
    "https://www.facebook.com/profile.php?id=939156675945316",
  ],
  description:
    "Mobile and shop welding, equipment repair, architectural metalwork, and custom fabrication across Greater Nashville and Middle Tennessee.",
  priceRange: "Free estimates; price depends on the job",
  paymentAccepted: "Cash, Card, Check, Venmo",
  openingHoursSpecification: {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    opens: "00:00",
    closes: "23:59",
  },
  logo: "https://musiccityspecialtywelding.com/images/optimized/mcs_welding_logo.webp",
  image: "https://musiccityspecialtywelding.com/images/optimized/welder.webp",
  geo: {
    "@type": "GeoCoordinates",
    latitude: 36.21646,
    longitude: -86.3035,
  },
  address: {
    "@type": "PostalAddress",
    streetAddress: "533 W Baddour Pkwy",
    addressLocality: "Lebanon",
    addressRegion: "TN",
    postalCode: "37087",
    addressCountry: "US",
  },
  areaServed: serviceAreas.map((area) => `${area}, Tennessee`),
  hasOfferCatalog: {
    "@type": "OfferCatalog",
    name: "Welding and fabrication services",
    itemListElement: [
      "Mobile welding",
      "Trailer and truck welding repair",
      "Equipment and structural welding repair",
      "Architectural welding and fabrication",
      "Specialty fabrication",
      "Aluminum and boat welding",
      "Custom wrought iron mailboxes",
      "Custom metal planter boxes",
    ].map((name) => ({
      "@type": "Offer",
      itemOffered: { "@type": "Service", name },
    })),
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // ThemeBoot sets only the saved theme attribute before hydration. This
    // one-level suppression covers that intentional root attribute difference;
    // mismatches inside the page still surface normally.
    <html lang="en" className={`${_barlowCondensed.variable} ${_marker.variable} ${_plexSans.variable} ${_plexMono.variable}`} data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <script
          id="local-business-schema"
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessSchema) }}
        />
        {/* Customer bearer links and internal operations never load third-party analytics. */}
        <PublicAnalytics measurementId={googleAnalyticsMeasurementId} />
        {children}
        {process.env.NEXT_PUBLIC_ASSISTANT_CHAT === "1" && (
          <AssistantChat phoneHref={shopPhone.href} phoneDisplay={shopPhone.display} />
        )}
      </body>
    </html>
  )
}
