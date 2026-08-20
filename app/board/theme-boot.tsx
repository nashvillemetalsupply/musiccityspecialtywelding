// Pre-paint theme boot shared by every /board surface. board.tsx's toggle
// reads and writes the same localStorage key and only runs on /board, so the
// satellite pages (customers, calls, updates) would flash light on a hard load
// with a saved dark theme. This inline script stamps the saved theme onto
// <html data-theme> before the first paint; the toggle still owns live changes.
const BOOT = `try { var t = localStorage.getItem("mcsw-theme"); if (t) { document.documentElement.setAttribute("data-theme", t) } } catch (e) {}`

export function ThemeBoot() {
  return <script dangerouslySetInnerHTML={{ __html: BOOT }} />
}
