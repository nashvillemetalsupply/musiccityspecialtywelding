"use client"

import { useFormStatus } from "react-dom"

export function PaperworkSubmit() {
  const { pending } = useFormStatus()
  return <button type="submit" disabled={pending}>{pending ? "Sending..." : "Send documents"}</button>
}
