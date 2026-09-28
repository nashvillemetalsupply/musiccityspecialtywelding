import Image from "next/image"
import Link from "next/link"
import { Phone } from "lucide-react"
import { MainstreetMenu } from "@/components/mainstreet-menu"
import { PublicSkipLink } from "@/components/public-skip-link"
import { getShopPhone } from "@/lib/shop-contact"

export function Navbar({ home = false }: { home?: boolean }) {
  const shopPhone = getShopPhone()
  return (
    <>
      {home && <PublicSkipLink label="Skip to the work" />}
      <header className={home ? "ms-nav" : "ms-site ms-nav"} aria-label="Main navigation">
        {!home && <PublicSkipLink />}
        <Link className="ms-brand" href={home ? "#home" : "/"}>
          <span className="ms-brand-badge">
            <Image
              src="/images/optimized/mcs_welding_logo.webp"
              alt=""
              width={240}
              height={160}
              loading={home ? "eager" : undefined}
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
          <Link href={`${home ? "" : "/"}#work`}>The work</Link>
          <Link href={`${home ? "" : "/"}#services`}>What we weld</Link>
          <Link href={`${home ? "" : "/"}#job-glass`}>Customer Page</Link>
          <Link href={`${home ? "" : "/"}#contact`}>Show us the job</Link>
        </nav>

        <a className="ms-nav-call" href={shopPhone.href}>
          <Phone aria-hidden="true" />
          <span><small>Open 24/7</small>{shopPhone.display}</span>
        </a>

        <MainstreetMenu homeHref={home ? "" : "/"} phoneHref={shopPhone.href} phoneDisplay={shopPhone.display} />
      </header>
    </>
  )
}
