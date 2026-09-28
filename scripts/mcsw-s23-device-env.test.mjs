import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n")
const CONTROL = read("styles/control.css")
const REDUCED_MOTION = read("styles/reduced-motion.css")
const JOB_CSS = read("app/ops/leads/[id]/job.css")

function mediaBlock(source, query) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const start = source.search(new RegExp(`@media\\s*\\(${escaped}\\)\\s*\\{`))
  assert.ok(start >= 0, `missing @media (${query}) block`)
  const open = source.indexOf("{", start)
  let depth = 1
  for (let index = open + 1; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1
    if (source[index] === "}" && --depth === 0) return source.slice(open + 1, index)
  }
  assert.fail(`unclosed @media (${query}) block`)
}

function boardPages(directory) {
  return readdirSync(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory()) return boardPages(path)
      return entry.name === "page.tsx" ? [path] : []
    })
}

test("forced colors keep job actions, status chips, buttons and focus visible", () => {
  const controlBlock = mediaBlock(CONTROL, "forced-colors:active")
  const jobBlock = mediaBlock(JOB_CSS, "forced-colors: active")
  assert.match(controlBlock, /\.chip[^\n{]*\{[^}]*border:1px solid ButtonText/)
  assert.match(controlBlock, /\.job-status[^\n{]*\{[^}]*border:1px solid ButtonText/)
  assert.match(controlBlock, /\.btn[^\n{]*\{[^}]*ButtonText/)
  assert.match(controlBlock, /:focus-visible\s*\{[^}]*outline[^}]*Highlight/)
  assert.match(jobBlock, /\.job-action-spine\s*\{[^}]*border[^}]*CanvasText/)
  assert.match(jobBlock, /\.job-action-spine\s+\.ops-tracked-call\s*>\s*button\s*\{[^}]*border:\s*1px solid ButtonText/)
})

test("reduced motion limits every app animation and transition", () => {
  const rootLayout = read("app/layout.tsx")
  assert.match(rootLayout, /import "\.\/globals\.css"/)
  assert.match(rootLayout, /import "\.\.\/styles\/reduced-motion\.css"/)
  assert.match(REDUCED_MOTION, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\*,\s*\*::before,\s*\*::after\s*\{[^}]*transition-duration:[^}]*!important[^}]*animation-duration:[^}]*!important[^}]*animation-iteration-count:\s*1\s*!important/s)
})

test("above-fold board logos reserve space before their files load", () => {
  const board = read("app/board/board.tsx")
  const mainIndex = board.indexOf('<main id="main"')
  assert.ok(mainIndex > 0, "board main landmark not found")
  const aboveFold = board.slice(0, mainIndex)
  const images = [...aboveFold.matchAll(/<img\b[^>]*>/gs)].map((match) => match[0])
  assert.ok(images.length > 0, "board header logo was not found")
  for (const image of images) {
    assert.match(image, /\bwidth=\{\d+\}/, `missing intrinsic width: ${image}`)
    assert.match(image, /\bheight=\{\d+\}/, `missing intrinsic height: ${image}`)
  }
  const opsHeader = read("app/ops/ops-header.tsx")
  const opsLogo = opsHeader.match(/<img\b[^>]*className="ops-logo"[^>]*>/s)
  assert.ok(opsLogo, "operations header logo not found")
  assert.match(opsLogo[0], /\bwidth=\{\d+\}/)
  assert.match(opsLogo[0], /\bheight=\{\d+\}/)
})

test("theme boot changes color tokens before paint without changing layout metrics", () => {
  const boot = read("app/board/theme-boot.tsx")
  assert.match(boot, /localStorage\.getItem\("mcsw-theme"\)/)
  assert.match(boot, /document\.documentElement\.setAttribute\("data-theme", t\)/)
  assert.match(boot, /<script\s+dangerouslySetInnerHTML=\{\{\s*__html:\s*BOOT\s*\}\}\s*\/>/)

  const importingPages = boardPages("app/board").filter((path) => /import\s+\{\s*ThemeBoot\s*\}\s+from/.test(read(path)))
  assert.ok(importingPages.length > 0, "no /board pages import ThemeBoot")
  for (const path of importingPages) {
    assert.match(read(path), /<ThemeBoot\s*\/>/, `${path} imports ThemeBoot but does not render it`)
  }

  const themeBlocks = [...CONTROL.matchAll(/:root(?:\[data-theme="dark"\]|:not\(\[data-theme="light"\]\))\s*\{([^}]*)\}/gs)]
  assert.ok(themeBlocks.length >= 2, "both saved and system dark themes must be pinned")
  for (const block of themeBlocks) {
    assert.match(block[1], /--w-reg\s*:\s*400\s*;/, "dark theme must keep the lighter regular font weight")
    const declarations = block[1].split(";").map((part) => part.trim()).filter(Boolean)
    for (const declaration of declarations) {
      const property = declaration.split(":", 1)[0].trim()
      assert.match(property, /^--/, `theme rule has a direct layout declaration: ${declaration}`)
      assert.doesNotMatch(property, /^--(?:t-|s\d|r-|row|control)/, `theme rule changes layout metrics: ${declaration}`)
    }
  }
})
