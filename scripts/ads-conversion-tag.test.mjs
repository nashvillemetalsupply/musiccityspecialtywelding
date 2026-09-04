import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

const AW_CONTAINER = "AW-17817632790"
const SEND_TO = "AW-17817632790/CZF4CMyQhPEbEJaAjrBC"

test("the shipped conversion label is the one the Ads conversion action listens on", () => {
  const measurement = source("lib/measurement.ts")
  assert.match(
    measurement,
    new RegExp(`process\\.env\\.NEXT_PUBLIC_GOOGLE_ADS_SEND_TO[^\\n]*\\n\\s*"${SEND_TO}"`),
    `lib/measurement.ts must fall back to ${SEND_TO}; a wrong label sends every conversion to a dead destination and looks exactly like a dead tag.`,
  )
})

test("the page configures the Ads container", () => {
  const analytics = source("components/public-analytics.tsx")
  assert.ok(
    analytics.includes(`window.gtag('config', '${AW_CONTAINER}')`),
    `public-analytics.tsx must configure ${AW_CONTAINER}. Without that config gtag still exists and the base tag still pings Google, but every conversion event is dropped.`,
  )
})

test("the inline tag script declares nothing at classic-script top level", () => {
  const analytics = source("components/public-analytics.tsx")
  const start = analytics.indexOf('<Script id="google-tag"')
  assert.notEqual(start, -1, "The inline google-tag Script is gone.")
  const body = analytics.slice(start, analytics.indexOf("</Script>", start))
  // An inline <script> shares the global lexical scope. A top-level const or
  // let throws "Identifier has already been declared" if the script ever parses
  // twice, and a failed parse discards the entire body -- including the AW
  // config -- with no error on the page you are looking at. An IIFE cannot.
  assert.ok(body.includes("(function(){"), "The inline tag body must be wrapped in an IIFE.")
  for (const line of body.split("\n")) {
    const code = line.trim()
    if (/^(const|let)\s/.test(code)) {
      assert.fail(`Top-level ${code.split(" ")[0]} in the inline tag script: ${code}`)
    }
  }
})

test("an accepted quote fires the Ads conversion", () => {
  const contact = source("components/mainstreet-contact.tsx")
  const accepted = contact.indexOf("data?.accepted !== true")
  assert.notEqual(accepted, -1, "The accepted-lead guard is gone.")
  const fire = contact.indexOf("if (ADS_CONVERSION_SEND_TO)")
  assert.ok(fire > accepted, "The conversion must fire after the lead is accepted, not before.")
  const call = contact.slice(fire, fire + 240)
  assert.ok(
    call.includes('queueMeasurementEvent("conversion", { send_to: ADS_CONVERSION_SEND_TO })'),
    "The conversion event must send to ADS_CONVERSION_SEND_TO.",
  )
})

test("a conversion is never dropped because gtag has not defined itself yet", () => {
  // GA4 recorded enhanced-measurement form_start on 2026-08-25, 27 and 28 and
  // zero generate_lead -- including the day lead #161 saved. Enhanced
  // measurement comes from gtag.js and needs no shim; these events did, and
  // `window.gtag &&` turned a missing shim into a permanent, silent loss.
  const measurement = source("lib/measurement.ts")
  assert.ok(
    measurement.includes("export function queueMeasurementEvent"),
    "queueMeasurementEvent must exist.",
  )
  assert.ok(
    measurement.includes("target.dataLayer = target.dataLayer || []"),
    "The queue must create dataLayer rather than assume it.",
  )
  for (const path of ["components/mainstreet-contact.tsx", "components/phone-click-tracker.tsx"]) {
    const body = source(path)
    assert.ok(
      !/window\.gtag/.test(body.replace(/gtag\?: \(/g, "")),
      `${path} must not read window.gtag directly; a falsy read drops the conversion for good.`,
    )
    assert.ok(body.includes("queueMeasurementEvent"), `${path} must queue its events.`)
  }
})

test("the internal-verification guard never disables the tag for ordinary traffic", () => {
  // utm_source=internal-verify and utm_medium=e2e switch the tag off by design,
  // so the shop's own end-to-end walk cannot bill a conversion. That guard must
  // stay narrow: any broader condition silently turns real visitors into
  // untracked ones, which is invisible from the site itself.
  for (const path of ["components/public-analytics.tsx", "components/deferred-google-tag.tsx"]) {
    const body = source(path)
    const guards = [...body.matchAll(/utm_(source|medium)'?"?\)? ?===? ?'([^']+)'/g)].map((m) => m[2])
    for (const value of guards) {
      assert.ok(
        ["internal-verify", "e2e"].includes(value),
        `${path} gates the tag on utm value "${value}"; only internal-verify and e2e may.`,
      )
    }
  }
})

test("health reports how long the public quote form has been silent", () => {
  const health = source("app/api/health/route.ts")
  assert.ok(
    health.includes("last_web_quote_at"),
    "checkDatabase must read the last web quote; only /api/quote writes landing_page.",
  )
  assert.ok(health.includes("webQuoteSilent"), "The health payload must expose webQuoteSilent.")
  assert.ok(
    health.includes("WEB_QUOTE_SILENCE_LIMIT_HOURS = 96"),
    "The silence limit must stay at 96 hours; the outage it was written for ran 264.",
  )
  const monitor = source(".github/workflows/health-monitor.yml")
  assert.ok(
    monitor.includes("webQuoteSilent"),
    "The health monitor must fail on quote-form silence, or nothing reads the field.",
  )
  assert.ok(
    monitor.includes("verify-ads-tag.mjs"),
    "The health monitor must run the live Ads tag probe.",
  )
})

test("a limited-signal ad click is still filed as paid", () => {
  // lib/leads.ts reaches the database at import time, so pin the rule on the
  // source rather than loading the module.
  const leads = source("lib/leads.ts")
  assert.ok(leads.includes('"gbraid="'), "gbraid must count as an ad click.")
  assert.ok(leads.includes('"wbraid="'), "wbraid must count as an ad click.")
  assert.ok(
    leads.includes("landingPageIsAdClick(input.landingPage ?? \"\")"),
    "deriveLeadSource must fall back to the landing page when gclid is absent.",
  )
})

test("a phone tap can carry an Ads conversion", () => {
  const measurement = source("lib/measurement.ts")
  assert.ok(
    measurement.includes("NEXT_PUBLIC_GOOGLE_ADS_PHONE_SEND_TO"),
    "The phone conversion label must be configurable.",
  )
  const tracker = source("components/phone-click-tracker.tsx")
  assert.ok(
    tracker.includes('queueMeasurementEvent("conversion", { send_to: ADS_PHONE_CONVERSION_SEND_TO })'),
    "A tel: tap must fire the Ads conversion when the label is set.",
  )
  assert.ok(
    tracker.includes("if (ADS_PHONE_CONVERSION_SEND_TO)"),
    "The phone conversion must stay off until a label exists.",
  )
})
