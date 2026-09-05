# Final Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shipped board language measurably correct — a 14px floor on every route, one type/weight/rhythm system in one file, self-hosted fonts, real landmarks, autofilling forms, parity for keyboard / reduced-motion / forced-colors users, 5,300 lines of dead CSS gone — and prove every one of those with a gate that runs against the signed-in app.

**Architecture:** Nothing new is designed. `styles/control.css` becomes the single owner of scale, weight and rhythm; `app/fonts.ts` owns the two faces through `next/font`; every other task is markup and CSS inside the approved vocabulary. A Playwright + axe gate (`scripts/qa/final-polish.spec.mjs`) runs first to record the baseline and last to publish the result. Source-pin tests in `scripts/` (the repo's `node --test` convention) keep each fix from regressing.

**Tech Stack:** Next.js 16 App Router, `next/font/google`, plain CSS on `styles/control.css` tokens, `@playwright/test` + `@axe-core/playwright` (new dev deps, root install only), `node --test` pins wired into `test:shop-brain`.

**Spec:** `docs/superpowers/specs/2026-09-04-final-polish-design.md` — read it first; the survey table there is the argument for every task below.

**Session split:** `2026-09-04-final-polish-SESSION-PLAN.md` — execute from there, one session per chat.

## Global Constraints

- All `CLAUDE.md` invariants hold. This round touches no schema, no `lib/`, no `actions.ts`, no SQL. A task that finds itself there has left its scope — stop and flag.
- **Board language only.** Tokens and classes from `styles/control.css` and `app/board/board.css`. No new colour, no new prop, no new layout, no component library, no Tailwind migration. Deletion beats addition.
- **The floor is 14px.** No token, no rule, no inline style may render text below 14px on any route. Owner's number.
- **Owner gate per visual task.** Every task that changes a pixel ends with the owner eyeballing the Vercel preview URL. The next session does not open until the previous is approved. Thirteen rejected redesigns are why.
- Every task green on `npm run typecheck`, `npm run lint`, `npm run test:shop-brain` before commit. Any task that adds a `"use client"` value import from `lib/` also runs `npx next build` (see memory: client bundle gate).
- New test files are added to the `test:shop-brain` list in `package.json` in the task that creates them.
- `npm run dev` does not work in a worktree. Verify on the Vercel preview for the branch with `node scripts/create-local-login.mjs` (swap `localhost:3030` for the preview host).
- Root-only jobs: `npm i`, `npx playwright install chromium`. `node_modules` is junctioned into worktrees.
- Codex sandbox has no network: any step that hits the preview (the gate, DevTools checks, owner walk) runs in a Claude session, not Codex.
- Crew sees no money, no per-worker figures, no surveillance surface. This round adds none; the exit task re-checks.

## Acceptance Criteria

Copied from the spec; the gate in Task 0 encodes them.

- **Given** any CRM route, signed in as owner, at 320 / 375 / 768 / 1440 widths, **when** axe runs with `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, **then** zero violations.
- **Given** any CRM route, **then** no rendered text node has computed `font-size` below 14px and no board-language stylesheet hard-codes a px font-size.
- **Given** any CRM route, **then** exactly one `h1`, exactly one `main`, a skip link first in tab order that moves focus to `main`, no skipped heading level.
- **Given** `/ops/intake/new` on a phone, **then** name / phone / email autofill and the phone field opens the tel keypad.
- **Given** `prefers-reduced-motion: reduce`, **then** nothing animates on any route; **given** `forced-colors: active`, **then** chips, tabs, buttons and tracker marks keep a visible boundary.
- **Given** `/board` throws or is asked for a missing job, **then** the error / not-found page is in the board vocabulary with a link back to the tracker.
- **Given** the CSS retirement, **then** the computed-style fingerprint of every live `.ops-*` class is unchanged on every route, and `app/globals.css` holds no ops-era rule.
- **Given** a cold-cache `/board`, **then** no request to `fonts.googleapis.com` and no layout shift when the face loads.
- **Given** a crew session, **then** nothing new reaches it.

## QA Procedure

The spec's ten steps, verbatim, are the QA Procedure. Task 0 turns steps 1–2 into `scripts/qa/final-polish.spec.mjs`; Task 6 walks steps 3–10 by hand and records the result under a `### QA execution record` heading appended to this file.

## Routes under test

| Key | Route | Notes |
|---|---|---|
| board | `/board` | front door, tracker |
| calls | `/board/calls` | |
| customers | `/board/customers` | |
| updates | `/board/updates` | |
| intake | `/ops/intake/new` | biggest form |
| job | `/ops/leads/${MCSW_QA_JOB_ID}` | |
| builds | `/ops/leads/${MCSW_QA_JOB_ID}/builds` | |
| account | `/ops/accounts/${MCSW_QA_ACCOUNT_ID}` | |
| analytics | `/ops/analytics` | owner only |
| sketch | `/ops/call-sketch` | |
| shop | `/ops/shop` | |
| install | `/ops/install` | |
| signedout | `/board` with no cookie | structural zero state |

---

### Task 0: The gate — measure before touching anything

**Files:**
- Create: `scripts/qa/final-polish.spec.mjs`
- Create: `scripts/qa/auth.setup.mjs`
- Create: `scripts/qa/playwright.config.mjs`
- Create: `scripts/qa/routes.mjs`
- Create: `scripts/qa/report.mjs`
- Modify: `package.json` (devDependencies, `test:qa` script)
- Modify: `.gitignore` (`scripts/qa/.auth.json`, `scripts/qa/report/`, `test-results/`; `scripts/qa/baseline/` stays tracked)

**Interfaces:**
- Produces: `npm run test:qa` — signs in once (setup project), runs the spec against `MCSW_QA_BASE`, then `node scripts/qa/report.mjs` merges the per-test artefacts into `scripts/qa/report/summary.md` (one row per route × width: axe violations, min font px, h1 count, main count, skip-link ok, heading-order ok, overflow px) and `scripts/qa/report/fingerprint.json` (per route, per `ops-*` class combination: computed `font-size`, `font-weight`, `color`, `background-color`, `padding`, `display`, `line-height`).
- Produces: `scripts/qa/routes.mjs` exporting `ROUTES`, `WIDTHS`, `FLOOR_PX`, used by Task 5's fingerprint diff and Task 6's re-run.
- Every test writes its own `scripts/qa/report/rows/<route>-<width>.json`; nothing is held in process memory across tests, so a worker restart cannot lose or overwrite a row (Codex review finding, 2026-09-05).

- [x] **Step 1: Install (root only)**

```powershell
npm i -D --save-exact @playwright/test@1.63.0 @axe-core/playwright@4.13.0
npx playwright install chromium
```

Exact versions (`npm view` on 2026-09-04), not caret ranges — the gate is evidence and must be reproducible.

- [x] **Step 2: Write the route table**

`scripts/qa/routes.mjs`:

```js
// One row per CRM surface. Keys are stable names the reports index by.
// Ids come from the environment so the gate never hard-codes a customer.
const job = process.env.MCSW_QA_JOB_ID
const account = process.env.MCSW_QA_ACCOUNT_ID

export const ROUTES = [
  { key: "board", path: "/board" },
  { key: "calls", path: "/board/calls" },
  { key: "customers", path: "/board/customers" },
  { key: "updates", path: "/board/updates" },
  { key: "intake", path: "/ops/intake/new" },
  job && { key: "job", path: `/ops/leads/${job}` },
  job && { key: "builds", path: `/ops/leads/${job}/builds` },
  account && { key: "account", path: `/ops/accounts/${account}` },
  { key: "analytics", path: "/ops/analytics" },
  { key: "sketch", path: "/ops/call-sketch" },
  { key: "shop", path: "/ops/shop" },
  { key: "install", path: "/ops/install" },
].filter(Boolean)

export const WIDTHS = [320, 375, 768, 1440]
export const FLOOR_PX = 14
// WCAG 2.0, 2.1 and 2.2 at A and AA. 2.1 is where the mobile rules live.
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
```

- [x] **Step 3: Sign in once, in a setup project**

`scripts/qa/auth.setup.mjs`:

```js
import { test as setup } from "@playwright/test"
import { existsSync, statSync } from "node:fs"

const AUTH = "scripts/qa/.auth.json"
const LOGIN = process.env.MCSW_QA_LOGIN_URL   // create-local-login.mjs output with the host swapped

// The magic link is one-use. Consume it exactly once per run; a rerun inside
// the cookie's life reuses the saved state instead of burning a second link.
setup("sign in as owner", async ({ page, context }) => {
  const fresh = existsSync(AUTH) && Date.now() - statSync(AUTH).mtimeMs < 6 * 60 * 60 * 1000
  if (fresh && process.env.MCSW_QA_REUSE_AUTH === "1") return
  if (!LOGIN) throw new Error("set MCSW_QA_LOGIN_URL (or MCSW_QA_REUSE_AUTH=1 with a fresh .auth.json)")
  await page.goto(LOGIN)
  await page.waitForURL(/\/board|\/ops/)
  await context.storageState({ path: AUTH })
})
```

`scripts/qa/playwright.config.mjs`:

```js
import { defineConfig } from "@playwright/test"

if (!process.env.MCSW_QA_BASE) throw new Error("set MCSW_QA_BASE")

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.MCSW_QA_BASE, colorScheme: "dark" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.mjs/ },
    { name: "gate", testMatch: /final-polish\.spec\.mjs/, dependencies: ["setup"],
      use: { storageState: "scripts/qa/.auth.json" } },
  ],
})
```

- [x] **Step 4: Write the spec**

`scripts/qa/final-polish.spec.mjs`:

```js
import { test, expect } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { ROUTES, WIDTHS, FLOOR_PX, AXE_TAGS } from "./routes.mjs"

const ROWS = "scripts/qa/report/rows"
mkdirSync(ROWS, { recursive: true })
const STRICT = process.env.MCSW_QA_STRICT === "1"
const BASE = process.env.MCSW_QA_BASE

// Live routes poll (OpsLive, the calls dropdown), so "networkidle" never
// arrives. Ready means: the document loaded, the fonts settled, and the
// first heading is on screen.
async function ready(page, path) {
  await page.goto(path, { waitUntil: "load" })
  await page.locator("h1, h2").first().waitFor({ state: "visible" })
  await page.evaluate(() => document.fonts.ready)
}

// Everything measurable about one rendered page, in one evaluate.
async function measure(page) {
  return page.evaluate((FLOOR) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"
    }
    let minFont = Infinity, minFontSel = ""
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue
      const el = n.parentElement
      if (!el || el.closest(".sr-only,[hidden],script,style,noscript")) continue
      if (!visible(el)) continue
      const fs = parseFloat(getComputedStyle(el).fontSize)
      if (fs < minFont) { minFont = fs; minFontSel = el.tagName.toLowerCase() + "." + [...el.classList].join(".") }
    }
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible).map((h) => +h.tagName[1])
    let orderOk = true
    for (let i = 1; i < headings.length; i++) if (headings[i] > headings[i - 1] + 1) orderOk = false
    const fp = {}
    for (const el of document.querySelectorAll("[class*='ops-']")) {
      const cls = [...el.classList].filter((c) => c.startsWith("ops-")).join(" ")
      if (!cls || fp[cls]) continue
      const cs = getComputedStyle(el)
      fp[cls] = [cs.fontSize, cs.fontWeight, cs.color, cs.backgroundColor, cs.padding, cs.display, cs.lineHeight].join("|")
    }
    return {
      minFont: minFont === Infinity ? null : minFont,
      minFontSel,
      floorOk: minFont >= FLOOR,
      h1: document.querySelectorAll("h1").length,
      main: document.querySelectorAll("main").length,
      skipLink: !!document.querySelector("a[href='#main']"),
      orderOk,
      overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      fp,
    }
  }, FLOOR_PX)
}

const row = (name, data) => writeFileSync(`${ROWS}/${name}.json`, JSON.stringify(data))

for (const route of ROUTES) {
  for (const width of WIDTHS) {
    test(`${route.key} @ ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await ready(page, route.path)
      const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
      const m = await measure(page)
      row(`${route.key}-${width}`, { route: route.key, width, axe: axe.violations.length,
        axeIds: axe.violations.map((v) => v.id).join(","), ...m, fp: width === 1440 ? m.fp : undefined })
      // The baseline run asserts nothing; Task 6 flips STRICT on.
      if (STRICT) {
        expect(axe.violations, axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`).join("\n")).toEqual([])
        expect(m.floorOk, `min font ${m.minFont}px at ${m.minFontSel}`).toBe(true)
        expect(m.h1).toBe(1)
        expect(m.main).toBe(1)
        expect(m.skipLink).toBe(true)
        expect(m.orderOk).toBe(true)
        expect(m.overflow).toBe(0)
      }
    })
  }
}

test("skip link moves focus to main", async ({ page }) => {
  await ready(page, "/board")
  await page.keyboard.press("Tab")
  const href = await page.evaluate(() => document.activeElement?.getAttribute("href"))
  let landed = null
  if (href === "#main") {
    await page.keyboard.press("Enter")
    landed = await page.evaluate(() => document.activeElement?.id)
  }
  row("skip-link", { route: "board", width: "skip", skipLink: href === "#main", landed })
  if (STRICT) { expect(href).toBe("#main"); expect(landed).toBe("main") }
})

test("no third-party font request", async ({ page }) => {
  const external = []
  page.on("request", (r) => { if (/fonts\.g(oogleapis|static)\.com/.test(r.url())) external.push(r.url()) })
  await ready(page, "/board")
  row("fonts", { route: "board", width: "fonts", externalFonts: external.length })
  if (STRICT) expect(external).toEqual([])
})

test("signed-out /board is the structural zero state, still measured", async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`${BASE}/board`, { waitUntil: "load" })
  const m = await measure(page)
  row("signedout-1280", { route: "signedout", width: 1280, ...m, fp: undefined })
  await ctx.close()
})
```

- [x] **Step 5: The report merger**

`scripts/qa/report.mjs`:

```js
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
```

- [x] **Step 6: Wire the script and ignore the artefacts**

`package.json` scripts:

```json
"test:qa": "playwright test -c scripts/qa/playwright.config.mjs; node scripts/qa/report.mjs"
```

(`;` not `&&`: the report must be written even when STRICT assertions fail — the failures are the report.)

`.gitignore`: add `scripts/qa/.auth.json`, `scripts/qa/report/`, `test-results/`.

- [x] **Step 7: Run the baseline against production**

```powershell
$env:MCSW_QA_BASE = "https://musiccityspecialtywelding.com"
$env:MCSW_QA_LOGIN_URL = (node scripts/create-local-login.mjs) -replace "http://localhost:3030", $env:MCSW_QA_BASE
$env:MCSW_QA_JOB_ID = "<a real open job id>"
$env:MCSW_QA_ACCOUNT_ID = "<a real account id>"
Remove-Item scripts/qa/report/rows -Recurse -Force -ErrorAction SilentlyContinue
npm run test:qa
```

Expected: every test passes (STRICT is off), `scripts/qa/report/summary.md` and `fingerprint.json` exist with one row per route × width plus the three extras. To rerun without a new link: `$env:MCSW_QA_REUSE_AUTH = "1"`.

- [x] **Step 8: Freeze the baseline**

Copy `scripts/qa/report/summary.md` to `scripts/qa/baseline/2026-09-04-summary.md` and `fingerprint.json` to `scripts/qa/baseline/2026-09-04-fingerprint.json`. Paste the summary table into this plan under a `### Baseline — 2026-09-04` heading at the end. These are the *before* numbers every later task is measured against.

- [ ] **Step 9: Commit**

```bash
git add scripts/qa package.json package-lock.json .gitignore docs/superpowers/plans/2026-09-04-final-polish.md
git commit -m "test(qa): a signed-in accessibility gate for every CRM route, and its baseline"
```

---

### Task 1: One type system — 14px floor, one weight ladder, fonts through next/font

**Files:**
- Create: `app/fonts.ts`
- Modify: `styles/control.css:1` (delete the `@import`), `:96-107` (scale + weights), the dark block at `:111-140` (add the dark weight ladder)
- Modify: `app/board/board.css:76-79` (delete the phone override)
- Modify: `app/ops/ops-shell.css:6-45` (delete `--w-reg/--w-med/--w-semi`), `app/ops/layout.tsx:3,12-17,38` (use shared fonts)
- Modify: `app/board/page.tsx`, `app/board/calls/page.tsx`, `app/board/customers/page.tsx`, `app/board/updates/page.tsx` (apply the font variable classes on the root element each renders)
- Modify: the 8 hard-coded `font-size: <n>px` in board-language CSS (`grep -rn "font-size:\s*[0-9]" styles/control.css app/board app/ops --include=*.css`) → tokens
- Create: `scripts/type-system.test.mjs`; add to `test:shop-brain`

**Interfaces:**
- Produces: `app/fonts.ts` exporting `golos` and `chivo` (`NextFont` instances) with CSS variables `--font-golos` and `--font-chivo`. Every shell root carries `${golos.variable} ${chivo.variable}`.
- Produces: `control.css` tokens as the single source: `--t-caption:14px; --t-label:14px; --t-body:15px; --t-data:15px; --t-sub:15px; --t-name:16px; --t-title:18px; --t-lede:22px; --t-display:40px` (display grows in the existing min-width layers to 56px), line-heights `--lh-body:1.5; --lh-data:1.35; --lh-label:1.3; --lh-caption:1.4; --lh-name:1.3; --lh-sub:1.35; --lh-title:1.25; --lh-lede:1.25; --lh-display:1`, weights `--w-reg:420; --w-med:500; --w-semi:640` on light ground and `400 / 480 / 620` on dark.

- [x] **Step 1: Write the failing pin test**

`scripts/type-system.test.mjs`:

```js
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n")
const cssUnder = (dir) => {
  const out = []
  for (const name of readdirSync(join(root, dir))) {
    const p = join(dir, name)
    if (statSync(join(root, p)).isDirectory()) out.push(...cssUnder(p))
    else if (name.endsWith(".css")) out.push(p)
  }
  return out
}
const BOARD_CSS = ["styles/control.css", ...cssUnder("app/board"), ...cssUnder("app/ops")]
const CONTROL = read("styles/control.css")

test("control.css owns the scale, and nothing on it is below 14px", () => {
  for (const tok of ["--t-caption", "--t-label", "--t-body", "--t-data", "--t-sub", "--t-name", "--t-title", "--t-lede", "--t-display"]) {
    const m = CONTROL.match(new RegExp(`${tok}:\\s*([\\d.]+)px`))
    assert.ok(m, `${tok} is defined in control.css`)
    assert.ok(parseFloat(m[1]) >= 14, `${tok} = ${m[1]}px is under the 14px floor`)
  }
})

test("no board-language stylesheet hard-codes a font-size or redefines a type token", () => {
  for (const file of BOARD_CSS) {
    const css = read(file)
    const hard = [...css.matchAll(/font-size\s*:\s*([\d.]+)px/g)]
    assert.deepEqual(hard.map((m) => m[0]), [], `${file} hard-codes font-size`)
    if (file !== "styles/control.css") {
      assert.doesNotMatch(css, /--t-(caption|label|body|data|sub|name|title|lede):/, `${file} redefines a type token`)
      assert.doesNotMatch(css, /--w-(reg|med|semi):/, `${file} redefines a weight`)
    }
  }
})

test("both weight ladders live in control.css and the dark one is a notch lighter", () => {
  assert.match(CONTROL, /--w-reg:\s*420;\s*--w-med:\s*500;\s*--w-semi:\s*640/)
  assert.match(CONTROL, /--w-reg:\s*400;\s*--w-med:\s*480;\s*--w-semi:\s*620/)
})

test("fonts come from next/font, not a Google @import", () => {
  assert.doesNotMatch(CONTROL, /@import\s+url\(/)
  const fonts = read("app/fonts.ts")
  assert.match(fonts, /Golos_Text\(/)
  assert.match(fonts, /Chivo\(/)
  assert.match(fonts, /adjustFontFallback:\s*true/)
  assert.match(fonts, /display:\s*"swap"/)
  assert.match(CONTROL, /--font:\s*var\(--font-golos\)/)
  assert.match(CONTROL, /--font-display:\s*var\(--font-chivo\)/)
  for (const shell of ["app/ops/layout.tsx", "app/board/page.tsx", "app/board/calls/page.tsx", "app/board/customers/page.tsx", "app/board/updates/page.tsx"]) {
    const src = read(shell)
    assert.match(src, /golos\.variable/, `${shell} applies the Golos variable`)
    assert.match(src, /chivo\.variable/, `${shell} applies the Chivo variable`)
  }
})
```

- [x] **Step 2: Run it, watch it fail**

Run: `node --test scripts/type-system.test.mjs`
Expected: FAIL on the floor (11.5px), the `@import`, `app/fonts.ts` missing, and `board.css` redefining `--t-data`.

- [x] **Step 3: Create `app/fonts.ts`**

```ts
import { Chivo, Golos_Text } from "next/font/google"

// The two faces the board reads in: Golos for everything read, Chivo for the
// numbers. Variable axes so the 420/500/640 ladder is real, not snapped to
// 400/700. adjustFontFallback sizes the system fallback to Golos's metrics so
// the page does not jump when the face arrives.
export const golos = Golos_Text({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-golos",
  display: "swap",
  adjustFontFallback: true,
})

export const chivo = Chivo({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-chivo",
  display: "swap",
  adjustFontFallback: true,
})
```

- [x] **Step 4: Rewrite the type block in `styles/control.css`**

Delete line 1 (the `@import`). Replace lines 96–107 with:

```css
  /* --- type roles ---------------------------------------------------------
     One scale for every route and every width. The floor is 14px — the owner's
     number ("readable for an old dude"). Display and title step up in the
     min-width layers at the end of board.css; nothing else moves.            */
  --font:var(--font-golos),system-ui,-apple-system,"Segoe UI",sans-serif;
  --font-display:var(--font-chivo),system-ui,sans-serif;
  --t-display:40px;  --lh-display:1.0;   /* the three numbers            */
  --t-lede:22px;     --lh-lede:1.25;     /* the question worth asking    */
  --t-title:18px;    --lh-title:1.25;    /* a card's name                */
  --t-name:16px;     --lh-name:1.3;      /* a customer, a signal         */
  --t-sub:15px;      --lh-sub:1.35;      /* a sub-head inside a card     */
  --t-body:15px;     --lh-body:1.5;      /* running prose                */
  --t-data:15px;     --lh-data:1.35;     /* anything in a column         */
  --t-label:14px;    --lh-label:1.3;     /* column heads, keys, chips    */
  --t-caption:14px;  --lh-caption:1.4;   /* the quiet line under a thing */
  /* the house ladder, heavy end reserved for display. Light ground here;
     the dark ground below runs one notch lighter because light-on-dark
     reads heavier than the same weight ink-on-paper.                       */
  --w-reg:420; --w-med:500; --w-semi:640;
  --ease:cubic-bezier(.2,.7,.3,1);
```

Inside the existing `@media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){ … } }` block and the `:root[data-theme="dark"]{ … }` block, and in a new `.ops-shell{ … }` rule placed directly after them, add the same line:

```css
    --w-reg:400; --w-med:480; --w-semi:620;
```

- [x] **Step 5: Delete the duplicates**

- `app/board/board.css` lines 76–79 (the `@media (max-width:55rem){ :root{--t-data:15px;…} .cust b{font-size:16px} }` block): delete. `.cust b` at line 378 already sets `font-size:15px` — change to `var(--t-name)`.
- `app/ops/ops-shell.css`: delete the three `--w-*` lines (43–45).
- The remaining hard-coded `font-size: <n>px` in board-language CSS: map each to the nearest token (`22px`→`--t-lede`, `15px`→`--t-data` or `--t-name` by role, `16px`→`--t-name`). Do not invent a new token.

- [x] **Step 5b: The layouts that clip at the new sizes**

A 14px/15px line box is 3–4px taller than the 11.5–13.5px one it replaces. Codex's read of the stylesheets (2026-09-05) named the rules with fixed boxes or nowrap that will clip, overflow or wrap badly; each is one edit, and none changes the look at rest:

| Rule | Problem at the new size | Edit |
|---|---|---|
| `app/board/board.css:141` (24px avatar), `:327` (`.tab` 32px), `:405` | fixed `height` leaves ~3px around the line box | `height` → `min-height`; keep block padding |
| `app/board/board.css:304,310` | `-webkit-line-clamp: 2` / `1` on the call transcript shows materially less at 15px | raise to 3 / 2; check a long call |
| `app/board/board.css:603,623,652` | 132 / 100 / 168 / 116px grid tracks squeeze the timestamp, chip and actions | `minmax(<n>px, max-content)` on those tracks, or move the breakpoint up one layer |
| `app/board/board.css:272` | 64px speaker column is marginal for "Customer" at 14px | `minmax(64px, max-content)` |
| `app/ops/leads/[id]/job.css:151-152,452` | nowrap actions in four equal columns overflow on phone | drop `white-space: nowrap`; `repeat(auto-fit, minmax(min(100%, 12rem), 1fr))` |
| `app/ops/leads/[id]/job.css:387-388` | two nowrap payment actions side by side down to 22rem | stack below 40rem, or allow wrapping |
| `app/ops/leads/[id]/job.css:445` | fixed 9rem / 8rem timeline tracks eat the message column | `minmax(0, <n>fr)` tracks, or delay the three-column layout one layer |
| `app/ops/intake/intake.css:198,209` | two-column action rows become two-line controls | `repeat(auto-fit, minmax(12rem, 1fr))` |
| `app/ops/ops-shell.css:124-128` | `.ops-person` is nowrap in the fixed top bar | add `min-width: 0; overflow: hidden; text-overflow: ellipsis` |

`min-height: var(--row)` rows (`board.css:289,364`, `job.css:201,291,376,421`) already grow — leave them. The gate's `overflow` column at 320 and 375 is the check; the owner's eye is the other.

- [x] **Step 6: Apply the font variables on every shell root**

`app/ops/layout.tsx`: replace the `Chivo` import and the local `chivo` const with `import { golos, chivo } from "@/app/fonts"`, and the root becomes `<div className={\`${golos.variable} ${chivo.variable} ops-shell\`}>`. Search the tree for `--font-mcsw-jobs` (the old variable name) and repoint every use to `var(--font-chivo)`.

`app/board/page.tsx`, `calls/page.tsx`, `customers/page.tsx`, `updates/page.tsx`: import `golos, chivo` from `@/app/fonts` and add `${golos.variable} ${chivo.variable}` to the className of the outermost element each page renders (for `/board` that is the `<div className="app">` at `board.tsx:400` — pass the classes in as a prop `fontClass` from `page.tsx`, since `board.tsx` is a client component and `next/font` instances are created in server modules).

- [x] **Step 7: Run the pin, then the suites**

Run: `node --test scripts/type-system.test.mjs` → PASS.
Add `scripts/type-system.test.mjs` to `test:shop-brain`. Run `npm run typecheck`, `npm run lint`, `npm run test:shop-brain` → green. Run `npx next build` → exit 0 (fonts are fetched at build).

- [ ] **Step 8: Preview, then the owner**

Push the branch, open the Vercel preview signed in. DevTools → Network → filter `font`: both faces from `/_next/static/media/`, nothing from `googleapis`. Walk `/board` on desktop and at 375: nothing under 14px (run `npm run test:qa` against the preview and read the `min font` column). **Owner eyeballs the preview.** Do not open Task 2 until approved.

- [ ] **Step 9: Commit**

```bash
git add app/fonts.ts styles/control.css app/board app/ops scripts/type-system.test.mjs package.json
git commit -m "feat(type): one scale with a 14px floor, one weight ladder, fonts self-hosted through next/font"
```

---

### Task 2: Landmarks, headings, skip link, and the board's own error surfaces

**Files:**
- Create: `app/board/skip-link.tsx`, `app/board/error.tsx`, `app/board/not-found.tsx`, `app/board/loading.tsx`
- Modify: `app/board/board.tsx` (one `h1`, `<main id="main">`, skip link, `aria-current` on the rail is already server-derived — keep), `app/board/board.css` (`.skip` rule)
- Modify: `app/ops/ops-header.tsx` (skip link first), `app/ops/layout.tsx` (wrap `{children}` in `<main id="main">` once, remove nested `<main>` from every `app/ops/**/page.tsx`)
- Modify: every `app/board/**/page.tsx` and `app/ops/**/page.tsx` so each renders exactly one `h1` and exports `metadata.title`
- Create: `scripts/landmarks.test.mjs`; add to `test:shop-brain`

**Interfaces:**
- Produces: `<SkipLink />` (server component) rendering `<a className="skip" href="#main">Skip to the job tracker</a>` on `/board` and `Skip to content` elsewhere (prop `label`).
- Produces: `main#main` on every route, `tabIndex={-1}` so `#main` receives focus in every browser.

- [ ] **Step 1: Write the failing pin**

`scripts/landmarks.test.mjs`:

```js
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n")
const pagesUnder = (dir) => {
  const out = []
  for (const name of readdirSync(join(root, dir))) {
    const p = join(dir, name)
    if (statSync(join(root, p)).isDirectory()) out.push(...pagesUnder(p))
    else if (name === "page.tsx") out.push(p)
  }
  return out
}
const PAGES = [...pagesUnder("app/board"), ...pagesUnder("app/ops")]

test("every CRM page exports a title", () => {
  for (const p of PAGES) assert.match(read(p), /title:\s*["`']/, `${p} has no metadata title`)
})

test("exactly one main per route, and it is #main", () => {
  // /ops pages sit under a layout that owns the landmark; the three board
  // satellites and board.tsx render their own, so theirs must be #main.
  for (const p of pagesUnder("app/ops")) assert.doesNotMatch(read(p), /<main[\s>]/, `${p} renders a nested <main>`)
  assert.match(read("app/ops/layout.tsx"), /<main id="main" tabIndex=\{-1\}>/)
  for (const p of ["app/board/board.tsx", "app/board/calls/page.tsx", "app/board/customers/page.tsx", "app/board/updates/page.tsx"]) {
    const src = read(p)
    assert.equal((src.match(/<main[\s>]/g) ?? []).length, 1, `${p} renders ${(src.match(/<main[\s>]/g) ?? []).length} <main>`)
    assert.match(src, /<main id="main" tabIndex=\{-1\}/, `${p}'s main is not #main`)
  }
})

test("both shells put the skip link first", () => {
  assert.match(read("app/board/skip-link.tsx"), /href="#main"/)
  assert.match(read("app/board/board.tsx"), /<SkipLink/)
  assert.match(read("app/ops/ops-header.tsx"), /<SkipLink/)
})

test("/board has its own error, not-found and loading surfaces in the board language", () => {
  for (const f of ["error.tsx", "not-found.tsx", "loading.tsx"]) {
    const src = read(`app/board/${f}`)
    assert.match(src, /href="\/board"/, `${f} links back to the tracker`)
    assert.doesNotMatch(src, /#[0-9a-f]{3,6}\b/i, `${f} names a hex colour`)
  }
})
```

- [ ] **Step 2: Run it, watch it fail**

Run: `node --test scripts/landmarks.test.mjs` → FAIL (no skip-link file, nested mains, missing titles).

- [ ] **Step 3: The skip link**

`app/board/skip-link.tsx`:

```tsx
// First focusable element on every shell. Hidden until it has focus, then it
// sits on the top bar in the action colour so a keyboard user sees where they
// are. Focus lands on main#main, which carries tabIndex={-1} for Safari.
export function SkipLink({ label = "Skip to content" }: { label?: string }) {
  return <a className="skip" href="#main">{label}</a>
}
```

`styles/control.css` (so both shells get it), after the `.btn` rules:

```css
.skip{position:absolute;left:var(--s4);top:-100px;z-index:100;height:44px;
  display:inline-flex;align-items:center;padding:0 var(--s4);
  background:var(--action);color:var(--action-ink);font-weight:var(--w-semi);
  border-radius:var(--r-md)}
.skip:focus-visible{top:var(--s2);outline:2px solid var(--focus);outline-offset:2px}
```

- [ ] **Step 4: One main, one h1 per route**

`app/board/board.tsx`: render `<SkipLink label="Skip to the job tracker" />` as the first child of `<div className="app">`; wrap the tracker + figures + calls column in `<main id="main" tabIndex={-1}>` (the rail stays a `<nav aria-label="Board">`; the live-call card is an `<aside aria-label="Last call">`). The board's `h1` is the visible "Job tracker" heading — `board.tsx:481` is `<h2 className="t-title">Job tracker</h2>`; make it `h1` (the `.t-title` class keeps its size, so nothing visibly changes); every other heading on the page steps down one level so none skips.

The three satellites (`calls`, `customers`, `updates`) already render one `<main className="…">` each — add `id="main" tabIndex={-1}` to it and put `<SkipLink />` before it.

`app/ops/layout.tsx`: `<main id="main" tabIndex={-1}>{children}</main>` inside `.ops-frame`. Then in every `app/ops/**/page.tsx` replace the page's `<main …>` with `<div …>` keeping the class. `/ops/shop` keeps one `h1` (the page name) and turns the other two into `h2`. `/ops/intake/new` and `/ops/intake/[draftId]` get an `h1` ("New job" / the draft's caller name) at the top of the form column.

`app/ops/ops-header.tsx`: `<SkipLink />` first in the header's JSX.

- [ ] **Step 5: Titles**

Every page without `export const metadata` gets one, in the pattern the ops layout already uses: `` export const metadata = { title: "Job tracker · MCSW Jobs" } ``. Dynamic pages (`leads/[id]`, `accounts/[id]`, `intake/[draftId]`) use `generateMetadata` returning `` `${name} · MCSW Jobs` ``.

- [ ] **Step 6: Board error surfaces**

`app/board/not-found.tsx`:

```tsx
import Link from "next/link"
import "./board.css"

export default function BoardNotFound() {
  return <div className="app"><main id="main" tabIndex={-1} className="empty-state">
    <h1>Nothing here</h1>
    <p>That link points at a job or page that is not on the board.</p>
    <Link className="btn btn--go" href="/board">Back to the job tracker</Link>
  </main></div>
}
```

`app/board/error.tsx` (must be a client component) with the same shape, the message "The board hit an error. Your work is saved; reload or go back to the tracker.", a `<button className="btn btn--edge" onClick={reset}>Try again</button>`, and the same back link. `app/board/loading.tsx` renders the figures strip and three tracker rows as `aria-hidden` blocks with `background:var(--surface-raised)` at the real row height (`--row`), plus an `sr-only` "Loading the board" `<p role="status">`.

`board.css`: one rule `.empty-state{max-width:56ch;margin:var(--s8) auto;padding:0 var(--s4);display:grid;gap:var(--s4)}`.

- [ ] **Step 7: Run the pin, suites, preview**

`node --test scripts/landmarks.test.mjs` → PASS. Add to `test:shop-brain`. `npm run typecheck && npm run lint && npm run test:shop-brain` → green. On the preview: Tab once on `/board` (skip link visible), Enter (focus on main), `/board/nope` → the not-found page. `npm run test:qa` → `h1`, `main`, `skip` columns all `1 / 1 / true`. **Owner eyeballs.**

- [ ] **Step 8: Commit**

```bash
git add app/board app/ops scripts/landmarks.test.mjs styles/control.css package.json
git commit -m "feat(a11y): one main and one h1 per route, a skip link on both shells, board-language error pages"
```

---

### Task 3: Forms that autofill and speak

**Files:**
- Modify: `app/ops/intake/job-intake-form.tsx`, `app/ops/intake/inline-job-intake.tsx`, `app/board/board.tsx` (search field), `app/board/customers/page.tsx`, `app/board/recent-calls.tsx`, and every `<input|select|textarea` under `app/ops/leads/[id]`, `app/ops/accounts/[id]`, `app/ops/shop`
- Create: `scripts/form-affordances.test.mjs`; add to `test:shop-brain`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the attribute contract below, pinned by the test.

The contract, per field kind:

| Field | `type` | `autocomplete` | `inputMode` | also |
|---|---|---|---|---|
| customer name | `text` | `name` | — | `spellCheck={false}` |
| phone | `tel` | `tel` | `tel` | |
| email | `email` | `email` | `email` | |
| street / address | `text` | `street-address` | — | |
| money (dollars) | `text` | `off` | `decimal` | `pattern="[0-9]*[.,]?[0-9]*"` |
| counts | `text` | `off` | `numeric` | |
| measurements | `text` | `off` | `decimal` | |
| search | `search` | `off` | — | `aria-label="Search jobs"` |
| free text | `text` / `textarea` | `off` | — | |

Every input has a `<label htmlFor>` or `aria-label`; every hint paragraph has an `id` and the input names it in `aria-describedby`; every error paragraph has `role="alert"` and its id is appended to `aria-describedby` when shown; a submit that fails validation calls `.focus()` on the first `[aria-invalid="true"]`; a pending submit sets `aria-busy="true"` on the form and `disabled` on the submit button with its text changed to the verb in progress ("Saving…").

- [x] **Step 1: Write the failing pin**

`scripts/form-affordances.test.mjs`:

```js
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n")

const FORMS = ["app/ops/intake/job-intake-form.tsx", "app/ops/intake/inline-job-intake.tsx"]

test("phone fields open the tel keypad and autofill", () => {
  for (const f of FORMS) {
    const src = read(f)
    for (const m of src.matchAll(/<input[^>]*type="tel"[^>]*>/gs)) {
      assert.match(m[0], /autoComplete="tel"/, `${f}: ${m[0].slice(0, 60)}`)
      assert.match(m[0], /inputMode="tel"/, `${f}: ${m[0].slice(0, 60)}`)
    }
  }
})

test("name and email fields autofill", () => {
  for (const f of FORMS) {
    const src = read(f)
    assert.match(src, /autoComplete="name"/, `${f} has no name autofill`)
    for (const m of src.matchAll(/<input[^>]*type="email"[^>]*>/gs)) assert.match(m[0], /autoComplete="email"/)
  }
})

test("every input in the intake forms is labelled", () => {
  for (const f of FORMS) {
    const src = read(f)
    for (const m of src.matchAll(/<(input|select|textarea)\b[^>]*>/gs)) {
      const tag = m[0]
      if (/type="(hidden|submit)"/.test(tag)) continue
      assert.ok(/\bid=/.test(tag) || /aria-label=/.test(tag), `${f}: unlabelled ${tag.slice(0, 80)}`)
    }
  }
})

test("a failed submit moves focus to the first invalid field, and a pending one says so", () => {
  for (const f of FORMS) {
    const src = read(f)
    assert.match(src, /\[aria-invalid="true"\]/, `${f} does not focus the first invalid field`)
    assert.match(src, /aria-busy=\{/, `${f} has no aria-busy`)
  }
})
```

- [x] **Step 2: Run it, watch it fail**

Run: `node --test scripts/form-affordances.test.mjs` → FAIL on every assertion (zero `autoComplete` today).

- [x] **Step 3: Apply the contract**

Work file by file from the table. The focus move is one effect in each form:

```tsx
// After a submit that returned field errors, put the keyboard on the first one.
useEffect(() => {
  if (!errors) return
  const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
  first?.focus()
}, [errors])
```

and `aria-busy={pending}` on the `<form>`, with the submit button `disabled={pending}` and its label `pending ? "Saving…" : "Save job"`.

- [ ] **Step 4: Run the pin, suites, preview**

`node --test scripts/form-affordances.test.mjs` → PASS. Add to `test:shop-brain`. Suites green. On a phone against the preview: `/ops/intake/new`, tap phone (tel keypad), tap name (autofill chip), submit empty (focus and error text). `npm run test:qa` → the axe `label` and `aria-*` rule ids are gone from the intake rows. **Owner eyeballs** (the form looks the same; the check is the keypad and the autofill).

- [ ] **Step 5: Commit**

```bash
git add app/ops app/board scripts/form-affordances.test.mjs package.json
git commit -m "feat(forms): autofill, the right keypad, labels, and focus on the first error"
```

---

### Task 4: Focus, motion, forced colours, contrast — parity on every route

**Files:**
- Modify: `styles/control.css` (global focus, reduced motion, forced-colors, prefers-contrast blocks), `app/board/board.css:509` (delete the local reduced-motion rule; the global one covers it), the single `outline:none` (`grep -rn "outline:\s*none\|outline:0" app/board app/ops styles --include=*.css`)
- Modify: `app/board/board.tsx` only if Step 4 finds a colour-only state
- Create: `scripts/modes.test.mjs`; add to `test:shop-brain`

**Interfaces:**
- Produces: `control.css` rules the whole app inherits — no per-component `:focus-visible` overrides remain except where the ring colour must change on a coloured field (`.figure :focus-visible` keeps `--on-field`).

- [ ] **Step 1: Write the failing pin**

`scripts/modes.test.mjs`:

```js
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n")
const CONTROL = read("styles/control.css")

test("one global focus ring", () => {
  assert.match(CONTROL, /:focus-visible\{outline:2px solid var\(--focus\);outline-offset:2px\}/)
  assert.doesNotMatch(read("app/board/board.css"), /outline:\s*(none|0)\b/)
  assert.doesNotMatch(read("app/ops/ops-shell.css"), /outline:\s*(none|0)\b/)
})

test("reduced motion is global, so /ops stops too", () => {
  assert.match(CONTROL, /@media \(prefers-reduced-motion:reduce\)/)
  assert.doesNotMatch(read("app/board/board.css"), /prefers-reduced-motion/)
})

test("forced colours keep a boundary on every stateful control", () => {
  const block = CONTROL.slice(CONTROL.indexOf("@media (forced-colors:active)"))
  assert.ok(block.length > 0, "no forced-colors block")
  for (const sel of [".chip", ".tab", ".btn", ".skip", ".chip i"]) assert.match(block, new RegExp(sel.replace(/\./g, "\\.")), `${sel} has no forced-colors rule`)
})

test("more contrast lifts the quiet tier", () => {
  assert.match(CONTROL, /@media \(prefers-contrast:more\)\{[^}]*--text-muted:var\(--text-secondary\)/)
})

test("the tracker's service drawing stays named", () => {
  // Already true today (board.tsx ~665): the SVG is role="img" with the service
  // as its label when there is one. Pinned so the forced-colors pass cannot
  // strip it.
  const board = read("app/board/board.tsx")
  assert.match(board, /role: "img", "aria-label": lead\.service\.trim\(\)/)
})
```

- [ ] **Step 2: Run it, watch it fail**

Run: `node --test scripts/modes.test.mjs` → FAIL.

- [ ] **Step 3: The four blocks in `control.css`**

Append after the touch-target block:

```css
/* One ring, everywhere. Components do not restate it; the two coloured
   fields override only the ring colour so it stays visible on the field. */
:focus-visible{outline:2px solid var(--focus);outline-offset:2px}

/* Motion is a courtesy, not information. Nothing here conveys state by
   moving, so stopping it loses nothing. Global so /ops stops too. */
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{transition-duration:.001ms !important;animation-duration:.001ms !important;
    animation-iteration-count:1 !important;scroll-behavior:auto !important}
}

/* Windows High Contrast strips backgrounds. Every control that showed its
   state as a fill shows it as a border instead. */
@media (forced-colors:active){
  .chip,.tab,.btn,.skip,.find{border:1px solid ButtonText}
  .tab[aria-pressed="true"],.tab[aria-current="page"]{border:2px solid Highlight}
  .btn--go{border:2px solid ButtonText}
  .chip i{background:CanvasText}
  .cust svg{stroke:CanvasText}
}

/* The reader asked the OS for more contrast: the quiet tier steps up one. */
@media (prefers-contrast:more){
  :root,.ops-shell{--text-muted:var(--text-secondary);--border:var(--border-strong);--border-subtle:var(--border)}
}
```

Delete the per-component `:focus-visible` rules in `control.css` (`.logo-home:focus-visible`, `.btn--go:focus-visible`) — the global rule replaces them; keep `.figure :focus-visible{outline-color:var(--on-field)}`. Delete `board.css:509`. Fix the one `outline:none` by removing it (the global ring now applies) or, if it is on `.find input`, leave it — `.find:focus-within` already draws the ring on the wrapper.

- [ ] **Step 4: Colour-only states**

Walk every place a state is a colour: `.chip` (dot + text — fine), the tracker's service SVG (`role="img"` + label — fine, pinned), the heard-price link (text — fine), the theme toggle and rail icons (`aria-label` — fine). The one to fix if found: any `.c-wait` age that turns red past a threshold without a word — add `<span className="sr-only">overdue</span>` there. Record in the commit body what was checked and what changed; if nothing changed, say so.

- [ ] **Step 5: Run the pin, suites, preview**

`node --test scripts/modes.test.mjs` → PASS. Add to `test:shop-brain`. Suites green. On the preview: keyboard through `/board` and a job page (every control shows the ring); DevTools → Rendering → `prefers-reduced-motion: reduce` (theme toggle and row expand snap, no animation); Windows contrast theme on (chips/tabs/buttons bordered). `npm run test:qa` → no `color-contrast` ids anywhere. **Owner eyeballs** (in the default modes nothing visibly changes except a consistent focus ring).

- [ ] **Step 6: Commit**

```bash
git add styles/control.css app/board scripts/modes.test.mjs package.json
git commit -m "feat(a11y): one focus ring, reduced motion and forced colours on every route"
```

---

### Task 5: Retire the dead CSS — with a fingerprint to prove nothing moved

**Files:**
- Create: `styles/ops-legacy.css` (the live `.ops-*` rules, moved verbatim)
- Modify: `app/globals.css` (delete every ops-era rule; the marketing half is untouched)
- Modify: `app/ops/layout.tsx`, `app/board/calls/page.tsx`, `app/board/customers/page.tsx`, `app/board/updates/page.tsx` (import `styles/ops-legacy.css` after `control.css`)
- Modify: `scripts/ops-shell-tokens.test.mjs` (read `styles/ops-legacy.css` instead of `globals.css`)
- Create: `scripts/qa/fingerprint-diff.mjs`
- Delete: `app/design-preview/` — nine routes (decided 2026-09-05: rejected drafts, public, unauthenticated; git history keeps them)
- Create: `scripts/dead-css.test.mjs`; add to `test:shop-brain`

**Interfaces:**
- Consumes: `scripts/qa/baseline/2026-09-04-fingerprint.json` from Task 0 and `scripts/qa/report/fingerprint.json` from a fresh `npm run test:qa` on the preview.
- Produces: `node scripts/qa/fingerprint-diff.mjs <before.json> <after.json>` — exits 1 and lists every `route / class / property` whose computed value changed.

- [ ] **Step 1: The diff tool**

`scripts/qa/fingerprint-diff.mjs`:

```js
import { readFileSync } from "node:fs"

const [, , beforePath, afterPath] = process.argv
const before = JSON.parse(readFileSync(beforePath, "utf8"))
const after = JSON.parse(readFileSync(afterPath, "utf8"))
const PROPS = ["font-size", "font-weight", "color", "background-color", "padding", "display", "line-height"]
const changed = []
for (const route of Object.keys(before)) {
  for (const cls of Object.keys(before[route])) {
    const a = before[route][cls].split("|"), b = (after[route]?.[cls] ?? "").split("|")
    a.forEach((v, i) => { if (v !== b[i]) changed.push(`${route}  .${cls}  ${PROPS[i]}: ${v} -> ${b[i] ?? "(gone)"}`) })
  }
}
if (changed.length) { console.error(changed.join("\n")); process.exit(1) }
console.log(`fingerprint unchanged across ${Object.keys(before).length} routes`)
```

Font-size and weight *will* differ from the 2026-09-04 baseline because Task 1 changed them on purpose. So the "before" for this task is a fresh fingerprint captured on the preview of Task 4's merge, not the original baseline: run `npm run test:qa` against that preview first and copy `report/fingerprint.json` to `scripts/qa/baseline/pre-retirement-fingerprint.json`.

- [ ] **Step 2: The pin**

`scripts/dead-css.test.mjs`:

```js
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n")

test("globals.css carries no ops-era rule", () => {
  const g = read("app/globals.css")
  assert.equal((g.match(/\.ops-[a-z0-9-]+/g) ?? []).length, 0, "an .ops-* selector is still in globals.css")
  assert.ok(g.split("\n").length < 4000, `globals.css is ${g.split("\n").length} lines; the marketing half is under 4,000`)
})

test("every .ops-* class the app renders has a rule in ops-legacy.css, and nothing more", () => {
  const legacy = read("styles/ops-legacy.css")
  const defined = new Set(legacy.match(/\.ops-[a-z0-9-]+/g))
  const used = new Set()
  const { execSync } = require("node:child_process")
  const out = execSync('git grep -ho "ops-[a-z0-9-]*" -- "app/board" "app/ops" "components"', { cwd: root }).toString()
  for (const c of out.split(/\s+/)) if (c) used.add("." + c)
  for (const c of used) assert.ok(defined.has(c) || !/^\.ops-[a-z]/.test(c), `${c} is rendered but has no rule`)
  for (const c of defined) assert.ok(used.has(c), `${c} has a rule but nothing renders it`)
})

test("the rejected design previews are gone", () => {
  const { existsSync } = require("node:fs")
  assert.equal(existsSync(join(root, "app/design-preview")), false)
})
```

(Write it with `import { execSync } from "node:child_process"` and `import { existsSync } …` at the top — ESM, as every other pin in `scripts/`.)

- [ ] **Step 3: Run it, watch it fail** — `node --test scripts/dead-css.test.mjs` → FAIL on all three.

- [ ] **Step 4: Move the live rules**

Produce the used-class list: `git grep -ho "ops-[a-z0-9-]*" -- "app/board" "app/ops" "components" | sort -u`. **Select by selector, never by line range** — the ops-era sections are interleaved with marketing (`.ms-site > header.ms-nav` sits at 3492 inside them) and with the customer page (`.glass-traveler` at 8021). The rule, per rule block in `app/globals.css`, including blocks nested in `@media`:

- a selector arm that names an `.ops-*` class **in the used list** → the arm moves verbatim (same order, same comments) into `styles/ops-legacy.css`;
- a selector arm that names only `.ops-*` classes **not** in the used list → the arm is deleted;
- a selector arm that names no `.ops-*` class at all (`.ms-*`, `.glass-*`, `.public-*`, a bare `.is-bad`) → the arm stays in `globals.css` untouched, whatever section it sits in.

A block whose arms fall in different buckets is split; a declaration block emptied of all its arms is deleted. `@keyframes` and `--ops-*` custom properties that a moved rule references move with it (Codex, 2026-09-05: a moved rule that animates or reads a variable left behind is a silent regression the fingerprint may not see). State modifiers ride with their host: `.ops-filters a.is-active` (1910) and `.ops-done-voice.is-listening` (4479) are ops arms and move. Survey on 2026-09-05: 92 non-`.ops-` class names appear in the ops-era ranges and 19 of them are rendered by CRM files — all but the two marketing ones are `.is-*` modifiers compounded with an `.ops-*` host, which the arm rule handles. Write the selection as a script in the session's scratchpad (parse with a regex over `selector{…}` at brace depth, respecting `@media` nesting) rather than by hand, and paste its counts (moved / deleted / kept arms) into the commit body.

Import `styles/ops-legacy.css` in `app/ops/layout.tsx` directly after `control.css`, and in the three board satellite pages after their route CSS. Route CSS keeps the two-class specificity pattern the memory note describes (`.updates-page .ops-wire-slip`), so order is not what decides — but the fingerprint diff is the proof, not this sentence.

- [ ] **Step 5: Retarget the token test** — `scripts/ops-shell-tokens.test.mjs` reads `styles/ops-legacy.css` for the `--color-*` references it diffs against the alias block.

- [ ] **Step 6: Delete the previews**

`git rm -r app/design-preview`. Decided in the planning session; do not ask again. They are rejected drafts reachable by anyone with the URL, and git history keeps them. Do not delete the root `design-previews/` image folder.

- [ ] **Step 7: Prove it**

`node --test scripts/dead-css.test.mjs` → PASS. Add to `test:shop-brain`. Suites green. `npx next build` → exit 0; note the `globals.css` chunk size before and after in the commit body. Push, run `npm run test:qa` against the preview, then

```powershell
node scripts/qa/fingerprint-diff.mjs scripts/qa/baseline/pre-retirement-fingerprint.json scripts/qa/report/fingerprint.json
```

Expected: `fingerprint unchanged across N routes`. Any line of output is a rule that lost the cascade — restore that block's order in `ops-legacy.css` and re-run; do not patch it with a new selector. **Owner eyeballs** the four routes that carry the most legacy rules: a job page, intake, `/board/updates`, `/board/customers`.

- [ ] **Step 8: Commit**

```bash
git add app/globals.css styles/ops-legacy.css app/ops/layout.tsx app/board scripts
git commit -m "refactor(css): the live ops rules move to ops-legacy.css; 5,300 dead lines and nine rejected preview routes go"
```

#### Pre-flight inventory — 2026-09-05

A read-only survey of `app/globals.css` ran before this task was scheduled, so the
hard-to-reverse session does no discovery of its own. It found **four errors in
the task as written above**. Read these before Step 1.

**Correction A — the plan names three board pages for the import. It is four.**
`app/board/page.tsx` renders `.ops-recovery-control` and `.ops-sr-only` (through
`board.tsx` and `recovery-control.tsx`), and their only rules are in
`globals.css`. Omitting it leaves `/board` broken. Per-route need, measured:

| route | classes whose only rules are in `globals.css` |
|---|---|
| `/board` | `.ops-followup-current .ops-ghost .ops-recovery-control .ops-sr-only` |
| `/board/calls` | `.ops-followup-current .ops-ghost` |
| `/board/customers` | `.ops-followup-current .ops-ghost` |
| `/board/updates` | `.ops-followup-current .ops-ghost` + `@keyframes paid-land` |

There is no `app/board/layout.tsx`; each board page carries its own CSS, and each
route CSS opens with `@import "../../styles/control.css"`.

**Correction B — `app/design-preview/` is 7 routes, not nine.** Seven `page.tsx`,
one `layout.tsx`, two client components, six CSS files: 16 files. Nothing in
`app/`, `components/` or `lib/` links to them; the three cross-links are internal
to the folder. Two path *strings* name the URL prefix and must stay:
`app/robots.ts:11` and `components/public-analytics.tsx:10`.

**Correction C — `.ops-filters a.is-active` (1910) is a DELETE, not a MOVE.**
`ops-filters` is rendered by no file; every `.ops-filters*` arm at 1887–1920 and
3546–3548 is dead. Only `.ops-filters .ops-ghost` (1922) and
`.ops-main > .ops-filters .ops-followup-current` (3977) move. The plan's other
half is right: `.ops-done-voice.is-listening` (4479) is a MOVE.

**Correction D — `scripts/dead-css.test.mjs` cannot pass as written.** Its second
test asserts `used ⊆ defined` *and* `defined ⊆ used`. Both directions fail, and
neither failure is a defect in the retirement:

- **79 of the 137 used tokens have no rule in `globals.css` at all.** They are
  styled by route CSS (all 35 `ops-builds-*` live in `builds.css`), or they are
  not class names — `ops-auth` is a cookie, `ops-sw` and `ops-service-worker` are
  service-worker registrations, `ops-dashboard` and `ops-data` are revalidate
  tags, `ops-reply` and `ops-sms-reply` are idempotency keys,
  `ops-handset-question` and `ops-login-message` are DOM ids, and
  `ops-code`/`ops-email`/`ops-phone` are form field names. A grep for
  `ops-[a-z0-9-]*` cannot tell a class from any other `ops-`-prefixed string.
- **20 names ride into `ops-legacy.css` on MOVE arms without being rendered
  themselves**, because they are ancestor selectors — `.ops-main .ops-ghost`,
  `.ops-work-order-vnext > .ops-header`, and so on. The list:
  `.ops-account-page .ops-account-people .ops-add-job-action .ops-card
  .ops-filters .ops-header-actions .ops-job-row .ops-kicker .ops-login .ops-main
  .ops-more-view .ops-phone-row .ops-row-actions .ops-shop-page .ops-sub
  .ops-table-wrap .ops-ticket-actions .ops-ticket-urgent .ops-wall-vnext
  .ops-work-order-vnext`. This is a direct consequence of the plan's own arm rule.

Pin the assertion that is actually worth pinning instead:

```js
// every used ops class that HAD a rule in globals.css still has one
for (const c of used) if (oldGlobalsDefined.has(c)) assert.ok(legacyDefined.has(c), `${c} lost its rule`)
// nothing survives that is not reachable from a used class
for (const c of legacyDefined) assert.ok(used.has(c) || ANCESTOR_ALLOWLIST.has(c), `${c} has a rule but nothing renders it`)
```

The first direction was verified to hold today: every used class with a rule in
`globals.css` is covered by a MOVE arm, zero misses. Tests 1 and 3 are fine as
written.

**Two suites break the moment `app/design-preview/` is deleted, and must be fixed
in the same commit:**

- `scripts/public-discovery-regressions.test.mjs:38–45` reads
  `app/design-preview/layout.tsx`. Delete the whole test.
- `scripts/recent-regressions.test.mjs:40–53` reads five preview pages. Delete
  the whole test. **This suite is in `test:shop-brain`**, so it breaks the gate.
- `scripts/recent-regressions.test.mjs:92` iterates a list containing
  `"/design-preview"` against `public-analytics.tsx` and passes unchanged, as long
  as that string stays in the component.

**Bucket counts**, from a brace-depth parser that respects `@media` nesting and
splits selector lists on top-level commas:

```
ARMS    MOVE=458   DELETE=1749  KEEP=900   total=3107
BLOCKS  MOVE=384   DELETE=1337  KEEP=782   MIXED=44   total=2547
```

Indicative lines: DELETE ≈ 3,633 · KEEP ≈ 2,810 · MOVE ≈ 1,038 · MIXED ≈ 273. The
`globals.css < 4000` assertion in test 1 is achievable. 78 distinct `.ops-*` names
appear in MOVE arms; 157 appear only in DELETE arms.

**Hazards, confirmed:**

- **`@keyframes`.** `paid-land` (4358) is referenced by `.ops-paid-moment` and
  **moves with it** — `/board/updates` restyles `.ops-paid-moment` in its own CSS
  but has no keyframe, so that route needs the import or the modal stops
  animating. `done-hold` (4484) and `money-odometer` (5385) are referenced only by
  DELETE arms and go with them. `wm-flicker` and `sw-buzz` are marketing.
- **Custom properties separate cleanly.** No MOVE arm reads a property declared in
  a KEEP or DELETE block. `--ms-*` and the five `--ops-*` are declared on
  `.ops-shell`, itself a MOVE arm, and read only by MOVE/DELETE. The marketing
  `--mx-*` are declared on `.ms-site` and read only by KEEP.
- **`app/globals.css:3` is `@import "../tokens.css"` and is load-bearing.**
  `tokens.css` declares every `--color-*`, `--space-*`, `--radius-*` and font
  variable that 54 moved properties depend on. Do not remove it, and do **not**
  add a second `@import "../tokens.css"` to `ops-legacy.css` — Tailwind inlines it
  twice.
- **`@theme inline` at 81–121 must stay.** It holds declarations, not rules, so an
  arm-counting classifier reports it empty in all three buckets.
- **44 MIXED blocks must be split.** Recurring shapes: `.glass-page` bundled with
  `.ops-main`/`.ops-login` (4099–4108, 4240–4254, 4767–4769 — the glass arms are
  `/j/[token]` and stay); `.ops-work-order-vnext > *` fan-outs;
  `.ops-tracked-call` paired with a dead sibling; `.ops-login > .ops-alert` inside
  dead login lists.
- **The two named interleaving traps are exactly where the plan says.**
  `.ms-site > header.ms-nav` opens at 3492 (block 3492–3496), and the KEEP glass
  region ends at exactly 8021, with `.ops-work-order-vnext .ops-spike-attachments`
  starting a 230-line DELETE run at 8025.
- **There are no `.public-*` classes in `globals.css`.** The "public stub" this
  task refers to is `html, body { overflow-x: clip }` at 4096–4097.
- **Cascade order flips, and the fingerprint is what catches it.** Today `/ops`
  loads `globals.css` (root layout) → `control.css` → `ops-shell.css`. After the
  move it is `control.css` → `ops-legacy.css` → `ops-shell.css`: the legacy rules
  go from *before* `control.css` to *after* it, so equal-specificity conflicts
  invert. If the fingerprint diff fires, import `ops-legacy.css` **before**
  `control.css`. Do not add a selector to win it back.

**Regenerate before starting.** The used-class list moved twice during the survey
itself (`ops-handset-speak` and `ops-login-message` appeared mid-pass). Re-run
`git grep -ho "ops-[a-z0-9-]*" -- "app/board" "app/ops" "components" | sort -u`
and re-run the classifier at the top of the session rather than trusting the
counts above.

---

### Task 6: Exit verification — the after table, the owner walk, the record

**Files:**
- Modify: this plan (append `### QA execution record — <date>` and the after table beside the baseline)
- Modify: `scripts/qa/final-polish.spec.mjs` — nothing; run it with `MCSW_QA_STRICT=1`
- Modify: `.github/workflows/*` only if a workflow already runs `test:shop-brain`; do **not** add the Playwright gate to CI (it needs a signed-in preview and a live database — it is an owner-run instrument, like the Lighthouse JSONs at the root)
- Modify: `docs/superpowers/plans/2026-09-04-final-polish-SESSION-PLAN.md` (mark the row), memory notes as the session sees fit

- [ ] **Step 1: Strict run against production after Task 5 deploys**

```powershell
$env:MCSW_QA_STRICT = "1"
npm run test:qa
```

Expected: every test passes. Paste `scripts/qa/report/summary.md` into this plan under `### After — <date>` directly below the baseline, so the two tables sit together.

- [ ] **Step 2: Walk QA Procedure steps 3–10 by hand** and write one line per step under the QA execution record: pass, or the exact thing seen. Steps that cannot be walked (no crew credential exists in production — see the C8 record) are written as *not walked, test-covered by …*, never as pass.

- [ ] **Step 3: Crew check** — `grep -rn "revenue\|invoice\|paid_amount\|cents" app/board app/ops --include=*.tsx | grep -v "owner"` shows nothing new since `12965ec` (compare with `git diff 12965ec --stat`). State the result in the record.

- [ ] **Step 4: Close the plan** — mark every task's checkboxes, mark the session row, and commit:

```bash
git add docs/superpowers/plans/2026-09-04-final-polish.md docs/superpowers/plans/2026-09-04-final-polish-SESSION-PLAN.md scripts/qa/baseline
git commit -m "docs(polish): the before and after tables, and the owner walk"
```

---

## What this round deliberately does not do

- **No redesign.** The vocabulary is approved; the round makes it correct.
- **No `board.tsx` split.** It is 2,555 lines and a client component; splitting it is a refactor with no measured user-facing gain in this round. If Task 1's `npx next build` or the gate shows a bundle problem, that becomes its own plan.
- **No Lighthouse in the gate.** Lighthouse cannot sign in; the fonts test and the DevTools check in QA step 3 cover the perceived-load gain this round makes.
- **No CI for the Playwright gate.** It needs a signed-in preview and the live database. It is run by hand, like the Lighthouse JSONs already at the repo root, and its outputs are frozen under `scripts/qa/baseline/`.
- **No change to `/j/[token]`.** The customer GLASS page is an owner decision left open since the conversion; its `globals.css` blocks stay exactly where they are.

---

### Baseline — 2026-09-04

Captured by `npm run test:qa` against **production** (`https://musiccityspecialtywelding.com`),
signed in as owner through a one-use link from `scripts/create-local-login.mjs`,
`MCSW_QA_JOB_ID=290`, `MCSW_QA_ACCOUNT_ID=23`. 52 tests, 51 rows, 12 routes
fingerprinted, 3.8 minutes. STRICT off — this run asserts nothing; it records.

Frozen at `scripts/qa/baseline/2026-09-04-summary.md` and
`scripts/qa/baseline/2026-09-04-fingerprint.json`.

**What the before numbers say, in one line each:**

- **The 14px floor is broken on every single route.** The smallest rendered text
  runs 10.8px (`/ops/leads/290`, a bare `<small>`) to 12px. Not one route clears
  the owner's number. Task 1.
- **There is no skip link anywhere.** `skip` is `false` on all 13 surfaces, and
  the dedicated skip-link test found the first Tab goes somewhere else. Task 2.
- **`/board` skips a heading level** at all four widths, and so does the
  signed-out zero state. Every `/ops` route is already in order. Task 2.
- **Two routes carry an axe `color-contrast` violation** — `/ops/accounts/23` and
  `/ops/leads/290`, at all four widths. Everything else is clean under
  wcag2a/2aa/21a/21aa/22aa. Task 4.
- **Three requests to Google Fonts** on a cold `/board`. Task 1.
- **`h1` and `main` are already 1 and 1 on every route**, and nothing overflows
  horizontally at any width. Task 2 must not regress that while moving the
  landmark into the ops layout.

| route | width | axe | axe ids | min font | at | h1 | main | skip | order | overflow |
|---|---|---|---|---|---|---|---|---|---|---|
| account | 1440 | 1 | color-contrast | 11.5 | a.account-back.t-caption | 1 | 1 | false | true | 0 |
| account | 320 | 1 | color-contrast | 11.5 | a.account-back.t-caption | 1 | 1 | false | true | 0 |
| account | 375 | 1 | color-contrast | 11.5 | a.account-back.t-caption | 1 | 1 | false | true | 0 |
| account | 768 | 1 | color-contrast | 11.5 | a.account-back.t-caption | 1 | 1 | false | true | 0 |
| analytics | 1440 | 0 |  | 11.5 | a.analytics-back.t-caption | 1 | 1 | false | true | 0 |
| analytics | 320 | 0 |  | 11.5 | a.analytics-back.t-caption | 1 | 1 | false | true | 0 |
| analytics | 375 | 0 |  | 11.5 | a.analytics-back.t-caption | 1 | 1 | false | true | 0 |
| analytics | 768 | 0 |  | 11.5 | a.analytics-back.t-caption | 1 | 1 | false | true | 0 |
| board | 1440 | 0 |  | 11.5 | span.who-dot | 1 | 1 | false | false | 0 |
| board | 320 | 0 |  | 12 | text. | 1 | 1 | false | false | 0 |
| board | 375 | 0 |  | 12 | text. | 1 | 1 | false | false | 0 |
| board | 768 | 0 |  | 12 | text. | 1 | 1 | false | false | 0 |
| board | fonts |  |  |  |  |  |  |  |  |  |
| board | skip |  |  |  |  |  |  | false |  |  |
| builds | 1440 | 0 |  | 12 | span.ops-person | 1 | 1 | false | true | 0 |
| builds | 320 | 0 |  | 12 | span.ops-person | 1 | 1 | false | true | 0 |
| builds | 375 | 0 |  | 12 | span.ops-person | 1 | 1 | false | true | 0 |
| builds | 768 | 0 |  | 12 | span.ops-person | 1 | 1 | false | true | 0 |
| calls | 1440 | 0 |  | 11.5 | span.t-caption | 1 | 1 | false | true | 0 |
| calls | 320 | 0 |  | 11.5 | span.t-caption | 1 | 1 | false | true | 0 |
| calls | 375 | 0 |  | 11.5 | span.t-caption | 1 | 1 | false | true | 0 |
| calls | 768 | 0 |  | 11.5 | span.t-caption | 1 | 1 | false | true | 0 |
| customers | 1440 | 0 |  | 12 | a.btn.btn--edge | 1 | 1 | false | true | 0 |
| customers | 320 | 0 |  | 12 | a.btn.btn--edge | 1 | 1 | false | true | 0 |
| customers | 375 | 0 |  | 12 | a.btn.btn--edge | 1 | 1 | false | true | 0 |
| customers | 768 | 0 |  | 12 | a.btn.btn--edge | 1 | 1 | false | true | 0 |
| install | 1440 | 0 |  | 11.5 | a.install-back.t-caption | 1 | 1 | false | true | 0 |
| install | 320 | 0 |  | 11.5 | a.install-back.t-caption | 1 | 1 | false | true | 0 |
| install | 375 | 0 |  | 11.5 | a.install-back.t-caption | 1 | 1 | false | true | 0 |
| install | 768 | 0 |  | 11.5 | a.install-back.t-caption | 1 | 1 | false | true | 0 |
| intake | 1440 | 0 |  | 11.5 | span. | 1 | 1 | false | true | 0 |
| intake | 320 | 0 |  | 11.5 | span. | 1 | 1 | false | true | 0 |
| intake | 375 | 0 |  | 11.5 | span. | 1 | 1 | false | true | 0 |
| intake | 768 | 0 |  | 11.5 | span. | 1 | 1 | false | true | 0 |
| job | 1440 | 1 | color-contrast | 10.8 | small. | 1 | 1 | false | true | 0 |
| job | 320 | 1 | color-contrast | 10.8 | small. | 1 | 1 | false | true | 0 |
| job | 375 | 1 | color-contrast | 10.8 | small. | 1 | 1 | false | true | 0 |
| job | 768 | 1 | color-contrast | 10.8 | small. | 1 | 1 | false | true | 0 |
| shop | 1440 | 0 |  | 11.5 | a.shop-back.t-caption | 1 | 1 | false | true | 0 |
| shop | 320 | 0 |  | 11.5 | a.shop-back.t-caption | 1 | 1 | false | true | 0 |
| shop | 375 | 0 |  | 11.5 | a.shop-back.t-caption | 1 | 1 | false | true | 0 |
| shop | 768 | 0 |  | 11.5 | a.shop-back.t-caption | 1 | 1 | false | true | 0 |
| signedout | 1280 |  |  | 11.5 | span.who-dot | 1 | 1 | false | false | 0 |
| sketch | 1440 | 0 |  | 12 | span.ops-person | 1 | 1 | false | true | 0 |
| sketch | 320 | 0 |  | 12 | span.ops-person | 1 | 1 | false | true | 0 |
| sketch | 375 | 0 |  | 12 | span.ops-person | 1 | 1 | false | true | 0 |
| sketch | 768 | 0 |  | 12 | span.ops-person | 1 | 1 | false | true | 0 |
| updates | 1440 | 0 |  | 11.5 | time. | 1 | 1 | false | true | 0 |
| updates | 320 | 0 |  | 12 | a. | 1 | 1 | false | true | 0 |
| updates | 375 | 0 |  | 12 | a. | 1 | 1 | false | true | 0 |
| updates | 768 | 0 |  | 12 | a. | 1 | 1 | false | true | 0 |

