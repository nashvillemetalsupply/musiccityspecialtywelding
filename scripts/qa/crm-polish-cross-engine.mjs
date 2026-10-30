import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { chromium, firefox, webkit } from 'playwright'

const require = createRequire(import.meta.url)
const engineName = process.argv[2]
if (!['chromium', 'firefox', 'webkit'].includes(engineName)) throw new Error('Select chromium, firefox or webkit; engines run serially.')
const expectedBrowserPath = path.resolve('.tmp/pw-browsers')
if (engineName !== 'chromium' && path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH || '') !== expectedBrowserPath) throw new Error('Use the task-local Playwright browser directory.')
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3047'
if (!/^http:\/\/127\.0\.0\.1:(3047|3048)$/.test(base)) throw new Error('Only isolated local preview origins are permitted.')
const output = path.resolve('.tmp/round2-cross-engine', process.env.QA_VARIANT || '.')
fs.mkdirSync(output, { recursive: true })
const surfaces = ['board', 'job', 'login', 'customers', 'updates', 'builds']
const cases = surfaces.flatMap(surface => [390, 768, 1440].map(width => ({ surface, width, role: 'owner', state: '' })))
cases.push(
  { surface: 'board', width: 320, role: 'owner', state: 'large' },
  { surface: 'board', width: 320, role: 'crew', state: '' },
  { surface: 'job', width: 320, role: 'owner', state: 'failed' },
  { surface: 'job', width: 320, role: 'owner', state: 'pending' },
  { surface: 'login', width: 320, role: 'owner', state: 'failed' },
  { surface: 'customers', width: 320, role: 'owner', state: '' },
  { surface: 'updates', width: 320, role: 'owner', state: 'history' },
  { surface: 'builds', width: 320, role: 'owner', state: 'failed' },
)
if (process.env.QA_CASES) cases.splice(0, cases.length, ...JSON.parse(process.env.QA_CASES))
const browser = await ({ chromium, firefox, webkit })[engineName].launch({ headless: true })
const report = { engine: engineName, version: browser.version(), base, started: new Date().toISOString(), scope: 'Desktop engine with resized viewport; not physical Safari/iPhone testing', cases: [] }

async function audit(page) {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') })
  return page.evaluate(async () => {
    const result = await window.axe.run({ exclude: [['nextjs-portal'], ['[data-qa-tools]'], ['[data-nextjs-dialog]']] }, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })
    return {
      violations: result.violations.map(({ id, impact, help, tags, nodes }) => ({ id, impact, help, tags, nodes: nodes.map(({ target, failureSummary, html }) => ({ target, failureSummary, html })) })),
      incomplete: result.incomplete.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })),
      passed: result.passes.length,
    }
  })
}

async function layout(page) {
  return page.evaluate(() => {
    const visible = element => element instanceof HTMLElement && element.getClientRects().length > 0
      && getComputedStyle(element).visibility === 'visible' && !element.closest('nextjs-portal,[data-qa-tools]')
    const describe = element => {
      const rect = element.getBoundingClientRect(), css = getComputedStyle(element)
      return { tag: element.tagName, id: element.id, class: String(element.className), text: element.textContent?.trim().slice(0, 90),
        x: rect.x, y: rect.y, width: rect.width, height: rect.height, fontSize: css.fontSize, fontFamily: css.fontFamily }
    }
    const intentionalScroller = element => {
      for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        if (['auto', 'scroll'].includes(getComputedStyle(ancestor).overflowX) && ancestor.scrollWidth > ancestor.clientWidth + 2) return true
      }
      return false
    }
    const elements = [...document.body.querySelectorAll('*')].filter(visible)
    return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight, bodyHeight: document.body.getBoundingClientRect().height,
      rootChildren: [...document.documentElement.children].map(element => ({ tag: element.tagName, id: element.id, height: element.getBoundingClientRect().height, top: element.getBoundingClientRect().top })),
      bodyChildren: [...document.body.children].map(element => ({ tag: element.tagName, id: element.id, height: element.getBoundingClientRect().height, top: element.getBoundingClientRect().top })),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      escaped: elements.filter(element => {
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && (rect.x < -1 || rect.right > innerWidth + 1) && !intentionalScroller(element)
      }).map(describe).slice(0, 30),
      clippedControls: elements.filter(element => {
        if (!element.matches('button,input,textarea,select')) return false
        const css = getComputedStyle(element)
        return (['hidden', 'clip'].includes(css.overflowX) && element.scrollWidth > element.clientWidth + 2)
          || (['hidden', 'clip'].includes(css.overflowY) && element.scrollHeight > element.clientHeight + 2)
      }).map(describe),
      fonts: [...document.fonts].map(font => ({ family: font.family, status: font.status })),
      headings: elements.filter(element => element.matches('h1,h2')).map(describe).slice(0, 12) }
  })
}

