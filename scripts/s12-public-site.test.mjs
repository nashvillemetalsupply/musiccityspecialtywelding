import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import { isQuoteHoneypotFilled, QUOTE_HONEYPOT_FIELD, quoteSubmissionOutcome } from "../lib/public-quote.mjs"

const homePage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8")
const serviceAreasPage = readFileSync(new URL("../app/service-areas/page.tsx", import.meta.url), "utf8")
const servicePage = readFileSync(new URL("../app/services/[slug]/page.tsx", import.meta.url), "utf8")
const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")
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

test("home sign keeps its visual text and names the service and city accessibly", () => {
  assert.match(
    homePage,
    /<h1 className="sw-sign" aria-label="Music City Specialty Welding — Nashville mobile welding, on-site repair, and custom fabrication across Middle Tennessee">/
  )
  assert.match(homePage, /<span className="sw-line-sm">Music City<\/span>/)
  assert.match(homePage, /<span className="sw-line-lg">Specialty<\/span>/)
  assert.match(homePage, /<span className="sw-line-lg">\s*Weld<i className="sw-buzz"/)
})

test("service-area cities link to the mobile-welding section with the existing chip styling", () => {
  assert.match(serviceAreasPage, /const areas = \["Lebanon", "Nashville", "Franklin", "Murfreesboro", "Gallatin", "Hendersonville", "Clarksville", "Antioch"\]/)
  assert.match(serviceAreasPage, /areas\.map\(\(area\) => <Link className="ms-display" href="\/services\/mobile-welding#service" key=\{area\}>\{area\}<\/Link>\)/)
  assert.match(servicePage, /<section className="ms-subhero" id="service">/)
  assert.match(globalCss, /\.ms-area-cities > div :is\(strong, a\) \{[^}]*text-decoration: none;/)
})

test("service pages offer the existing quote form below their content", () => {
  assert.match(servicePage, /import \{ MainstreetContact \} from "@\/components\/mainstreet-contact"/)
  assert.match(servicePage, /<MainstreetContact phoneHref=\{shopPhone\.href\} phoneDisplay=\{shopPhone\.display\} \/>/)
  assert.match(servicePage, /href="#contact"/)
  assert.match(servicePage, /<MobileQuickActions quoteHref="#contact" phoneHref=\{shopPhone\.href\} \/>/)
  assert.doesNotMatch(servicePage, /href="\/#contact"|quoteHref="\/#contact"/)
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
