import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"
import postcss from "postcss"
import { classify, scanClassUsage } from "./qa/retire-ops-css.mjs"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
// Ignore horizontal indentation at the beginning of a line, and nothing else:
// value spacing, declaration order, comments, semicolons and line endings count.
const unindent = (text) => text.replace(/^[\t ]+/gm, "")

function openingBrace(text, start) {
  let quote = ""
  let comment = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (comment) {
      if (char === "*" && text[index + 1] === "/") { comment = false; index++ }
    } else if (quote) {
      if (char === "\\") index++
      else if (char === quote) quote = ""
    } else if (char === "/" && text[index + 1] === "*") { comment = true; index++ }
    else if (char === "\"" || char === "'") quote = char
    else if (char === "{") return index
  }
  throw new Error("declaration block has no opening brace")
}

function blocks(css) {
  const result = []
  postcss.parse(css).walk((node) => {
    if (!node.nodes || !node.nodes.some((child) => child.type === "decl")) return
    const context = []
    for (let parent = node.parent; parent?.type !== "root"; parent = parent.parent) {
      context.unshift(unindent(css.slice(parent.source.start.offset, openingBrace(css, parent.source.start.offset))))
    }
    const open = openingBrace(css, node.source.start.offset)
    result.push({
      body: unindent(css.slice(open, node.source.end.offset)),
      arms: node.type === "rule" ? postcss.list.comma(node.selector).map(unindent) : [unindent(css.slice(node.source.start.offset, open))],
      context: JSON.stringify(context),
      line: node.source.start.line,
    })
  })
  return result
}

function assertVerbatim(original, moved) {
  const before = blocks(original)
  const after = blocks(moved)
  assert.ok(after.length, "legacy must contain declaration blocks")
  let cursor = -1
  for (const block of after) {
    const match = before.findIndex((candidate, index) => {
      if (index <= cursor || candidate.body !== block.body || candidate.context !== block.context) return false
      let armCursor = -1
      return block.arms.every((arm) => {
        armCursor = candidate.arms.indexOf(arm, armCursor + 1)
        return armCursor !== -1
      })
    })
    assert.ok(match >= 0, `legacy line ${block.line}: declaration bytes, selector arms, enclosing at-rules or source order differ from the frozen globals`)
    cursor = match
  }
}

test("every moved declaration block is byte-identical to the frozen globals in source order", () => {
  assertVerbatim(read("scripts/qa/baseline/pre-retirement-globals.css"), read("styles/ops-legacy.css"))
})

test("verbatim proof permits selector-arm extraction and leading indentation only", () => {
  assertVerbatim("@media (max-width: 600px) {\n  .dead, .ops-live {\n    color: red; /* retained */\n    padding: 0;\n  }\n}", "@media (max-width: 600px) {\n.ops-live {\ncolor: red; /* retained */\npadding: 0;\n}\n}")
})

test("verbatim proof rejects reformatting, reordering, merging, splitting and rewritten values", () => {
  const original = ".ops-live {\n  color: red; /* retained */\n  padding: 0;\n}\n.ops-next { margin: 0; }"
  for (const moved of [
    ".ops-live { color: red; /* retained */ padding: 0; }",
    ".ops-live {\n  padding: 0;\n  color: red; /* retained */\n}",
    ".ops-live {\n  color: red; /* retained */\n  padding: 0;\n  margin: 0;\n}",
    ".ops-live {\n  color: red; /* retained */\n}\n.ops-live {\n  padding: 0;\n}",
    original.replace("red", "blue"),
    original.replace(" /* retained */", ""),
    original.replace("padding: 0;", "padding:  0;"),
    original.replaceAll("\n", "\r\n"),
    original.replace(".ops-live", ".ops-live.ops-live"),
    ".ops-next { margin: 0; }\n" + original.slice(0, original.indexOf("\n.ops-next")),
    `@media (max-width: 600px) {${original}}`,
  ]) assert.throws(() => assertVerbatim(original, moved), /differ from the frozen globals/)
})

