import Image from "next/image"
import Link from "next/link"
import { getShopPhone } from "@/lib/shop-contact"

export function Footer() {
  const shopPhone = getShopPhone()
  return (
    <footer className="ms-site ms-footer">
      <div className="ms-footer-mark">
        <Image src="/images/optimized/mcs_welding_logo.webp" alt="Music City Specialty Welding" width={240} height={160} sizes="96px" unoptimized />
        <p className="ms-display">Built here.<br />Fixed where it sits.</p>
      </div>
      <div className="ms-footer-contact">
        <div className="ms-footer-call">
          <strong>Open 24/7</strong>
          <a href={shopPhone.href}>Call the shop · {shopPhone.display}</a>
        </div>
        <a href="mailto:Sales@musiccityspecialtywelding.com">Sales@musiccityspecialtywelding.com</a>
        <span>533 W Baddour Pkwy<br />Lebanon, TN 37087</span>
      </div>
      <div className="ms-footer-meta">
        <span>© {new Date().getFullYear()} Music City Specialty Welding</span>
        <div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><a href="https://www.facebook.com/people/Music-City-Specialty-Welding/61585337136685/" target="_blank" rel="noreferrer">Facebook</a></div>
      </div>
    </footer>
  )
}