async function keyboardChecks(page, item, key) {
  const results = {}
  if (process.env.QA_CALENDAR === '1' && item.surface === 'board') {
    const calendar = page.getByRole('group', { name: /calendar$/ })
    const selected = calendar.locator('button[aria-pressed="true"]')
    const before = await selected.getAttribute('aria-label')
    await selected.focus()
    await page.keyboard.press('ArrowRight')
    const next = calendar.locator('button[aria-pressed="true"]')
    results.calendar = { before, after: await next.getAttribute('aria-label'), focused: await next.evaluate(element => document.activeElement === element), controls: await next.getAttribute('aria-controls') }
    results.calendar.targetMatches = await next.evaluate(element => {
      const id = element.getAttribute('aria-controls')
      return Boolean(id && element.closest('section')?.querySelector(`[id="${CSS.escape(id)}"]`))
    })
    results.calendar.currentDateCount = await calendar.locator('button[aria-current="date"]').count()
    results.calendar.weekdayHeaders = await calendar.locator('[class*="weekdays"] > span').allInnerTexts()
    if (item.width <= 480 && (results.calendar.weekdayHeaders.length !== 7 || results.calendar.weekdayHeaders.some(text => text.trim().length !== 2))) throw new Error('Narrow weekday headers are not compact two-letter labels')
    if (results.calendar.currentDateCount !== 1) throw new Error('Today is not uniquely marked with aria-current=date')
    if (results.calendar.before === results.calendar.after || !results.calendar.focused || !results.calendar.targetMatches) throw new Error('Calendar selection, focus, or local agenda target failed')
    await page.keyboard.press('ArrowLeft')
    await calendar.locator('xpath=ancestor::section[1]').screenshot({ path: path.join(output, `${key}-calendar.jpg`), type: 'jpeg', quality: 85, animations: 'disabled' })
  }
  if (item.surface === 'board' && [320, 390].includes(item.width)) {
    const trigger = page.getByRole('button', { name: 'Open menu', exact: true })
    await trigger.click()
    await page.getByRole('dialog', { name: 'Menu', exact: true }).waitFor({ state: 'visible' })
    results.menu = { tabStops: [], escaped: false, initialFocusInside: await page.evaluate(() => Boolean(document.activeElement?.closest('.ops-more-panel'))), coversBottomRail: await page.evaluate(() => Boolean(document.elementFromPoint(innerWidth / 2, innerHeight - 12)?.closest('.ops-more-backdrop'))) }
    for (let index = 0; index < 32; index++) {
      await page.keyboard.press('Tab')
      const focused = await page.evaluate(() => {
        const active = document.activeElement
        return { tag: active?.tagName, text: active?.getAttribute('aria-label') || active?.textContent?.trim().slice(0, 60),
          inside: Boolean(active?.closest('.ops-more-panel')) }
      })
      results.menu.tabStops.push(focused)
      if (!focused.inside) results.menu.escaped = true
    }
    results.menu.axe = await audit(page)
    await page.screenshot({ path: path.join(output, `${key}-menu.jpg`), type: 'jpeg', quality: 80, animations: 'disabled', style: 'nextjs-portal{visibility:hidden!important}' })
    await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: 'Menu', exact: true }).waitFor({ state: 'hidden' })
    results.menu.escapeRestoredFocus = await trigger.evaluate(element => document.activeElement === element)
  }
  if (item.surface === 'job' && item.role === 'owner' && [320, 390].includes(item.width)) {
    await page.getByRole('link', { name: /Edit price:/ }).click()
    const input = page.locator('.job-page [data-job-fragment="lead-estimate"]')
    await input.waitFor({ state: 'visible' })
    await page.waitForFunction(() => document.activeElement?.dataset.jobFragment === 'lead-estimate', null, { timeout: 3000 })
    results.price = await input.evaluate(element => {
      const root = element.closest('.job-page'), label = [...root.querySelectorAll('label')].find(item => item.htmlFor === element.id)
      const header = root.closest('.ops-frame')?.querySelector('.ops-top')?.getBoundingClientRect()
      const dock = root.querySelector('.job-action-spine')?.getBoundingClientRect()
      const rect = element.getBoundingClientRect(), labelRect = label?.getBoundingClientRect()
      return { focused: document.activeElement === element, top: rect.top, bottom: rect.bottom, labelTop: labelRect?.top,
        headerBottom: header?.bottom || 0, dockTop: dock?.top || innerHeight }
    })
    await page.screenshot({ path: path.join(output, `${key}-price.jpg`), type: 'jpeg', quality: 80, animations: 'disabled', style: 'nextjs-portal{visibility:hidden!important}' })
  }
  if (item.surface === 'login' && item.state !== 'failed' && item.width === 390) {
    await page.locator('button[aria-label^="Sign in as"]').first().click()
    await page.getByRole('button', { name: 'Text my code', exact: true }).click()
    const code = page.locator('input[autocomplete="one-time-code"]')
    await code.waitFor({ state: 'visible' })
    await page.waitForFunction(() => document.activeElement?.getAttribute('autocomplete') === 'one-time-code', null, { timeout: 3000 })
    results.login = { codeFocused: await code.evaluate(element => document.activeElement === element) }
    await page.screenshot({ path: path.join(output, `${key}-code.jpg`), type: 'jpeg', quality: 80, animations: 'disabled', style: 'nextjs-portal{visibility:hidden!important}' })
  }
  return results
}

