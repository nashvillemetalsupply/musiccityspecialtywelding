/** @type {import('next').NextConfig} */
import { CSP_REPORTING_ENDPOINTS, CSP_REPORT_ONLY_POLICY } from "./lib/csp-policy.ts"

const nextConfig = {
  env: {
    OPS_SW_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || "dev",
  },
  turbopack: {
    root: process.cwd(),
  },
  outputFileTracingIncludes: {
    "/api/assist": ["./BRAND-BRIEF.md", "./app/service-areas/page.tsx", "./app/page.tsx", "./components/mainstreet-contact.tsx"],
    "/api/twilio/assist-voice": ["./BRAND-BRIEF.md", "./app/service-areas/page.tsx", "./app/page.tsx", "./components/mainstreet-contact.tsx"],
  },
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [390, 640, 768, 1024, 1280, 1440, 1920],
    qualities: [60, 75],
  },
  async redirects() {
    return [
      {
        source: "/home",
        destination: "https://musiccityspecialtywelding.com/",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.musiccityspecialtywelding.com" }],
        destination: "https://musiccityspecialtywelding.com/:path*",
        permanent: true,
      },
    ]
  },
  async headers() {
    return [
      // These public filenames can be replaced in place. Cache repeat visits for
      // one day, then validate before reuse; immutable would hide later edits.
      ...["/images/:path*", "/brand/:path*"].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, must-revalidate" }],
      })),
      {
        source: "/ops-sw.js",
        headers: [{ key: "Service-Worker-Allowed", value: "/" }],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY_POLICY },
          { key: "Reporting-Endpoints", value: CSP_REPORTING_ENDPOINTS },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
        ],
      },
    ]
  },
}

export default nextConfig
