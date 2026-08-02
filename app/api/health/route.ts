import { ADS_CONVERSION_SEND_TO } from "@/lib/measurement"

export const dynamic = "force-dynamic"

export function GET() {
  const quoteEmailConfigured = Boolean(
    process.env.RESEND_API_KEY?.trim() &&
      process.env.QUOTE_FROM_EMAIL?.trim() &&
      process.env.QUOTE_TO_EMAIL?.trim()
  )
  const adsConversionConfigured = Boolean(ADS_CONVERSION_SEND_TO)
  const analyticsMeasurementConfigured = Boolean(
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim()
  )
  const launchGatePassed = quoteEmailConfigured && adsConversionConfigured

  return Response.json(
    {
      ok: launchGatePassed,
      service: "music-city-specialty-welding-website",
      leadsAccepted: quoteEmailConfigured,
      email: {
        configured: quoteEmailConfigured,
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
          ? "Quote delivery and Ads conversion configuration are present."
          : "Quote delivery or Ads conversion configuration is missing.",
      },
    },
    {
      status: launchGatePassed ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  )
}