try {
  for (const item of cases.filter(item => !process.env.QA_FILTER || new RegExp(process.env.QA_FILTER).test(item.surface))) {
    const key = `${engineName}-${item.surface}-${item.role}-${item.state || 'normal'}-${item.width}`
    const context = await browser.newContext({ viewport: { width: item.width, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
    const page = await context.newPage()
    const result = { ...item, key, appErrors: [], appErrorStacks: [], consoleErrors: [], blockedRequests: [], navigations: [] }
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) result.navigations.push({ url: frame.url(), time: new Date().toISOString() }) })
    page.on('pageerror', error => { result.appErrors.push(String(error)); result.appErrorStacks.push(error.stack || String(error)) })
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource|blocked|favicon/i.test(message.text())) result.consoleErrors.push(message.text()) })
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url())
      const allowedPath = url.pathname === '/board/qa-polish' || url.pathname.startsWith('/_next/') || url.pathname.startsWith('/images/') || /\.(ico|png|svg|webp|woff2?)$/.test(url.pathname)
      if (url.origin !== base || !['GET', 'HEAD'].includes(request.method()) || !allowedPath) {
        result.blockedRequests.push({ method: request.method(), path: url.pathname })
        return route.abort('blockedbyclient')
      }
      return route.continue()
    })
    try {
      const query = new URLSearchParams({ surface: item.surface, role: item.role, state: item.state })
      const response = await page.goto(`${base}/board/qa-polish?${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      result.httpStatus = response?.status()
      await page.locator('main,.app').first().waitFor({ state: 'visible', timeout: 30000 })
      await page.locator('[data-qa-boundary-hydrated="true"]').waitFor({ state: 'attached', timeout: 30000 })
      if (item.surface === 'login') await page.locator('button[aria-label^="Sign in as"]').first().waitFor({ state: 'visible', timeout: 30000 })
      if (item.surface === 'forms') await page.locator('.intake-form input[name="firstName"]').waitFor({ state: 'visible', timeout: 30000 })
      if (item.surface === 'job') await page.locator('.job-page h1').waitFor({ state: 'visible', timeout: 30000 })
      if (process.env.QA_THEME === 'dark' && item.surface === 'board') {
        if (await page.locator('html').getAttribute('data-theme') !== 'dark') await page.locator('#theme').click()
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
        result.theme = 'dark'
      }
      await page.evaluate(async () => {
        const elements = [...document.querySelectorAll('.app,.job-page,.ops-shell,.customers-page,.updates-page,h1,h2')]
        const families = [...new Set(elements.map(element => getComputedStyle(element).fontFamily))]
        await Promise.all(families.map(family => document.fonts.load(`16px ${family}`)))
        await document.fonts.ready
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      })
      await page.waitForTimeout(350)
      if (item.surface === 'login' && item.state === 'failed') {
        await page.locator('button[aria-label^="Sign in as"]').first().click()
        await page.getByRole('button', { name: 'Text my code', exact: true }).click()
      }
      result.layout = await layout(page)
      result.axe = await audit(page)
      if ([320, 390, 1440].includes(item.width)) {
        result.screenshot = `${key}.jpg`
        await page.screenshot({ path: path.join(output, result.screenshot), type: 'jpeg', quality: 78, fullPage: true, animations: 'disabled', style: 'nextjs-portal{visibility:hidden!important}' })
      }
      result.keyboard = await keyboardChecks(page, item, key)
    } catch (error) { result.failure = String(error) }
    finally { await context.close() }
    report.cases.push(result)
    report.updated = new Date().toISOString()
    fs.writeFileSync(path.join(output, `${engineName}.json`), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ key, status: result.httpStatus, overflow: result.layout?.horizontalOverflow, axe: result.axe?.violations.map(item => item.id), appErrors: result.appErrors, failure: result.failure }))
  }
} finally { await browser.close() }

if (report.cases.some(item => item.failure || item.appErrors.length || item.layout?.horizontalOverflow || item.axe?.violations.length)) process.exitCode = 1
