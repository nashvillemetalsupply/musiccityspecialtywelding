import Link from "next/link"
import { randomUUID } from "node:crypto"
import { redirect } from "next/navigation"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { voiceTranscriptionConfigured } from "@/lib/voice-transcription"
import { InlineJobIntake } from "../inline-job-intake"

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
  return <main className="jobs-intake-page jobs-intake-parity">
    <Link className="jobs-intake-back" href="/ops">Back to Jobs</Link>
    <InlineJobIntake
      initialSource={source}
      intakeKey={randomUUID()}
      owner={operator.role === "owner"}
      voiceReady={voiceTranscriptionConfigured()}
    />
  </main>
}
