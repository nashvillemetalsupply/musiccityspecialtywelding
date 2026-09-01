import Link from "next/link"
import { MoreMenu } from "@/app/ops/more-menu"
import { voiceTranscriptionConfigured } from "@/lib/voice-transcription"
import "./board-route-nav.css"

export function BoardRouteNav({ role, current }: { role: "owner" | "crew"; current: "customers" | "calls" | "updates" }) {
  return <nav className="board-route-nav" aria-label="Job Control sections">
    <Link href="/board">Jobs</Link>
    <Link href="/ops/intake/new">New job</Link>
    <Link href="/board/updates" aria-current={current === "updates" ? "page" : undefined}>Updates</Link>
    <div className="board-route-menu">
      <MoreMenu role={role} vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? ""} voiceReady={voiceTranscriptionConfigured()} />
    </div>
  </nav>
}
