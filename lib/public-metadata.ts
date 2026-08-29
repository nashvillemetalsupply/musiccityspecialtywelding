import type { Metadata } from "next"

export const publicSiteName = "Music City Specialty Welding"
export const publicSiteUrl = "https://musiccityspecialtywelding.com"
export const publicDefaultTitle = "Mobile Welding & Fabrication | Nashville & Lebanon, TN"
export const publicDefaultDescription =
  "Open 24/7 for mobile and shop welding, trailer and equipment repair, architectural metalwork, and custom fabrication across Greater Nashville and Middle Tennessee."

type PublicSocialImage = {
  url: string
  alt: string
  width?: number
  height?: number
}

type PublicMetadataInput = {
  title: string
  description: string
  canonical: string
  socialTitle?: string
  image?: PublicSocialImage
}

const defaultSocialImage: PublicSocialImage = {
  url: "/images/optimized/welder-1280.webp",
  width: 1280,
  height: 1024,
  alt: "Music City Specialty Welding at work on a metal fabrication project",
}

/** Complete, route-specific discovery metadata for every indexable public page. */
export function createPublicMetadata({
  title,
  description,
  canonical,
  socialTitle = title,
  image = defaultSocialImage,
}: PublicMetadataInput): Metadata {
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      locale: "en_US",
      siteName: publicSiteName,
      url: canonical,
      title: socialTitle,
      description,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [image.url],
    },
  }
}
