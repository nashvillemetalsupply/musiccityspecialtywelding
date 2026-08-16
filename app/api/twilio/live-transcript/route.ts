import { recordLiveTranscriptionEvent } from "@/lib/call-sketch-store"
import { processEvent } from "@/lib/extract"
import { readTwilioForm } from "@/lib/twilio"
import { after } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const EVENTS = new Set([
  "transcription-started",
  "transcription-content",
  "transcription-stopped",
  "transcription-error",
])

function finiteNumber(value: string | null) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export async function POST(req: Request) {
  const { params, valid } = await readTwilioForm(req)
  if (!valid) return new Response("", { status: 403, headers: { "Cache-Control": "no-store" } })
  const callSid = params.get("CallSid") ?? ""
  const transcriptionSid = params.get("TranscriptionSid") ?? ""
  const event = params.get("TranscriptionEvent") ?? ""
  const sequenceId = Number(params.get("SequenceId"))
  if (!/^CA[0-9a-f]{32}$/i.test(callSid) || !/^GT[0-9a-f]{32}$/i.test(transcriptionSid) || !EVENTS.has(event)) {
    return new Response("", { status: 400, headers: { "Cache-Control": "no-store" } })
  }
  if (!Number.isInteger(sequenceId) || sequenceId < 0) {
    return new Response("", { status: 400, headers: { "Cache-Control": "no-store" } })
  }
  try {
    const result = await recordLiveTranscriptionEvent({
      callSid,
      transcriptionSid,
      event,
      sequenceId,
      track: params.get("Track") ?? "",
      timestamp: params.get("Timestamp") ?? "",
      transcriptionData: params.get("TranscriptionData") ?? "",
      final: params.get("Final")?.toLowerCase() === "true",
      stability: finiteNumber(params.get("Stability")),
    })
    if (result?.transcriptEventId) {
      after(() => processEvent(result.transcriptEventId!).catch((error) => console.error("Live transcript extraction failed:", error)))
    }
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Live transcription callback failed:", error)
    return new Response("", { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
