import type React from "react"
import type { Metadata } from "next"
import { Playfair_Display, Inter } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"

const _playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-serif",
})

const _inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
})

export const metadata: Metadata = {
  title: "Music City Specialty Welding | Expert Mobile Welding Services in Nashville",
  description:
    "Professional mobile welding, architectural fabrication, equipment repair, and specialty welding services in Nashville. Expert craftsmanship for all your welding needs.",
  generator: "v0.app",
  keywords: ["mobile welding", "Nashville welding", "architectural fabrication", "equipment repair", "custom welding"],
  icons: {
    icon: [
      {
        url: "/images/mcs welding logo.png",
        type: "image/png",
      },
    ],
    apple: "/images/mcs welding logo.png",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${_inter.variable} ${_playfairDisplay.variable} font-sans antialiased`}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
