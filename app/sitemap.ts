import type { MetadataRoute } from "next"
import { servicePages } from "@/lib/service-pages"

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: "https://musiccityspecialtywelding.com/",
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: "https://musiccityspecialtywelding.com/service-areas",
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: "https://musiccityspecialtywelding.com/privacy",
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: "https://musiccityspecialtywelding.com/terms",
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ]

  return [
    ...staticPages,
    ...servicePages.map((service) => ({
      url: `https://musiccityspecialtywelding.com/services/${service.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.9,
    })),
  ]
}
