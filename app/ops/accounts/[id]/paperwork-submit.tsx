"use client"

import { useFormStatus } from "react-dom"

export function PaperworkSubmit() {
  const { pending } = useFormStatus()
  return <button className="btn btn--sm btn--go" type="submit" disabled={pending}>{pending ? "Sending..." : "Send documents"}</button>
}