const projection = ({ body, arms, context }) => ({ body, arms, context })
// These 15 legacy selector arms had no effect: every declaration is replaced
// by a later rule with the same selector and at-rule context. Keep their
// frozen source lines here so the provenance test permits this proven cleanup
// without broadening the set of rules that can disappear.
// Fourteen baseline rule starts cover fifteen selector arms; line 5629 is a
// comma-separated rule containing both the handset and radio panel arms.
const REDUNDANT_LEGACY_RULE_LINES = new Set([
  1788, 1831, 1833, 5000, 5003, 5264, 5629, 5729, 5731, 5753, 5768, 5775,
  5782, 5783,
])

// Compare complete ordered projections as well as individual block provenance:
// dropping one rule must fail even when another rule still names the class.
test("every retained live selector arm and declaration block survives the move", () => {
  const root = fileURLToPath(new URL("..", import.meta.url))
  const out = execFileSync("git", ["grep", "-ho", "ops-[a-z0-9-]*", "--", "app/board", "app/ops", "components"], { cwd: root, encoding: "utf8" })
  const used = new Set(out.trim().split(/\s+/).filter(Boolean).map((name) => `.${name}`))
  const expected = blocks(read("scripts/qa/baseline/pre-retirement-globals.css"))
    .filter(({ line }) => !REDUNDANT_LEGACY_RULE_LINES.has(line))
    .map(projection).flatMap((block) => {
      const arms = block.context.includes("@keyframes paid-land") ? block.arms : block.arms.filter((arm) => (arm.match(/\.ops-[a-z0-9-]+/g) ?? []).some((name) => used.has(name)))
      return arms.length ? [{ ...block, arms }] : []
    })
  const actual = blocks(read("styles/ops-legacy.css")).map(projection)
  assert.deepEqual(actual, expected, "a live selector arm, declaration block, context or source order changed")
})

