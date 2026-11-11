import { readFileSync } from "node:fs"
import { join } from "node:path"
import { servicePages } from "../service-pages.ts"
import { serviceAreas } from "../service-areas.ts"
import { assistantAnswers, ASSISTANT_SHOP_PHONE } from "./answers.ts"
export { ASSISTANT_SHOP_PHONE } from "./answers.ts"

function briefSection(brief: string, title: string): string {
  const heading = `## ${title}\n`
  const start = brief.indexOf(heading)
  if (start < 0) throw new Error(`Assistant knowledge is missing BRAND-BRIEF.md section: ${title}`)
  return brief.slice(start + heading.length).split(/\n## /, 1)[0].trim()
}

// These files are local, versioned evidence. Load once at module import; no
// crawler, network retrieval, hand-copied service list, or per-turn file read.
const brand = readFileSync(join(process.cwd(), "BRAND-BRIEF.md"), "utf8").replace(/\r\n/g, "\n")
const areaPage = readFileSync(join(process.cwd(), "app/service-areas/page.tsx"), "utf8")
const homepage = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8")
const contactForm = readFileSync(join(process.cwd(), "components/mainstreet-contact.tsx"), "utf8")

function visibleText(source: string): string {
  return source.replace(/<[^>]+>/g, " ").replace(/\{[^}]+\}/g, "").replace(/&apos;/g, "'").replace(/\s+/g, " ").trim()
}

// Read only literal FAQ answers and the explanatory copy, never the example
// job's status or dates. Missing source anchors fail closed during the build.
const faqSource = homepage.match(/const faqs = \[([\s\S]*?)^\]/m)?.[1]
const processSource = homepage.match(/<section\b[^>]*\bid="process"[^>]*>([\s\S]*?)<\/section>/)?.[1]
const customerPageSource = homepage.match(/<div className="ms-job-glass-copy[^\"]*">([\s\S]*?)<\/div>/)?.[1]
if (!faqSource || !processSource || !customerPageSource) throw new Error("Assistant knowledge could not read the homepage customer facts.")
const homepageFaqs = [...faqSource.matchAll(/question:\s*("(?:[^"\\]|\\.)*")\s*,\s*answer:\s*("(?:[^"\\]|\\.)*")/g)]
  .map((match) => ({ question: JSON.parse(match[1]) as string, answer: JSON.parse(match[2]) as string }))
if (!homepageFaqs.length) throw new Error("Assistant knowledge has no homepage FAQs.")
const customerProcess = [...processSource.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => visibleText(match[1]))
const customerPage = [...customerPageSource.matchAll(/<(?:p|li)\b[^>]*>([\s\S]*?)<\/(?:p|li)>/g)].map((match) => visibleText(match[1]))
const photoLimit = contactForm.match(/<small>(Up to \d+ \/ \d+ MB total)<\/small>/)?.[1]
const photoValidation = [...contactForm.matchAll(/validation = "((?:Use |Each photo |Photos must )[^"\n]+)"/g)].map((match) => match[1])
const requiredFields = [...contactForm.matchAll(/<label htmlFor="(quote-[^"]+)">([^<]+)<\/label>\s*(?:<div className="ms-select-wrap">\s*)?<(?:input|select)\b([^>]+)>/g)]
  .filter((match) => /\brequired\b/.test(match[3])).map((match) => visibleText(match[2]).replace(/\s*\*$/, ""))
if (!customerProcess.length || !customerPage.length || !photoLimit || photoValidation.length !== 3 || requiredFields.length !== 3) {
  throw new Error("Assistant knowledge could not read the customer process or quote form requirements.")
}
const areaContent = [...areaPage.matchAll(/<(?:h[12]|p|span|strong)\b[^>]*>([\s\S]*?)<\/(?:h[12]|p|span|strong)>/g)]
  .map((match) => match[1].replace(/<[^>]+>/g, "").replace(/\{[^}]+\}/g, "").replace(/&apos;/g, "'").replace(/\s+/g, " ").trim())
  .filter(Boolean)

const approvedLines = briefSection(brand, "Google Ads Source of Truth")
  .split("\n")
  .filter((line) => /^- \*\*(?:Approved .* promise|Approved secondary capabilities|Operating hours):/.test(line))
const businessDetailsSource = briefSection(brand, "Assets").split("\n")
  .find((line) => line.startsWith("- **Existing business details:**"))
if (!businessDetailsSource) throw new Error("Assistant knowledge is missing the business contact details.")
// Contact facts use the same configured public number as the page. The brief's
// historic tracking and fallback values must not override current wiring.
const businessDetails = businessDetailsSource.replace(/, fallback owner line `[^`]+`/, "")
  .replace(/public tracking phone `[^`]+`/, `public shop phone \`${ASSISTANT_SHOP_PHONE.display}\``)
  .replace(/Sales@/g, "sales@")

export const assistantKnowledge = Object.freeze({
  sources: ["lib/service-pages.ts (app/services/[slug]/page.tsx)", "lib/service-areas.ts", "lib/assistant/answers.ts", "app/service-areas/page.tsx", "BRAND-BRIEF.md", "app/page.tsx", "components/mainstreet-contact.tsx"],
  answers: assistantAnswers,
  services: servicePages.map(({ slug, title, shortTitle, intro, commonJobs, goodFit, details, faqs }) => ({
    slug, title, shortTitle, intro, commonJobs, goodFit, details, faqs,
  })),
  serviceAreas,
  travel: areaContent,
  homepage: { faqs: homepageFaqs, process: customerProcess, customerPage },
  quoteForm: { href: "/#contact", requiredFields, photos: { optional: /Photos <i>optional<\/i>/.test(contactForm), limit: photoLimit, validation: photoValidation } },
  brand: {
    voice: briefSection(brand, "Voice").split("Sample headlines:", 1)[0].trim(),
    approvedFacts: approvedLines,
    businessDetails,
  },
})

export const ASSISTANT_KNOWLEDGE = JSON.stringify(assistantKnowledge)
