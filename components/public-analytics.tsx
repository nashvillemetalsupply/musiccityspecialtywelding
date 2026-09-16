"use client"

import Script from "next/script"
import { usePathname } from "next/navigation"
import { AttributionTracker } from "@/components/attribution-tracker"
import { DeferredGoogleTag } from "@/components/deferred-google-tag"
import { PhoneClickTracker } from "@/components/phone-click-tracker"
import { META_PIXEL_ID } from "@/lib/measurement"

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
    <Script id="meta-pixel" strategy="afterInteractive">
      {`
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window, document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', '${META_PIXEL_ID}');
        fbq('track', 'PageView');
      `}
    </Script>
    <noscript>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        height="1"
        width="1"
        style={{ display: "none" }}
        src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
        alt=""
      />
    </noscript>
    <AttributionTracker />
    <PhoneClickTracker />
  </>
}
