const manifest = {
  name: "MCSW Jobs",
  short_name: "MCSW Jobs",
  description: "Music City Specialty Welding jobs.",
  start_url: "/board",
  scope: "/",
  display: "standalone",
  background_color: "#12100d",
  theme_color: "#12100d",
  icons: [
    { src: "/mcsw-jobs-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    { src: "/mcsw-jobs-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
    { src: "/mcsw-jobs-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
  ],
}

export function GET() {
  return Response.json(manifest, {
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "Content-Type": "application/manifest+json",
    },
  })
}
