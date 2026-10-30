// Real HTTP/session/browser checks against the unmodified production Next build.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { chromium } from "playwright"

const file = process.env.MCSW_QA_DATA
const data = JSON.parse(readFileSync(file, "utf8"))
const origin = "http://localhost:3050"
const records = []
const workflows = []
const record = (name, details = {}) => { records.push({ name, passed: true, ...details }); console.log(`PASS ${name}`) }
const workflow = (name, details = {}) => { workflows.push({ name, passed: true, ...details }); console.log(`PASS workflow: ${name}`) }
const request = (pathname, cookie, options = {}) => fetch(origin + pathname, {
  redirect: "manual", ...options, headers: { ...(cookie ? { cookie } : {}), ...options.headers },
})
function sql(query) {
  const result = spawnSync(path.join(process.env.MCSW_POSTGRES_BIN, "psql.exe"),
    ["-h", "127.0.0.1", "-p", String(data.port), "-U", "mcsw_qa", "-d", "mcsw_predeploy", "-v", "ON_ERROR_STOP=1", "-At", "-c", query],
    { encoding: "utf8", windowsHide: true, timeout: 15000 })
  assert.equal(result.status, 0, "Local fixture SQL must succeed")
  return result.stdout.trim()
}
async function login(token) {
  const response = await request(`/api/ops/verify?token=${token}`)
  assert.equal(response.status, 303)
  const header = response.headers.get("set-cookie")
  assert.ok(header)
  assert.match(header, /HttpOnly/)
  assert.match(header, /Secure/)
  assert.match(header, /SameSite=Lax/)
  return header.split(";")[0]
}
let browser
try {
  assert.equal((await request("/api/ops/cache-session")).status, 401)
  assert.equal((await request("/api/ops/export")).status, 401)
  record("signed-out session and export are denied")
  for (const token of ["malformed", data.expired]) {
    const response = await request(`/api/ops/verify?token=${token}`)
    assert.equal(response.status, 303)
    assert.match(response.headers.get("location"), /error=link/)
    assert.equal(response.headers.get("set-cookie"), null)
  }
  record("malformed and expired login links cannot create sessions")
  const owner = await login(data.owner)
  const crew = await login(data.crew)
  record("owner and crew redeem actual one-use links with secure cookie attributes")
  const replay = await request(`/api/ops/verify?token=${data.owner}`)
  assert.match(replay.headers.get("location"), /error=link/)
  assert.equal(replay.headers.get("set-cookie"), null)
  record("consumed login link cannot be replayed")
  const ownerState = await (await request("/api/ops/cache-session", owner)).json()
  const crewState = await (await request("/api/ops/cache-session", crew)).json()
  assert.equal(ownerState.role, "owner")
  assert.equal(crewState.role, "crew")
  assert.notEqual(ownerState.sessionId, crewState.sessionId)
  assert.notEqual(ownerState.voiceScope, crewState.voiceScope)
  assert.equal((await (await request("/api/ops/cache-session", owner)).json()).sessionId, ownerState.sessionId)
  record("actual sessions retain role and distinct cache and voice partitions")
  const ownerJob = await request(`/ops/leads/${data.lead}`, owner)
  const ownerHtml = await ownerJob.text()
  assert.equal(ownerJob.status, 200)
  assert.match(ownerHtml, /OWNER_ONLY_ACCEPTANCE_913579/)
  assert.match(ownerHtml, /Acceptance Gate/)
  const crewJob = await request(`/ops/leads/${data.lead}`, crew)
  const crewHtml = await crewJob.text()
  assert.equal(crewJob.status, 200)
  assert.match(crewHtml, /Acceptance Gate/)
  assert.doesNotMatch(crewHtml, /OWNER_ONLY_ACCEPTANCE_913579|913579|9,135\.79/)
  record("real job HTTP and embedded RSC contain owner facts only for owner")
  const ownerTest = await request(`/ops/leads/${data.testLead}`, owner)
  assert.equal(ownerTest.status, 200)
  assert.match(await ownerTest.text(), /Restricted Gate/)
  const restricted = await request(`/ops/leads/${data.testLead}`, crew)
  const restrictedHtml = await restricted.text()
  assert.doesNotMatch(restrictedHtml, /Restricted Gate/)
  // Next can already have streamed its shell before notFound resolves.
  assert.ok(restricted.status === 404 || /NEXT_HTTP_ERROR_FALLBACK;404|This page could not be found/.test(restrictedHtml))
  record("crew cannot open internal-test job by guessed URL")
  assert.equal((await request("/api/ops/export", owner)).status, 200)
  assert.equal((await request("/api/ops/export", crew)).status, 403)
  assert.equal((await request("/ops/analytics", owner)).status, 200)
  const crewAnalytics = await request("/ops/analytics", crew)
  const analyticsHtml = await crewAnalytics.text()
  assert.ok(crewAnalytics.status === 307 || /NEXT_REDIRECT/.test(analyticsHtml))
  assert.doesNotMatch(analyticsHtml, /class="analytics-page"/)
  record("owner-only export and analytics enforce real session role")
  const settings = await (await request("/ops/shop", crew)).text()
  assert.match(settings, /Owner settings/)
  assert.doesNotMatch(settings, /shop-crew-email/)
  record("crew settings reveal no team-management form")

  const voicePath = "/api/ops/transcribe?id=aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
  const voiceRecovery = await request(voicePath, owner, { headers: { "X-Voice-Operator-Scope": ownerState.voiceScope } })
  assert.equal(voiceRecovery.status, 200)
  assert.equal(voiceRecovery.headers.get("cache-control"), "private, no-store")
  const voiceState = await voiceRecovery.json()
  assert.equal(voiceState.uploadRequired, true)
  assert.equal(voiceState.status, "failed")
  assert.equal(voiceState.transcript, "")
  assert.equal("blob_path" in voiceState, false)
  record("real voice recovery GET identifies missing stored bytes without exposing private paths")
  assert.equal((await request(voicePath)).status, 401)
  const crewVoice = await request(voicePath, crew, { headers: { "X-Voice-Operator-Scope": crewState.voiceScope } })
  assert.equal(crewVoice.status, 404)
  assert.equal((await crewVoice.json()).uploadRequired, undefined)
  record("signed-out and other-operator sessions cannot read the voice intent")
  const staleVoice = await request(voicePath, owner, { headers: { "X-Voice-Operator-Scope": crewState.voiceScope } })
  assert.equal(staleVoice.status, 409)
  assert.equal((await staleVoice.json()).uploadRequired, undefined)
  record("real voice recovery GET rejects a stale operator scope")

  browser = await chromium.launch({ headless: true })
  const errors = [], blocked = []
  for (const role of ["owner", "crew"]) {
    const context = await browser.newContext({ viewport: { width: role === "owner" ? 1440 : 390, height: 900 }, serviceWorkers: "block" })
    await context.route("**/*", (route) => {
      const target = new URL(route.request().url())
      if (target.origin !== origin) { blocked.push(target.hostname); return route.abort() }
      return route.continue()
    })
    const page = await context.newPage()
    page.on("pageerror", (error) => errors.push(String(error)))
    await page.goto(`${origin}/api/ops/verify?token=${data[`${role}Browser`]}`, { waitUntil: "domcontentloaded" })
    const cookie = (await context.cookies()).find((item) => item.name === "mcw_ops_session")
    assert.ok(cookie, "Browser must accept the real Secure cookie on localhost")
    assert.equal(cookie.secure, true)
    await page.goto(`${origin}/board`, { waitUntil: "domcontentloaded" })
    await page.getByText("Acceptance Gate", { exact: false }).first().waitFor()
    await page.screenshot({ path: path.join(path.dirname(file), `${role}-board.png`), fullPage: true })
    await page.goto(`${origin}/ops/leads/${data.lead}`, { waitUntil: "domcontentloaded" })
    await page.getByText("Acceptance Gate", { exact: false }).first().waitFor()
    const content = await page.locator("body").innerText()
    if (role === "owner") assert.match(content, /OWNER_ONLY_ACCEPTANCE_913579/)
    else assert.doesNotMatch(content, /OWNER_ONLY_ACCEPTANCE_913579|913579|9,135\.79/)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false)
    await page.screenshot({ path: path.join(path.dirname(file), `${role}-job.png`), fullPage: true })
    if (role === "owner") {
      await page.goto(`${origin}/ops/intake/new?source=walk-in`, { waitUntil: "domcontentloaded" })
      const customer = "[INTERNAL TEST] HTTP workflow gate"
      const need = "[INTERNAL TEST] Fit the synthetic gate hinge; disposable acceptance only."
      await page.locator('input[name="firstName"]').fill(customer)
      await page.locator('textarea[name="message"]').fill(need)
      // A real operator revocation while an unsaved draft is open produces a
      // real server-action error, without replacing any application behavior.
      sql("UPDATE operators SET active=false WHERE email='owner@acceptance.invalid'")
      await page.getByRole("button", { name: "Save job", exact: true }).click()
      await page.getByText("Not signed in.", { exact: true }).waitFor()
      assert.equal(await page.locator('input[name="firstName"]').inputValue(), customer)
      assert.equal(await page.locator('textarea[name="message"]').inputValue(), need)
      assert.equal(sql("SELECT count(*) FROM leads WHERE first_name='[INTERNAL TEST] HTTP workflow gate'"), "0")
      await page.screenshot({ path: path.join(path.dirname(file), "intake-rejected-draft.png"), fullPage: true })
      workflow("real rejected server action retains the intake draft and writes no job")
      sql("UPDATE operators SET active=true WHERE email='owner@acceptance.invalid'")
      await page.getByRole("button", { name: "Save job", exact: true }).click()
      const openJob = page.getByRole("link", { name: "Open job", exact: true })
      await openJob.waitFor()
      const jobPath = await openJob.getAttribute("href")
      const jobId = Number(jobPath.split("/").at(-1))
      assert.ok(Number.isSafeInteger(jobId) && jobId > 0)
      assert.equal(sql(`SELECT count(*) FROM leads WHERE id=${jobId} AND is_test AND first_name='[INTERNAL TEST] HTTP workflow gate'`), "1")
      assert.equal(sql(`SELECT count(*) FROM events WHERE lead_id=${jobId} AND kind='form.quote' AND is_test`), "1")
      assert.equal(sql(`SELECT count(*) FROM events WHERE lead_id=${jobId} AND NOT is_test`), "0")
      await page.screenshot({ path: path.join(path.dirname(file), "intake-saved-receipt.png"), fullPage: true })
      await openJob.click()
      await page.waitForURL(`${origin}${jobPath}`)
      await page.reload({ waitUntil: "domcontentloaded" })
      await page.getByText(customer, { exact: false }).first().waitFor()
      workflow("real intake submission creates one test job and test journal receipt visible after reload")
      const notes = page.locator('textarea[name="notes"]')
      const drawer = page.locator("details.job-drawer").filter({ has: notes })
      await drawer.locator("summary").click()
      const note = "Acceptance persistence note: synthetic hinge clearance 12 mm."
      await notes.fill(note)
      const saved = page.waitForResponse((response) => response.request().method() === "POST" && response.url() === `${origin}${jobPath}`)
      await page.getByRole("button", { name: "Save notes", exact: true }).click()
      assert.equal((await saved).status(), 200)
      assert.equal(sql(`SELECT notes FROM leads WHERE id=${jobId}`), note)
      assert.equal(sql(`SELECT count(*) FROM events WHERE lead_id=${jobId} AND kind='note.text' AND is_test AND body LIKE '%Acceptance persistence note%'`), "1")
      await page.reload({ waitUntil: "domcontentloaded" })
      assert.equal(await notes.inputValue(), note)
      await drawer.locator("summary").click()
      await page.screenshot({ path: path.join(path.dirname(file), "notes-persisted.png"), fullPage: true })
      workflow("real notes server action persists the note and immutable test receipt across reload")
    }
    await context.close()
    record(`${role} real browser login board and job render`, { width: role === "owner" ? 1440 : 390 })
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(blocked, [])
  record("browser has no application JavaScript error or remote request")

  sql("UPDATE operators SET role='crew' WHERE email='owner@acceptance.invalid'")
  assert.equal((await (await request("/api/ops/cache-session", owner)).json()).role, "crew")
  assert.equal((await request("/api/ops/export", owner)).status, 403)
  record("role downgrade takes effect in existing session")
  sql("UPDATE operators SET active=false WHERE email='crew@acceptance.invalid'")
  assert.equal((await request("/api/ops/cache-session", crew)).status, 401)
  record("deactivated operator cannot reuse existing session")
  const tokenHash = createHash("sha256").update(owner.split("=")[1]).digest("hex")
  sql(`UPDATE ops_tokens SET expires_at=now()-interval '1 second' WHERE token_hash='${tokenHash}'`)
  assert.equal((await request("/api/ops/cache-session", owner)).status, 401)
  record("expired session is rejected by real HTTP endpoint")
  sql("UPDATE operators SET role='owner',active=true WHERE email='owner@acceptance.invalid'; UPDATE operators SET active=true WHERE email='crew@acceptance.invalid'")
  const logout = await request("/api/ops/logout", crew, { method: "POST" })
  assert.equal(logout.status, 303)
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/)
  assert.equal((await request("/api/ops/cache-session", crew)).status, 401)
  record("logout revokes durable session and clears browser cookie")
} finally {
  await browser?.close()
  writeFileSync(path.join(path.dirname(file), "http-browser-results.json"), JSON.stringify({ records, passed: records.length === 19 }, null, 2))
  writeFileSync(path.join(path.dirname(file), "workflow-results.json"), JSON.stringify({ workflows, passed: workflows.length === 3 }, null, 2))
}
