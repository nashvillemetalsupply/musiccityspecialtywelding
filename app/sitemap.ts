import type { MetadataRoute } from "next"
import { servicePages } from "@/lib/service-pages"

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: "https://musiccityspecialtywelding.com/",
      lastModified: new Date("2026-09-27"),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: "https://musiccityspecialtywelding.com/service-areas",
      lastModified: new Date("2026-09-27"),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: "https://musiccityspecialtywelding.com/privacy",
      lastModified: new Date("2026-09-17"),
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: "https://musiccityspecialtywelding.com/terms",
      lastModified: new Date("2026-08-29"),
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ]

  return [
    ...staticPages,
    ...servicePages.map((service) => ({
      url: `https://musiccityspecialtywelding.com/services/${service.slug}`,
      lastModified: new Date("2026-09-27"),
      changeFrequency: "monthly" as const,
      priority: 0.9,
    })),
  ]
}
