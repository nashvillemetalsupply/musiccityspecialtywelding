import Image from "next/image"
import Link from "next/link"
import { Phone } from "lucide-react"
import { MainstreetMenu } from "@/components/mainstreet-menu"
import { getShopPhone } from "@/lib/shop-contact"

export function Navbar() {
  const shopPhone = getShopPhone()
  return (
    <header className="ms-site ms-nav" aria-label="Main navigation">
      <Link className="ms-brand" href="/">
        <span className="ms-brand-badge">
          <Image
            src="/images/optimized/mcs_welding_logo.webp"
            alt=""
            width={240}
            height={160}
            sizes="64px"
            unoptimized
          />
        </span>
        <span className="ms-brand-words">
          <strong>Music City</strong>
          <span>Specialty Welding</span>
        </span>
      </Link>

      <nav className="ms-nav-links" aria-label="Desktop navigation">
        <Link href="/#work">The work</Link>
        <Link href="/#services">What we weld</Link>
        <Link href="/#job-glass">Customer Page</Link>
        <Link href="/#contact">Show us the job</Link>
      </nav>

      <a className="ms-nav-call" href={shopPhone.href}>
        <Phone aria-hidden="true" />
        <span><small>Open 24/7</small>{shopPhone.display}</span>
      </a>

      <MainstreetMenu homeHref="/" phoneHref={shopPhone.href} phoneDisplay={shopPhone.display} />
    </header>
  )
}
