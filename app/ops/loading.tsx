export default function OpsLoading() {
  return <main className="jobs-app-shell jobs-loading" aria-busy="true" aria-label="Loading MCSW Jobs">
    <section className="jobs-panel" aria-hidden="true"><span className="jobs-loading-line" /><span className="jobs-loading-line is-long" /><span className="jobs-loading-block" /></section>
    <section className="jobs-panel" aria-hidden="true"><span className="jobs-loading-line" /><span className="jobs-loading-row" /><span className="jobs-loading-row" /><span className="jobs-loading-row" /></section>
  </main>
}
