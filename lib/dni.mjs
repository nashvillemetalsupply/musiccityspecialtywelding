// Dynamic number insertion: one extra Twilio number per paid channel, so a
// phone call from an ad can be attributed at all. A form carries gclid; a call
// carries nothing but the number that was dialled, which is why the board has
// been able to say "calls not yet attributed" and nothing better.
//
// Inbound only. Everything the shop SENDS still goes out from the main number,
// so a customer's thread stays one thread.
//
// NEXT_PUBLIC_ because the number is printed on the page -- a number the shop
// advertises is not a secret -- and because one variable read by both halves
// cannot disagree with itself the way a public/private pair can.
export const DNI_CHANNELS = ["google", "facebook"]

// Next inlines process.env.NEXT_PUBLIC_* only where it is written out as a
// literal property access, so this map cannot be built from a loop.
const RAW = {
  google: process.env.NEXT_PUBLIC_TWILIO_PHONE_NUMBER_GOOGLE,
  facebook: process.env.NEXT_PUBLIC_TWILIO_PHONE_NUMBER_FACEBOOK,
}

export function normalizedE164(value) {
  const raw = value?.trim() ?? ""
  const digits = raw.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`
  return ""
}

// Empty until the owner buys the number and sets the variable. Every caller
// treats empty as "this channel has no tracking number", so the whole feature
// is inert rather than half-on.
export function dniNumber(channel) {
  return normalizedE164(RAW[channel])
}

export function dniDisplay(channel) {
  const e164 = dniNumber(channel)
  const digits = e164.replace(/\D/g, "")
  if (digits.length !== 11 || !digits.startsWith("1")) return ""
  return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
}

export function dniConfigured() {
  return DNI_CHANNELS.some((channel) => dniNumber(channel) !== "")
}

// Which channel a call came in on, read from the number it was dialled to.
export function channelForNumber(value) {
  const normalized = normalizedE164(value)
  if (!normalized) return null
  for (const channel of DNI_CHANNELS) {
    if (dniNumber(channel) === normalized) return channel
  }
  return null
}

// Which channel THIS visitor arrived on, so the page can show them that
// channel's number. Mirrors deriveLeadSource's markers: an iOS ad click often
// carries gbraid or wbraid instead of gclid, and lead #161 was filed "direct"
// for exactly that reason.
export function paidChannelForVisit({ gclid = "", utmSource = "", landingPage = "" } = {}) {
  const landing = String(landingPage).toLowerCase()
  const source = String(utmSource).trim().toLowerCase()
  if (gclid || /[?&](gclid|gbraid|wbraid|gad_source)=/.test(landing) || source.startsWith("google")) return "google"
  if (/[?&]fbclid=/.test(landing) || ["facebook", "fb", "meta", "instagram", "ig"].includes(source)) return "facebook"
  return null
}
