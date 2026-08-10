import Link from "next/link"

export default function OpsNotFound() {
  return <main className="jobs-route-state">
    <section className="jobs-panel">
      <p className="jobs-route-kicker">Nothing was changed</p>
      <h1>Job or customer not found.</h1>
      <p>The link may be old, or this record may have been filed somewhere else. Check Active Jobs or search from the Jobs home.</p>
      <div><Link href="/ops">Back to Jobs</Link></div>
    </section>
  </main>
}