// P01 adds literal fallbacks to three CTA custom properties so subpages retain
// readable colors when those properties are outside their defining scope.
// P02 moves each service-area tile style onto its link so the visible tile is
// the target. Keep this allowlist at full-rule granularity: every other public
// CSS byte remains frozen, and each old rule must appear once in the baseline.
// CRMACCEPT gives the process phone link and both consent links 44px touch
// targets. Only these two exact rules join the approved replacements.
// Fable adds the chat button to the existing mobile CTA styles, retaining its
// typography, colors and grid while limiting action colors to direct children.
// Normalize its native appearance so mobile browsers paint the shared CTA CSS;
// leave font/border resets to the same preflight rules that style the Quote link.
// Keep both labels on one line so adjusted fallback fonts preserve the bar height.
const APPROVED_PUBLIC_CSS_REPLACEMENTS = [
  [
    ".ms-mobile-cta a {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 0.55rem;\n  padding: 0.95rem 0.6rem;\n  text-decoration: none;\n  font-family: var(--font-ms-display), sans-serif;\n  font-weight: 900;\n  font-size: 1.15rem;\n  text-transform: uppercase;\n}",
    ".ms-mobile-cta button { -webkit-appearance: none; appearance: none; cursor: pointer; }\n\n.ms-mobile-cta a, .ms-mobile-cta button {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 0.55rem;\n  padding: 0.95rem 0.6rem;\n  text-decoration: none;\n  font-family: var(--font-ms-display), sans-serif;\n  font-weight: 900;\n  font-size: 1.15rem;\n  text-transform: uppercase;\n  white-space: nowrap;\n}",
  ],
  [
    ".ms-mobile-cta a:first-child { background: var(--mx-arc); color: #16100b; }",
    ".ms-mobile-cta > :first-child { background: var(--mx-arc); color: #16100b; }",
  ],
  [
    ".ms-mobile-cta a:last-child { background: var(--mx-ink); color: var(--mx-bone); border-left: 2px solid var(--mx-bone); }",
    ".ms-mobile-cta > :last-child { background: var(--mx-ink); color: var(--mx-bone); border-left: 2px solid var(--mx-bone); }",
  ],
  [
    ".ms-mobile-cta a:first-child { background: linear-gradient(180deg, var(--sw-neon), var(--sw-fire) 60%); color: #1b0f02; }",
    ".ms-mobile-cta > :first-child { background: linear-gradient(180deg, var(--sw-neon, #ffb46b), var(--sw-fire, #ff8a2a) 60%); color: #1b0f02; }",
  ],
  [
    ".ms-mobile-cta a:last-child { background: #241d12; color: var(--sw-chalk); border-left-color: #000; }",
    ".ms-mobile-cta > :last-child { background: #241d12; color: var(--sw-chalk, #f3ead8); border-left-color: #000; }",
  ],
  [
    ".ms-area-cities > div strong { display: inline-flex; min-height: 3.2rem; align-items: center; padding: .5rem 1rem; border: 2px solid #252620; color: #252620; background: #e8ddc4; box-shadow: .18rem .22rem 0 rgba(0,0,0,.38); font-size: clamp(1.15rem,2.6vw,1.75rem); transform: rotate(-.35deg); }",
    ".ms-area-cities > div > a { display: inline-flex; min-height: 3.2rem; align-items: center; padding: .5rem 1rem; border: 2px solid #252620; color: #252620; background: #e8ddc4; box-shadow: .18rem .22rem 0 rgba(0,0,0,.38); font-size: clamp(1.15rem,2.6vw,1.75rem); text-decoration: none; transform: rotate(-.35deg); }",
  ],
  [
    ".ms-area-cities > div strong:nth-child(2n) { transform: rotate(.35deg); background: #d8d1bf; }",
    ".ms-area-cities > div > a:nth-child(2n) { transform: rotate(.35deg); background: #d8d1bf; }",
  ],
  [
    "  .ms-area-cities > div strong { min-height: 2.8rem; font-size: 1.05rem; }",
    "  .ms-area-cities > div > a { min-height: 2.8rem; font-size: 1.05rem; }",
  ],
  [
    ".ms-process-call {\n  border: 0;\n  background: transparent;\n  padding: 0;\n}",
    ".ms-process-call {\n  border: 0;\n  background: transparent;\n  padding: 0;\n  min-height: 44px;\n}",
  ],
  [
    ".ms-text-consent a { color: var(--sw-red); font-weight: 700; text-underline-offset: .15em; }",
    ".ms-text-consent a { display: inline-flex; min-width: 44px; min-height: 44px; align-items: center; vertical-align: middle; color: var(--sw-red); font-weight: 700; text-underline-offset: .15em; }",
  ],
]

function applyApprovedPublicCssReplacements(css) {
  // Git checks out LF on Linux and CRLF here. Adapt only these canonical rule
  // literals to the input; the complete expected/current byte check stays exact.
  const lineEnding = css.match(/\r?\n/)?.[0] || "\n"
  for (const [canonicalBefore, canonicalAfter] of APPROVED_PUBLIC_CSS_REPLACEMENTS) {
    const before = canonicalBefore.replaceAll("\n", lineEnding)
    const after = canonicalAfter.replaceAll("\n", lineEnding)
    assert.equal(css.split(before).length - 1, 1, `approved public CSS source rule must occur once: ${before}`)
    css = css.replace(before, after)
  }
  return css
}

