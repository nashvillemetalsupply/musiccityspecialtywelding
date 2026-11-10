import { readFileSync } from "node:fs"
import { join } from "node:path"
import { servicePages } from "../service-pages.ts"

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
const areaList = areaPage.match(/const areas = (\[[^\n]+\])/)?.[1]
if (!areaList) throw new Error("Assistant knowledge could not read the service-area list.")
const areas: unknown = JSON.parse(areaList)
if (!Array.isArray(areas) || !areas.every((area) => typeof area === "string")) {
  throw new Error("Assistant knowledge has an invalid service-area list.")
}

const areaContent = [...areaPage.matchAll(/<(?:h[12]|p|span|strong)\b[^>]*>([\s\S]*?)<\/(?:h[12]|p|span|strong)>/g)]
  .map((match) => match[1].replace(/<[^>]+>/g, "").replace(/\{[^}]+\}/g, "").replace(/&apos;/g, "'").replace(/\s+/g, " ").trim())
  .filter(Boolean)

const approvedLines = briefSection(brand, "Google Ads Source of Truth")
  .split("\n")
  .filter((line) => /^- \*\*(?:Approved .* promise|Approved secondary capabilities|Operating hours):/.test(line))
const businessDetails = briefSection(brand, "Assets").split("\n")
  .find((line) => line.startsWith("- **Existing business details:**"))
if (!businessDetails) throw new Error("Assistant knowledge is missing the business contact details.")
const publicNumber = businessDetails.match(/public tracking phone `([^`]+)`/)?.[1]
if (!publicNumber) throw new Error("Assistant knowledge is missing the public shop phone.")

export const ASSISTANT_SHOP_PHONE = Object.freeze({
  display: publicNumber,
  href: `tel:+1${publicNumber.replace(/\D/g, "")}`,
})

export const assistantKnowledge = Object.freeze({
  sources: ["lib/service-pages.ts (app/services/[slug]/page.tsx)", "app/service-areas/page.tsx", "BRAND-BRIEF.md"],
  services: servicePages.map(({ slug, title, shortTitle, intro, commonJobs, goodFit, details, faqs }) => ({
    slug, title, shortTitle, intro, commonJobs, goodFit, details, faqs,
  })),
  serviceAreas: areas as string[],
  travel: areaContent,
  brand: {
    voice: briefSection(brand, "Voice").split("Sample headlines:", 1)[0].trim(),
    approvedFacts: approvedLines,
    businessDetails,
  },
})

export const ASSISTANT_KNOWLEDGE = JSON.stringify(assistantKnowledge)
