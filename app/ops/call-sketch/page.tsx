import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import "./call-sketch.css"
import { CallSketchPrototype } from "@/components/call-sketch/call-sketch-prototype"
import { getAuthenticatedOperator } from "@/lib/ops-auth"

export const metadata: Metadata = {
  title: "Call Sketch | MCSW Jobs",
  description: "Owner practice workspace for the MCSW Jobs live Call Sketch.",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

export default async function OpsCallSketchPage() {
  const operator = await getAuthenticatedOperator()
  if (!operator) redirect("/ops")

  if (operator.role !== "owner") {
    return <main className="sketch-gate-page">
      <section className="card sketch-gate">
        <p className="t-label">Owner workspace</p>
        <h1 className="t-title">Call Sketch</h1>
        <p>The live sketch and its practice workspace are owner-only.</p>
        <Link className="btn btn--edge" href="/ops">Back to Jobs</Link>
      </section>
    </main>
  }

  return <CallSketchPrototype embedded />
}
