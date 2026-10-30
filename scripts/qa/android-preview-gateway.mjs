// Temporary, credential-free visual QA gateway. Never point it at a live CRM.
import { createServer, request } from "node:http"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const COOKIE = "mcsw_phone_qa"
const SESSION_MS = 90 * 60 * 1000
const surfaces = new Set(["board", "forms", "job", "customers", "account", "shop", "analytics", "calls", "updates", "login", "install", "builds", "customer"])
const states = new Set(["", "empty", "large", "failed", "pending", "completed"])
const policy = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; media-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'"

function equal(left, right) {
  const a = Buffer.from(left || "")
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function fixtureRequest(url) {
  if (url.pathname !== "/board/qa-polish") return false
  for (const [key, value] of url.searchParams) {
    if (key === "surface" && surfaces.has(value)) continue
    if (key === "state" && states.has(value)) continue
    if (key === "role" && ["owner", "crew"].includes(value)) continue
    return false
  }
  return true
}

function staticRequest(url) {
  if ([...url.searchParams.keys()].some((key) => key !== "v")) return false
  return (/^\/_next\/static\/[A-Za-z0-9_./[\]@-]+\.(?:js|css|woff2?|ttf|png|svg)$/.test(url.pathname)
    || /^\/images\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|avif|svg)$/.test(url.pathname)
    || ["/favicon.ico", "/icon.svg", "/apple-icon.png"].includes(url.pathname))
}

