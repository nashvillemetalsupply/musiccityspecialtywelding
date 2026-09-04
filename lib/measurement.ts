export const ADS_CONVERSION_SEND_TO =
  process.env.NEXT_PUBLIC_GOOGLE_ADS_SEND_TO?.trim() ||
  "AW-17817632790/CZF4CMyQhPEbEJaAjrBC"

export const GA_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() || ""

// The shop's busiest channel is the phone: 30 leads in the eleven days from
// 2026-08-24 were almost all calls, and Google Ads recorded none of them,
// because a tel: tap reaches GA4 only. Set this once a "Calls from website
// visits" conversion action exists in account 747-818-3137 and the tap becomes
// a bidding signal; empty until then, and the tap stays GA4-only.
export const ADS_PHONE_CONVERSION_SEND_TO =
  process.env.NEXT_PUBLIC_GOOGLE_ADS_PHONE_SEND_TO?.trim() || ""
