import Link from "next/link"
import { MoreMenu } from "./more-menu"

export function OpsCompactHeader({ name, role, voiceReady }: { name: string; role: "owner" | "crew"; voiceReady: boolean }) {
  const firstName = name.trim().split(/\s+/)[0] || "Crew"
  return <header className="jobs-topbar">
    <div className="jobs-topbar-inner">
      <Link href="/ops" className="jobs-brand" aria-label="MCSW Jobs home">
        <img
          className="jobs-brand-logo"
          src="/images/optimized/mcs_welding_logo.webp"
          alt="MCS Welding"
          width={72}
          height={48}
          loading="eager"
          decoding="sync"
          fetchPriority="high"
        />
        <strong>Jobs</strong>
      </Link>
      <nav aria-label="Account and more">
        <span className="jobs-person">{firstName}</span>
        <MoreMenu role={role} vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? ""} voiceReady={voiceReady} />
      </nav>
    </div>
  </header>
}
