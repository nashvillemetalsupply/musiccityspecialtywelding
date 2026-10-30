import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { webkit } from 'playwright'

const output = path.resolve('.tmp/round2-cross-engine')
const sourceHash = crypto.createHash('sha256').update(fs.readFileSync('app/ops/leads/[id]/payment-form.tsx')).digest('hex')
const browser = await webkit.launch({ headless: true })
const report = { engine: 'webkit', sourceHash, checks: [], appErrors: [] }
let currentPage
try {
  for (const state of ['failed', 'pending', 'success']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: 'block' })
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== 'http://127.0.0.1:3047' || !['GET', 'HEAD'].includes(request.method()) || !(url.pathname === '/board/qa-polish' || url.pathname.startsWith('/_next/') || /\.(png|webp|svg|ico|woff2?)$/.test(url.pathname))) return route.abort()
      return route.continue()
    })
    const page = await context.newPage()
    currentPage = page
    await page.addInitScript(() => {
      window.__qaPaymentSubmissions = []
      window.addEventListener('qa-payment-action', event => window.__qaPaymentSubmissions.push(event.detail))
    })
    page.on('pageerror', error => report.appErrors.push({ state, error: String(error) }))
    await page.goto(`http://127.0.0.1:3047/board/qa-polish?surface=payment-check&state=${state}`, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-payment-source-sha]').waitFor()
    await page.locator('[data-qa-hydrated="true"]').waitFor()
    assert.equal(await page.locator('[data-payment-source-sha]').getAttribute('data-payment-source-sha'), sourceHash)
    const payment = page.locator('.job-payment-form'), reversal = page.locator('.job-payment-reversal')
    const submissions = async () => page.evaluate(() => window.__qaPaymentSubmissions)
    if (state !== 'success') {
      await payment.locator('[name="paymentAmount"]').fill('125.25')
      await payment.locator('[name="paymentMethod"]').selectOption('check')
      await payment.locator('[name="settles"]').check()
      await payment.getByRole('button', { name: 'Record payment', exact: true }).click()
      await page.waitForFunction(() => window.__qaPaymentSubmissions.length === 1)
      if (state === 'pending') {
        assert.equal(await payment.locator('[name="paymentAmount"]').evaluate(el => el.readOnly), true)
        assert.equal(await payment.locator('[name="paymentMethod"]').isDisabled(), true)
        assert.equal(await reversal.getByRole('button').isDisabled(), true)
      }
      assert.equal((await submissions())[0].values.settles, '1')
      assert.equal((await submissions())[0].values.paymentMethod, 'check')
      if (state === 'failed') {
        await payment.getByRole('alert').waitFor()
        assert.equal(await payment.locator('[name="paymentAmount"]').inputValue(), '125.25')
        assert.equal(await payment.locator('[name="paymentMethod"]').inputValue(), 'check')
        assert.equal(await payment.locator('[name="settles"]').isChecked(), true)
        await reversal.locator('[name="reversalAmount"]').fill('35.50')
        await reversal.locator('[name="reason"]').fill('Correct duplicate cash receipt')
        const key = await reversal.locator('[name="reversalKey"]').inputValue()
        await reversal.getByRole('button').click()
        await reversal.getByRole('alert').waitFor()
        assert.equal(await reversal.locator('[name="reversalAmount"]').inputValue(), '35.50')
        assert.equal(await reversal.locator('[name="reason"]').inputValue(), 'Correct duplicate cash receipt')
        assert.equal(await reversal.locator('[name="reversalKey"]').inputValue(), key)
        assert.equal(await payment.locator('[name="paymentAmount"]').inputValue(), '125.25')
      }
    } else {
      const keys = []
      for (const amount of ['20.00', '30.00']) {
        keys.push(await reversal.locator('[name="reversalKey"]').inputValue())
        await reversal.locator('[name="reversalAmount"]').fill(amount)
        await reversal.locator('[name="reason"]').fill(`Refund ${amount}`)
        await reversal.getByRole('button').click()
        await page.waitForFunction(count => window.__qaPaymentSubmissions.length === count, keys.length)
        await page.waitForFunction(() => document.querySelector('[name="reversalAmount"]').value === '')
        assert.equal(await reversal.locator('[name="reason"]').inputValue(), '')
      }
      assert.notEqual(keys[0], keys[1])
      assert.deepEqual((await submissions()).map(item => item.values.reversalKey), keys)
      assert.notEqual(await reversal.locator('[name="reversalKey"]').inputValue(), keys[1])
      await payment.locator('[name="paymentAmount"]').fill('75.00')
      await payment.locator('[name="paymentMethod"]').selectOption('card')
      await payment.locator('[name="settles"]').check()
      await payment.getByRole('button', { name: 'Record payment', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('[name="paymentAmount"]').value === '')
      assert.equal(await payment.locator('[name="paymentMethod"]').inputValue(), 'cash')
      assert.equal(await payment.locator('[name="settles"]').isChecked(), false)
    }
    await page.screenshot({ path: path.join(output, `webkit-payment-${state}.jpg`), fullPage: true, type: 'jpeg', quality: 85 })
    report.checks.push({ state, passed: true, submissions: await submissions() })
    await context.close()
  }
} catch (error) {
  report.failure = error.stack || String(error); process.exitCode = 1
  if (currentPage) {
    await currentPage.screenshot({ path: path.join(output, 'payment-failure-diagnostic.jpg'), fullPage: true })
    report.dom = await currentPage.evaluate(() => ({ text: document.body.innerText, fields: [...document.querySelectorAll('input,select,textarea')].map(el => ({ name: el.name, value: el.value, disabled: el.disabled, readOnly: el.readOnly, valid: el.validity.valid })) }))
  }
}
finally {
  await browser.close()
  fs.writeFileSync(path.join(output, 'payment-check.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
