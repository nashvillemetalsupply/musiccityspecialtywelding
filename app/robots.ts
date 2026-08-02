import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
    sitemap: "https://musiccityspecialtywelding.com/sitemap.xml",
    host: "https://musiccityspecialtywelding.com",
  }
}
