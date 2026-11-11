import { Phone } from "lucide-react"
import { AskShopButton } from "@/components/shop-actions"

export type ContactLeadProps = { phoneHref: string; phoneDisplay: string; showActions?: boolean }

// Shared pure markup keeps the server section and compatibility client export
// identical, with the existing Ask interaction isolated in its client leaf.
export function ContactLead({ phoneHref, phoneDisplay, showActions = true }: ContactLeadProps) {
  return <div className="ms-contact-lead">
    <h2 className="ms-display" id="contact-title">Show us the job.</h2>
    <p>24/7. Call the shop or send the details below for a free estimate. Photos help us see what needs welding.</p>
    <p>Bringing work to the shop? Bring it by any time. Calling ahead helps us be ready for you.</p>
    {showActions && <div className="ms-actions">
      <a className="ms-contact-call ms-button ms-button-primary" href={phoneHref}>
        <Phone aria-hidden="true" />
        <span>Call the shop</span>
      </a>
      <AskShopButton />
    </div>}
    <p className="ms-contact-number">{phoneDisplay}</p>
  </div>
}
