import { put } from "@vercel/blob"
import { readableEmailText, stripQuotedReply } from "@/lib/gmail-plaintext.mjs"

type GmailPart = { mimeType?: string; filename?: string; body?: { data?: string; attachmentId?: string; size?: number }; parts?: GmailPart[]; headers?: Array<{ name: string; value: string }> }
export type GmailMessage = { id: string; threadId: string; historyId: string; internalDate: string; labelIds?: string[]; payload: GmailPart; snippet?: string }

export function gmailConfigured() {
  return Boolean(process.env.GMAIL_CLIENT_ID?.trim() && process.env.GMAIL_CLIENT_SECRET?.trim() && process.env.GMAIL_REFRESH_TOKEN?.trim())
}

function decode(data = "") { return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64") }
export function gmailHeaders(message: GmailMessage) { return Object.fromEntries((message.payload.headers ?? []).map((h) => [h.name.toLowerCase(), h.value])) }
export function gmailHeaderValues(message: GmailMessage, name: string) {
  const wanted = name.trim().toLowerCase()
  return (message.payload.headers ?? []).filter((header) => header.name.trim().toLowerCase() === wanted).map((header) => header.value)
}
function walk(part: GmailPart): GmailPart[] { return [part, ...(part.parts ?? []).flatMap(walk)] }
export function gmailAttachmentDescriptors(message: GmailMessage) {
  return walk(message.payload).flatMap((part, index) => {
    if (!part.filename || (!part.body?.attachmentId && !part.body?.data)) return []
    return [{
      key: part.body.attachmentId || `inline:${index}:${part.filename}`,
      filename: part.filename,
      contentType: part.mimeType || "application/octet-stream",
      attachmentId: part.body.attachmentId || "",
      inlineData: part.body.data || "",
      size: part.body.size ?? 0,
    }]
  })
}
export function gmailPlaintext(message: GmailMessage) {
  const parts = walk(message.payload)
  const plain = parts.find((part) => part.mimeType === "text/plain" && part.body?.data)
  const html = parts.find((part) => part.mimeType === "text/html" && part.body?.data)
  const raw = decode(plain?.body?.data || html?.body?.data || "").toString("utf8")
  const freshHtml = plain ? raw : raw.split(/<(?:div|blockquote)[^>]+(?:gmail_quote|divRplyFwdMsg)[^>]*>/i)[0]
  return stripQuotedReply(readableEmailText(freshHtml))
}
export function emailAddress(value = "") { return (value.match(/<([^>]+)>/)?.[1] || value).trim().toLowerCase() }
export function emailName(value = "") { return (value.split("<")[0] || "").replace(/^"|"$/g, "").trim() }

export async function gmailAccessToken() {
  const form = new URLSearchParams({ client_id: process.env.GMAIL_CLIENT_ID!, client_secret: process.env.GMAIL_CLIENT_SECRET!, refresh_token: process.env.GMAIL_REFRESH_TOKEN!, grant_type: "refresh_token" })
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form, cache: "no-store" })
  const data = await response.json() as { access_token?: string; error_description?: string }
  if (!response.ok || !data.access_token) throw new Error(data.error_description || "Gmail authorization failed.")
  return data.access_token
}
async function gmailFetch<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
  if (!response.ok) throw Object.assign(new Error(`Gmail API ${response.status}`), { status: response.status })
  return response.json() as Promise<T>
}
export async function getGmailMessage(token: string, id: string) { return gmailFetch<GmailMessage>(token, `messages/${encodeURIComponent(id)}?format=full`) }
export async function listGmailMessageIds(token: string, historyId?: string | null) {
  const ids = new Set<string>()
  let pageToken = ""
  let latestHistoryId: string | null = null
  let pages = 0
  if (historyId) {
    do {
      const data = await gmailFetch<{ historyId: string; nextPageToken?: string; history?: Array<{ messagesAdded?: Array<{ message: { id: string } }> }> }>(token, `history?startHistoryId=${encodeURIComponent(historyId)}&historyTypes=messageAdded&maxResults=500${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`)
      for (const id of (data.history ?? []).flatMap((h) => h.messagesAdded ?? []).map((item) => item.message.id)) ids.add(id)
      latestHistoryId = data.historyId
      pageToken = data.nextPageToken ?? ""
      pages += 1
    } while (pageToken && pages < 20)
    if (pageToken) throw new Error("Gmail history exceeded the safe 10,000-message sync cap; state was not advanced.")
    return { ids: [...ids], historyId: latestHistoryId }
  }
  do {
    const data = await gmailFetch<{ messages?: Array<{ id: string }>; nextPageToken?: string; resultSizeEstimate?: number }>(token, `messages?q=newer_than%3A7d&maxResults=500${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`)
    for (const message of data.messages ?? []) ids.add(message.id)
    pageToken = data.nextPageToken ?? ""
    pages += 1
  } while (pageToken && pages < 20)
  if (pageToken) throw new Error("Gmail fallback exceeded the safe 10,000-message sync cap; state was not advanced.")
  return { ids: [...ids], historyId: null }
}
export async function getMailboxHistoryId(token: string) { return (await gmailFetch<{ historyId: string }>(token, "profile")).historyId }
export async function storeGmailAttachments(token: string, message: GmailMessage, leadId: number) {
  const stored: Array<{ pathname: string; name: string; contentType: string; size: number }> = []
  for (const part of walk(message.payload)) {
    if (!part.filename || (!part.body?.attachmentId && !part.body?.data)) continue
    const data = part.body.attachmentId
      ? await gmailFetch<{ data: string; size: number }>(token, `messages/${message.id}/attachments/${part.body.attachmentId}`)
      : { data: part.body.data ?? "", size: part.body.size ?? 0 }
    const bytes = decode(data.data)
    if (bytes.byteLength > 20 * 1024 * 1024) continue
    const name = part.filename.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 140) || "attachment"
    const blob = await put(`leads/${leadId}/email/${message.id}/${name}`, bytes, { access: "private", contentType: part.mimeType || "application/octet-stream", allowOverwrite: true })
    stored.push({ pathname: blob.pathname, name, contentType: part.mimeType || "application/octet-stream", size: bytes.byteLength })
  }
  return stored
}
