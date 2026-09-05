import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(path, "utf8")

test("every indexable public route uses complete route-specific discovery metadata", () => {
  const helper = read("lib/public-metadata.ts")
  for (const field of ["alternates:", "openGraph:", "type: \"website\"", "siteName:", "twitter:"]) {
    assert.match(helper, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  }

  for (const path of [
    "app/page.tsx",
    "app/service-areas/page.tsx",
    "app/services/[slug]/page.tsx",
    "app/privacy/page.tsx",
    "app/terms/page.tsx",
  ]) {
    assert.match(read(path), /createPublicMetadata\(/, `${path} must use the complete metadata helper`)
  }
})

test("social and icon assets are truthful and branded", () => {
  const helper = read("lib/public-metadata.ts")
  const layout = read("app/layout.tsx")
  const appleIcon = read("app/apple-icon.tsx")

  assert.match(helper, /welder-1280\.webp/)
  assert.match(helper, /width:\s*1280/)
  assert.match(helper, /height:\s*1024/)
  assert.doesNotMatch(layout, /width:\s*1200[\s\S]*height:\s*630/)
  assert.match(layout, /url:\s*"\/apple-icon"/)
  assert.match(appleIcon, />\s*MCS\s*</)
  assert.match(appleIcon, />\s*WELDING\s*</)
})

test("public subpages share a skip link, a matching target, and compact 44px controls", () => {
  const navbar = read("components/navbar.tsx")
  const css = read("app/globals.css")

  assert.match(navbar, /<PublicSkipLink\s*\/>/)
  for (const path of [
    "app/not-found.tsx",
    "app/service-areas/page.tsx",
    "app/services/[slug]/page.tsx",
    "app/privacy/page.tsx",
    "app/terms/page.tsx",
  ]) {
    assert.match(read(path), /<main id="main-content"/, `${path} needs the shared skip target`)
  }

  for (const selector of [".ms-text-link", ".ms-footer-contact a", ".ms-footer-meta a", ".ms-subplan-lead a"]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    assert.match(css, new RegExp(`${escaped}\\s*\\{[\\s\\S]*?min-height:\\s*2\\.75rem;`))
  }
})

test("structured service coverage matches the visible Antioch service area", () => {
  assert.match(read("app/layout.tsx"), /"Antioch, Tennessee"/)
  assert.match(read("app/service-areas/page.tsx"), /"Antioch"/)
})

test("public phone taps are measured as intent without firing the quote conversion", () => {
  const analytics = read("components/public-analytics.tsx")
  const phoneClicks = read("components/phone-click-tracker.tsx")
  assert.match(analytics, /<PhoneClickTracker\s*\/>/)
  assert.match(phoneClicks, /closest<HTMLAnchorElement>\('a\[href\^="tel:"\]'\)/)
  assert.match(phoneClicks, /window\.gtag\("event", "phone_click"/)
  assert.doesNotMatch(phoneClicks, /AW-17817632790|conversion/)
})

test("high-intent trailer repair has a proven landing page and every service shows breadcrumbs", () => {
  const services = read("lib/service-pages.ts")
  const page = read("app/services/[slug]/page.tsx")
  const home = read("app/page.tsx")
  assert.match(services, /slug: "trailer-welding-repair"/)
  assert.match(services, /IMG_20250809_180018\.webp/)
  assert.match(home, /href: "\/services\/trailer-welding-repair"/)
  assert.match(page, /"@type": "BreadcrumbList"/)
  assert.match(page, /aria-label="Breadcrumb"/)
})
