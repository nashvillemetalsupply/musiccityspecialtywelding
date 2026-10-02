import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import nextConfigModule from "../next.config.ts"
import { isQuoteHoneypotFilled, QUOTE_HONEYPOT_FIELD, quoteSubmissionOutcome } from "../lib/public-quote.ts"
import { enforceShopPhoneFallbackPolicy } from "../lib/shop-contact-policy.ts"

const homePage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8")
const serviceAreasPage = readFileSync(new URL("../app/service-areas/page.tsx", import.meta.url), "utf8")
const servicePage = readFileSync(new URL("../app/services/[slug]/page.tsx", import.meta.url), "utf8")
const appLayout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8")
const servicePagesSource = readFileSync(new URL("../lib/service-pages.ts", import.meta.url), "utf8")
const servicePagesTestModule = await import(`data:text/javascript;base64,${Buffer.from(
  ts.transpileModule(
    servicePagesSource.replace(
      'import { getShopPhone } from "@/lib/shop-contact"',
      'const getShopPhone = () => ({ display: "(615) 000-0000" })'
    ),
    { compilerOptions: { module: ts.ModuleKind.ES2022 } }
  ).outputText
).toString("base64")}`)
const contactComponent = readFileSync(new URL("../components/mainstreet-contact.tsx", import.meta.url), "utf8")
const quoteRoute = readFileSync(new URL("../app/api/quote/route.ts", import.meta.url), "utf8")
const navbarComponent = readFileSync(new URL("../components/navbar.tsx", import.meta.url), "utf8")
const footerComponent = readFileSync(new URL("../components/footer.tsx", import.meta.url), "utf8")
const notFoundPage = readFileSync(new URL("../app/not-found.tsx", import.meta.url), "utf8")
const sitemapSource = readFileSync(new URL("../app/sitemap.ts", import.meta.url), "utf8")
const shopContactSource = readFileSync(new URL("../lib/shop-contact.ts", import.meta.url), "utf8")
const sitemapTestModule = await import(`data:text/javascript;base64,${Buffer.from(
  ts.transpileModule(
    sitemapSource.replace(
      'import { servicePages } from "@/lib/service-pages"',
      'const servicePages = [{ slug: "mobile-welding" }]'
    ),
    { compilerOptions: { module: ts.ModuleKind.ES2022 } }
  ).outputText
).toString("base64")}`)

test("home sign keeps its visual text and names the service and city accessibly", () => {
  assert.match(
    homePage,
    /<h1 className="sw-sign" aria-label="Music City Specialty Welding — Nashville mobile welding, on-site repair, and custom fabrication across Middle Tennessee">/
  )
  assert.match(homePage, /<span className="sw-line-sm">Music City<\/span>/)
  assert.match(homePage, /<span className="sw-line-lg">Specialty<\/span>/)
  assert.match(homePage, /<span className="sw-line-lg">\s*Weld<i className="sw-buzz"/)
})

test("service-area city links own the full visual tile and keep their destination", () => {
  assert.match(serviceAreasPage, /const areas = \["Lebanon", "Nashville", "Franklin", "Murfreesboro", "Gallatin", "Hendersonville", "Clarksville", "Antioch"\]/)
  assert.match(serviceAreasPage, /areas\.map\(\(area\) => \(\s*<Link className="ms-display" href="\/services\/mobile-welding#service" key=\{area\}>\s*\{area\}\s*<\/Link>\s*\)\)/)
  assert.match(servicePage, /<section className="ms-subhero" id="service">/)
})

test("service pages offer the existing quote form below their content", () => {
  assert.match(servicePage, /import \{ MainstreetContact \} from "@\/components\/mainstreet-contact"/)
  assert.match(servicePage, /<MainstreetContact phoneHref=\{shopPhone\.href\} phoneDisplay=\{shopPhone\.display\} \/>/)
  assert.match(servicePage, /href="#contact"/)
  assert.match(servicePage, /<MobileQuickActions quoteHref="#contact" phoneHref=\{shopPhone\.href\} \/>/)
  assert.doesNotMatch(servicePage, /href="\/#contact"|quoteHref="\/#contact"/)
})

