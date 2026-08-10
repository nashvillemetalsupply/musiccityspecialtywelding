import Link from "next/link"
import { redirect } from "next/navigation"
import { getCallIntakeDraft } from "@/lib/job-intake"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { voiceTranscriptionConfigured } from "@/lib/voice-transcription"
import { InlineJobIntake } from "../inline-job-intake"

export const dynamic = "force-dynamic"

export default async function CallIntakePage({ params }: { params: Promise<{ draftId: string }> }) {
  const operator = await getAuthenticatedOperator()
  if (!operator) redirect("/ops")
  const { draftId } = await params
  const draft = await getCallIntakeDraft(draftId)
  if (!draft || draft.status === "dismissed") redirect("/ops")
  if (draft.status === "saved" && draft.lead_id) redirect(`/ops/leads/${draft.lead_id}`)

  return <main className="jobs-intake-page jobs-intake-parity">
    <Link className="jobs-intake-back" href="/ops">Back to Jobs</Link>
    <InlineJobIntake
      intakeKey={`call-${draft.public_id}`}
      owner={operator.role === "owner"}
      voiceReady={voiceTranscriptionConfigured()}
      draft={{
        publicId: draft.public_id,
        name: draft.caller_name,
        phone: draft.phone,
        need: draft.need,
        callStatus: draft.call_status,
        createdAt: draft.created_at,
        lastError: draft.last_error,
      }}
    />
  </main>
}
