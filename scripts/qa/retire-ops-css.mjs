import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, extname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const globalsPath = join(root, "app", "globals.css")
const baselinePath = join(root, "scripts", "qa", "baseline", "pre-s11-public-css.css")

const BUCKETS = ["DELETE", "KEEP"]
const CSS_CLASSES = /\.(?:ops|ms|glass)-[a-z0-9-]+/g
const SOURCE_CLASSES = /\b(?:ops|ms|glass)-[a-z0-9-]+/g
const PREFIXES = ["ops", "ms", "glass"]
const SOURCE_EXTENSIONS = new Set([".cjs", ".html", ".js", ".json", ".jsx", ".mjs", ".md", ".mdx", ".ts", ".tsx"])

export function sourceUsageFromTexts(texts) {
  const classes = new Set()
  const dynamicPrefixes = new Set()
  for (const source of texts) {
    for (const match of source.matchAll(SOURCE_CLASSES)) classes.add(`.${match[0]}`)
    for (const prefix of PREFIXES) {
      const dynamicPattern = new RegExp("\\b" + prefix + "-(?:\\$\\{|['\"`]\\s*\\+)")
      if (dynamicPattern.test(source)) dynamicPrefixes.add(prefix)
    }
  }
  return { classes, dynamicPrefixes }
}

export function scanClassUsage(projectRoot = root) {
  const files = []
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(path)
    }
  }
  for (const directory of ["app", "components", "lib"]) visit(join(projectRoot, directory))
  const usage = sourceUsageFromTexts(files.map((path) => readFileSync(path, "utf8")))
  return { ...usage, filesScanned: files.length }
}

function leadingTrivia(text) {
  let index = 0
  while (index < text.length) {
    const whitespace = /^[\t\r\n ]+/.exec(text.slice(index))
    if (whitespace) {
      index += whitespace[0].length
      continue
    }
    if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2)
      if (end === -1) throw new Error("Unclosed CSS comment")
      index = end + 2
      continue
    }
    break
  }
  return [text.slice(0, index), text.slice(index)]
}

