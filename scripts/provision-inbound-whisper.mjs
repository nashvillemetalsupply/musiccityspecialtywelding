#!/usr/bin/env node

/**
 * Provision the owner-only inbound call cue as a dedicated Twilio-hosted asset.
 *
 * Dry-run: node scripts/provision-inbound-whisper.mjs
 * Apply:   node scripts/provision-inbound-whisper.mjs --apply
 *
 * The script never changes the phone number or Shop Brain webhook. Activation
 * remains a separate Vercel environment change after the returned URL passes
 * validation. Removing TWILIO_INBOUND_WHISPER_URL is the instant rollback.
 */

const APPLY = process.argv.includes("--apply")
const SERVICE_NAME = "mcsw-inbound-call-cue"
const SERVICE_LABEL = "Music City Welding inbound call cue"
const ASSET_LABEL = "Inbound business call whisper"
const ENVIRONMENT_NAME = "production"
const DOMAIN_SUFFIX = "prod"
const ASSET_PATH = "/inbound-whisper.xml"
const TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Music City Specialty Welding business call.</Say></Response>'

if (!APPLY) {
  console.log(JSON.stringify({
    mode: "dry-run",
    changes: [
      `ensure dedicated Twilio Service ${SERVICE_NAME}`,
      `ensure public static asset ${ASSET_PATH}`,
      `ensure ${ENVIRONMENT_NAME} environment and deploy a verified build`,
    ],
    activation: "Set the returned HTTPS URL as TWILIO_INBOUND_WHISPER_URL only after verification.",
    rollback: "Remove TWILIO_INBOUND_WHISPER_URL; ordinary direct forwarding remains the fallback.",
  }, null, 2))
  process.exit(0)
}

const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? ""
const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? ""
if (!/^AC[0-9a-f]{32}$/i.test(accountSid) || !authToken) {
  throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required. No provider changes were made.")
}

const authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: authorization, ...(options.headers ?? {}) },
  })
  const raw = await response.text()
  let payload = null
  try { payload = raw ? JSON.parse(raw) : null } catch { payload = null }
  if (!response.ok) {
    const message = payload?.message || payload?.detail || `Twilio returned HTTP ${response.status}`
    throw new Error(String(message).slice(0, 500))
  }
  return payload
}

function formBody(values) {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) body.append(key, String(value))
  return body
}

async function postForm(url, values) {
  return requestJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody(values),
  })
}

async function waitForBuild(serviceSid, buildSid) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const result = await requestJson(`https://serverless.twilio.com/v1/Services/${serviceSid}/Builds/${buildSid}/Status`)
    const status = String(result?.status ?? result?.build_status ?? "").toLowerCase()
    if (["completed", "ready"].includes(status)) return
    if (["failed", "error"].includes(status)) throw new Error(`Twilio build ${buildSid} failed.`)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`Twilio build ${buildSid} did not finish within 60 seconds.`)
}

async function assetIsReady(url) {
  try {
    const response = await fetch(url, { redirect: "error" })
    if (!response.ok) return false
    return (await response.text()).replace(/\s+/g, "") === TWIML.replace(/\s+/g, "")
  } catch {
    return false
  }
}

async function verifyAsset(url) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await assetIsReady(url)) return
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error("The deployed Twilio asset did not return the expected static TwiML within 30 seconds.")
}

const servicesResult = await requestJson("https://serverless.twilio.com/v1/Services?PageSize=1000")
let service = servicesResult?.services?.find((item) => item.unique_name === SERVICE_NAME)
if (!service) {
  service = await postForm("https://serverless.twilio.com/v1/Services", {
    FriendlyName: SERVICE_LABEL,
    UniqueName: SERVICE_NAME,
    IncludeCredentials: false,
    UiEditable: true,
  })
}

const serviceSid = String(service.sid)
const [assetsResult, environmentsResult] = await Promise.all([
  requestJson(`https://serverless.twilio.com/v1/Services/${serviceSid}/Assets?PageSize=1000`),
  requestJson(`https://serverless.twilio.com/v1/Services/${serviceSid}/Environments?PageSize=1000`),
])

let asset = assetsResult?.assets?.find((item) => item.friendly_name === ASSET_LABEL)
if (!asset) {
  asset = await postForm(`https://serverless.twilio.com/v1/Services/${serviceSid}/Assets`, { FriendlyName: ASSET_LABEL })
}

let environment = environmentsResult?.environments?.find((item) => item.unique_name === ENVIRONMENT_NAME)
if (!environment) {
  environment = await postForm(`https://serverless.twilio.com/v1/Services/${serviceSid}/Environments`, {
    UniqueName: ENVIRONMENT_NAME,
    DomainSuffix: DOMAIN_SUFFIX,
  })
}

const whisperUrl = `https://${environment.domain_name}${ASSET_PATH}`
if (await assetIsReady(whisperUrl)) {
  console.log(JSON.stringify({ status: "already-ready", whisperUrl, serviceSid, environmentSid: environment.sid }, null, 2))
  process.exit(0)
}

const upload = new FormData()
upload.append("Path", ASSET_PATH)
upload.append("Visibility", "public")
upload.append("Content", new Blob([TWIML], { type: "application/xml" }), "inbound-whisper.xml")
const assetVersion = await requestJson(
  `https://serverless-upload.twilio.com/v1/Services/${serviceSid}/Assets/${asset.sid}/Versions`,
  { method: "POST", body: upload },
)

const buildBody = new URLSearchParams()
buildBody.append("AssetVersions", String(assetVersion.sid))
const build = await requestJson(`https://serverless.twilio.com/v1/Services/${serviceSid}/Builds`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: buildBody,
})
await waitForBuild(serviceSid, String(build.sid))

const deployment = await postForm(
  `https://serverless.twilio.com/v1/Services/${serviceSid}/Environments/${environment.sid}/Deployments`,
  { BuildSid: build.sid },
)
await verifyAsset(whisperUrl)

console.log(JSON.stringify({
  status: "provisioned",
  whisperUrl,
  serviceSid,
  assetSid: asset.sid,
  assetVersionSid: assetVersion.sid,
  environmentSid: environment.sid,
  buildSid: build.sid,
  deploymentSid: deployment.sid,
}, null, 2))
