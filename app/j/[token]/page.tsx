import { randomUUID } from "node:crypto"
import { notFound } from "next/navigation"
import Image from "next/image"
import { CustomerBuildDrawing } from "@/components/build-sheets/customer-build-drawing"
import type { Viewport } from "next"
import { Chivo } from "next/font/google"
import { Check } from "lucide-react"
import { getGlassJob, listGlassPromises, noteGlassView } from "@/lib/glass"
import { buildSheetsEnabled } from "@/lib/build-sheets-access"
import { getCustomerBuildProjection } from "@/lib/build-sheets"
import { recordEvent } from "@/lib/events"
import { notifyAll } from "@/lib/notify"
import { getShopPhone } from "@/lib/shop-contact"
import { glassStageIndex } from "@/lib/shop-brain-invariants.mjs"
import { listGlassUploads } from "@/lib/glass-uploads"
import { GlassUpload } from "./glass-upload"
import "./customer-page.css"

const chivo = Chivo({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-mcsw-customer",
  display: "swap",
})

export const dynamic = "force-dynamic"
export const metadata = {
  title: { absolute: "Private MCSW Customer Page" },
  description: "A private Music City Specialty Welding job page.",
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light",
  themeColor: "#f7f8f9",
}

const STATIONS = ["Received", "Quoted", "Scheduled", "In progress", "Finished"]
function money(cents: number | null) { return cents == null ? "" : (Number(cents) / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function date(iso: string | null) { return iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" }) : "Date being confirmed" }
function CorrectionStub({ token, fact }: { token: string; fact: string }) { return <form className="glass-correction" action={`/j/${token}/correct?fact=${encodeURIComponent(fact)}`} method="post"><button type="submit">Something wrong with this?</button></form> }

export default async function GlassPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ build?: string }> }) {
  const { token } = await params
  const query = await searchParams
  const shopPhone = getShopPhone()
  const job = await getGlassJob(token)
  if (!job) notFound()
  if (job.status === "closed") return <main className={`${chivo.variable} glass-page glass-page-brand`}><section className="glass-closed"><span>MCSW Customer Page</span><h1>This page is closed.</h1><p>Need the shop again? Call us. We still answer our phone.</p><a href={shopPhone.href}>Call the shop</a></section></main>
  const showReview = Boolean(job.completed_at && job.paid_at && !job.review_shown_at && process.env.GOOGLE_REVIEW_URL?.trim())
  const [promises, view, uploads, customerBuild] = await Promise.all([
    listGlassPromises(job.lead_id),
    noteGlassView(job),
    listGlassUploads(job),
    job.is_test && buildSheetsEnabled() ? getCustomerBuildProjection(job.lead_id) : Promise.resolve(null),
  ])
  if (!job.is_test && view && Number(view.daily_view_count) >= 3) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date())
    let eventId = await recordEvent({ kind: "glass.view", actorType: "customer", leadId: job.lead_id, externalId: `glass:${job.token_hash}:${day}:buying-signal`, body: "Customer checked the Customer Page 3 times today", crewBody: "Customer checked the Customer Page 3 times today" })
    if (!eventId) {
      const { getSql } = await import("@/lib/db")
      const existing = (await getSql()`SELECT id FROM events WHERE kind = 'glass.view' AND external_id = ${`glass:${job.token_hash}:${day}:buying-signal`}::text LIMIT 1`) as { id: number }[]
      eventId = Number(existing[0]?.id) || null
    }
    if (eventId) await notifyAll({ priority: "digest", stock: "white", title: `${job.first_name} checked the Customer Page 3×`, body: "They are watching the job today.", crewBody: "They are watching the job today.", url: `/ops/leads/${job.lead_id}`, sourceEventId: eventId })
  }
  const promise = promises.find((item) => item.status === "open")
  const stageIndex = glassStageIndex(job)
  const sharedPhotos = Array.isArray(job.photos) ? job.photos.filter((photo) => photo.shared) : []
  return <main className={`${chivo.variable} glass-page glass-page-brand`}><article className="glass-clipboard">
    <header><div className="glass-brand-lockup"><Image src="/images/optimized/mcs_welding_logo.webp" alt="MCS Welding" width={240} height={160} sizes="72px" priority unoptimized /><strong>Customer Page</strong></div><div className="glass-contact"><span>{shopPhone.textReady ? "Call or text us" : "Call the shop"}</span><a href={shopPhone.href}>{shopPhone.display}</a></div></header>
    <section className="glass-job"><span>Your job</span><h1>{job.first_name}’s {job.service}</h1><CorrectionStub token={token} fact="job status" /></section>
    <section className="glass-promise"><span>Timing</span><strong>{promise ? date(promise.due_at) : job.completed_at ? "Finished" : "We’re confirming the date"}</strong>{promise && <><p>{promise.summary}</p>{promise.history.length > 0 && <div className="glass-promise-history">{promise.history.map((move) => <p key={`${move.changed_at}-${move.previous_due_at}`}><del>{date(move.previous_due_at)}</del><span>{move.reason || "The shop called and moved the date."}</span></p>)}</div>}</>}<CorrectionStub token={token} fact="promised date" /></section>
    <ol className="glass-traveler" aria-label="Job status">{STATIONS.map((station, index) => <li className={`${index <= stageIndex ? "is-done" : ""}${index === stageIndex ? " is-current" : ""}`} key={station}><i>{index < stageIndex ? <Check aria-hidden="true" /> : index === stageIndex ? "Now" : ""}</i><span>{station}</span></li>)}</ol>
    {job.assigned_name && !job.completed_at && <p className="glass-runner"><strong>{job.assigned_name.split(" ")[0]}</strong> is running your job.</p>}
    {customerBuild && <section className="glass-understanding" id="what-we-understand" aria-labelledby="glass-understanding-title">
      <header>
        <div><span>Build Sheet {customerBuild.buildSheetNumber}</span><h2 id="glass-understanding-title">What We Understand</h2></div>
        <strong>{customerBuild.scope}</strong>
      </header>
      <p>This is the saved version the shop is working from. Confirm each line or propose a correction. A correction opens a new shop draft; it never rewrites this Build Sheet.</p>
      {customerBuild.drawing
        ? <CustomerBuildDrawing drawing={customerBuild.drawing} />
        : <p className="glass-build-drawing-empty">The shared drawing is waiting on the remaining dimensions. No numbers are guessed.</p>}
      {query.build === "accepted" && <p className="glass-build-receipt" role="status"><Check aria-hidden="true" />Confirmation filed.</p>}
      {query.build === "corrected" && <p className="glass-build-receipt" role="status"><Check aria-hidden="true" />Correction proposed for shop review.</p>}
      <div className="glass-understanding-facts">
        {customerBuild.facts.map((fact) => {
          const numberFact = ["opening.clear_width", "gate_leaf.finished_width", "gate_leaf.finished_height", "frame.stock_size", "frame.rail_count"].includes(fact.factKey)
          const sideFact = ["gate.hinge_side", "gate.latch_side"].includes(fact.factKey)
          return <article key={fact.claimId}>
            <div className="glass-understanding-value"><span>{fact.label}</span><strong>{fact.value}</strong>{fact.reference && <small>{fact.reference}</small>}<small className={`glass-build-state is-${fact.state}`}>{fact.state === "working-number" ? "Shop working number — not fabrication-confirmed" : "Saved on this locked Build Sheet"}</small></div>
            <div className="glass-understanding-response">
              {fact.state === "customer-confirmed" ? <span className="is-confirmed"><Check aria-hidden="true" />You confirmed this</span>
                : fact.state === "customer-correction-proposed" ? <span className="is-proposed">Shop review pending</span>
                  : <form action={`/j/${token}/build`} method="post">
                    <input type="hidden" name="intent" value="accept" />
                    <input type="hidden" name="buildSheetNumber" value={customerBuild.buildSheetNumber} />
                    <input type="hidden" name="claimId" value={fact.claimId} />
                    <input type="hidden" name="responseKey" value={randomUUID()} />
                    <button type="submit">Confirm</button>
                  </form>}
              <details>
                <summary>Propose a correction</summary>
                <form action={`/j/${token}/build`} method="post">
                  <input type="hidden" name="intent" value="correct" />
                  <input type="hidden" name="buildSheetNumber" value={customerBuild.buildSheetNumber} />
                  <input type="hidden" name="claimId" value={fact.claimId} />
                  <input type="hidden" name="responseKey" value={randomUUID()} />
                  <label><span>What should this say?</span>{sideFact
                    ? <select name="correction" defaultValue="" required><option value="" disabled>Choose a side</option><option value="left">Left</option><option value="right">Right</option></select>
                    : <input name="correction" type={numberFact ? "number" : "text"} min={numberFact ? "0.01" : undefined} step={fact.factKey === "frame.rail_count" ? "1" : numberFact ? "0.01" : undefined} inputMode={numberFact ? "decimal" : undefined} maxLength={numberFact ? undefined : 120} required />}</label>
                  <button type="submit">Send correction</button>
                </form>
              </details>
            </div>
          </article>
        })}
      </div>
    </section>}
    {sharedPhotos.length > 0 && <section className="glass-progress"><h2>Progress from the shop</h2><div>{sharedPhotos.map((photo) => {
      const caption = photo.caption || job.glass_caption_draft || "Progress from the crew"
      return <figure key={photo.pathname}><img src={`/api/glass/photo?token=${token}&path=${encodeURIComponent(photo.pathname)}`} alt={`Shop progress: ${caption}`} /><figcaption>{caption}</figcaption><CorrectionStub token={token} fact="progress photo" /></figure>
    })}</div></section>}
    <GlassUpload token={token} initialUploads={uploads.map((item) => ({ id: item.id, filename: item.filename, content_type: item.content_type, size_bytes: Number(item.size_bytes), status: item.status, error: item.error, expired: Boolean(item.expired_at) }))} />
    {job.show_quote && ((job.quoted_at && job.estimate_value_cents != null) || job.invoice_number) && <section className="glass-money"><h2>Price &amp; Invoice</h2>{job.quoted_at && job.estimate_value_cents != null && <p><span>Approved quote</span><strong>{money(job.estimate_value_cents)}</strong></p>}{job.invoice_number && <p><span>Invoice #{job.invoice_number}{job.invoice_due_at ? `, due ${date(job.invoice_due_at)}` : ""}</span><strong>{job.paid_at ? "Paid" : money(job.invoice_total_cents ?? job.revenue_cents ?? job.estimate_value_cents)}</strong></p>}{job.invoice_pay_url && !job.paid_at && <a className="glass-pay" href={job.invoice_pay_url} rel="noreferrer">Pay invoice</a>}<CorrectionStub token={token} fact="invoice or amount" /></section>}
    {showReview && <section className="glass-review"><span>Job finished, invoice paid</span><h2>How did the weld hold up?</h2><p>A straight answer helps the next person who needs a real shop.</p><form action={`/j/${token}/review`} method="post"><button type="submit">Leave a Google review</button></form></section>}
    <footer><strong>We answer our phone.</strong><p>{shopPhone.textReady ? "If we miss you, text this number with photos of what’s broke." : "Call the shop if anything on this page needs a correction."}</p><a href={shopPhone.href}>Call</a>{shopPhone.textReady && <a href={shopPhone.smsHref}>Text</a>}</footer>
  </article></main>
}
