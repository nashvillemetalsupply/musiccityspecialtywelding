"use client"

import { useEffect, useId, useState } from "react"

export function ActionKeyField({ name = "actionKey", scope }: { name?: string; scope: string }) {
  const stableId = useId()
  const [key, setKey] = useState(`${scope}:${stableId}`)

  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      setKey(`${scope}:${globalThis.crypto.randomUUID()}`)
    }, 0)
    return () => globalThis.clearTimeout(timer)
  }, [scope])

  return <input type="hidden" name={name} value={key} />
}