function nextBoundary(text, start, end) {
  let quote = ""
  let comment = false
  let parens = 0
  let brackets = 0
  for (let index = start; index < end; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (comment) {
      if (char === "*" && next === "/") {
        comment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (char === "\\") index += 1
      else if (char === quote) quote = ""
      continue
    }
    if (char === "/" && next === "*") {
      comment = true
      index += 1
    } else if (char === '"' || char === "'") quote = char
    else if (char === "(") parens += 1
    else if (char === ")") parens -= 1
    else if (char === "[") brackets += 1
    else if (char === "]") brackets -= 1
    else if (parens === 0 && brackets === 0 && (char === ";" || char === "{")) {
      return { char, index }
    }
  }
  return null
}

function matchingBrace(text, open, end) {
  let depth = 1
  let quote = ""
  let comment = false
  for (let index = open + 1; index < end; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (comment) {
      if (char === "*" && next === "/") {
        comment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (char === "\\") index += 1
      else if (char === quote) quote = ""
      continue
    }
    if (char === "/" && next === "*") {
      comment = true
      index += 1
    } else if (char === '"' || char === "'") quote = char
    else if (char === "{") depth += 1
    else if (char === "}") {
      depth -= 1
      if (depth === 0) return index
    }
  }
  throw new Error(`Unclosed CSS block beginning at byte ${open}`)
}

function splitSelectorArms(selector) {
  const arms = []
  let start = 0
  let quote = ""
  let comment = false
  let parens = 0
  let brackets = 0
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index]
    const next = selector[index + 1]
    if (comment) {
      if (char === "*" && next === "/") {
        comment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (char === "\\") index += 1
      else if (char === quote) quote = ""
      continue
    }
    if (char === "/" && next === "*") {
      comment = true
      index += 1
    } else if (char === '"' || char === "'") quote = char
    else if (char === "(") parens += 1
    else if (char === ")") parens -= 1
    else if (char === "[") brackets += 1
    else if (char === "]") brackets -= 1
    else if (char === "," && parens === 0 && brackets === 0) {
      arms.push(selector.slice(start, index))
      start = index + 1
    }
  }
  arms.push(selector.slice(start))
  return arms
}

function armBucket(arm, usage) {
  const classes = arm.match(CSS_CLASSES) ?? []
  if (!classes.length) return "KEEP"
  const referenced = (name) => {
    if (usage.classes.has(name)) return true
    const prefix = /^\.(ops|ms|glass)-/.exec(name)?.[1]
    return prefix ? usage.dynamicPrefixes.has(prefix) : false
  }

  // A positive class in a compound or descendant selector is required for a
  // match; one with no static or dynamic source reference makes the whole arm
  // dead. Functional pseudos and attribute selectors can invert or construct
  // classes, so retain those arms unless preview fingerprints are available.
  if (/:(?:not|is|where|has)\s*\(|\[/.test(arm)) return "KEEP"
  return classes.some((name) => !referenced(name)) ? "DELETE" : "KEEP"
}

function emptyResult() {
  return {
    text: { MOVE: "", DELETE: "", KEEP: "" },
    active: { MOVE: false, DELETE: false, KEEP: false },
  }
}

function append(result, bucket, text, active = true) {
  result.text[bucket] += text
  if (active) result.active[bucket] = true
}

function processSequence(source, start, end, used, stats) {
  const result = emptyResult()
  let cursor = start

  while (cursor < end) {
    const boundary = nextBoundary(source, cursor, end)
    if (!boundary) break

    if (boundary.char === ";") {
      append(result, "KEEP", source.slice(cursor, boundary.index + 1))
      cursor = boundary.index + 1
      continue
    }

    const close = matchingBrace(source, boundary.index, end)
    const beforeOpen = source.slice(cursor, boundary.index)
    const [prefix, head] = leadingTrivia(beforeOpen)
    const body = source.slice(boundary.index, close + 1)
    const trimmedHead = head.trim()

    if (trimmedHead.startsWith("@")) {
      const keyframes = /^@(?:-webkit-)?keyframes\s+([^\s{]+)/i.exec(trimmedHead)
      const nested = /^@(media|supports|container|layer|scope)\b/i.test(trimmedHead)
      if (keyframes) {
        append(result, "KEEP", prefix + head + body)
      } else if (nested) {
        const children = processSequence(source, boundary.index + 1, close, used, stats)
        for (const bucket of BUCKETS) {
          if (!children.active[bucket]) continue
          append(
            result,
            bucket,
            prefix + head + "{" + children.text[bucket] + "}",
          )
        }
      } else {
        append(result, "KEEP", prefix + head + body)
      }
      cursor = close + 1
      continue
    }

    const arms = splitSelectorArms(head)
    const grouped = { DELETE: [], KEEP: [] }
    for (const [index, arm] of arms.entries()) {
      const bucket = armBucket(arm, used)
      grouped[bucket].push({ arm, index })
      stats.arms[bucket] += 1
      if (bucket === "DELETE") {
        for (const name of arm.match(CSS_CLASSES) ?? []) {
          const prefix = /^\.(ops|ms|glass)-/.exec(name)?.[1]
          if (!used.classes.has(name) && !(prefix && used.dynamicPrefixes.has(prefix))) {
            stats.deletedClasses.add(name)
          }
        }
        stats.deletedSelectors.add(arm.trim())
      }
    }
    const present = BUCKETS.filter((bucket) => grouped[bucket].length)
    stats.blocks[present.length === 1 ? present[0] : "MIXED"] += 1

    for (const bucket of present) {
      const selected = grouped[bucket]
      const firstIndex = selected[0].index
      const lastIndex = selected.at(-1).index
      const carriesPrefix = firstIndex === 0 || /\/\*/.test(prefix)
      const trailingWhitespace = /\s*$/.exec(head)?.[0] ?? ""
      const suffix = lastIndex === arms.length - 1 ? "" : trailingWhitespace
      append(
        result,
        bucket,
        (carriesPrefix ? prefix : "") + selected.map(({ arm }) => arm).join(",") + suffix + body,
      )
    }
    cursor = close + 1
  }

  const tail = source.slice(cursor, end)
  const activeBuckets = BUCKETS.filter((bucket) => result.active[bucket])
  if (activeBuckets.length === 0) append(result, "KEEP", tail, /\S/.test(tail))
  else {
    for (const bucket of activeBuckets) result.text[bucket] += tail
  }
  return result
}

export function classify(source, used) {
  const stats = {
    arms: { DELETE: 0, KEEP: 0 },
    blocks: { DELETE: 0, KEEP: 0, MIXED: 0 },
    deletedClasses: new Set(),
    deletedSelectors: new Set(),
  }
  return { ...processSequence(source, 0, source.length, used, stats), stats }
}

export function lineCount(text) {
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
}

function main() {
  const baseline = readFileSync(baselinePath)
  const source = baseline.toString("utf8")
  const usage = scanClassUsage()
  const classified = classify(source, usage)
  const totals = {
    arms: Object.values(classified.stats.arms).reduce((sum, count) => sum + count, 0),
    blocks: Object.values(classified.stats.blocks).reduce((sum, count) => sum + count, 0),
  }

  console.log(`source files scanned in app/, components/, lib/: ${usage.filesScanned}`)
  console.log(`referenced class tokens: ${usage.classes.size}`)
  console.log(`dynamic prefixes kept: ${[...usage.dynamicPrefixes].sort().join(", ") || "none"}`)
  console.log(
    `ARMS    DELETE=${classified.stats.arms.DELETE} KEEP=${classified.stats.arms.KEEP} total=${totals.arms}`,
  )
  console.log(
    `BLOCKS  DELETE=${classified.stats.blocks.DELETE} KEEP=${classified.stats.blocks.KEEP} MIXED=${classified.stats.blocks.MIXED} total=${totals.blocks}`,
  )
  console.log(
    `LINES   before=${lineCount(source)} globals=${lineCount(classified.text.KEEP)}`,
  )
  console.log(
    `ZERO-REFERENCE classes (${classified.stats.deletedClasses.size}): ${[...classified.stats.deletedClasses].sort().join(", ") || "none"}`,
  )
  console.log(
    `DELETED selector arms (${classified.stats.deletedSelectors.size}): ${[...classified.stats.deletedSelectors].sort().join(" | ") || "none"}`,
  )

  if (process.argv.includes("--write")) {
    const current = readFileSync(globalsPath)
    if (!baseline.equals(current)) {
      throw new Error("app/globals.css does not byte-match the frozen S11 public CSS baseline")
    }
    writeFileSync(globalsPath, classified.text.KEEP)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