const landing = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Android CRM check</title><style>
:root{color-scheme:dark;font:17px/1.5 system-ui,sans-serif;background:#151515;color:#f5f1e9}*{box-sizing:border-box}body{margin:0;padding:24px 18px 48px}main{max-width:720px;margin:auto}h1{font-size:32px;line-height:1.1;margin:12px 0 18px}h2{font-size:20px;margin:28px 0 10px}p{color:#d2cbc0}a,button{display:block;min-height:48px;padding:12px 14px;border:1px solid #81796c;color:#fff;text-decoration:none;background:#222;font:inherit;text-align:left}a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #ff9d4b;outline-offset:3px}.links{display:grid;gap:10px}.links a:first-child{background:#b4490e;border-color:#ff9d4b}label{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #45413b}input{width:23px;height:23px;flex:none;margin-top:2px}small{display:block;color:#c4bdae}textarea{width:100%;min-height:130px;font:16px/1.5 system-ui;padding:12px;color:#fff;background:#222;border:1px solid #81796c}button{margin-top:12px;width:100%}.scope{border-left:3px solid #e87525;padding-left:14px}details{margin-top:20px}summary{min-height:44px;padding:10px 0}code{overflow-wrap:anywhere}#device{font-size:14px;overflow-wrap:anywhere}</style></head><body><main>
<small>MUSIC CITY SPECIALTY WELDING · PRIVATE PHONE CHECK</small><h1>Check the CRM on your Android</h1>
<p class="scope">This preview uses synthetic records. It checks layout, touch controls, your keyboard, and optional TalkBack. Saving, calls, messages, uploads, and microphone recording are disabled here.</p>
<p>Open each screen below in Chrome. Use Android Back to return here. Nothing is submitted by these checkboxes.</p>
<div class="links"><a href="/board/qa-polish?surface=board">1. Board and More menu</a><a href="/board/qa-polish?surface=forms&state=empty">2. Forms and keyboard</a><a href="/board/qa-polish?surface=job">3. Job, Price, and Photo sections</a><a href="/board/qa-polish?surface=customers">4. Customer directory</a></div>
<h2>What to check</h2>
<label><input type="checkbox" data-check="Board and menu"><span>Board text and totals fit. Open More, reach every item, then close it. No accidental sideways page scrolling.</span></label>
<label><input type="checkbox" data-check="Forms with native keyboard"><span>Tap name, phone, and note fields. With the keyboard open, labels and controls remain reachable and typed text stays visible.</span></label>
<label><input type="checkbox" data-check="Job section links"><span>Price and Photo reach the intended job sections. The bottom action rail does not cover the field you need.</span></label>
<label><input type="checkbox" data-check="Landscape and larger text"><span>Rotate to landscape and repeat the menu and form checks. If comfortable, repeat with your usual enlarged text setting.</span></label>
<label><input type="checkbox" data-check="TalkBack checked"><span>Optional TalkBack: controls have understandable spoken names, reading order makes sense, and the open menu keeps navigation inside it until closed.</span></label>
<details><summary>More screens and alternate states</summary><div class="links"><a href="/board/qa-polish?surface=board&role=crew">Crew board</a><a href="/board/qa-polish?surface=board&state=large">Long totals</a><a href="/board/qa-polish?surface=board&state=empty">Empty board</a><a href="/board/qa-polish?surface=job&state=failed">Job error state</a><a href="/board/qa-polish?surface=job&state=pending">Job pending state</a><a href="/board/qa-polish?surface=job&state=completed">Completed job</a><a href="/board/qa-polish?surface=account">Account</a><a href="/board/qa-polish?surface=shop">Settings</a><a href="/board/qa-polish?surface=analytics">Analytics</a><a href="/board/qa-polish?surface=calls">Calls</a><a href="/board/qa-polish?surface=updates">Updates</a><a href="/board/qa-polish?surface=login">Login layout</a><a href="/board/qa-polish?surface=customer">Customer page</a></div></details>
<h2>Tell us what happened</h2><p>Include anything clipped, hard to tap, covered by the keyboard, or spoken unclearly. An unchecked box means untested, not failed.</p><textarea id="notes" aria-label="Phone check observations" placeholder="Example: Board and keyboard look good; Price was hard to reach in landscape."></textarea><button id="copy" type="button">Copy results to paste into chat</button><p id="status" role="status"></p><p id="device"></p>
<script>
const storageKey='__QA_STORAGE_KEY__';
const boxes=[...document.querySelectorAll('[data-check]')];
const notes=document.getElementById('notes');
const device=navigator.userAgent+' | viewport '+innerWidth+'×'+innerHeight+' | screen '+screen.width+'×'+screen.height;
document.getElementById('device').textContent=device;
try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved){for(const box of boxes)box.checked=Array.isArray(saved.checked)&&saved.checked.includes(box.dataset.check);if(typeof saved.notes==='string')notes.value=saved.notes;}}catch{}
function save(){try{sessionStorage.setItem(storageKey,JSON.stringify({checked:boxes.filter(e=>e.checked).map(e=>e.dataset.check),notes:notes.value}));}catch{}}
for(const box of boxes)box.addEventListener('change',save);
notes.addEventListener('input',save);
document.getElementById('copy').onclick=async()=>{const checked=boxes.filter(e=>e.checked).map(e=>e.dataset.check);const text='Android CRM check\n'+device+'\nChecked: '+(checked.join(', ')||'None yet')+'\nObservations: '+notes.value;try{await navigator.clipboard.writeText(text);document.getElementById('status').textContent='Copied. Paste the results into our chat.'}catch{document.getElementById('status').textContent='Copy unavailable. Tell us your observations in chat.'}};
</script></main></body></html>`

export function createPhonePreviewGateway({ entryToken = randomBytes(32).toString("base64url"), cookieToken = randomBytes(32).toString("base64url"), upstreamPort = 3047, expiresAt = Date.now() + SESSION_MS } = {}) {
  const entryPath = `/open/${entryToken}`
  const sessionLanding = landing.replace("__QA_STORAGE_KEY__", `mcsw-phone-check-${randomBytes(8).toString("hex")}`)
  const server = createServer((req, res) => {
    const headers = {
      "Cache-Control": "no-store, private", "Pragma": "no-cache", "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
      "Content-Security-Policy": policy, "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    }
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
    const reply = (code, body) => { res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" }); res.end(req.method === "HEAD" ? "" : body) }
    if (!["GET", "HEAD"].includes(req.method)) return reply(405, "This visual preview does not accept submissions.")
    if (Date.now() >= expiresAt) return reply(410, "This phone-check session has expired. Ask for a fresh link.")
    let url
    try {
      const rawPath = req.url.split("?")[0]
      const decoded = decodeURIComponent(rawPath)
      if (!rawPath.startsWith("/") || rawPath.startsWith("//") || /[\\\0\r\n]/.test(decoded) || decoded.split("/").some((part) => part === "." || part === "..")) return reply(400, "Invalid preview path.")
      url = new URL(req.url, "http://127.0.0.1")
    } catch { return reply(400, "Invalid preview path.") }
    if (equal(url.pathname, entryPath) && !url.search) {
      const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""
      res.setHeader("Set-Cookie", `${COOKIE}=${cookieToken}; Path=/; Max-Age=${Math.floor((expiresAt - Date.now()) / 1000)}; HttpOnly; SameSite=Lax${secure}`)
      res.writeHead(303, { Location: "/" })
      return res.end()
    }
    const cookie = (req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
    if (!equal(cookie, cookieToken)) return reply(403, "Open the private phone-check link from the chat first.")
    if (url.pathname === "/" && !url.search) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      return res.end(req.method === "HEAD" ? "" : sessionLanding)
    }
    if (!fixtureRequest(url) && !staticRequest(url)) return reply(403, "This route is outside the phone-check preview.")
    const upstream = request({ hostname: "127.0.0.1", port: upstreamPort, path: url.pathname + url.search, method: req.method,
      headers: { Host: `127.0.0.1:${upstreamPort}`, Accept: "*/*", "Accept-Encoding": "identity" }, timeout: 90000 }, (source) => {
      if (source.statusCode !== 200) { source.resume(); return reply(502, "The preview screen is not ready. Return to the checklist and retry.") }
      res.writeHead(200, { "Content-Type": source.headers["content-type"] || "application/octet-stream" })
      source.on("error", () => res.destroy())
      source.pipe(res)
    })
    upstream.on("timeout", () => upstream.destroy(new Error("Preview timeout")))
    upstream.on("error", () => { if (!res.headersSent) reply(502, "The local preview is unavailable."); else res.destroy() })
    res.on("close", () => upstream.destroy())
    upstream.end()
  })
  server.on("upgrade", (_req, socket) => { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n") })
  return { server, entryPath, expiresAt }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { server, entryPath, expiresAt } = createPhonePreviewGateway()
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(3060, "127.0.0.1", accept) })
  await mkdir(".tmp", { recursive: true })
  await writeFile(".tmp/android-preview-gateway.json", JSON.stringify({ pid: process.pid, port: 3060, upstreamPort: 3047, entryPath, expiresAt: new Date(expiresAt).toISOString(), scope: "Synthetic visual/touch/keyboard/optional TalkBack only; no saves/providers/microphone/uploads" }, null, 2), { mode: 0o600 })
  console.log("Android visual QA gateway listening on loopback port 3060. Private entry metadata is in ignored .tmp.")
}
