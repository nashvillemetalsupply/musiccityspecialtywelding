import type React from "react"
import type { Metadata } from "next"
import { Alfa_Slab_One, Barlow_Condensed, IBM_Plex_Mono, IBM_Plex_Sans, Permanent_Marker } from "next/font/google"
import { PublicAnalytics } from "@/components/public-analytics"
import { getShopPhone } from "@/lib/shop-contact"
import "./globals.css"

const _barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["800", "900"],
  variable: "--font-ms-display",
  display: "swap",
})

const _plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ms-sans",
  display: "swap",
  preload: false,
})

const _plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-ms-mono",
  display: "swap",
  preload: false,
})

const _marker = Permanent_Marker({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-ms-marker",
  display: "swap",
  preload: false,
})

const _alfaSlab = Alfa_Slab_One({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-ms-slab",
  display: "swap",
  preload: false,
})

const googleAnalyticsMeasurementId =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim()

export const metadata: Metadata = {
  metadataBase: new URL("https://musiccityspecialtywelding.com"),
  title: {
    default: "Mobile Welding & Fabrication | Nashville & Lebanon, TN",
    template: "%s | Music City Specialty Welding",
  },
  description:
    "Open 24/7 for mobile and shop welding, trailer and equipment repair, architectural metalwork, and custom fabrication across Greater Nashville and Middle Tennessee.",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Music City Specialty Welding",
    title: "Mobile Welding & Fabrication | Nashville & Lebanon, TN",
    description:
      "Mobile welding, equipment repair, architectural metalwork, and custom fabrication across Middle Tennessee.",
    images: [
      {
        url: "/images/optimized/welder.webp",
        width: 1200,
        height: 630,
        alt: "Music City Specialty Welding at work",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mobile Welding & Fabrication | Nashville & Lebanon, TN",
    description:
      "Mobile welding, equipment repair, architectural metalwork, and custom fabrication across Middle Tennessee.",
    images: ["/images/optimized/welder.webp"],
  },
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
    apple: "/images/optimized/mcs welding logo.png",
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
    <html lang="en">
      <body className={`${_barlowCondensed.variable} ${_plexSans.variable} ${_plexMono.variable} ${_alfaSlab.variable} ${_marker.variable} font-sans antialiased`}>
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
