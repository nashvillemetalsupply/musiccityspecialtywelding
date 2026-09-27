import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import postcss from "postcss"

const source = execFileSync(
  "rg",
  ["-o", "ops-[a-z0-9-]+", "app/board", "app/ops", "components", "-g", "*.tsx", "-g", "*.ts"],
  { encoding: "utf8" },
)
const used = new Set(source.match(/ops-[a-z0-9-]+/g) ?? [])
const allowlisted = new Set(`
  ops-account-page ops-account-people ops-add-job-action ops-card
  ops-filters ops-header-actions ops-job-row ops-kicker ops-login ops-main
  ops-more-view ops-phone-row ops-row-actions ops-shop-page ops-sub
  ops-table-wrap ops-ticket-actions ops-ticket-urgent ops-wall-vnext
  ops-work-order-vnext ops-shell
`.trim().split(/\s+/))
const css = readFileSync("styles/ops-legacy.css", "utf8")
const baseline = readFileSync("scripts/qa/baseline/pre-retirement-globals.css", "utf8")
const unused = new Set()
const arms = new Set()
const nonOps = new Set()
const duplicateSelectors = new Map()
const rules = []

postcss.parse(css).walkRules((rule) => {
  const context = []
  for (let parent = rule.parent; parent?.type !== "root"; parent = parent.parent) {
    if (parent.type === "atrule") context.unshift(`${parent.name} ${parent.params}`)
  }
  rules.push({
    selector: rule.selector.trim().replace(/\s+/g, " "),
    context: context.join(" | "),
    line: rule.source.start.line,
    declarations: (rule.nodes ?? [])
      .filter((node) => node.type === "decl")
      .map((node) => ({ prop: node.prop, value: node.value, important: node.important })),
  })
  for (const arm of postcss.list.comma(rule.selector)) {
    const normalized = arm.trim().replace(/\s+/g, " ")
    const lines = duplicateSelectors.get(normalized) ?? []
    lines.push(rule.source.start.line)
    duplicateSelectors.set(normalized, lines)
    const classes = arm.match(/\.ops-[a-z0-9-]+/g) ?? []
    if (classes.length === 0) nonOps.add(arm.trim())
    for (const token of classes) {
      const name = token.slice(1)
      if (!used.has(name) && !allowlisted.has(name)) {
        unused.add(name)
        arms.add(arm.trim())
      }
    }
  }
})

console.log(`Unused ops classes: ${[...unused].sort().join(", ")}`)
console.log(`Candidate selector arms (${arms.size}):`)
for (const arm of [...arms].sort()) console.log(arm)
console.log(`Selector arms with no .ops class (${nonOps.size}):`)
for (const arm of [...nonOps].sort()) console.log(arm)
const duplicates = [...duplicateSelectors].filter(([, lines]) => lines.length > 1)
console.log(`Repeated selector arms (${duplicates.length}):`)
for (const [selector, lines] of duplicates) console.log(`${lines.join(", ")}: ${selector}`)
const shadowed = rules.filter((rule, index) => {
  if (!rule.declarations.length) return false
  const later = rules.slice(index + 1).filter((candidate) => candidate.selector === rule.selector && candidate.context === rule.context)
  return rule.declarations.every((declaration) => later.some((candidate) => candidate.declarations.some((laterDeclaration) =>
    declaration.prop === laterDeclaration.prop
    && declaration.value === laterDeclaration.value
    && (!declaration.important || laterDeclaration.important)
  )))
})
console.log(`Fully repeated blocks (${shadowed.length}):`)
for (const rule of shadowed) console.log(`${rule.line}: ${rule.selector}`)
const overridden = rules.filter((rule, index) => {
  if (!rule.declarations.length) return false
  const later = rules.slice(index + 1).filter((candidate) => candidate.selector === rule.selector && candidate.context === rule.context)
  return rule.declarations.every((declaration) => {
    return later.some((candidate) => candidate.declarations.some((laterDeclaration) =>
      laterDeclaration.prop === declaration.prop
      && (!declaration.important || laterDeclaration.important)
    ))
  })
})
console.log(`Fully overridden blocks (${overridden.length}):`)
for (const rule of overridden) console.log(`${rule.line}: ${rule.selector}`)

const baselineRules = []
postcss.parse(baseline).walkRules((rule) => {
  const context = []
  for (let parent = rule.parent; parent?.type !== "root"; parent = parent.parent) {
    if (parent.type === "atrule") context.unshift(`${parent.name} ${parent.params}`)
  }
  baselineRules.push({
    selector: rule.selector.trim().replace(/\s+/g, " "),
    context: context.join(" | "),
    line: rule.source.start.line,
    declarations: (rule.nodes ?? [])
      .filter((node) => node.type === "decl")
      .map((node) => ({ prop: node.prop, value: node.value, important: node.important })),
  })
})
console.log("Baseline line mappings for fully overridden blocks:")
for (const rule of overridden) {
  const matches = baselineRules.filter((candidate) =>
    candidate.selector === rule.selector
    && candidate.context === rule.context
    && JSON.stringify(candidate.declarations) === JSON.stringify(rule.declarations)
  )
  console.log(`${rule.line} -> ${matches.map((match) => match.line).join(", ")}: ${rule.selector}`)
}
