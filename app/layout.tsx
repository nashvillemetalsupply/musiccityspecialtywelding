import type React from "react"
import type { Metadata } from "next"
import { Barlow_Condensed, Permanent_Marker } from "next/font/google"
import { PublicAnalytics } from "@/components/public-analytics"
import { publicDefaultDescription, publicDefaultTitle } from "@/lib/public-metadata"
import { getShopPhone } from "@/lib/shop-contact"
import "./globals.css"

const _barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: "900",
  variable: "--font-ms-display",
  display: "optional",
})

const _marker = Permanent_Marker({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-ms-marker",
  display: "optional",
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
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      {
        url: "/images/optimized/mcs welding logo.png",
        type: "image/png",
      },
    ],
    apple: [{ url: "/apple-icon", sizes: "180x180", type: "image/png" }],
  },
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
    "https://www.facebook.com/people/Music-City-Specialty-Welding/61585337136685/",
  ],
  description:
    "Mobile and shop welding, equipment repair, architectural metalwork, and custom fabrication across Greater Nashville and Middle Tennessee.",
  logo: "https://musiccityspecialtywelding.com/images/optimized/mcs_welding_logo.webp",
  image: "https://musiccityspecialtywelding.com/images/optimized/welder.webp",
  address: {
    "@type": "PostalAddress",
    streetAddress: "533 W Baddour Pkwy",
    addressLocality: "Lebanon",
    addressRegion: "TN",
    postalCode: "37087",
    addressCountry: "US",
  },
  openingHoursSpecification: [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ].map((dayOfWeek) => ({
    "@type": "OpeningHoursSpecification",
    dayOfWeek,
    opens: "00:00",
    closes: "23:59",
  })),
  areaServed: [
    "Lebanon, Tennessee",
    "Nashville, Tennessee",
    "Franklin, Tennessee",
    "Murfreesboro, Tennessee",
    "Gallatin, Tennessee",
    "Hendersonville, Tennessee",
    "Clarksville, Tennessee",
    "Antioch, Tennessee",
  ],
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
    <html lang="en" data-scroll-behavior="smooth">
      <body className={`${_barlowCondensed.variable} ${_marker.variable} font-sans antialiased`}>
        <script
          id="local-business-schema"
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessSchema) }}
        />
        {/* Customer bearer links and internal operations never load third-party analytics. */}
        <PublicAnalytics measurementId={googleAnalyticsMeasurementId} />
        {children}
      </body>
    </html>
  )
}
