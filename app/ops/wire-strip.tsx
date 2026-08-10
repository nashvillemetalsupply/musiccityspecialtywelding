"use client"

import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { SafeActionButton, SafeSubmitButton } from "./safe-action-controls"

export type WireSlip = {
  id: number
  stock: string
  title: string
  body: string
  url: string
  age: string
  actionKind: string
  actionDetail: Record<string, unknown>
}

function plainUpdateText(value: string) {
  return value
    .replace(/\bstamped DONE\b/gi, "finished")
    .replace(/\bclosed (.+?'s job)\b/i, "finished $1")
}

export function WireStrip({ slips, unreadTotal, history, page, hasOlder, query }: { slips: WireSlip[]; unreadTotal: number; history: boolean; page: number; hasOlder: boolean; query: string }) {
  const router = useRouter()
  const [working, setWorking] = useState<number | null>(null)
  const [result, setResult] = useState<Record<number, string>>({})

  function openUpdate(id: number) {
    if (history) return
    void fetch("/api/ops/wire/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
      keepalive: true,
    })
  }

  async function runAction(slip: WireSlip, decision = "", value = "") {
    if (working !== null) return
    setWorking(slip.id)
    try {
      const response = await fetch("/api/ops/wire/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId: slip.id, decision, value }),
      })
      const data = await response.json().catch(() => null) as { message?: string; error?: string } | null
      setResult((current) => ({
        ...current,
        [slip.id]: response.ok ? data?.message || "Handled." : data?.error || "Could not handle that update.",
      }))
      if (response.ok) router.refresh()
    } catch {
      setResult((current) => ({ ...current, [slip.id]: "That update could not be handled. Try again." }))
    } finally {
      setWorking(null)
    }
  }

  const summary = history
    ? `${slips.length} past updates`
    : unreadTotal > slips.length
      ? `${slips.length} of ${unreadTotal} new updates`
      : slips.length
        ? `${slips.length} new updates`
        : "caught up"

  return <section className="ops-wire" id="wire" aria-label="Updates">
    <div className="ops-wire-current">
      <p className="ops-update-summary">{summary}</p>
      <div className="ops-wire-line">
        {slips.length === 0 ? <p className="ops-wire-empty">No new updates.</p> : slips.map((slip) => <article className={`ops-wire-slip is-${slip.stock}`} key={slip.id}>
          <div className="ops-update-copy"><strong>{plainUpdateText(slip.title)}</strong>{slip.body && <span>{plainUpdateText(slip.body)}</span>}<time>{slip.age} ago</time></div>
          <Link className="ops-update-open" onClick={() => openUpdate(slip.id)} href={slip.url || "/ops"}>Open</Link>
          {!history && slip.actionKind && <div className="ops-wire-action">
            {slip.actionKind === "usual-paperwork" && <SafeActionButton disabled={working !== null} onAction={() => runAction(slip)}>Send it</SafeActionButton>}
            {slip.actionKind === "quote-capture" && <><SafeActionButton disabled={working !== null} onAction={() => runAction(slip, "yep")}>Quoted</SafeActionButton><SafeActionButton disabled={working !== null} onAction={() => runAction(slip, "nah")}>Not a quote</SafeActionButton></>}
            {slip.actionKind === "departure-confirm" && <><SafeActionButton disabled={working !== null} onAction={() => runAction(slip, "yep")}>They left</SafeActionButton><SafeActionButton disabled={working !== null} onAction={() => runAction(slip, "nah")}>Keep contact</SafeActionButton></>}
            {slip.actionKind === "contact-intro" && <SafeActionButton disabled={working !== null} aria-label={`Text ${String(slip.actionDetail.name || "new contact")}`} onAction={() => runAction(slip)}>Text contact</SafeActionButton>}
            {slip.actionKind === "contact-intro-email" && <SafeActionButton disabled={working !== null} aria-label={`Email ${String(slip.actionDetail.name || "new contact")}`} onAction={() => runAction(slip)}>Email contact</SafeActionButton>}
            {slip.actionKind === "attachment-retry" && <SafeActionButton disabled={working !== null} onAction={() => runAction(slip)}>Try filing again</SafeActionButton>}
            {slip.actionKind === "attach-payment" && <form onSubmit={(event) => { event.preventDefault(); const value = new FormData(event.currentTarget).get("leadId"); void runAction(slip, "attach", String(value ?? "")) }}><input name="leadId" inputMode="numeric" placeholder="Job #" aria-label="Job number" required /><SafeSubmitButton disabled={working !== null}>Attach payment</SafeSubmitButton></form>}
          </div>}
          {result[slip.id] && <small className="ops-wire-result" role="status">{result[slip.id]}</small>}
        </article>)}
      </div>
    </div>
    <details className="ops-wire-cabinet" open={history || Boolean(query) || page > 1}>
      <summary>All Updates <span>Search</span></summary>
      <form className="ops-wire-search" action="/ops" method="get">
        <input type="hidden" name="view" value="updates" />
        <input type="hidden" name="wire" value={history ? "past" : "fresh"} />
        <input name="wireQ" type="search" defaultValue={query} placeholder="Search updates" aria-label="Search updates" />
        <SafeSubmitButton>Search</SafeSubmitButton>
      </form>
      <nav className="ops-wire-pages" aria-label="Update pages">
        {page > 1 && <Link href={`/ops?view=updates&wire=${history ? "past" : "fresh"}&wirePage=${page - 1}${query ? `&wireQ=${encodeURIComponent(query)}` : ""}#wire`}>Newer</Link>}
        <span>Page {page}</span>
        {hasOlder && <Link href={`/ops?view=updates&wire=${history ? "past" : "fresh"}&wirePage=${page + 1}${query ? `&wireQ=${encodeURIComponent(query)}` : ""}#wire`}>Older</Link>}
      </nav>
      <Link className="ops-wire-archive" href={history ? "/ops?view=updates#wire" : "/ops?view=updates&wire=past#wire"}>{history ? "Back to new updates" : "View past updates"}</Link>
    </details>
  </section>
}
