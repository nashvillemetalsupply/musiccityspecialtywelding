import { dbConfigured } from "@/lib/db"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { listOperators, operatorHasEmail, operatorPunchSelector } from "@/lib/operators"
import { twilioPhoneLoginConfigured } from "@/lib/twilio"
import { OpsLoginForm } from "../login-form"
import { InstallAppButton } from "./install-app-button"
import Link from "next/link"

export const dynamic = "force-dynamic"

export default async function InstallPage() {
  if (!dbConfigured()) return <main className="ops-login"><h1>MCSW Jobs</h1><p className="ops-alert">The operations database is not configured.</p></main>
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
  return <main className="ops-main ops-install-page">
    <header className="ops-page-heading"><Link href="/ops">Back to Jobs</Link><h1>Install MCSW Jobs</h1><p>Put Jobs on this phone&apos;s home screen.</p></header>
    <InstallAppButton />
    <section>
      <h2>If Install does not appear</h2>
      <ol>
        <li>Tap the three-dot Chrome menu.</li>
        <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
        <li>Confirm <strong>MCSW Jobs</strong>.</li>
      </ol>
    </section>
    <p className="ops-install-note">This phone stays signed in for up to 90 days. Keep it locked.</p>
  </main>
}
