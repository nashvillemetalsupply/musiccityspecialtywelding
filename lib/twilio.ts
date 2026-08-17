import { createHmac, timingSafeEqual } from "node:crypto"

const DEFAULT_WEBHOOK_BASE_URL = "https://musiccityspecialtywelding.com"

function normalizedE164(value: string | undefined) {
  const raw = value?.trim() ?? ""
  const digits = raw.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`
  return ""
}

function accountCredentialsConfigured() {
  return Boolean(
    /^AC[0-9a-f]{32}$/i.test(process.env.TWILIO_ACCOUNT_SID?.trim() ?? "") &&
      process.env.TWILIO_AUTH_TOKEN?.trim()
  )
}

export function twilioWebhookBaseUrl() {
  const raw =
    process.env.TWILIO_WEBHOOK_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    DEFAULT_WEBHOOK_BASE_URL
  try {
    const parsed = new URL(raw)
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname && parsed.pathname !== "/")
    ) return ""
    return parsed.origin
  } catch {
    return ""
  }
}

export function twilioCallbackUrl(path: string) {
  const base = twilioWebhookBaseUrl()
  if (!base || !path.startsWith("/")) throw new Error("Twilio's HTTPS webhook base URL is not configured.")
  return `${base}${path}`
}

export function isConfiguredTwilioNumber(value: string) {
  const configured = normalizedE164(process.env.TWILIO_PHONE_NUMBER)
  return Boolean(configured && normalizedE164(value) === configured)
}

export function twilioConfigured() {
  return accountCredentialsConfigured() && Boolean(normalizedE164(process.env.TWILIO_PHONE_NUMBER))
}

export function twilioMessagingServiceConfigured() {
  return Boolean(
    accountCredentialsConfigured() &&
      /^MG[0-9a-f]{32}$/i.test(process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() ?? "") &&
      normalizedE164(process.env.TWILIO_PHONE_NUMBER)
  )
}

// Receiving signed messages and delivery receipts is independent of the
// outbound launch switch. STOP and an in-flight status callback must continue
// to land even when customer sending is paused.
export function twilioSmsWebhookConfigured() {
  return twilioConfigured() && Boolean(twilioWebhookBaseUrl())
}

export function twilioPublicNumberEnabled() {
  return process.env.TWILIO_PUBLIC_NUMBER_ENABLED?.trim().toLowerCase() === "true"
}

// Voice credentials can ship before A2P registration. Customer SMS is a
// separate, explicit launch switch so buying the number never activates texts.
export function twilioSmsConfigured() {
  return (
    twilioSmsWebhookConfigured() &&
    twilioMessagingServiceConfigured() &&
    process.env.TWILIO_SMS_ENABLED?.trim().toLowerCase() === "true"
  )
}

export function twilioVerifyConfigured() {
  return Boolean(
    accountCredentialsConfigured() &&
      /^VA[0-9a-f]{32}$/i.test(process.env.TWILIO_VERIFY_SERVICE_SID?.trim() ?? "")
  )
}

export function twilioPhoneLoginConfigured() {
  return twilioVerifyConfigured() || twilioSmsConfigured()
}

export function twilioVoiceConfigured() {
  return Boolean(
    twilioConfigured() &&
      normalizedE164(process.env.OWNER_CELL_PHONE) &&
      twilioWebhookBaseUrl()
  )
}

export function twilioLiveTranscriptionConfigured() {
  return (
    twilioVoiceConfigured() &&
    process.env.TWILIO_LIVE_TRANSCRIPTION_ENABLED?.trim().toLowerCase() === "true"
  )
}

export function twilioLiveTranscriptionStart(input: {
  callSid: string
  direction: "in" | "out"
}) {
  if (!twilioLiveTranscriptionConfigured()) return ""
  const inboundLabel = input.direction === "in" ? "customer" : "shop"
  const outboundLabel = input.direction === "in" ? "shop" : "customer"
  const hints = "gate,frame,panel,width,height,opening,finished dimension,square tube,steel,aluminum,rail,hinge,latch,swing,driveway"
  return (
    `<Start><Transcription ` +
    `name="${escapeXml(`call-sketch-${input.callSid}`)}" ` +
    `statusCallbackUrl="${escapeXml(twilioCallbackUrl("/api/twilio/live-transcript"))}" ` +
    `track="both_tracks" inboundTrackLabel="${inboundLabel}" outboundTrackLabel="${outboundLabel}" ` +
    `transcriptionEngine="deepgram" speechModel="nova-3" languageCode="en-US" ` +
    `partialResults="true" enableAutomaticPunctuation="true" profanityFilter="false" ` +
    `hints="${escapeXml(hints)}" /></Start>`
  )
}

export type TwilioProviderReadiness = {
  checked: boolean
  credentialsValid: boolean
  numberFound: boolean
  voiceCapable: boolean
  smsCapable: boolean
  mmsCapable: boolean
  voiceWebhookMatches: boolean
  voiceFallbackProviderHosted: boolean
  messagingServiceFound: boolean
  messagingInboundWebhookMatches: boolean
  messagingStatusCallbackMatches: boolean
  numberInSenderPool: boolean
}

const EMPTY_PROVIDER_READINESS: TwilioProviderReadiness = {
  checked: false,
  credentialsValid: false,
  numberFound: false,
  voiceCapable: false,
  smsCapable: false,
  mmsCapable: false,
  voiceWebhookMatches: false,
  voiceFallbackProviderHosted: false,
  messagingServiceFound: false,
  messagingInboundWebhookMatches: false,
  messagingStatusCallbackMatches: false,
  numberInSenderPool: false,
}

function sameWebhookUrl(actual: string | undefined, expected: string) {
  try {
    const left = new URL(actual ?? "")
    const right = new URL(expected)
    return left.toString().replace(/\/$/, "") === right.toString().replace(/\/$/, "")
  } catch {
    return false
  }
}

function isProviderHostedFallback(value: string | undefined) {
  try {
    const parsed = new URL(value ?? "")
    return Boolean(
      parsed.protocol === "https:" &&
        parsed.hostname.toLowerCase() === "handler.twilio.com" &&
        /^\/twiml\/EH[0-9a-f]{32}\/?$/i.test(parsed.pathname) &&
        !parsed.search &&
        !parsed.hash
    )
  } catch {
    return false
  }
}

async function twilioApiJson<T>(url: string): Promise<T | null> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? ""
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? ""
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null
    return await response.json() as T
  } catch {
    return null
  }
}

async function inspectTwilioProviderReadiness(): Promise<TwilioProviderReadiness> {
  if (!twilioConfigured() || !twilioWebhookBaseUrl()) return { ...EMPTY_PROVIDER_READINESS }
  const accountSid = process.env.TWILIO_ACCOUNT_SID!.trim()
  const phone = normalizedE164(process.env.TWILIO_PHONE_NUMBER)
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() ?? ""
  const account = await twilioApiJson<{ sid?: string; status?: string }>(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`
  )
  const credentialsValid = account?.sid === accountSid && account.status !== "suspended" && account.status !== "closed"
  if (!credentialsValid) return { ...EMPTY_PROVIDER_READINESS, checked: true }

  const numberList = await twilioApiJson<{
    incoming_phone_numbers?: Array<{
      sid?: string
      phone_number?: string
      voice_url?: string
      voice_method?: string
      voice_fallback_url?: string
      capabilities?: { voice?: boolean; sms?: boolean; mms?: boolean }
    }>
  }>(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phone)}&PageSize=20`)
  const number = numberList?.incoming_phone_numbers?.find((item) => normalizedE164(item.phone_number) === phone)
  const expectedVoiceUrl = twilioCallbackUrl("/api/twilio/voice")

  let messagingServiceFound = false
  let messagingInboundWebhookMatches = false
  let messagingStatusCallbackMatches = false
  let numberInSenderPool = false
  if (/^MG[0-9a-f]{32}$/i.test(messagingServiceSid)) {
    const [service, senders] = await Promise.all([
      twilioApiJson<{
        sid?: string
        inbound_request_url?: string
        inbound_method?: string
        use_inbound_webhook_on_number?: boolean
        status_callback?: string
      }>(
        `https://messaging.twilio.com/v1/Services/${encodeURIComponent(messagingServiceSid)}`
      ),
      twilioApiJson<{ phone_numbers?: Array<{ phone_number?: string }> }>(
        `https://messaging.twilio.com/v1/Services/${encodeURIComponent(messagingServiceSid)}/PhoneNumbers?PageSize=50`
      ),
    ])
    messagingServiceFound = service?.sid === messagingServiceSid
    messagingInboundWebhookMatches = Boolean(
      messagingServiceFound &&
        service?.use_inbound_webhook_on_number === false &&
        sameWebhookUrl(service?.inbound_request_url, twilioCallbackUrl("/api/twilio/sms")) &&
        (service?.inbound_method ?? "POST").toUpperCase() === "POST"
    )
    numberInSenderPool = Boolean(senders?.phone_numbers?.some((item) => normalizedE164(item.phone_number) === phone))
    messagingStatusCallbackMatches = Boolean(
      messagingServiceFound &&
        sameWebhookUrl(service?.status_callback, twilioCallbackUrl("/api/twilio/sms-status"))
    )
  }

  return {
    checked: true,
    credentialsValid,
    numberFound: Boolean(number),
    voiceCapable: Boolean(number?.capabilities?.voice),
    smsCapable: Boolean(number?.capabilities?.sms),
    mmsCapable: Boolean(number?.capabilities?.mms),
    voiceWebhookMatches: Boolean(number && sameWebhookUrl(number.voice_url, expectedVoiceUrl) && (number.voice_method ?? "POST").toUpperCase() === "POST"),
    voiceFallbackProviderHosted: Boolean(number && isProviderHostedFallback(number.voice_fallback_url)),
    messagingServiceFound,
    messagingInboundWebhookMatches,
    messagingStatusCallbackMatches,
    numberInSenderPool,
  }
}

