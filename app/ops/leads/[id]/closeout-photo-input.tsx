"use client"

import { upload } from "@vercel/blob/client"
import { useRef, useState } from "react"

const MAX_PHOTO_BYTES = 12 * 1024 * 1024

export function CloseoutPhotoInput({
  leadId,
  mode,
  onBusyChange,
  onUploaded,
}: {
  leadId: number
  mode: "completion" | "addendum"
  onBusyChange?: (busy: boolean) => void
  onUploaded?: () => void
}) {
  const receiptRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState("")
  const [progress, setProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const fieldId = mode === "completion" ? "finish-photo" : "done-photo"

  async function uploadPhoto(file: File) {
    if (!file.type.toLowerCase().startsWith("image/") || file.size <= 0 || file.size > MAX_PHOTO_BYTES) {
      if (receiptRef.current) receiptRef.current.value = ""
      setMessage("Choose an image under 12 MB.")
      return
    }

    const uploadId = crypto.randomUUID()
    const pathname = `closeouts/${uploadId}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^\.+/, "").slice(-120) || "closeout-image"}`
    if (receiptRef.current) receiptRef.current.value = ""
    setUploading(true)
    onBusyChange?.(true)
    setProgress(0)
    setMessage("Uploading photo…")
    try {
      await upload(pathname, file, {
        access: "private",
        handleUploadUrl: "/api/ops/closeout-upload",
        clientPayload: JSON.stringify({
          uploadId,
          leadId,
          mode,
          originalName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        }),
        contentType: file.type,
        multipart: true,
        onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
      })
      if (receiptRef.current) receiptRef.current.value = uploadId
      setMessage("Photo uploaded and ready to file.")
      onUploaded?.()
    } catch (error) {
      if (receiptRef.current) receiptRef.current.value = ""
      setMessage(error instanceof Error ? error.message : "The photo did not upload. Choose it again.")
    } finally {
      setUploading(false)
      onBusyChange?.(false)
    }
  }

  return <>
    <input ref={receiptRef} type="hidden" name="photoUploadId" />
    <label className="ops-done-photo" htmlFor={fieldId}>
      <span>{uploading ? `Uploading photo ${progress}%` : "Add a finished-work photo"}</span>
      <input
        id={fieldId}
        type="file"
        accept="image/*"
        capture="environment"
        disabled={uploading}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ""
          if (file) void uploadPhoto(file)
        }}
      />
    </label>
    {message && <small className="ops-done-voice-error" aria-live="polite">{message}</small>}
  </>
}
