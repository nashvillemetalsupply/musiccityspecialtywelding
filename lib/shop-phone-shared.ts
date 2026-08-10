export const FALLBACK_SHOP_PHONE_E164 = "+16158104910"
export const FALLBACK_SHOP_PHONE_DISPLAY = "(615) 810-4910"
export const FALLBACK_SHOP_PHONE_HREF = `tel:${FALLBACK_SHOP_PHONE_E164}`

export type ShopPhone = {
  e164: string
  display: string
  href: string
  smsHref: string
  publicNumberEnabled: boolean
  voiceReady: boolean
  textReady: boolean
  isFallback: boolean
}