let providerReadinessCache: { checkedAt: number; value: TwilioProviderReadiness } | null = null
let providerReadinessInFlight: Promise<TwilioProviderReadiness> | null = null

/** Read-only provider inspection. It never returns credentials, SIDs, or phone numbers. */
export async function checkTwilioProviderReadiness(): Promise<TwilioProviderReadiness> {
  if (providerReadinessCache && Date.now() - providerReadinessCache.checkedAt < 60_000) {
    return providerReadinessCache.value
  }
  if (providerReadinessInFlight) return providerReadinessInFlight
  providerReadinessInFlight = inspectTwilioProviderReadiness()
    .then((value) => {
      providerReadinessCache = { checkedAt: Date.now(), value }
      return value
    })
    .finally(() => { providerReadinessInFlight = null })
  return providerReadinessInFlight
}

export class TwilioProviderError extends Error {
  constructor(message: string, readonly definitive: boolean) { super(message); this.name = "TwilioProviderError" }
}

export function isDefinitiveTwilioError(error: unknown) {
  return error instanceof TwilioProviderError && error.definitive
}

function isDefinitiveTwilioHttpRejection(status: number) {
  // A request-timeout or server/edge response can arrive after Twilio has
  // accepted the POST. Only an explicit client rejection is safe to retry.
  return status >= 400 && status < 500 && status !== 408
}

