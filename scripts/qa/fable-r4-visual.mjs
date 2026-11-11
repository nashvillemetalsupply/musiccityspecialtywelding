// Fable round 4: local production UI evidence, without submissions or remote traffic.
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "@playwright/test"

const origin = process.argv[2]
assert.ok(origin, "Supply the local production origin as the first argument")
const target = new URL(origin)
assert.ok(target.protocol === "http:" && ["localhost", "127.0.0.1"].includes(target.hostname))
assert.equal(origin, target.origin)
const directory = "docs/design-shots"
mkdirSync(directory, { recursive: true })
const results = {
  origin,
  safety: "Only local GET/HEAD requests allowed; no chat or form submitted.",
  menu: [], faq: [], launcher: [],
}
const save = () => writeFileSync(`${directory}/fable-r4-metrics.json`, JSON.stringify(results, null, 2) + "\n")
const browser = await chromium.launch({ channel: "chrome", headless: true })
const launcherSelector = 'aside[aria-label="Contact the welding shop"]'

async function open(route, viewport, hasTouch = false) {
  const page = await browser.newPage({ viewport, hasTouch, reducedMotion: "reduce" })
  page.setDefaultTimeout(20_000)
  const errors = [], submissions = []
  page.on("pageerror", error => errors.push(error.message))
  await page.route("**/*", request => {
    const call = request.request()
    if (!["GET", "HEAD"].includes(call.method())) {
      submissions.push({ method: call.method(), url: call.url() })
      return request.abort()
    }
    return new URL(call.url()).origin === origin ? request.continue() : request.abort()
  })
  const response = await page.goto(origin + route, { waitUntil: "networkidle", timeout: 60_000 })
  assert.equal(response.status(), 200)
  await page.addStyleTag({ content: "html { scroll-behavior: auto !important; }" })
  await page.evaluate(() => document.fonts.ready)
  const finish = async () => {
    assert.deepEqual(errors, [], `${route}: no browser errors`)
    assert.deepEqual(submissions, [], `${route}: no attempted submissions`)
    await page.close()
  }
  return { page, finish }
}

