import Link from "next/link"
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
  if (!dbConfigured()) return <main className="ops-login"><h1>MCSW Jobs</h1><p>Database not configured.</p></main>
  const operator = await getAuthenticatedOperator()
  if (!operator) return <OpsLoginForm linkError={false} />
  if (operator.role !== "owner") {
    return (
      <main className="ops-main ops-shop-page">
        <header className="ops-settings-heading"><Link href="/ops">Back to Jobs</Link><h1>Settings</h1></header>
        <section className="ops-card"><h2>Owner settings</h2><p>Crew can work every job. Philippe manages team and paperwork settings.</p></section>
      </main>
    )
  }

  const [operators, documents] = await Promise.all([listOperators(true), listShopDocuments()])
  return (
    <main className="ops-main ops-shop-page">
      <header className="ops-settings-heading">
        <Link href="/ops">Back to Jobs</Link><h1>Settings</h1><p>Team, documents, phone, and exports.</p>
      </header>

      <section className="ops-card ops-punch-rack" aria-labelledby="crew-heading">
        <header className="ops-settings-section-heading"><h2 id="crew-heading">Team</h2><span>{operators.filter((item) => item.active).length} active</span></header>
        <div className="ops-crew-cards">
          {operators.map((item) => (
            <article className={`ops-crew-card${item.active ? "" : " is-inactive"}`} key={item.id}>
              <strong>{item.name || item.email}</strong>
              <span>{item.role === "owner" ? "Owner" : "Crew"}, {item.cell_phone || "no cell"}</span>
              <small>{item.email}</small>
              {Number(item.id) !== Number(operator.id) && (
                <form action={setCrewActive}>
                  <input type="hidden" name="operatorId" value={item.id} />
                  <SafeSubmitButton className="ops-ghost" name="active" value={item.active ? "0" : "1"} pendingLabel="Saving...">
                    {item.active ? "Deactivate" : "Reactivate"}
                  </SafeSubmitButton>
                </form>
              )}
            </article>
          ))}
        </div>
        <details className="ops-settings-drawer"><summary>Add team member <span>Open</span></summary><form action={saveCrewMember} className="ops-shop-form">
            <label>Name<input name="name" autoComplete="name" /></label>
            <label>Email<input name="email" type="email" autoComplete="email" /></label>
            <label>Cell<input name="cellPhone" type="tel" inputMode="tel" autoComplete="tel" /></label>
            <label>Role<select name="role" defaultValue="crew"><option value="crew">Crew</option><option value="owner">Owner</option></select></label>
            <SafeSubmitButton pendingLabel="Adding...">Add team member</SafeSubmitButton>
          </form></details>
      </section>

      <section className="ops-card ops-document-locker" aria-labelledby="paperwork-heading">
        <header className="ops-settings-section-heading"><h2 id="paperwork-heading">Documents</h2></header>
        <div className="ops-document-list">
          {(["w9", "coi"] as const).map((kind) => {
            const document = documents.find((item) => item.kind === kind)
            return <div key={kind}><strong>{kind === "w9" ? "W-9" : "Insurance certificate"}</strong><span>{document?.status === "ready" ? document.filename : "Nothing on file"}</span>{document?.expires_at && <small>Expires {new Date(document.expires_at).toLocaleDateString("en-US")}</small>}</div>
          })}
        </div>
        <details className="ops-settings-drawer"><summary>Update a document <span>Open</span></summary><form action="/api/ops/shop/document" method="post" encType="multipart/form-data" className="ops-shop-form">
            <label>Document<select name="kind"><option value="w9">W-9</option><option value="coi">Insurance certificate</option></select></label>
            <label>PDF<input name="file" type="file" accept="application/pdf" /></label>
            <label>Expires<input name="expiresAt" type="date" /></label>
            <SafeSubmitButton pendingLabel="Uploading...">Save document</SafeSubmitButton>
          </form></details>
      </section>

      <section className="ops-card ops-shop-utilities" aria-labelledby="utilities-heading">
        <header className="ops-settings-section-heading"><h2 id="utilities-heading">Phone &amp; Exports</h2></header>
        <dl>
          <div><dt>Tracking number</dt><dd>{process.env.TWILIO_PHONE_NUMBER?.trim() || "Not connected yet"}</dd></div>
          <div><dt>Voice capture</dt><dd>{voiceTranscriptionConfigured() ? "Ready" : "Waiting on voice setup"}</dd></div>
          <div><dt>Review link</dt><dd>{process.env.GOOGLE_REVIEW_URL?.trim() ? "On file" : "Not set"}</dd></div>
        </dl>
        <div className="ops-account-actions">
          <a className="ops-ghost" href="/api/ops/export">Export CSV</a>
          <a className="ops-ghost" href="/api/ops/export?format=google-oci">Ads conversions</a>
          <Link className="ops-ghost" href="/ops?status=open&tests=1">Internal tests</Link>
        </div>
        <div className="ops-glass-trust">
          <div><strong>Customer Page photo approval</strong><span>{operator.glass_clean_approvals} / 10 clean owner approvals</span><small>{operator.glass_auto_post ? "Trusted closeout photos post automatically." : "Owner still approves every customer-facing caption."}</small></div>
          <form action={setGlassAutoPost}>
            <SafeSubmitButton name="enabled" value={operator.glass_auto_post ? "0" : "1"} disabled={!operator.glass_auto_post && operator.glass_clean_approvals < 10} pendingLabel="Saving...">
              {operator.glass_auto_post ? "Return to owner approval" : operator.glass_clean_approvals >= 10 ? "Trust clean captions" : `${10 - operator.glass_clean_approvals} approvals to go`}
            </SafeSubmitButton>
          </form>
        </div>
      </section>
    </main>
  )
}
