import Image from "next/image"
import Link from "next/link"
import { Phone } from "lucide-react"
import { MainstreetMenu } from "@/components/mainstreet-menu"

export function Navbar() {
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
        <Link href="/#contact">Show us the job</Link>
      </nav>

      <a className="ms-nav-call" href="tel:6158104910">
        <Phone aria-hidden="true" />
        <span><small>Open 24/7</small>(615) 810-4910</span>
      </a>

      <MainstreetMenu homeHref="/" />
    </header>
  )
}