async function scrollTo(page, y) {
  await page.evaluate(y => window.scrollTo({ top: y, left: 0, behavior: "instant" }), y)
  // Give scroll observers, reveal transitions and launcher visibility a frame.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

async function prepare(page) {
  // Visit real deferred content before measuring; preserve production CSS.
  for (const section of await page.locator("main section").all()) {
    await section.scrollIntoViewIfNeeded()
  }
  for (const image of await page.locator("img").all()) {
    if (!await image.isVisible()) continue
    await image.scrollIntoViewIfNeeded()
    await image.evaluate(img => img.decode())
  }
  await page.locator(".ms-footer").scrollIntoViewIfNeeded()
  await scrollTo(page, 0)
}

async function menuState(page) {
  return page.evaluate(() => {
    const box = element => {
      const { top, bottom, left, right, width, height } = element.getBoundingClientRect()
      return { top, bottom, left, right, width, height }
    }
    const summary = document.querySelector(".ms-menu summary")
    return {
      scrollY, nav: box(document.querySelector(".ms-nav")), summary: box(summary),
      summaryVisible: summary.checkVisibility() && summary.getBoundingClientRect().top >= 0 && summary.getBoundingClientRect().bottom <= innerHeight,
      open: document.querySelector(".ms-menu").open,
    }
  })
}

try {
  for (const [slug, route] of [["home", "/"], ["mobile-welding", "/services/mobile-welding"], ["privacy", "/privacy"]]) {
    const viewport = { width: 390, height: 844 }
    const { page, finish } = await open(route, viewport, true)
    await prepare(page)
    await scrollTo(page, 900)
    const stages = [{ stage: "before-open", ...await menuState(page) }]
    assert.equal(stages[0].scrollY, 900)
    await page.locator(".ms-menu summary").click()
    stages.push({ stage: "after-open", ...await menuState(page) })
    const screenshot = `${directory}/fable-r4-${slug}-390x844-menu-scroll900.png`
    await page.screenshot({ path: screenshot, animations: "disabled" })
    await page.mouse.move(190, 730)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(100)
    stages.push({ stage: "after-wheel", ...await menuState(page) })
    const session = await page.context().newCDPSession(page)
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 190, y: 750 }] })
    for (const y of [650, 550, 450, 350]) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 190, y }] })
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await page.waitForTimeout(100)
    stages.push({ stage: "after-touch", ...await menuState(page) })
    await page.locator(".ms-menu summary").click()
    stages.push({ stage: "after-close", ...await menuState(page) })
    for (const stage of stages) {
      assert.equal(stage.scrollY, 900, `${route} ${stage.stage}: scroll stays at 900`)
      assert.ok(Math.abs(stage.nav.top) < 0.5, `${route} ${stage.stage}: nav stays at top 0`)
      assert.equal(stage.summaryVisible, true, `${route} ${stage.stage}: close button stays visible`)
    }
    assert.equal(stages.at(-1).open, false)
    results.menu.push({ route, viewport, screenshot, stages })
    save()
    await finish()
    console.log(JSON.stringify({ check: "menu", route, passed: true }))
  }

  const widths = [980, 1024, 1040, 1100, 1120, 1180, 1280, 1340, 1366, 1440]
  for (const [slug, route] of [["home", "/"], ["mobile-welding", "/services/mobile-welding"]]) {
    for (const width of widths) {
      const viewport = { width, height: 900 }
      const { page, finish } = await open(route, viewport)
      await prepare(page)
      await page.locator(".ms-faq-heading h2").scrollIntoViewIfNeeded()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const measurement = await page.evaluate(selector => {
        const heading = document.querySelector(".ms-faq-heading h2")
        const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT)
        const lines = new Map()
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          for (let offset = 0; offset < node.length; offset++) {
            const range = document.createRange()
            range.setStart(node, offset)
            range.setEnd(node, offset + 1)
            const rect = range.getBoundingClientRect()
            const key = Math.round(rect.top)
            lines.set(key, (lines.get(key) ?? "") + node.textContent[offset])
          }
        }
        const box = element => {
          const { top, right, bottom, left, width, height } = element.getBoundingClientRect()
          return { top, right, bottom, left, width, height }
        }
        return {
          lines: [...lines.values()].map(line => line.trim()).filter(Boolean),
          heading: box(heading), card: box(document.querySelector(".ms-faq-list")),
          launcher: box(document.querySelector(selector)),
          overflow: document.documentElement.scrollWidth > innerWidth,
        }
      }, launcherSelector)
      assert.deepEqual(measurement.lines, ["Straight", "answers."], `${route} ${width}: exactly two intact words`)
      assert.equal(measurement.overflow, false, `${route} ${width}: no horizontal overflow`)
      assert.ok(measurement.card.right <= measurement.launcher.left, `${route} ${width}: FAQ card clears launcher column`)
      const screenshot = `${directory}/fable-r4-${slug}-${width}x900-faq.png`
      await page.screenshot({ path: screenshot, animations: "disabled" })
      results.faq.push({ route, viewport, screenshot, ...measurement })
      save()
      await finish()
      console.log(JSON.stringify({ check: "faq", route, width, passed: true }))
    }
  }

  for (const viewport of [{ width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }]) {
    for (const [slug, route] of [["home", "/"], ["service-areas", "/service-areas"]]) {
      const { page, finish } = await open(route, viewport)
      await prepare(page)
      const maxY = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
      let samples = 0, visibleSamples = 0, closestCity = null
      const collisions = []
      for (let y = 0; y <= maxY + 24; y += 24) {
        await scrollTo(page, Math.min(y, maxY))
        const sample = await page.evaluate(selector => {
          const launcher = document.querySelector(selector)
          const a = launcher.getBoundingClientRect(), style = getComputedStyle(launcher)
          const visible = launcher.getAttribute("aria-hidden") !== "true" && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && style.pointerEvents !== "none"
          const rect = box => ({ top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height })
          const candidates = [...document.querySelectorAll("a, button, summary, input, select, textarea")].filter(element => !launcher.contains(element) && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
          const hits = visible ? candidates.filter(element => {
            const b = element.getBoundingClientRect()
            return b.width && b.height && Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)
          }).map(element => ({ tag: element.tagName, text: element.textContent.trim().slice(0, 90), box: rect(element.getBoundingClientRect()) })) : []
          const cities = visible ? [...document.querySelectorAll(".ms-city-list a")].map(element => ({ text: element.textContent.trim(), box: rect(element.getBoundingClientRect()) })).filter(city => Math.min(a.bottom, city.box.bottom) > Math.max(a.top, city.box.top)) : []
          return { y: scrollY, visible, launcher: rect(a), hits, cities }
        }, launcherSelector)
        samples++
        if (sample.visible) visibleSamples++
        collisions.push(...sample.hits.map(hit => ({ y: sample.y, ...hit })))
        for (const city of sample.cities) {
          const gap = sample.launcher.left - city.box.right
          const centerDistance = Math.abs((city.box.top + city.box.bottom) / 2 - (sample.launcher.top + sample.launcher.bottom) / 2)
          if (!closestCity || gap < closestCity.gap || Math.abs(gap - closestCity.gap) < 0.5 && centerDistance < closestCity.centerDistance) {
            closestCity = { y: sample.y, gap, centerDistance, city, launcher: sample.launcher }
          }
        }
      }
      assert.ok(visibleSamples > 0, `${route} ${viewport.width}: launcher was present in sweep`)
      assert.deepEqual(collisions, [], `${route} ${viewport.width}: all controls clear launcher during 24px scroll sweep`)
      let screenshot = null
      if (viewport.width === 1280) {
        assert.ok(closestCity, `${route}: city chips were measured beside the visible launcher`)
        await scrollTo(page, closestCity.y)
        // A native hover and mouse-out refresh Chromium's fixed layer after
        // jumping back from the footer; leave production styles untouched.
        await page.locator(`${launcherSelector} button`).hover()
        await page.mouse.move(0, 75)
        await page.waitForTimeout(160)
        screenshot = `${directory}/fable-r4-${slug}-1280x720-city-launcher${slug === "service-areas" ? "-visible" : ""}.png`
        await page.screenshot({ path: screenshot, animations: "disabled" })
      }
      results.launcher.push({ route, viewport, step: 24, samples, visibleSamples, collisions, closestCity, screenshot })
      save()
      await finish()
      console.log(JSON.stringify({ check: "launcher", route, viewport, samples, passed: true }))
    }
  }
  results.passed = true
  save()
} catch (error) {
  results.passed = false
  results.failure = error.message
  save()
  throw error
} finally {
  await browser.close()
}
