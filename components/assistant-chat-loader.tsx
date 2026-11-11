"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { ASSISTANT_QUOTE_FORM, ASSISTANT_SHOP_EMAIL } from "@/lib/assistant/contact.ts"
import styles from "./assistant-chat.module.css"

type Props = { phoneHref: string; phoneDisplay: string }
type ChatModule = typeof import("./assistant-chat")

// One user request owns one module load. A failed load can retry, and a route
// change cancels its UI callbacks without changing the chat's durable session.
export function createAssistantModuleGate<T,>(load: () => Promise<T>, ready: (module: T) => void, failed: () => void) {
  let active = true
  let pending: Promise<void> | null = null
  return {
    open() {
      if (!active) return Promise.resolve()
      if (pending) return pending
      pending = Promise.resolve().then(load).then((module) => {
        if (active) ready(module)
      }).catch(() => {
        pending = null
        if (active) failed()
      })
      return pending
    },
    dispose() { active = false },
  }
}

function PublicChatLoader({ phoneHref, phoneDisplay }: Props) {
  const [Chat, setChat] = useState<ChatModule["AssistantChat"] | null>(null)
  const [requested, setRequested] = useState(false)
  const [failed, setFailed] = useState(false)
  const [openingFocus, setOpeningFocus] = useState<HTMLElement | null>(null)
  const gateRef = useRef<ReturnType<typeof createAssistantModuleGate<ChatModule>> | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  const openChat = useCallback(() => {
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) openerRef.current = document.activeElement
    setOpeningFocus(openerRef.current)
    setRequested(true)
    setFailed(false)
    if (!gateRef.current) {
      gateRef.current = createAssistantModuleGate(() => import("./assistant-chat"),
        (module) => setChat(() => module.AssistantChat), () => setFailed(true))
    }
    void gateRef.current.open()
  }, [])

  function closeLoadingDialog(restoreFocus = true) {
    setRequested(false)
    if (dialogRef.current?.open) dialogRef.current.close()
    if (restoreFocus) {
      if (openerRef.current?.isConnected) openerRef.current.focus({ preventScroll: true })
      else launcherRef.current?.focus({ preventScroll: true })
    }
  }

  useEffect(() => {
    if (Chat) return
    window.addEventListener("ms:open-assistant", openChat)
    return () => window.removeEventListener("ms:open-assistant", openChat)
  }, [Chat, openChat])

  useEffect(() => {
    return () => {
      gateRef.current?.dispose()
      gateRef.current = null
    }
  }, [])

  useEffect(() => {
    if (requested && !Chat && !dialogRef.current?.open) dialogRef.current?.showModal()
    else if ((!requested || Chat) && dialogRef.current?.open) dialogRef.current.close()
  }, [requested, Chat])

  if (Chat) return <Chat phoneHref={phoneHref} phoneDisplay={phoneDisplay} initialOpen={requested} initialFocus={openingFocus} />

  return <>
    <aside className={styles.launcher} aria-label="Contact the welding shop">
      <button className="ms-button ms-button-secondary" ref={launcherRef} type="button" onClick={openChat} aria-haspopup="dialog" aria-controls="shop-assistant" aria-expanded={requested}>Ask the shop</button>
    </aside>
    {!requested && <span id="shop-assistant" hidden />}
    {requested && <dialog id="shop-assistant" className={styles.dialog} ref={dialogRef} aria-labelledby="shop-assistant-loading-title" onCancel={() => closeLoadingDialog()}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <div><span>Music City Specialty Welding</span><h2 id="shop-assistant-loading-title">Tell us the job.</h2></div>
          <button type="button" onClick={() => closeLoadingDialog()} aria-label="Close shop assistant">×</button>
        </header>
        <a className={`${styles.call} ms-button ms-button-primary`} href={phoneHref}>Call the shop · {phoneDisplay}</a>
        <div className={styles.messages}>
          {failed ? <>
            <p role="alert">The chat didn&apos;t load. You can reach the shop directly.</p>
            <p className={styles.assistant}><a href={ASSISTANT_QUOTE_FORM} onClick={() => closeLoadingDialog(false)}>Leave your number for a callback request.</a></p>
            <p className={styles.assistant}><a href={`mailto:${ASSISTANT_SHOP_EMAIL}`}>{ASSISTANT_SHOP_EMAIL}</a></p>
            <button className={styles.retry} type="button" onClick={openChat}>Retry the chat</button>
          </> : <p role="status">Opening the automated shop assistant…</p>}
        </div>
      </div>
    </dialog>}
  </>
}

export function AssistantChatLoader(props: Props) {
  const pathname = usePathname()
  if (process.env.NEXT_PUBLIC_ASSISTANT_CHAT !== "1" || !pathname ||
    ["/ops", "/board", "/j", "/design-preview"].some((path) => pathname === path || pathname.startsWith(`${path}/`))) return null
  return <PublicChatLoader {...props} />
}
