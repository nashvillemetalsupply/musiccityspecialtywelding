import {
  FALLBACK_SHOP_PHONE_DISPLAY,
  FALLBACK_SHOP_PHONE_E164,
  type ShopPhone,
} from "@/lib/shop-phone-shared"
import { twilioPublicNumberEnabled, twilioSmsConfigured, twilioVoiceConfigured } from "@/lib/twilio"

function normalizedConfiguredPhone() {
  if (!twilioPublicNumberEnabled() || !twilioVoiceConfigured()) return FALLBACK_SHOP_PHONE_E164
  const digits = (process.env.TWILIO_PHONE_NUMBER ?? "").replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return FALLBACK_SHOP_PHONE_E164
}

function displayPhone(e164: string) {
  const digits = e164.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return e164 || FALLBACK_SHOP_PHONE_DISPLAY
}

// One env change moves every customer-facing surface to the tracking number.
export function getShopPhone(): ShopPhone {
  const e164 = normalizedConfiguredPhone()
  const publicNumberEnabled = twilioPublicNumberEnabled() && twilioVoiceConfigured() && e164 !== FALLBACK_SHOP_PHONE_E164
  return {
    e164,
    display: displayPhone(e164),
    href: `tel:${e164}`,
    smsHref: `sms:${e164}`,
    publicNumberEnabled,
    voiceReady: publicNumberEnabled,
    textReady: publicNumberEnabled && twilioSmsConfigured(),
    isFallback: !publicNumberEnabled,
  }
}
