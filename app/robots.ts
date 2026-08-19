import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /board is the operations board, same class of thing as /ops. Its page
      // metadata already sets noindex, but that only stops indexing after a
      // crawl; this stops the crawl.
      disallow: ["/api/", "/ops", "/board", "/design-preview"],
    },
    sitemap: "https://musiccityspecialtywelding.com/sitemap.xml",
    host: "https://musiccityspecialtywelding.com",
  }
}
