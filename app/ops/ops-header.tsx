import Link from "next/link"
import { SkipLink } from "../board/skip-link"
import { MoreMenu } from "./more-menu"

export function OpsCompactHeader({ name, role, voiceReady }: { name: string; role: "owner" | "crew"; voiceReady: boolean }) {
  const firstName = name.trim().split(/\s+/)[0] || "Crew"
  return <header className="ops-top">
    <SkipLink />
    <div className="ops-top-inner">
      <Link href="/ops" className="ops-logo-home" aria-label="MCSW Jobs home">
        <img
          className="ops-logo"
          src="/images/optimized/mcs_welding_logo.webp"
          alt="MCS Welding"
          width={72}
          height={48}
          loading="eager"
          decoding="sync"
          fetchPriority="high"
        />
      </Link>
      <nav aria-label="Account and menu">
        <span className="ops-person">{firstName}</span>
        <MoreMenu role={role} vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? ""} voiceReady={voiceReady} />
      </nav>
    </div>
  </header>
}
