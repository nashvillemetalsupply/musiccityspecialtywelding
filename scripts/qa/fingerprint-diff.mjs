import { readFileSync } from "node:fs"

const [, , beforePath, afterPath] = process.argv
if (!beforePath || !afterPath) {
  console.error("usage: node scripts/qa/fingerprint-diff.mjs <before.json> <after.json>")
  process.exit(1)
}
const before = JSON.parse(readFileSync(beforePath, "utf8"))
const after = JSON.parse(readFileSync(afterPath, "utf8"))
const PROPS = ["font-size", "font-weight", "color", "background-color", "padding", "display", "line-height"]
const changed = []
for (const route of Object.keys(before)) {
  for (const cls of Object.keys(before[route])) {
    const a = before[route][cls].split("|")
    const b = (after[route]?.[cls] ?? "").split("|")
    a.forEach((value, index) => {
      if (value !== b[index]) changed.push(`${route}  .${cls}  ${PROPS[index]}: ${value} -> ${b[index] ?? "(gone)"}`)
    })
  }
}
if (changed.length) {
  console.error(changed.join("\n"))
  process.exit(1)
}
console.log(`fingerprint unchanged across ${Object.keys(before).length} routes`)
