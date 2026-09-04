"use client"

import Script from "next/script"
import { usePathname } from "next/navigation"
import { AttributionTracker } from "@/components/attribution-tracker"
import { DeferredGoogleTag } from "@/components/deferred-google-tag"
import { PhoneClickTracker } from "@/components/phone-click-tracker"

function isPrivateSurface(pathname: string) {
  return ["/ops", "/board", "/j", "/design-preview"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export function PublicAnalytics({ measurementId }: { measurementId?: string }) {
  const pathname = usePathname() || ""
  if (isPrivateSurface(pathname)) return null

  return <>
    <Script id="google-tag" strategy="afterInteractive">
      {`
        (function(){
          var params = new URLSearchParams(window.location.search);
          if (params.get('utm_source') === 'internal-verify' || params.get('utm_medium') === 'e2e') return;
          window.dataLayer = window.dataLayer || [];
          window.gtag = window.gtag || function(){window.dataLayer.push(arguments);};
          window.gtag('js', new Date());
          window.gtag('config', 'GT-TWZ9WFGX');
          window.gtag('config', 'AW-17817632790');
          ${measurementId ? `window.gtag('config', ${JSON.stringify(measurementId)});` : ""}
        })();
      `}
    </Script>
    <DeferredGoogleTag containerId="GT-TWZ9WFGX" />
    <AttributionTracker />
    <PhoneClickTracker />
  </>
}