test("home page uses the shared shell without changing its skip link or footer crest", () => {
  assert.match(homePage, /<Navbar home \/>/)
  assert.match(homePage, /<Footer home \/>/)
  assert.doesNotMatch(homePage, /<header className="ms-nav"|<footer className="ms-footer"/)
  assert.match(navbarComponent, /home && <PublicSkipLink label="Skip to the work" \/>/)
  assert.match(navbarComponent, /home \? "ms-nav" : "ms-site ms-nav"/)
  assert.match(navbarComponent, /href=\{home \? "#home" : "\/"\}/)
  assert.match(footerComponent, /home && <ShopCrest className="wm-art wm-crest" style=\{\{ width: "7\.5rem", top: "2\.6rem", right: "6%", opacity: 0\.35 \}\} \/>/)
  assert.match(footerComponent, /mailto:sales@musiccityspecialtywelding\.com">sales@musiccityspecialtywelding\.com/)
})

test("service JSON-LD has FAQ and breadcrumb schema with absolute URLs", () => {
  const service = servicePagesTestModule.servicePages[0]
  const structuredData = servicePagesTestModule.buildServiceStructuredData(service)

  assert.equal(structuredData.faqPage["@context"], "https://schema.org")
  assert.equal(structuredData.faqPage["@type"], "FAQPage")
  assert.ok(structuredData.faqPage.mainEntity.length > 0)
  for (const question of structuredData.faqPage.mainEntity) {
    assert.equal(question["@type"], "Question")
    assert.equal(typeof question.name, "string")
    assert.equal(question.acceptedAnswer["@type"], "Answer")
    assert.equal(typeof question.acceptedAnswer.text, "string")
  }

  assert.equal(structuredData.breadcrumbList["@context"], "https://schema.org")
  assert.equal(structuredData.breadcrumbList["@type"], "BreadcrumbList")
  assert.deepEqual(structuredData.breadcrumbList.itemListElement.map((item) => item.position), [1, 2, 3])
  for (const item of structuredData.breadcrumbList.itemListElement) {
    assert.equal(item["@type"], "ListItem")
    assert.equal(new URL(item.item).origin, "https://musiccityspecialtywelding.com")
  }
  assert.match(servicePage, /structuredData\.faqPage/)
})

test("LocalBusiness JSON-LD gives the address a geo point and existing pricing wording", () => {
  assert.match(appLayout, /priceRange: "Pricing is not listed"/)
  assert.match(appLayout, /geo:\s*\{\s*"@type": "GeoCoordinates",\s*latitude: 36\.21646,\s*longitude: -86\.3035,/)
})

test("quote honeypot ignores ordinary autofill and silently suppresses a filled trap", () => {
  assert.equal(QUOTE_HONEYPOT_FIELD, "mcsw_9f3a2")
  assert.doesNotMatch(QUOTE_HONEYPOT_FIELD, /name|email|phone|company|address|url|organization/i)

  const browserAutofilledForm = new FormData()
  browserAutofilledForm.set("company", "[INTERNAL TEST] Example Company")
  browserAutofilledForm.set(QUOTE_HONEYPOT_FIELD, "")
  assert.equal(isQuoteHoneypotFilled(browserAutofilledForm), false)
  assert.equal(quoteSubmissionOutcome({ accepted: true }), "accepted")

  const filledTrap = new FormData()
  filledTrap.set(QUOTE_HONEYPOT_FIELD, "[INTERNAL TEST] spam")
  assert.equal(isQuoteHoneypotFilled(filledTrap), true)
  assert.equal(quoteSubmissionOutcome({ accepted: true, suppressed: true }), "suppressed")
  assert.equal(quoteSubmissionOutcome({ accepted: false }), "rejected")

  const routeBranch = quoteRoute.match(/if \(isQuoteHoneypotFilled\(formData\)\) \{[\s\S]*?\n    \}/)?.[0]
  assert.match(routeBranch ?? "", /accepted: true, suppressed: true/)
  assert.doesNotMatch(routeBranch ?? "", /createLead|recordEvent|notifyAll/)
  assert.match(contactComponent, /if \(outcome === "accepted"\) \{[\s\S]*?reportMetaLead\(\)/)
  assert.match(contactComponent, /if \(outcome === "rejected"\) throw/)
  assert.match(contactComponent, /name=\{QUOTE_HONEYPOT_FIELD\}[^\n]*autoComplete="off"/)
})

test("404 emits one robots directive from its route metadata", () => {
  const rootMetadata = appLayout.match(/export const metadata: Metadata = \{[\s\S]*?\n\}/)?.[0] ?? ""
  const routeMetadata = notFoundPage.match(/export const metadata: Metadata = \{[\s\S]*?\n\}/)?.[0] ?? ""
  assert.equal((rootMetadata.match(/\brobots\s*:/g) ?? []).length, 0)
  assert.equal((routeMetadata.match(/\brobots\s*:/g) ?? []).length, 1)
  assert.match(routeMetadata, /robots:\s*\{\s*index: false, follow: false\s*\}/)
})

test("sitemap carries the source files' Git dates as lastmod values", () => {
  const entries = sitemapTestModule.default()
  assert.ok(entries.length > 0)
  assert.ok(entries.every((entry) => entry.lastModified instanceof Date))
  assert.deepEqual(entries.map((entry) => entry.lastModified.toISOString().slice(0, 10)), [
    "2026-09-27",
    "2026-09-27",
    "2026-09-17",
    "2026-08-29",
    "2026-09-27",
  ])
})

test("favicon comes from app/icon.svg and unreferenced PNGs stay archived", () => {
  assert.equal(existsSync(new URL("../app/icon.svg", import.meta.url)), true)
  assert.equal(existsSync(new URL("../public/icon.svg", import.meta.url)), false)
  assert.equal(existsSync(new URL("../docs/archive/unused-public-assets/icon-light-32x32.png", import.meta.url)), true)
  assert.equal(existsSync(new URL("../docs/archive/unused-public-assets/placeholder-logo.png", import.meta.url)), true)
  assert.equal(existsSync(new URL("../public/icon-light-32x32.png", import.meta.url)), false)
  assert.equal(existsSync(new URL("../public/placeholder-logo.png", import.meta.url)), false)
  assert.doesNotMatch(appLayout, /mcs welding logo\.png/)
})

test("Access-Control-Allow-Origin only applies to API routes", async () => {
  const configuredHeaders = await nextConfigModule.headers()
  const originHeaders = configuredHeaders.flatMap(({ source, headers }) =>
    headers
      .filter(({ key }) => key.toLowerCase() === "access-control-allow-origin")
      .map(({ value }) => ({ source, value }))
  )

  assert.ok(originHeaders.every(({ source }) => source.startsWith("/api/")))
})

test("shop phone fallback throws only in production and logs in preview", () => {
  const warnings = []
  assert.throws(
    () => enforceShopPhoneFallbackPolicy({ isFallback: true, nodeEnv: "production", vercelEnv: "production", warn: (message) => warnings.push(message) }),
    /must be configured in production/
  )
  assert.equal(enforceShopPhoneFallbackPolicy({ isFallback: true, nodeEnv: "production", vercelEnv: "preview", warn: (message) => warnings.push(message) }), "fallback")
  assert.equal(enforceShopPhoneFallbackPolicy({ isFallback: true, nodeEnv: "test", vercelEnv: "production", warn: (message) => warnings.push(message) }), "fallback")
  assert.equal(enforceShopPhoneFallbackPolicy({ isFallback: false, nodeEnv: "production", vercelEnv: "production", warn: (message) => warnings.push(message) }), "configured")
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /preview is using the fallback number/)
  assert.match(shopContactSource, /enforceShopPhoneFallbackPolicy\(\{\s*isFallback,\s*nodeEnv: process\.env\.NODE_ENV,\s*vercelEnv: process\.env\.VERCEL_ENV,/)
})
