import { redirect } from "next/navigation"
import { dbConfigured } from "@/lib/db"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { listOperators, operatorHasEmail, operatorPunchSelector } from "@/lib/operators"
import { twilioPhoneLoginConfigured } from "@/lib/twilio"
import { OpsLoginForm } from "./login-form"

export const dynamic = "force-dynamic"

type SearchParams = Promise<{ error?: string }>

// /ops is the sign-in door. Past it the board is the front door; two job lists
// was always one too many, but a redirect with no door left nowhere to sign in.
export default async function OpsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  if (!dbConfigured()) return <main><h1>MCSW Jobs</h1><p>The operations database is not configured.</p></main>
  if (await getAuthenticatedOperator()) redirect("/board")

  const smsLoginReady = twilioPhoneLoginConfigured()
  const punchCards = (await listOperators()).map((person) => ({
    selector: operatorPunchSelector(person.id),
    name: person.name.split(/\s+/)[0] || "Crew",
    hasEmail: operatorHasEmail(person),
    hasSms: smsLoginReady && Boolean(person.cell_phone),
  })).filter((person) => Boolean(person.selector))
  return <OpsLoginForm linkError={params.error === "link"} operators={punchCards} smsReady={smsLoginReady} />
}