// Fable 2026-11-10 #1/#3/#4/#6/#17 explicitly replace the two font
// fallbacks, unify public small type, widen the shared container, reserve
// footer clearance, and retire the two bespoke 404 action rules. Keep the
// historical comparison for every other byte and all operations CSS.
function applyFablePublicCssRuling(css) {
  assert.equal((css.match(/^  --font-ms-(?:sans|mono): .+\r?\n/gm) ?? []).length, 2)
  css = css.replace(/^  --font-ms-(?:sans|mono): .+\r?\n/gm, "")
  css = css.replace("minmax(0, 0.8fr); padding-bottom: 4rem;", "minmax(0, 0.8fr); padding-bottom: 6.5rem;")
  css = css.replace("max-width: 68rem;", "max-width: var(--ms-container);")
  assert.equal((css.match(/^\.ms-lost-actions a[^\r\n]+\r?\n/gm) ?? []).length, 2)
  css = css.replace(/^\.ms-lost-actions a[^\r\n]+\r?\n/gm, "")
  const approvedTypeSizes = new Map([
    ...[.5, .52, .56, .58, .6, .62, .64, .65, .66, .68, .7, .72, .74, .75, .76, .78, .8].map((size) => [size, .75]),
    ...[.85, .875, .9, .92, .9375].map((size) => [size, .875]),
    ...[.95, .96, 1, 1.02, 1.03, 1.04, 1.05, 1.06, 1.0625].map((size) => [size, 1]),
    ...[1.08, 1.1, 1.12, 1.15].map((size) => [size, 1.125]),
    ...[1.2, 1.25, 1.3, 1.35, 1.4].map((size) => [size, 1.25]),
  ])
  const sheet = postcss.parse(css)
  sheet.walkRules((rule) => {
    if (!/\.(?:ms|sw|wm)-/.test(rule.selector)) return
    const mono = rule.nodes.some((decl) => /^(font-family|font)$/.test(decl.prop) && decl.value.includes("--font-ms-mono"))
    rule.walkDecls("font-size", (decl) => {
      if (mono) decl.value = "var(--ms-label)"
      else if (/^[\d.]+rem$/.test(decl.value) && approvedTypeSizes.has(parseFloat(decl.value))) decl.value = `${approvedTypeSizes.get(parseFloat(decl.value))}rem`
    })
    rule.walkDecls("font", (decl) => {
      decl.value = decl.value.replace(/([\d.]+)rem(?=\/)/, (value, size) => mono ? "var(--ms-label)" : approvedTypeSizes.has(+size) ? `${approvedTypeSizes.get(+size)}rem` : value)
    })
  })
  // Fable round 2 explicitly aligns the breadcrumb and private-link band,
  // places its link below the paragraph, and removes the doubled mobile gap.
  // Keep these complete approved rules exact; all remaining public bytes stay
  // under the same frozen comparison, including unrelated service styling.
  const lineEnding = css.match(/\r?\n/)?.[0] || "\n"
  let approved = sheet.toString()
  const round2 = [
    [
      ".ms-breadcrumb {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 0.55rem;\n  padding: 1rem clamp(1rem, 4vw, 4.5rem) 0;\n  color: var(--mx-steel);\n  font-family: var(--font-ms-mono), monospace;\n  font-size: var(--ms-label);\n  font-weight: 600;\n  letter-spacing: 0.04em;\n}",
      ".ms-breadcrumb {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 0.55rem;\n  padding: 1rem max(var(--ms-gutter), calc((100% - var(--ms-container)) / 2)) 0;\n  color: var(--mx-steel);\n  font-family: var(--font-ms-mono), monospace;\n  font-size: var(--ms-label);\n  font-weight: 600;\n  letter-spacing: 0.04em;\n}",
    ],
    [
      ".ms-subglass { display: grid; gap: 1.25rem; align-items: center; padding: clamp(1.5rem,4vw,2.5rem) clamp(1rem,5vw,3rem); border-block: 1px solid rgba(243,234,216,.2); color: #f3ead8; background: linear-gradient(90deg,#17191a,#252927 55%,#17191a); }",
      ".ms-subglass { display: grid; gap: 1.25rem; align-items: start; padding: clamp(1.5rem,4vw,2.5rem) max(var(--ms-gutter), calc((100% - var(--ms-container)) / 2)); border-block: 1px solid rgba(243,234,216,.2); color: #f3ead8; background: linear-gradient(90deg,#17191a,#252927 55%,#17191a); }",
    ],
    [
      "@media (min-width: 900px) { .ms-subglass { grid-template-columns: minmax(16rem,.75fr) minmax(0,1.25fr) auto; } }",
      "@media (min-width: 900px) {\n  .ms-subglass { grid-template-columns: minmax(16rem,.75fr) minmax(0,1.25fr); }\n  .ms-subglass > div { grid-row: 1 / span 2; }\n  .ms-subglass a { grid-column: 2; justify-self: start; }\n}",
    ],
    [
      "  .ms-job-glass-demo { border-width: .45rem; transform: none; }",
      "  .ms-job-glass-demo { margin-top: 0; border-width: .45rem; transform: none; }",
    ],
  ]
  for (const [before, after] of round2) {
    const source = before.replaceAll("\n", lineEnding)
    assert.equal(approved.split(source).length - 1, 1, `Fable round 2 source rule must occur once: ${before}`)
    approved = approved.replace(source, after.replaceAll("\n", lineEnding))
  }
  // The conservative dead-rule classifier retains attribute selectors. This
  // final unused toggle rule belongs to the service FAQ design retired by R2-7.
  const retiredFaqToggle = ".ms-subfaq details[open] summary i { transform: rotate(45deg); }" + lineEnding
  assert.equal(approved.split(retiredFaqToggle).length - 1, 1)
  approved = approved.replace(retiredFaqToggle, "")
  return approved
}

