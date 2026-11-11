"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { usePathname } from "next/navigation"
import {
  acceptChatReply, CHAT_MESSAGE_LIMIT, CHAT_TURN_LIMIT,
  prepareChatRequest, readChatDraft, readChatSession, writeChatDraft, writeChatSession, type ChatSession,
} from "@/lib/assistant/chat-client.ts"
import { ASSISTANT_SHOP_EMAIL, ASSISTANT_QUOTE_FORM } from "@/lib/assistant/contact.ts"
import styles from "./assistant-chat.module.css"

type Props = { phoneHref: string; phoneDisplay: string; initialOpen?: boolean; initialFocus?: HTMLElement | null; launcherHidden?: boolean }
const GREETING = "I'm the automated shop assistant. What needs welding?"
const REPLY_UNCONFIRMED = "The reply couldn't be confirmed. You can reach the shop directly."

// This contact surface needs no API response, model output, or browser storage.
export function AssistantContactFallback({ phoneHref, phoneDisplay, onCallback }: Props & { onCallback?: () => void }) {
  return <div role="alert" className={styles.error}>
    <p>{REPLY_UNCONFIRMED}</p>
    <p><a className={styles.call} href={phoneHref}>Call the shop · {phoneDisplay}</a></p>
    <p className={styles.assistant}><a href={ASSISTANT_QUOTE_FORM} onClick={onCallback}>Leave your number for a callback request.</a></p>
    <p className={styles.assistant}><a href={`mailto:${ASSISTANT_SHOP_EMAIL}`}>{ASSISTANT_SHOP_EMAIL}</a></p>
  </div>
}

export async function requestAssistantReply(payload: { session_id: string; turn_index: number; message: string }, request: typeof fetch = fetch) {
  try {
    const response = await request("/api/assist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(45_000),
    })
    const result = await response.json() as { ok?: boolean; reply?: string; lead_saved?: boolean }
    if (!response.ok || result.ok !== true || typeof result.reply !== "string" || !result.reply.trim()) throw new Error(REPLY_UNCONFIRMED)
    return { reply: result.reply, lead_saved: result.lead_saved === true }
  } catch {
    // HTML outage pages, provider messages and network errors share the static
    // contact path. No server-controlled error text is displayed to customers.
    throw new Error(REPLY_UNCONFIRMED)
  }
}

function browserStorage() {
  try { return window.sessionStorage } catch { return null }
}

export function AssistantReply({ text, phoneHref, onCallback }: { text: string; phoneHref: string; onCallback?: () => void }) {
  // Only the shop's approved contact destinations can become clickable.
  return text.split(/(\[[^\]]{1,100}\]\([^)]{1,120}\))/g).map((part, index) => {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    return link && (link[2] === phoneHref || link[2] === `mailto:${ASSISTANT_SHOP_EMAIL}` || link[2] === ASSISTANT_QUOTE_FORM)
      ? <a key={index} href={link[2]} onClick={link[2] === ASSISTANT_QUOTE_FORM ? onCallback : undefined}>{link[1]}</a>
      : <span key={index}>{part}</span>
  })
}