function signatureUrl(req: Request) {
  const incoming = new URL(req.url)
  const base = twilioWebhookBaseUrl()
  return base ? `${base}${incoming.pathname}${incoming.search}` : ""
}

export function validateTwilioSignature(req: Request, params: URLSearchParams): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()
  const supplied = req.headers.get("x-twilio-signature")?.trim()
  if (!authToken || !supplied) return false

  let payload = signatureUrl(req)
  if (!payload) return false
  for (const key of [...new Set(params.keys())].sort()) {
    for (const value of params.getAll(key).sort()) payload += `${key}${value}`
  }
  const expected = createHmac("sha1", authToken).update(payload).digest("base64")
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function readTwilioForm(req: Request) {
  const raw = await req.text()
  const params = new URLSearchParams(raw)
  return { params, valid: validateTwilioSignature(req, params) }
}

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

export function twiml(content: string, status = 200) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${content}</Response>`, {
    status,
    headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" },
  })
}

export async function sendSms(input: {
  to: string
  body: string
  statusCallback?: string
}): Promise<{ sid: string; status: string }> {
  if (!twilioSmsConfigured()) throw new Error("Twilio SMS is waiting for A2P approval.")
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim()
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim()
  if (!accountSid || !authToken || !messagingServiceSid) throw new Error("Twilio Messaging Service is not configured.")

  const form = new URLSearchParams({ To: input.to, MessagingServiceSid: messagingServiceSid, Body: input.body })
  if (input.statusCallback) form.set("StatusCallback", input.statusCallback)
  let response: Response
  try {
    response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      cache: "no-store",
    })
  } catch {
    throw new TwilioProviderError("Twilio may have accepted the text, but its response did not return. Check Calls & Messages before retrying.", false)
  }
  const data = (await response.json().catch(() => null)) as {
    sid?: string
    status?: string
    message?: string
  } | null
  if (!response.ok) {
    const definitive = isDefinitiveTwilioHttpRejection(response.status)
    const message = definitive
      ? data?.message || "Twilio rejected the text."
      : `Twilio returned ${response.status} after the text request. It may have been accepted; verify before retrying.`
    throw new TwilioProviderError(message, definitive)
  }
  if (!data?.sid) throw new TwilioProviderError("Twilio responded without a text receipt. Verify before retrying.", false)
  return { sid: data.sid, status: data.status ?? "queued" }
}

async function twilioVerifyPost(path: string, form: URLSearchParams) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim()
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim()
  if (!accountSid || !authToken || !serviceSid) throw new Error("Twilio Verify is not configured.")
  const response = await fetch(
    `https://verify.twilio.com/v2/Services/${encodeURIComponent(serviceSid)}/${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      cache: "no-store",
    }
  )
  const data = (await response.json().catch(() => null)) as { sid?: string; status?: string; message?: string } | null
  return { response, data }
}

