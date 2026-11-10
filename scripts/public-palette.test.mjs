import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import postcss from "postcss"

const site = postcss.parse(readFileSync("app/page-cohesion.css", "utf8"))
const chat = postcss.parse(readFileSync("components/assistant-chat.module.css", "utf8"))
const tokens = new Map()
site.walkRules(":root", (rule) => rule.walkDecls((decl) => tokens.set(decl.prop, decl.value)))

// Approved BRAND-BRIEF.md Palette ruling, not colors sampled from the CSS under test.
const approved = {
  "--ms-carbon": "#100c08", "--ms-wall-1": "#191309", "--ms-wall-2": "#221a0e",
  "--ms-plank": "#241809", "--ms-plank-1": "#2a1d10", "--ms-plank-2": "#3a2916",
  "--ms-surface": "#241d12", "--ms-bone": "#efe6d2", "--ms-chalk": "#f3ead8",
  "--ms-muted": "#d9cdb4", "--ms-neon": "#ffb46b", "--ms-arc": "#ff8a2a",
  "--ms-button-ink": "#1b0f02", "--ms-paper": "#fdf9ec", "--ms-paper-end": "#f4ecd8",
  "--ms-ink": "#241a10", "--ms-ink-muted": "#4f4433", "--ms-copper": "#b3402a", "--ms-rule": "#7a6a4d",
}

function resolve(value, seen = new Set()) {
  return value.replace(/var\((--[\w-]+)\)/g, (_, token) => {
    assert.ok(tokens.has(token), `missing color token ${token}`)
    assert.ok(!seen.has(token), `cyclic color token ${token}`)
    return resolve(tokens.get(token), new Set([...seen, token]))
  })
}

function rgb(value) {
  const resolved = resolve(value)
  if (/^#[\da-f]{6}$/i.test(resolved)) return resolved.slice(1).match(/../g).map((v) => parseInt(v, 16))
  const rgba = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([.\d]+)\s*\)$/.exec(resolved)
  assert.ok(rgba, `unsupported color ${resolved}`)
  return rgba.slice(1).map(Number)
}

function luminance(color) {
  const channels = color.slice(0, 3).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
}

function contrast(foreground, background) {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x)
  return (a + .05) / (b + .05)
}

function meets(foreground, background, threshold, label) {
  const ratio = contrast(foreground, background)
  assert.ok(ratio >= threshold, `${label}: ${ratio.toFixed(3)}:1 is below ${threshold}:1`)
}

function declaration(sheet, selector, property) {
  let value
  sheet.walkRules((rule) => {
    if (rule.selectors.includes(selector)) rule.walkDecls(property, (decl) => { value = decl.value })
  })
  assert.ok(value, `${selector} must define ${property}`)
  return value
}

test("public palette retains the owner-approved role values and alpha treatments", () => {
  for (const [token, value] of Object.entries(approved)) assert.equal(resolve(`var(${token})`).toLowerCase(), value, token)
  assert.deepEqual(rgb("var(--ms-glow)"), [255, 180, 107, .08])
  assert.deepEqual(rgb("var(--ms-line-bone)"), [243, 234, 216, .15])
  assert.equal(resolve("var(--mx-coal)"), approved["--ms-carbon"])
  assert.equal(resolve("var(--ms-rule-light)"), approved["--ms-rule"])
})

test("active public literals stay in root and chat color declarations use public aliases", () => {
  site.walkDecls((decl) => {
    if (/#[\da-f]{3,8}\b/i.test(decl.value)) {
      assert.equal(decl.parent.selector, ":root", `${decl.prop}: ${decl.value}`)
      assert.ok(decl.prop.startsWith("--ms-"), decl.prop)
    }
  })
  chat.walkDecls((decl) => {
    assert.doesNotMatch(decl.value, /#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i, `${decl.prop}: ${decl.value}`)
    if (/^(?:color|background|background-color|border-color|outline-color)$/.test(decl.prop)) {
      assert.match(decl.value, /^(?:var\(--ms-[\w-]+\)|transparent|currentColor|none)$/, `${decl.prop}: ${decl.value}`)
      if (decl.value.startsWith("var(")) resolve(decl.value)
    }
  })
})

test("dark body, muted, accent and large headline colors meet AA even at full lamp glow", () => {
  const glow = rgb("var(--ms-glow)")
  // Cover every stripe endpoint; brightest plank plus maximum glow is the
  // worst case, not the quieter solid night sampled by a token-only audit.
  for (const background of ["carbon", "wall-1", "wall-2", "plank", "plank-1", "plank-2", "surface"]) {
    const base = rgb(`var(--ms-${background})`)
    const illuminated = base.map((v, i) => glow[i] * glow[3] + v * (1 - glow[3]))
    for (const surface of [base, illuminated]) {
      for (const text of ["bone", "muted", "arc", "neon"]) meets(rgb(`var(--ms-${text})`), surface, 4.5, `${text} on ${background}`)
      meets(rgb("var(--ms-chalk)"), surface, 3, `large chalk on ${background}`)
    }
  }
})

test("paper body, muted and red links meet AA across both gradient endpoints", () => {
  for (const background of ["paper", "paper-end"]) {
    for (const text of ["ink", "ink-muted", "copper"]) {
      meets(rgb(`var(--ms-${text})`), rgb(`var(--ms-${background})`), 4.5, `${text} on ${background}`)
    }
    meets(rgb("var(--ms-rule)"), rgb(`var(--ms-${background})`), 3, `control rule on ${background}`)
  }
})

test("component color declarations retain accessible buttons, chat text and links", () => {
  for (const [sheet, selector] of [
    [site, ".ms-site .ms-button-primary"], [site, ".ms-site .ms-button-primary:hover"],
    [site, ".ms-site .ms-button-secondary:hover"], [site, ".ms-mobile-cta .ms-button-secondary"],
    [chat, ".dialog .call"], [chat, ".dialog .call:hover"], [chat, '.dialog button[type="submit"]'],
    [chat, ".dialog button:disabled"], [chat, ".customer"], [chat, ".form"], [chat, ".header"],
  ]) {
    meets(rgb(declaration(sheet, selector, "color")), rgb(declaration(sheet, selector, "background")), 4.5, selector)
  }
  for (const selector of [".messages", ".assistant", ".form textarea"]) {
    assert.equal(resolve(declaration(chat, selector, "background")), resolve("var(--ms-paper-fill)"), selector)
    for (const background of ["paper", "paper-end"]) meets(rgb(declaration(chat, selector, "color")), rgb(`var(--ms-${background})`), 4.5, selector)
  }
  for (const background of ["paper", "paper-end"]) meets(rgb(declaration(chat, ".assistant a", "color")), rgb(`var(--ms-${background})`), 4.5, "assistant link")
})

test("chat textarea focus ring stays inside its contrasting paper surface", () => {
  const outline = declaration(chat, ".dialog :focus-visible", "outline")
  const width = parseFloat(outline)
  assert.ok(width >= 2, "focus indicator needs a visible width")
  assert.equal(declaration(chat, ".form textarea:focus-visible", "outline-color"), "currentColor")
  const offset = parseFloat(declaration(chat, ".form textarea:focus-visible", "outline-offset"))
  assert.ok(offset <= -width, "ink ring must be inset on paper, not outside on the dark composer")
  const ink = rgb(declaration(chat, ".form textarea", "color"))
  for (const endpoint of ["paper", "paper-end"]) meets(ink, rgb(`var(--ms-${endpoint})`), 3, `focus ring on ${endpoint}`)
})
