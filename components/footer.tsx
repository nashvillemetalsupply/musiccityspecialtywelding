import Image from "next/image"
import Link from "next/link"
import { getShopPhone } from "@/lib/shop-contact"

export function Footer({ home = false }: { home?: boolean }) {
  const shopPhone = getShopPhone()
  return (
    <footer className={home ? "ms-footer" : "ms-site ms-footer"}>
      <div className="ms-footer-mark">
        <Image src="/images/optimized/mcs_welding_logo.webp" alt="Music City Specialty Welding" width={240} height={160} sizes="96px" unoptimized />
        <p className="ms-display">Built here.<br />Fixed where it sits.</p>
      </div>
      <div className="ms-footer-contact">
        <div className="ms-footer-call">
          <strong>Phone</strong>
          <a href={shopPhone.href}>{shopPhone.display}</a>
        </div>
        <a href="mailto:sales@musiccityspecialtywelding.com">sales@musiccityspecialtywelding.com</a>
        <span>533 W Baddour Pkwy<br />Lebanon, TN 37087</span>
        <span>Serving Greater Nashville and Middle Tennessee.</span>
        <span>Music City Specialty Welding is operated by Neverlift Chassis Works,&nbsp;LLC.</span>
      </div>
      <div className="ms-footer-meta">
        <span>© {new Date().getFullYear()} Music City Specialty Welding</span>
        <div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><a href="https://www.facebook.com/profile.php?id=939156675945316" target="_blank" rel="noreferrer">Facebook</a></div>
      </div>
    </footer>
  )
}