function publicColorTokens() {
  const tokens = new Map()
  postcss.parse(read("styles/public-color-tokens.css")).walkDecls((declaration) => {
    assert.match(declaration.prop, /^--public-[a-z0-9-]+$/)
    assert.match(declaration.value, /^#[\da-fA-F]{3,8}$/)
    assert.equal(tokens.has(declaration.prop), false, `duplicate public color token: ${declaration.prop}`)
    tokens.set(declaration.prop, declaration.value)
  })
  return tokens
}

function resolvePublicColorTokens(css) {
  const tokens = publicColorTokens()
  return css.replace(/var\((--public-[a-z0-9-]+)\)/g, (_, token) => {
    assert.ok(tokens.has(token), `unresolved public color token: ${token}`)
    return tokens.get(token)
  })
}

test("public colors live in tokens and every retained color reference resolves", () => {
  const tokens = publicColorTokens()
  const used = new Set()
  postcss.parse(read("app/globals.css")).walkDecls((declaration) => {
    if (!declaration.prop.startsWith("--")) {
      assert.doesNotMatch(declaration.value, /#[\da-fA-F]{3,8}\b/, `literal color outside a token: ${declaration.prop}`)
    }
    for (const [, token] of declaration.value.matchAll(/var\((--public-[a-z0-9-]+)\)/g)) {
      assert.ok(tokens.has(token), `unresolved public color token: ${token}`)
      used.add(token)
    }
  })
  assert.deepEqual([...used].sort(), [...tokens.keys()].sort(), "retained public color tokens must all have a declaration using them")
  assert.match(read("app/layout.tsx"), /import "\.\/public-site\.css"/)
  assert.match(read("app/public-site.css"), /@import "\.\.\/styles\/public-color-tokens\.css";[\r\n]+@import "\.\/globals\.css";[\r\n]+@import "\.\/page-cohesion\.css";[\r\n]+@import "\.\.\/styles\/reduced-motion\.css";[\r\n]+@import "\.\/homepage-polish\.css";/)
})

test("public CSS remains frozen except approved polish and exact color token extraction", () => {
  const original = read("scripts/qa/baseline/pre-s11-public-css.css")
  const current = read("app/globals.css")
  const root = fileURLToPath(new URL("..", import.meta.url))
  const usage = scanClassUsage(root)
  // The cohesion pass replaced the old process phone treatment with ShopActions.
  // Its historical rules remain preserved, so classify the baseline with this
  // original public class as well. The complete byte comparison still applies.
  usage.classes.add(".ms-process-call")
  const expected = applyFablePublicCssRuling(applyApprovedPublicCssReplacements(classify(original, usage).text.KEEP))
  assert.equal(resolvePublicColorTokens(current), expected, "public CSS differs from the frozen baseline plus approved polish after resolving exact color tokens")
  const imports = (css) => postcss.parse(css).nodes.filter((node) => node.type === "atrule" && !node.nodes).map((node) => css.slice(node.source.start.offset, node.source.end.offset))
  assert.deepEqual(imports(current), imports(original), "global imports and leaf at-rules must remain byte-identical")
})