export async function startPhoneLoginVerification(phone: string) {
  if (!twilioVerifyConfigured()) throw new Error("Twilio Verify is not configured.")
  const { response, data } = await twilioVerifyPost("Verifications", new URLSearchParams({ To: phone, Channel: "sms" }))
  if (!response.ok || !data?.sid) throw new Error(data?.message || "Twilio could not send the sign-in code.")
}

export async function checkPhoneLoginVerification(phone: string, code: string) {
  if (!twilioVerifyConfigured()) return false
  const { response, data } = await twilioVerifyPost("VerificationCheck", new URLSearchParams({ To: phone, Code: code }))
  if (!response.ok) {
    if (response.status === 400 || response.status === 404) return false
    throw new Error(data?.message || "Twilio could not check the sign-in code.")
  }
  return data?.status === "approved"
}

export async function startVoiceCall(input: { to: string; url: string; statusCallback: string }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim()
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()
  const from = process.env.TWILIO_PHONE_NUMBER?.trim()
  if (!accountSid || !authToken || !from) throw new Error("Twilio Voice is not configured.")
  const form = new URLSearchParams({
    To: input.to,
    From: from,
    Url: input.url,
    Method: "POST",
    StatusCallback: input.statusCallback,
    StatusCallbackMethod: "POST",
  })
  for (const event of ["initiated", "ringing", "answered", "completed"]) {
    form.append("StatusCallbackEvent", event)
  }
  let response: Response
  try {
    response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      cache: "no-store",
    })
  } catch {
    throw new TwilioProviderError("Twilio may have started the call, but its response did not return. Verify before ringing again.", false)
  }
  const data = await response.json().catch(() => null) as { sid?: string; status?: string; message?: string } | null
  if (!response.ok) {
    const definitive = isDefinitiveTwilioHttpRejection(response.status)
    const message = definitive
      ? data?.message || "Twilio rejected the call."
      : `Twilio returned ${response.status} after the call request. It may have been accepted; verify before retrying.`
    throw new TwilioProviderError(message, definitive)
  }
  if (!data?.sid) throw new TwilioProviderError("Twilio responded without a call receipt. Verify before retrying.", false)
  return { sid: data.sid, status: data.status ?? "queued" }
}
