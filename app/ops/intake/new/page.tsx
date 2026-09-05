import Link from "next/link"
import { randomUUID } from "node:crypto"
import { redirect } from "next/navigation"
import "../intake.css"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { voiceTranscriptionConfigured } from "@/lib/voice-transcription"
import { InlineJobIntake } from "../inline-job-intake"

export const metadata = { title: "New job · MCSW Jobs" }

export const dynamic = "force-dynamic"

export default async function NewJobIntakePage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>
}) {
  const operator = await getAuthenticatedOperator()
  if (!operator) redirect("/ops")
  const query = await searchParams
  const source = query.source === "walk-in" ? "walk-in" : "phone-in"
  return <div className="intake-page">
    <Link className="btn btn--sm btn--edge intake-back" href="/ops">Back to Jobs</Link>
    <InlineJobIntake
      initialSource={source}
      intakeKey={randomUUID()}
      owner={operator.role === "owner"}
      voiceReady={voiceTranscriptionConfigured()}
    />
  </div>
}
