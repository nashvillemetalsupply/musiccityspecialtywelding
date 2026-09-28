import Image from "next/image"
import Link from "next/link"
import { ShopCrest } from "@/components/weldment"
import { getShopPhone } from "@/lib/shop-contact"

export function Footer({ home = false }: { home?: boolean }) {
  const shopPhone = getShopPhone()
  return (
    <footer className={home ? "ms-footer" : "ms-site ms-footer"}>
      {home && <ShopCrest className="wm-art wm-crest" style={{ width: "7.5rem", top: "2.6rem", right: "6%", opacity: 0.35 }} />}
      <div className="ms-footer-mark">
        <Image src="/images/optimized/mcs_welding_logo.webp" alt="Music City Specialty Welding" width={240} height={160} sizes="96px" unoptimized />
        <p className="ms-display">Built here.<br />Fixed where it sits.</p>
      </div>
      <div className="ms-footer-contact">
        <div className="ms-footer-call">
          <strong>Open 24/7</strong>
          <a href={shopPhone.href}>Call the shop · {shopPhone.display}</a>
        </div>
        <a href="mailto:sales@musiccityspecialtywelding.com">sales@musiccityspecialtywelding.com</a>
        <span>533 W Baddour Pkwy<br />Lebanon, TN 37087</span>
        <span>Music City Specialty Welding is operated by Neverlift Chassis Works, LLC.</span>
      </div>
      <div className="ms-footer-meta">
        <span>© {new Date().getFullYear()} Music City Specialty Welding</span>
        <div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><a href="https://www.facebook.com/people/Music-City-Specialty-Welding/61585337136685/" target="_blank" rel="noreferrer">Facebook</a></div>
      </div>
    </footer>
  )
}
