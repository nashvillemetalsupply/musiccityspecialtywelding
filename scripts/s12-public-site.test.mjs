import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const homePage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8")
const serviceAreasPage = readFileSync(new URL("../app/service-areas/page.tsx", import.meta.url), "utf8")
const servicePage = readFileSync(new URL("../app/services/[slug]/page.tsx", import.meta.url), "utf8")
const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")

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
