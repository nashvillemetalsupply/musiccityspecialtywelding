import { ADS_CONVERSION_SEND_TO } from "@/lib/measurement"

export const dynamic = "force-dynamic"

async function hasWorkingResendCredential(apiKey: string) {
  try {
    const response = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function GET() {
  const resendApiKey = process.env.RESEND_API_KEY?.trim() || ""
  const quoteEmailConfigured = Boolean(
    resendApiKey &&
      process.env.QUOTE_FROM_EMAIL?.trim() &&
      process.env.QUOTE_TO_EMAIL?.trim()
  )
  const quoteEmailCredentialValid = quoteEmailConfigured
    ? await hasWorkingResendCredential(resendApiKey)
    : false
  const adsConversionConfigured = Boolean(ADS_CONVERSION_SEND_TO)
  const analyticsMeasurementConfigured = Boolean(
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim()
  )
  const launchGatePassed = quoteEmailConfigured && quoteEmailCredentialValid && adsConversionConfigured

  return Response.json(
    {
      ok: launchGatePassed,
      service: "music-city-specialty-welding-website",
      leadsAccepted: quoteEmailConfigured && quoteEmailCredentialValid,
      email: {
        configured: quoteEmailConfigured,
        credentialValid: quoteEmailCredentialValid,
      },
      googleAds: {
        conversionConfigured: adsConversionConfigured,
      },
      googleAnalytics: {
        measurementConfigured: analyticsMeasurementConfigured,
      },
      reviews: {
        googleReviewUrlConfigured: false,
      },
      launchGate: {
        passed: launchGatePassed,
        detail: launchGatePassed
          ? "Quote delivery credential and Ads conversion configuration passed."
          : "Quote delivery credential or Ads conversion configuration failed.",
      },
    },
    {
      status: launchGatePassed ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  )
}
