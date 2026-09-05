import { readdirSync, readFileSync, writeFileSync } from "node:fs"

const ROWS = "scripts/qa/report/rows"
const rows = readdirSync(ROWS).filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(`${ROWS}/${f}`, "utf8")))
  .sort((a, b) => `${a.route}${a.width}`.localeCompare(`${b.route}${b.width}`))

const head = "| route | width | axe | axe ids | min font | at | h1 | main | skip | order | overflow |\n|---|---|---|---|---|---|---|---|---|---|---|\n"
const body = rows.map((r) => `| ${r.route} | ${r.width} | ${r.axe ?? ""} | ${r.axeIds ?? ""} | ${r.minFont ?? ""} | ${r.minFontSel ?? ""} | ${r.h1 ?? ""} | ${r.main ?? ""} | ${r.skipLink ?? ""} | ${r.orderOk ?? ""} | ${r.overflow ?? ""} |`).join("\n")
writeFileSync("scripts/qa/report/summary.md", head + body + "\n")

const fingerprint = {}
for (const r of rows) if (r.fp) fingerprint[r.route] = r.fp
writeFileSync("scripts/qa/report/fingerprint.json", JSON.stringify(fingerprint, null, 2))
console.log(`${rows.length} rows -> scripts/qa/report/summary.md, ${Object.keys(fingerprint).length} routes fingerprinted`)
