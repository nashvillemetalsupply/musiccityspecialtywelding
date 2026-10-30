// Read-only browser regression: run against a local production build by default.
import assert from 'node:assert/strict'
import { chromium, webkit, devices } from '@playwright/test'

const parsed = new URL(process.argv[2] || 'http://127.0.0.1:3050')
assert.ok(parsed.pathname === '/' && !parsed.search && !parsed.hash && !parsed.username && !parsed.password, 'Supply only a bare origin; paths, queries, fragments and credentials are forbidden')
assert.ok((parsed.hostname === 'musiccityspecialtywelding.com' && parsed.protocol === 'https:' && !parsed.port) ||
  (['127.0.0.1', 'localhost'].includes(parsed.hostname) && parsed.protocol === 'http:'), 'Use HTTP loopback or the canonical HTTPS signed-out site')
const origin = parsed.origin
const configurations = [
  { name: 'iPhone 15', engine: webkit, device: devices['iPhone 15'] },
  { name: 'Pixel 8', engine: chromium, device: {
    viewport: { width: 412, height: 915 }, screen: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36',
  } },
]
const results = []
for (const { name, engine, device } of configurations) {
  const browser = await engine.launch({ headless: true })
  try {
    for (const landscape of [false, true]) for (const scale of [1, 2]) {
      const viewport = landscape ? { width: device.viewport.height, height: device.viewport.width } : device.viewport
      const context = await browser.newContext({ ...device, viewport, screen: viewport, serviceWorkers: 'block', reducedMotion: 'reduce' })
      await context.route('**/*', route => {
        const request = route.request()
        if (!['GET', 'HEAD'].includes(request.method())) return route.abort('blockedbyclient')
        if (new URL(request.url()).origin !== parsed.origin) return route.fulfill({ status: 200, body: '' })
        return route.continue()
      })
      try {
        const page = await context.newPage()
        const response = await page.goto(origin, { waitUntil: 'networkidle' })
        assert.equal(response.status(), 200)
        await page.evaluate(() => document.fonts.ready)
        await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}.ms-home,.ms-home *{content-visibility:visible!important}.ms-reveal{opacity:1!important;transform:none!important}' })
        const fontRatios = await page.evaluate(scale => {
          const heading = document.querySelector('h1')
          const before = parseFloat(getComputedStyle(heading).fontSize)
          const samples = [...document.querySelectorAll('.ms-brand-words strong,.ms-brand-words span,.sw-sign span,.ms-sticker,#job-glass p,#job-glass figcaption,.ms-text-consent a')]
            .map(element => [element, parseFloat(getComputedStyle(element).fontSize)])
          // Snapshot first so nested text does not compound its enlargement.
          const sizes = [...document.querySelectorAll('*')].filter(element => element instanceof HTMLElement)
            .map(element => {
              const style = getComputedStyle(element)
              return [element, parseFloat(style.fontSize), parseFloat(style.lineHeight)]
            })
          for (const [element, fontSize, lineHeight] of sizes) {
            if (fontSize) element.style.setProperty('font-size', `${fontSize * scale}px`, 'important')
            if (lineHeight) element.style.setProperty('line-height', `${lineHeight * scale}px`, 'important')
          }
          return { heading: parseFloat(getComputedStyle(heading).fontSize) / before,
            samples: samples.map(([element, original]) => ({ text: element.textContent.trim().slice(0, 60), ratio: parseFloat(getComputedStyle(element).fontSize) / original })) }
        }, scale)
        assert.equal(fontRatios.heading, scale, 'The heading must render at the requested text scale')
        assert.ok(fontRatios.samples.length > 5, 'Verify text scale throughout the full page')
        for (const sample of fontRatios.samples) assert.ok(Math.abs(sample.ratio - scale) < 0.001, `Requested text scale: ${JSON.stringify(sample)}`)
        const measurement = await page.evaluate(() => {
          const textOverflow = []
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
          while (walker.nextNode()) {
            const node = walker.currentNode, parent = node.parentElement
            if (!node.textContent.trim() || parent.closest('script,style,noscript,svg,[aria-hidden="true"],[hidden]')) continue
            const skipLink = parent.closest('.ms-skip')
            if (skipLink && document.activeElement !== skipLink) continue
            const closedDetails = parent.closest('details:not([open])')
            if (closedDetails && !parent.closest('summary')) continue
            const style = getComputedStyle(parent)
            if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue
            const range = document.createRange()
            range.selectNodeContents(node)
            for (const rectangle of range.getClientRects()) {
              if (rectangle.width && rectangle.height && (rectangle.left < -1 || rectangle.right > innerWidth + 1)) {
                textOverflow.push({ text: node.textContent.trim().slice(0, 90), left: rectangle.left, right: rectangle.right })
                break
              }
            }
          }
          return {
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          textOverflow,
          targets: [...document.querySelectorAll('.ms-process-call, .ms-text-consent a')].map(element => {
            const rectangle = element.getBoundingClientRect()
            return { text: element.textContent.trim().replace(/\s+/g, ' '), width: rectangle.width, height: rectangle.height }
          }),
          }
        })
        const result = { device: name, orientation: landscape ? 'landscape' : 'portrait', scale, fontRatios, ...measurement }
        results.push(result)
        console.log(JSON.stringify(result))
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
}
for (const result of results) {
  assert.equal(result.overflow, false, `No overflow: ${JSON.stringify(result)}`)
  assert.deepEqual(result.textOverflow, [], `No clipped text: ${JSON.stringify(result)}`)
  assert.equal(result.targets.length, 3, 'The phone link and both legal links must render')
  for (const target of result.targets) {
    assert.ok(target.width >= 43.99 && target.height >= 43.99, `44px target required: ${JSON.stringify({ ...result, targets: [target] })}`)
  }
}
console.log(`Passed ${results.length} phone viewport/text cases; no forms submitted.`)
