import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { findBoundGa4MeasurementIds } from "./verify-ads-tag.mjs"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

const AW_CONTAINER = "AW-17817632790"
const SEND_TO = "AW-17817632790/CZF4CMyQhPEbEJaAjrBC"
const PHONE_SEND_TO = "AW-17817632790/0aSACPS5ue4cEJaAjrBC"

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
    health.includes("WEB_QUOTE_SILENCE_LIMIT_HOURS = 240"),
    "The silence limit is 240 hours: the form takes about one lead a week, so four days of quiet is normal and reddened the monitor for ten runs straight.",
  )
  const monitor = source(".github/workflows/health-monitor.yml")
  assert.ok(
    monitor.includes("webQuoteSilent"),
    "The health monitor must read quote-form silence, or nothing reads the field.",
  )
  assert.match(
    monitor,
    /::warning::No web quote has reached the database/,
    "Form silence is a warning; inbound-call silence is the red build.",
  )
  assert.ok(
    monitor.includes("verify-ads-tag.mjs"),
    "The health monitor must run the live Ads tag probe.",
  )
})

test("release health gates both Ads destinations and GA4 configuration", () => {
  const health = source("app/api/health/route.ts")
  assert.match(
    health,
    /import \{[^}]*ADS_CONVERSION_SEND_TO[^}]*ADS_PHONE_CONVERSION_SEND_TO[^}]*GA_MEASUREMENT_ID[^}]*\} from "@\/lib\/measurement"/s,
    "Health must use the same public measurement IDs as the browser bundle.",
  )
  for (const gate of [
    "adsConversionConfigured",
    "adsPhoneConversionConfigured",
    "analyticsMeasurementConfigured",
  ]) {
    const launchGateStart = health.indexOf("const launchGatePassed")
    const launchGate = health.slice(launchGateStart, health.indexOf("return Response.json", launchGateStart))
    assert.ok(launchGate.includes(gate), `${gate} must participate in the release gate.`)
  }
  assert.ok(health.includes("phoneConversionSendTo: ADS_PHONE_CONVERSION_SEND_TO"))

  const monitor = source(".github/workflows/health-monitor.yml")
  assert.ok(
    monitor.includes(".googleAds.phoneConversionConfigured == true"),
    "Production verification must fail when the phone Ads destination is missing.",
  )
  assert.ok(
    monitor.includes(".googleAnalytics.measurementConfigured == true"),
    "Production verification must fail when GA4 is missing.",
  )
})

test("the live tag probe checks form, phone, and GA4 runtime wiring", () => {
  const verifier = source("scripts/verify-ads-tag.mjs")
  assert.ok(verifier.includes(PHONE_SEND_TO), "The phone conversion destination must be probed.")
  assert.match(verifier, /G-\[A-Z0-9\]/, "The probe must discover a shipped GA4 measurement ID.")
  assert.ok(
    verifier.includes("GA4") && verifier.includes("gtag config"),
    "The probe must require GA4 runtime config, not merely a G- string elsewhere in the bundle.",
  )
})

test("the live tag probe binds the discovered GA4 ID to its exact config call", () => {
  const html = '<script>self.__next_f.push([1,"{\\"measurementId\\":\\"G-BOUND123\\"}"])</script>'
  const boundBundle = "function({measurementId:e}){return `${e?`window.gtag('config', ${JSON.stringify(e)});`:\"\"}`}"
  assert.deepEqual(findBoundGa4MeasurementIds(html, boundBundle), ["G-BOUND123"])

  const unrelatedHtml = '<script>window.unrelatedMeasurement = "G-STRAY123"</script>'
  const unrelatedBundle = "window.gtag('config', 'GT-CONTAINER1')"
  assert.deepEqual(
    findBoundGa4MeasurementIds(unrelatedHtml, unrelatedBundle),
    [],
    "A stray G-* ID and a different config call must not pass GA4 verification.",
  )

  const wrongBindingBundle = "function({measurementId:e}){return `${e?`window.gtag('config', ${JSON.stringify(other)});`:\"\"}`}"
  assert.deepEqual(
    findBoundGa4MeasurementIds(html, wrongBindingBundle),
    [],
    "The config expression must use the exact variable receiving measurementId.",
  )
})

test("Meta measurement shares verification suppression and queues an early Lead", () => {
  const analytics = source("components/public-analytics.tsx")
  const metaStart = analytics.indexOf('<Script id="meta-pixel"')
  const metaBody = analytics.slice(metaStart, analytics.indexOf("</Script>", metaStart))
  assert.ok(metaBody.includes("internal-verify"), "Meta PageView must ignore internal verification.")
  assert.ok(metaBody.includes("e2e"), "Meta PageView must ignore end-to-end verification.")
  assert.doesNotMatch(
    analytics,
    /facebook\.com\/tr\?[^\n]*noscript/i,
    "A no-script pixel must not bypass internal-verification suppression.",
  )
  assert.ok(
    metaBody.includes("__mcswMetaQueue") && metaBody.includes("fbq.apply"),
    "The Meta bootstrap must drain Leads queued before fbq becomes available.",
  )

  const measurement = source("lib/measurement.ts")
  const reportMetaLead = measurement.slice(measurement.indexOf("export function reportMetaLead"))
  assert.ok(reportMetaLead.includes("internal-verify"), "Meta Lead must ignore internal verification.")
  assert.ok(reportMetaLead.includes("e2e"), "Meta Lead must ignore end-to-end verification.")
  assert.ok(
    reportMetaLead.includes("__mcswMetaQueue") && reportMetaLead.includes('["track", "Lead"]'),
    "A Lead must queue when fbq is temporarily unavailable.",
  )
  assert.doesNotMatch(reportMetaLead, /eventID|receipt/i, "Do not fabricate a Meta provider receipt.")
})

test("privacy copy names Meta measurement without claiming enhanced data sharing", () => {
  const privacy = source("app/privacy/page.tsx")
  assert.match(privacy, /Meta Pixel/)
  assert.match(privacy, /Facebook/)
  assert.match(privacy, /quote request/)
  assert.doesNotMatch(privacy, /enhanced conversions|enhanced data sharing/i)
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
  assert.ok(
    measurement.includes('"AW-17817632790/0aSACPS5ue4cEJaAjrBC"'),
    'The tap must send to "Call tap on website"; a wrong label is a dead destination.',
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