function ChatDoor({ phoneHref, phoneDisplay, initialOpen = false, initialFocus = null, launcherHidden = false }: Props) {
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState<ChatSession | null>(null)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const sessionRef = useRef<ChatSession | null>(null)
  const draftRef = useRef("")
  const sendingRef = useRef(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(initialFocus)
  const restoreFocusRef = useRef(true)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && !dialogRef.current?.open) {
      dialogRef.current?.showModal()
      inputRef.current?.focus()
    } else if (!open && dialogRef.current?.open) {
      dialogRef.current.close()
    }
  }, [open])

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }) }, [session, busy, error])

  const openChat = useCallback(() => {
    restoreFocusRef.current = true
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      returnFocusRef.current = document.activeElement
    }
    const remembered = sessionRef.current
    const current = remembered ?? readChatSession(browserStorage(), () => crypto.randomUUID())
    const restoredDraft = current.pending ?? (remembered ? draftRef.current : readChatDraft(browserStorage()))
    sessionRef.current = current
    setSession(current)
    draftRef.current = restoredDraft
    setDraft(restoredDraft)
    setOpen(true)
  }, [])

  useEffect(() => {
    window.addEventListener("ms:open-assistant", openChat)
    return () => window.removeEventListener("ms:open-assistant", openChat)
  }, [openChat])

  useEffect(() => { if (initialOpen) openChat() }, [initialOpen, openChat])

  function saveSession(value: ChatSession) {
    sessionRef.current = value
    writeChatSession(browserStorage(), value)
    setSession(value)
  }

  function closeForQuote() {
    restoreFocusRef.current = false
    setOpen(false)
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sendingRef.current || !sessionRef.current) return
    let request
    try { request = prepareChatRequest(sessionRef.current, draft) }
    catch (failure) { setError((failure as Error).message); return }
    // Save retry identity before fetch. A timeout or reload reuses this turn.
    saveSession(request.session)
    draftRef.current = request.session.pending ?? ""
    setDraft(draftRef.current)
    sendingRef.current = true
    setBusy(true)
    setError("")
    try {
      const result = await requestAssistantReply(request.payload)
      saveSession(acceptChatReply(request.session, result.reply, result.lead_saved === true))
      draftRef.current = ""
      setDraft("")
      writeChatDraft(browserStorage(), "")
    } catch {
      setError(REPLY_UNCONFIRMED)
    } finally {
      sendingRef.current = false
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  const atLimit = (session?.nextTurn ?? 0) >= CHAT_TURN_LIMIT
  return (
    <>
      <aside className={`${styles.launcher}${launcherHidden ? ` ${styles.launcherHidden}` : ""}`} aria-label="Contact the welding shop" aria-hidden={launcherHidden || undefined}>
        <button className="ms-button ms-button-secondary" ref={launcherRef} type="button" tabIndex={launcherHidden ? -1 : undefined} onClick={openChat} aria-haspopup="dialog" aria-controls="shop-assistant" aria-expanded={open}>Ask the shop</button>
      </aside>
      <dialog ref={dialogRef} id="shop-assistant" className={styles.dialog} aria-labelledby="shop-assistant-title"
        onCancel={() => setOpen(false)}
        onClose={() => {
          setOpen(false)
          if (!restoreFocusRef.current) return
          if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true })
          else launcherRef.current?.focus({ preventScroll: true })
        }}>
        <div className={styles.panel}>
          <header className={styles.header}>
            <div><span>Music City Specialty Welding</span><h2 id="shop-assistant-title">Tell us the job.</h2></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close shop assistant">×</button>
          </header>
          <a className={`${styles.call} ms-button ms-button-primary`} href={phoneHref}>Call the shop · {phoneDisplay}</a>
          <div className={styles.messages} role="log" aria-live="polite" aria-relevant="additions" aria-label="Chat with the automated shop assistant">
            <p className={styles.assistant}>{GREETING}</p>
            {session?.messages.map((message, index) => (
              <p key={index} className={message.role === "user" ? styles.customer : styles.assistant}>
                <span className={styles.byline}>{message.role === "user" ? "You" : "Automated assistant"}</span>
                <AssistantReply text={message.content} phoneHref={phoneHref} onCallback={closeForQuote} />
              </p>
            ))}
            {session?.pending && <p className={styles.customer}><span className={styles.byline}>You · awaiting reply</span>{session.pending}</p>}
            {busy && <p role="status" className={styles.status}>Reading your message…</p>}
            {session?.leadSaved && <p className={styles.status}>Your callback request is saved for the shop.</p>}
            {error && <AssistantContactFallback phoneHref={phoneHref} phoneDisplay={phoneDisplay} onCallback={closeForQuote} />}
            {atLimit && !error && <AssistantContactFallback phoneHref={phoneHref} phoneDisplay={phoneDisplay} onCallback={closeForQuote} />}
            <div ref={endRef} />
          </div>
          <form onSubmit={sendMessage} className={styles.form} aria-busy={busy}>
            <label htmlFor="shop-assistant-message">{session?.pending ? "Message awaiting reply" : "Your message"}</label>
            <textarea ref={inputRef} id="shop-assistant-message" value={draft} onChange={(event) => {
              const value = event.target.value.slice(0, CHAT_MESSAGE_LIMIT)
              draftRef.current = value
              setDraft(value)
              writeChatDraft(browserStorage(), value)
            }}
              maxLength={CHAT_MESSAGE_LIMIT} rows={2} required readOnly={busy || session?.pending != null} disabled={atLimit}
              aria-describedby="shop-assistant-help" />
            <div className={styles.formActions}>
              <p id="shop-assistant-help">{atLimit ? "Please call the shop to keep going." : session?.pending ? "Retry sends this same message." : "Tell us the job and a number to call. The shop gives prices and dates."}</p>
              <button type="submit" disabled={busy || atLimit || !draft.trim()}>{busy ? "Sending…" : session?.pending ? "Retry" : "Send"}</button>
            </div>
          </form>
        </div>
      </dialog>
    </>
  )
}

function PublicChat(props: Props) {
  const pathname = usePathname()
  if (!pathname || ["/ops", "/board", "/j", "/design-preview"].some((path) => pathname === path || pathname.startsWith(`${path}/`))) return null
  return <ChatDoor {...props} />
}

export function AssistantChat(props: Props) {
  if (process.env.NEXT_PUBLIC_ASSISTANT_CHAT !== "1") return null
  return <PublicChat {...props} />
}
