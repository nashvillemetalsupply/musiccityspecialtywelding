import Link from "next/link"
import "./shop.css"
import { dbConfigured } from "@/lib/db"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { listOperators } from "@/lib/operators"
import { listShopDocuments } from "@/lib/shop"
import { OpsLoginForm } from "../login-form"
import { SafeSubmitButton } from "../safe-action-controls"
import { saveCrewMember, setCrewActive, setGlassAutoPost } from "./actions"
import { voiceTranscriptionConfigured } from "@/lib/voice-transcription"

export const dynamic = "force-dynamic"

export default async function ShopPage() {
  if (!dbConfigured()) return <main className="shop-page shop-state-page"><section className="card shop-state"><h1 className="t-title">MCSW Jobs</h1><p>Database not configured.</p></section></main>
  const operator = await getAuthenticatedOperator()
  if (!operator) return <OpsLoginForm linkError={false} />
  if (operator.role !== "owner") {
    return (
      <main className="shop-page">
        <header className="card shop-head"><Link className="shop-back t-caption" href="/ops">Back to Jobs</Link><h1 className="t-title">Settings</h1></header>
        <section className="card shop-state"><h2 className="t-sub">Owner settings</h2><p>Crew can work every job. Philippe manages team and paperwork settings.</p></section>
      </main>
    )
  }

  const [operators, documents] = await Promise.all([listOperators(true), listShopDocuments()])
  return (
    <main className="shop-page">
      <header className="card shop-head">
        <Link className="shop-back t-caption" href="/ops">Back to Jobs</Link><h1 className="t-title">Settings</h1><p className="t-caption">Team, documents, phone, and exports.</p>
      </header>

      <section className="card shop-card" aria-labelledby="crew-heading">
        <header className="shop-card-head"><h2 className="t-sub" id="crew-heading">Team</h2><span className="t-label">{operators.filter((item) => item.active).length} active</span></header>
        <div className="shop-crew">
          {operators.map((item) => (
            <article className={`shop-crew-card${item.active ? "" : " is-inactive"}`} key={item.id}>
              <strong>{item.name || item.email}</strong>
              <span className="t-caption">{item.role === "owner" ? "Owner" : "Crew"}, {item.cell_phone || "no cell"}</span>
              <small className="t-caption">{item.email}</small>
              {Number(item.id) !== Number(operator.id) && (
                <form action={setCrewActive}>
                  <input type="hidden" name="operatorId" value={item.id} />
                  <SafeSubmitButton className="btn btn--sm btn--edge" name="active" value={item.active ? "0" : "1"} pendingLabel="Saving...">
                    {item.active ? "Deactivate" : "Reactivate"}
                  </SafeSubmitButton>
                </form>
              )}
            </article>
          ))}
        </div>
        <details className="shop-drawer"><summary>Add team member <span className="t-label">Open</span></summary><form action={saveCrewMember} className="shop-form">
            <label>Name<input name="name" autoComplete="name" /></label>
            <label>Email<input name="email" type="email" autoComplete="email" /></label>
            <label>Cell<input name="cellPhone" type="tel" inputMode="tel" autoComplete="tel" /></label>
            <label>Role<select name="role" defaultValue="crew"><option value="crew">Crew</option><option value="owner">Owner</option></select></label>
            <SafeSubmitButton className="btn btn--go" pendingLabel="Adding...">Add team member</SafeSubmitButton>
          </form></details>
      </section>

      <section className="card shop-card" aria-labelledby="paperwork-heading">
        <header className="shop-card-head"><h2 className="t-sub" id="paperwork-heading">Documents</h2></header>
        <div className="shop-documents">
          {(["w9", "coi"] as const).map((kind) => {
            const document = documents.find((item) => item.kind === kind)
            return <div key={kind}><strong>{kind === "w9" ? "W-9" : "Insurance certificate"}</strong><span className="t-caption">{document?.status === "ready" ? document.filename : "Nothing on file"}</span>{document?.expires_at && <small className="t-caption">Expires {new Date(document.expires_at).toLocaleDateString("en-US")}</small>}</div>
          })}
        </div>
        <details className="shop-drawer"><summary>Update a document <span className="t-label">Open</span></summary><form action="/api/ops/shop/document" method="post" encType="multipart/form-data" className="shop-form">
            <label>Document<select name="kind"><option value="w9">W-9</option><option value="coi">Insurance certificate</option></select></label>
            <label>PDF<input name="file" type="file" accept="application/pdf" /></label>
            <label>Expires<input name="expiresAt" type="date" /></label>
            <SafeSubmitButton className="btn btn--go" pendingLabel="Uploading...">Save document</SafeSubmitButton>
          </form></details>
      </section>

      <section className="card shop-card" aria-labelledby="utilities-heading">
        <header className="shop-card-head"><h2 className="t-sub" id="utilities-heading">Phone &amp; Exports</h2></header>
        <dl className="shop-facts">
          <div><dt>Tracking number</dt><dd>{process.env.TWILIO_PHONE_NUMBER?.trim() || "Not connected yet"}</dd></div>
          <div><dt>Voice capture</dt><dd>{voiceTranscriptionConfigured() ? "Ready" : "Waiting on voice setup"}</dd></div>
          <div><dt>Review link</dt><dd>{process.env.GOOGLE_REVIEW_URL?.trim() ? "On file" : "Not set"}</dd></div>
        </dl>
        <div className="shop-actions">
          <a className="btn btn--sm btn--edge" href="/api/ops/export">Export CSV</a>
          <a className="btn btn--sm btn--edge" href="/api/ops/export?format=google-oci">Ads conversions</a>
          <Link className="btn btn--sm btn--edge" href="/board?tests=1">Internal tests</Link>
        </div>
        <div className="shop-trust">
          <div><strong>Customer Page photo approval</strong><span className="t-caption">{operator.glass_clean_approvals} / 10 clean owner approvals</span><small className="t-caption">{operator.glass_auto_post ? "Trusted closeout photos post automatically." : "Owner still approves every customer-facing caption."}</small></div>
          <form action={setGlassAutoPost}>
            <SafeSubmitButton className="btn btn--edge" name="enabled" value={operator.glass_auto_post ? "0" : "1"} disabled={!operator.glass_auto_post && operator.glass_clean_approvals < 10} pendingLabel="Saving...">
              {operator.glass_auto_post ? "Return to owner approval" : operator.glass_clean_approvals >= 10 ? "Trust clean captions" : `${10 - operator.glass_clean_approvals} approvals to go`}
            </SafeSubmitButton>
          </form>
        </div>
      </section>
    </main>
  )
}
