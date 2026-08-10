import { createServer } from "node:http"
import { randomBytes } from "node:crypto"

const clientId = process.env.GMAIL_CLIENT_ID
const clientSecret = process.env.GMAIL_CLIENT_SECRET
if (!clientId || !clientSecret) throw new Error("Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET locally first.")
const port = 53682
const redirectUri = `http://127.0.0.1:${port}/oauth2/callback`
const state = randomBytes(18).toString("hex")
const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth")
auth.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "https://www.googleapis.com/auth/gmail.readonly", access_type: "offline", prompt: "consent", state }).toString()
console.log(`Open this URL while signed in as sales@:\n\n${auth}\n`)
const code = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, redirectUri)
    if (url.pathname !== "/oauth2/callback" || url.searchParams.get("state") !== state) { res.writeHead(400).end("Invalid callback"); return }
    const value = url.searchParams.get("code")
    res.end("Gmail approved. Return to the terminal.")
    server.close()
    if (value) resolve(value)
    else reject(new Error("Google returned no code."))
  }).listen(port, "127.0.0.1")
})
const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }) })
const data = await response.json()
if (!response.ok || !data.refresh_token) throw new Error(data.error_description || "No refresh token returned.")
console.log(`\nGMAIL_REFRESH_TOKEN=${data.refresh_token}\n`)
