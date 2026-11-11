// Fable F-1: local-only legal-page control/launcher bounding-box evidence.
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "@playwright/test"

const origin = process.argv[2]
assert.ok(origin, "Supply a local production-build origin as the first argument")
const target = new URL(origin)
assert.ok(target.protocol === "http:" && ["localhost", "127.0.0.1"].includes(target.hostname))
assert.equal(origin, target.origin)
const directory = "docs/design-shots"
mkdirSync(directory, { recursive: true })
const results = {
  origin,
  safety: "Only local GET/HEAD requests allowed; no forms submitted or chat turns sent.",
  step: 8,
  pages: [],
}
const save = () => writeFileSync(`${directory}/fable-r5-legal-metrics.json`, JSON.stringify(results, null, 2) + "\n")
const browser = await chromium.launch({ channel: "chrome", headless: true })
const launcherSelector = 'aside[aria-label="Contact the welding shop"]'

async function scrollTo(page, y) {
  await page.evaluate(y => window.scrollTo({ top: y, left: 0, behavior: "instant" }), y)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

try {
  for (const viewport of [{ width: 980, height: 700 }, { width: 1024, height: 768 }]) {
    for (const route of ["/privacy", "/terms"]) {
      const context = await browser.newContext({ viewport, reducedMotion: "reduce", serviceWorkers: "block" })
      const page = await context.newPage()
      const errors = [], submissions = []
      page.on("pageerror", error => errors.push(error.message))
      await context.route("**/*", request => {
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
      await page.locator(".ms-footer").scrollIntoViewIfNeeded()
      await scrollTo(page, 0)
      const maxY = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
      const entry = { route, viewport, maxY, samples: 0, visibleLauncherSamples: 0, controlsMeasured: 0, collisions: [], boundingBoxCollisions: [], closestControl: null }
      // Include the exact bottom even when maximum scroll is not divisible by 8.
      const positions = Array.from({ length: Math.floor(maxY / 8) + 1 }, (_, index) => index * 8)
      if (positions.at(-1) !== maxY) positions.push(maxY)
      for (const y of positions) {
        await scrollTo(page, y)
        const sample = await page.evaluate(selector => {
          const box = rect => ({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height })
          const intersects = (a, b) => a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0
            && Math.min(a.right, b.right) > Math.max(a.left, b.left)
            && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)
          const launcher = document.querySelector(selector)
          if (!launcher) throw new Error("Contact launcher is missing")
          const launcherBox = launcher.getBoundingClientRect()
          const style = getComputedStyle(launcher)
          const visible = launcher.getAttribute("aria-hidden") !== "true" && style.pointerEvents !== "none"
            && launcher.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            && intersects(launcherBox, { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight })
          const controls = [...document.querySelectorAll("a, button, summary, input, select, textarea")]
            .filter(element => !launcher.contains(element) && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
            .map(element => ({ tag: element.tagName, text: element.textContent.trim().slice(0, 100), href: element.getAttribute("href"),
              box: box(element.getBoundingClientRect()), rects: [...element.getClientRects()].map(box) }))
            .filter(control => control.rects.some(rect => rect.bottom > 0 && rect.top < innerHeight && rect.width > 0 && rect.height > 0))
          const hits = visible ? controls.filter(control => control.rects.some(rect => intersects(launcherBox, rect))) : []
          const boundingHits = visible ? controls.filter(control => intersects(launcherBox, control.box)) : []
          const beside = visible ? controls.filter(control => control.rects.some(rect => rect.bottom > launcherBox.top && rect.top < launcherBox.bottom)) : []
          const closest = beside.sort((a, b) => Math.abs(launcherBox.left - a.box.right) - Math.abs(launcherBox.left - b.box.right))[0] ?? null
          return { y: scrollY, visible, launcher: box(launcherBox), controls: controls.length, hits, boundingHits, closest,
            overflow: document.documentElement.scrollWidth - innerWidth }
        }, launcherSelector)
        assert.equal(sample.y, y, `${route} ${viewport.width}: measured requested scroll position`)
        assert.equal(sample.overflow, 0, `${route} ${viewport.width}: no horizontal overflow`)
        entry.samples++
        entry.controlsMeasured += sample.controls
        if (sample.visible) entry.visibleLauncherSamples++
        entry.collisions.push(...sample.hits.map(control => ({ y: sample.y, launcher: sample.launcher, ...control })))
        entry.boundingBoxCollisions.push(...sample.boundingHits.map(control => ({ y: sample.y, launcher: sample.launcher, ...control })))
        if (sample.closest) {
          const gap = sample.launcher.left - sample.closest.box.right
          if (!entry.closestControl || Math.abs(gap) < Math.abs(entry.closestControl.gap)) {
            entry.closestControl = { y: sample.y, gap, launcher: sample.launcher, ...sample.closest }
          }
        }
      }
      assert.ok(entry.visibleLauncherSamples > 0, `${route} ${viewport.width}: launcher was visible during sweep`)
      const subject = route === "/privacy" ? 'a[href="https://policies.google.com/technologies/partner-sites"]' : '.ms-legal a[href="/privacy"]'
      const subjectY = await page.locator(subject).evaluate(element => element.getBoundingClientRect().top + scrollY)
      await scrollTo(page, Math.max(0, Math.min(maxY, Math.round(subjectY - viewport.height + 120))))
      entry.screenshot = `${directory}/fable-r5-${route.slice(1)}-${viewport.width}x${viewport.height}-launcher.png`
      await page.screenshot({ path: entry.screenshot, animations: "disabled" })
      entry.subject = await page.locator(subject).evaluate(element => {
        const box = rect => ({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height })
        return { y: scrollY, text: element.textContent.trim(), box: box(element.getBoundingClientRect()), rects: [...element.getClientRects()].map(box) }
      })
      entry.errors = errors
      entry.attemptedSubmissions = submissions
      results.pages.push(entry)
      save()
      assert.deepEqual(entry.collisions, [], `${route} ${viewport.width}: all control fragments clear launcher`)
      assert.deepEqual(entry.boundingBoxCollisions, [], `${route} ${viewport.width}: all control bounding boxes clear launcher`)
      assert.deepEqual(errors, [], `${route}: no browser errors`)
      assert.deepEqual(submissions, [], `${route}: no attempted submissions`)
      await context.close()
      console.log(JSON.stringify({ route, viewport, samples: entry.samples, visibleLauncherSamples: entry.visibleLauncherSamples, collisions: 0 }))
    }
  }
} finally {
  await browser.close()
}
