import "../../../styles/control.css"
import "./install.css"
import { dbConfigured } from "@/lib/db"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { listOperators, operatorHasEmail, operatorPunchSelector } from "@/lib/operators"
import { twilioPhoneLoginConfigured } from "@/lib/twilio"
import { OpsLoginForm } from "../login-form"
import { InstallAppButton } from "./install-app-button"
import Link from "next/link"

export const dynamic = "force-dynamic"

export default async function InstallPage() {
  if (!dbConfigured()) return <main className="install-page install-state-page"><section className="card install-state"><h1 className="t-title">MCSW Jobs</h1><p>The operations database is not configured.</p></section></main>
  const operator = await getAuthenticatedOperator()
  if (!operator) {
    const smsReady = twilioPhoneLoginConfigured()
    const operators = (await listOperators()).map((person) => ({
      selector: operatorPunchSelector(person.id),
      name: person.name.split(/\s+/)[0] || "Crew",
      hasEmail: operatorHasEmail(person),
      hasSms: smsReady && Boolean(person.cell_phone),
    })).filter((person) => Boolean(person.selector))
    return <OpsLoginForm linkError={false} operators={operators} smsReady={smsReady} />
  }
  return <main className="install-page">
    <header className="card install-head"><Link className="install-back t-caption" href="/ops">Back to Jobs</Link><h1 className="t-title">Install MCSW Jobs</h1><p className="t-caption">Put Jobs on this phone&apos;s home screen.</p></header>
    <InstallAppButton />
    <section className="card install-steps">
      <h2 className="t-sub">If Install does not appear</h2>
      <ol>
        <li>Tap the three-dot Chrome menu.</li>
        <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
        <li>Confirm <strong>MCSW Jobs</strong>.</li>
      </ol>
    </section>
    <p className="install-note t-caption">This phone stays signed in for up to 90 days. Keep it locked.</p>
  </main>
}
