import type { MetadataRoute } from "next"
import { servicePages } from "@/lib/service-pages"

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: "https://musiccityspecialtywelding.com/",
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: "https://musiccityspecialtywelding.com/service-areas",
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: "https://musiccityspecialtywelding.com/privacy",
      lastModified,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: "https://musiccityspecialtywelding.com/terms",
      lastModified,
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ]

  return [
    ...staticPages,
    ...servicePages.map((service) => ({
      url: `https://musiccityspecialtywelding.com/services/${service.slug}`,
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.9,
    })),
  ]
}
