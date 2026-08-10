"use server"

import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { createOrReuseQuoteGlassLink, hashGlassToken, revokeGlassLinks, rotateGlassLink } from "@/lib/glass"
import { recordEvent } from "@/lib/events"
import { deliverGlassClipboard, glassUrl } from "@/lib/glass-delivery"
import { twilioSmsConfigured } from "@/lib/twilio"

export type GlassActionState = { url: string; error: string; message: string; smsReady: boolean; needsReplacement: boolean }
export type GlassSendState = { message: string; error: string }

export async function hangGlassClipboard(state: GlassActionState, formData: FormData): Promise<GlassActionState> {
  const operator = await getAuthenticatedOperator()
  if (!operator) return { ...state, error: "Sign in again.", message: "" }
  if (operator.role !== "owner") return { ...state, error: "Only the owner can manage a Customer Page.", message: "" }
  const leadId = Number(formData.get("leadId"))
  if (!Number.isInteger(leadId) || leadId <= 0) return { ...state, error: "Job not found.", message: "", smsReady: twilioSmsConfigured() }
  const intent = String(formData.get("intent") ?? "hang")
  const smsReady = twilioSmsConfigured()
  try {
    if (intent === "revoke") {
      const revoked = await revokeGlassLinks(leadId, operator.id)
      return { url: "", error: "", message: revoked ? "Customer Page closed. The old link no longer works." : "No active Customer Page was found.", smsReady, needsReplacement: false }
    }
    const token = intent === "rotate" ? await rotateGlassLink(leadId, operator.id) : await createOrReuseQuoteGlassLink(leadId, operator.id)
    const url = glassUrl(token)
    if (intent !== "rotate") await recordEvent({ kind: "glass.created", actorType: "operator", actorId: operator.id, leadId, externalId: `glass-created:${hashGlassToken(token)}`, body: "Customer Page created" })
    return { url, error: "", message: intent === "rotate" ? "New link created. The old link no longer works." : "", smsReady, needsReplacement: false }
  } catch (error) {
    return {
      url: state.url,
      error: error instanceof Error ? error.message : "Customer Page could not be created.",
      message: "",
      smsReady,
      needsReplacement: state.needsReplacement,
    }
  }
}

export async function sendGlassClipboard(_state: GlassSendState, formData: FormData): Promise<GlassSendState> {
  const operator = await getAuthenticatedOperator()
  if (!operator) return { message: "", error: "Sign in again." }
  if (operator.role !== "owner") return { message: "", error: "Only the owner can send a Customer Page." }
  const leadId = Number(formData.get("leadId"))
  const url = String(formData.get("url") ?? "").trim()
  const token = url.match(/\/j\/([a-f0-9]{64})/i)?.[1] ?? ""
  if (!Number.isInteger(leadId) || leadId <= 0 || !token) return { message: "", error: "Customer Page link is invalid." }
  try {
    const result = await deliverGlassClipboard({ token, leadId, operatorId: operator.id })
    return { message: result.alreadySent ? "Already sent from the shop number." : "Sent from the shop number.", error: "" }
  } catch (error) {
    return { message: "", error: error instanceof Error ? error.message : "Customer Page text failed." }
  }
}
