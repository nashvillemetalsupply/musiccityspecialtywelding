"use client"

import { upload } from "@vercel/blob/client"
import { useRef, useState } from "react"

type ExistingUpload = {
  id: string
  filename: string
  content_type: string
  size_bytes: number
  status: string
  error: string
  expired: boolean
}

type LocalUpload = ExistingUpload & {
  batchId: string
  file: File
  pathname?: string
  progress: number
}

const allowedExtension = /\.(?:jpe?g|png|webp|heic|heif|pdf|dxf|dwg|step|stp|iges|igs)$/i
const maxBytes = 20 * 1024 * 1024

class ExpiredUploadIntentError extends Error {}

function visibleStatus(status: string, expired: boolean) {
  if (expired || status === "expired") return "Expired"
  if (status === "stored") return "Added"
  if (status === "uploaded" || status === "projecting" || status === "retrying") return "Filing"
  if (status === "failed" || status === "unknown") return "Retry"
  return "Uploading"
}

function readableBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function GlassUpload({ token, initialUploads }: { token: string; initialUploads: ExistingUpload[] }) {
  const [items, setItems] = useState<LocalUpload[]>([])
  const [persistedItems, setPersistedItems] = useState(initialUploads)
  const [message, setMessage] = useState("")
  const [liveStatus, setLiveStatus] = useState("")
  const sendingIds = useRef(new Set<string>())

  function update(id: string, patch: Partial<LocalUpload>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  function updatePersisted(id: string, patch: Partial<ExistingUpload>) {
    setPersistedItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  async function completeFiling(uploadId: string) {
    const response = await fetch("/api/glass/upload/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete", token, uploadId }),
    })
    const data = await response.json().catch(() => null) as { error?: string; code?: string } | null
    if (!response.ok) {
      const message = data?.error || "The file uploaded, but filing needs another try."
      if (response.status === 410 || data?.code === "UPLOAD_RESERVATION_EXPIRED") throw new ExpiredUploadIntentError(message)
      throw new Error(message)
    }
  }

  async function fileIntent(item: LocalUpload) {
    const response = await fetch("/api/glass/upload/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "intent",
        token,
        uploadId: item.id,
        batchId: item.batchId,
        filename: item.file.name,
        contentType: item.file.type || "application/octet-stream",
        size: item.file.size,
      }),
    })
    const data = await response.json().catch(() => null) as { error?: string; code?: string; upload?: { pathname: string; content_type: string } } | null
    if (!response.ok || !data?.upload) {
      const message = data?.error || "The upload could not be filed."
      if (response.status === 410 || data?.code === "UPLOAD_RESERVATION_EXPIRED") throw new ExpiredUploadIntentError(message)
      throw new Error(message)
    }
    return data.upload
  }

  async function send(item: LocalUpload) {
    if (["uploading", "uploaded", "projecting", "stored"].includes(item.status) || sendingIds.current.has(item.id)) return
    sendingIds.current.add(item.id)
    update(item.id, { status: "pending", error: "", progress: 0 })
    setLiveStatus(`${item.filename} is uploading.`)
    try {
      const intent = await fileIntent(item)
      update(item.id, { status: "uploading", pathname: intent.pathname })
      await upload(intent.pathname, item.file, {
        access: "private",
        handleUploadUrl: "/api/glass/upload",
        clientPayload: JSON.stringify({ uploadId: item.id, token }),
        contentType: intent.content_type,
        multipart: true,
        onUploadProgress: ({ percentage }) => update(item.id, { status: "uploading", progress: Math.round(percentage) }),
      })
      update(item.id, { status: "projecting", progress: 100 })
      await completeFiling(item.id)
      update(item.id, { status: "stored", error: "", progress: 100 })
      setLiveStatus(`${item.filename} was added to the job.`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "The upload did not finish."
      const expired = error instanceof ExpiredUploadIntentError
      update(item.id, { status: expired ? "expired" : "unknown", error: errorMessage, expired, progress: 0 })
      setLiveStatus(expired ? `${item.filename} expired. Choose the file again.` : `${item.filename} needs another try.`)
    } finally {
      sendingIds.current.delete(item.id)
    }
  }

  async function retryPersisted(item: ExistingUpload) {
    if (item.expired || !["uploading", "uploaded", "projecting", "failed", "unknown"].includes(item.status) || sendingIds.current.has(item.id)) return
    sendingIds.current.add(item.id)
    updatePersisted(item.id, { status: "retrying", error: "" })
    setLiveStatus(`Filing ${item.filename} again.`)
    try {
      await completeFiling(item.id)
      updatePersisted(item.id, { status: "stored", error: "" })
      setLiveStatus(`${item.filename} was added to the job.`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "The file could not be filed yet."
      const expired = error instanceof ExpiredUploadIntentError
      updatePersisted(item.id, { status: expired ? "failed" : "unknown", error: errorMessage, expired })
      setLiveStatus(expired ? `${item.filename} expired. Choose the file again.` : `${item.filename} still needs another try.`)
    } finally {
      sendingIds.current.delete(item.id)
    }
  }

  function chooseFiles(files: File[]) {
    setMessage("")
    if (files.length > 10) {
      setMessage("Choose up to 10 files at a time.")
      files = files.slice(0, 10)
    }
    const valid: File[] = []
    for (const file of files) {
      if (!allowedExtension.test(file.name)) { setMessage("Use JPG, PNG, WebP, HEIC/HEIF, PDF, DXF, DWG, STEP/STP, or IGES/IGS files."); continue }
      if (file.size <= 0 || file.size > maxBytes) { setMessage(`${file.name} must be 20 MB or smaller.`); continue }
      valid.push(file)
    }
    const batchId = crypto.randomUUID()
    const next = valid.map((file) => ({
      id: crypto.randomUUID(),
      batchId,
      file,
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      status: "ready",
      error: "",
      expired: false,
      progress: 0,
    }))
    setItems((current) => [...next, ...current])
    for (const item of next) void send(item)
  }

  const allItems: ExistingUpload[] = [
    ...items,
    ...persistedItems.filter((stored) => !items.some((item) => item.id === stored.id)),
  ]

  return <section className="glass-uploads" aria-labelledby="glass-upload-title">
    <div>
      <span>From you to the shop</span>
      <h2 id="glass-upload-title">Add photos or files</h2>
      <p id="glass-upload-guidance">Add up to 10 photos, PDFs, or CAD files. 20 MB each.</p>
    </div>
    <label className="glass-upload-choose">
      <span>Add files</span>
      <input
        id="glass-files"
        name="files"
        type="file"
        multiple
        aria-describedby="glass-upload-guidance glass-upload-limits"
        accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.dxf,.dwg,.step,.stp,.iges,.igs,image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
        onChange={(event) => { chooseFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = "" }}
      />
    </label>
    {message && <p className="glass-upload-error" role="alert">{message}</p>}
    <p className="glass-upload-live" role="status" aria-live="polite" aria-atomic="true">{liveStatus}</p>
    {allItems.length > 0 && <ul className="glass-upload-list">
      {allItems.map((item) => {
        const local = items.find((candidate) => candidate.id === item.id)
        const href = item.status === "stored" ? `/api/glass/attachment?token=${token}&upload=${encodeURIComponent(item.id)}` : ""
        return <li className={`is-${item.expired ? "expired" : item.status}`} key={item.id}>
          <div><strong>{item.filename}</strong><small>{readableBytes(Number(item.size_bytes))}</small></div>
          {href ? <a href={href} target="_blank" rel="noreferrer">Added</a> : local && !local.expired && ["failed", "unknown"].includes(local.status)
            ? <button type="button" onClick={() => void send(local)}>Retry</button>
            : !local && !item.expired && ["uploading", "uploaded", "projecting", "failed", "unknown"].includes(item.status)
              ? <button type="button" aria-label={`Retry filing ${item.filename}`} onClick={() => void retryPersisted(item)}>Retry filing</button>
            : <span>{visibleStatus(item.status, item.expired)}{local?.status === "uploading" && local.progress ? ` ${local.progress}%` : ""}</span>}
          {(item.error || local?.error) && <p>{local?.error || item.error}</p>}
        </li>
      })}
    </ul>}
    <small className="glass-upload-limits" id="glass-upload-limits">Daily limit: 30 files or 100 MB for this private link.</small>
  </section>
}
