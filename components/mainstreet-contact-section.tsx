import { ContactLead } from "@/components/contact-lead"
import { LazyQuoteForm } from "@/components/lazy-quote-form"
import { FALLBACK_SHOP_PHONE_DISPLAY, FALLBACK_SHOP_PHONE_HREF } from "@/lib/shop-phone-shared"

export function MainstreetContact({ phoneHref = FALLBACK_SHOP_PHONE_HREF, phoneDisplay = FALLBACK_SHOP_PHONE_DISPLAY, showActions = true }: { phoneHref?: string; phoneDisplay?: string; showActions?: boolean }) {
  return <section className="ms-contact" id="contact" aria-labelledby="contact-title">
    <ContactLead phoneHref={phoneHref} phoneDisplay={phoneDisplay} showActions={showActions} />
    <LazyQuoteForm phoneHref={phoneHref} phoneDisplay={phoneDisplay} />
  </section>
}
