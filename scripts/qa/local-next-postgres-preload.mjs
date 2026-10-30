// QA-only transport for the unchanged Next production server. SQL still runs in
// real PostgreSQL; only Neon's HTTP transport is translated to its wire driver.
import net from "node:net"
import { appendFileSync } from "node:fs"
import { Pool, neonConfig } from "@neondatabase/serverless"
import WebSocket, { WebSocketServer } from "ws"

const expected = process.env.DATABASE_URL
const url = new URL(expected)
if (process.env.MCSW_DISPOSABLE_DATABASE !== "1" || url.hostname !== "localhost"
  || url.pathname !== "/mcsw_predeploy" || url.username !== "mcsw_qa" || !url.port
  || expected !== process.env.DATABASE_URL_UNPOOLED || !process.env.MCSW_QA_NETWORK_LOG) {
  throw new Error("Refusing non-local Next acceptance transport")
}
const record = (kind, detail = {}) => appendFileSync(process.env.MCSW_QA_NETWORK_LOG,
  JSON.stringify({ kind, ...detail }) + "\n")
const local = (host) => ["127.0.0.1", "localhost", "::1"].includes(String(host).replace(/^\[|\]$/g, ""))
const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  const host = typeof first === "object" ? first.host : typeof args[1] === "string" ? args[1] : "localhost"
  const pipe = typeof first === "object" && first.path
  if (!pipe && !local(host || "localhost")) {
    record("blocked-socket", { host: String(host) })
    throw new Error("QA blocks non-loopback socket connections")
  }
  return connect.apply(this, args)
}
neonConfig.webSocketConstructor = WebSocket
const wire = new WebSocketServer({ host: "127.0.0.1", port: 0 })
await new Promise((done, reject) => { wire.once("listening", done); wire.once("error", reject) })
wire.on("connection", (socket) => {
  const tcp = net.createConnection({ host: "127.0.0.1", port: Number(url.port) })
  socket.on("message", (data) => tcp.write(data))
  tcp.on("data", (data) => { if (socket.readyState === 1) socket.send(data) })
  socket.on("close", () => tcp.destroy())
  socket.on("error", () => tcp.destroy())
  tcp.on("close", () => socket.close())
  tcp.on("error", () => socket.close())
})
wire._server.unref()
neonConfig.wsProxy = () => `127.0.0.1:${wire.address().port}`
neonConfig.useSecureWebSocket = false
neonConfig.pipelineConnect = false
neonConfig.pipelineTLS = false
neonConfig.forceDisablePgSSL = true
const pool = new Pool({ connectionString: expected, max: 10 })
const rawTypes = { getTypeParser: () => (value) => value }
const nativeFetch = globalThis.fetch
globalThis.fetch = async function (input, options = {}) {
  const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined))
  const connection = headers.get("Neon-Connection-String")
  if (connection) {
    if (connection !== expected) throw new Error("QA rejected unexpected database identity")
    const payload = JSON.parse(options.body)
    const client = await pool.connect()
    const batch = Array.isArray(payload.queries)
    try {
      if (batch) {
        await client.query("BEGIN")
        const isolation = headers.get("Neon-Batch-Isolation-Level")
        if (isolation) {
          if (!["ReadUncommitted", "ReadCommitted", "RepeatableRead", "Serializable"].includes(isolation)) throw new Error("Unknown QA transaction isolation")
          const names = { ReadUncommitted: "READ UNCOMMITTED", ReadCommitted: "READ COMMITTED", RepeatableRead: "REPEATABLE READ", Serializable: "SERIALIZABLE" }
          await client.query(`SET TRANSACTION ISOLATION LEVEL ${names[isolation]}`)
        }
        if (headers.get("Neon-Batch-Read-Only") === "true") await client.query("SET TRANSACTION READ ONLY")
      }
      const results = []
      for (const query of batch ? payload.queries : [payload]) {
        const result = await client.query({ text: query.query, values: query.params, rowMode: "array", types: rawTypes })
        results.push({ command: result.command, rowCount: result.rowCount, rows: result.rows, fields: result.fields })
      }
      if (batch) await client.query("COMMIT")
      record("database-request", { batch, queries: results.length })
      return Response.json(batch ? { results } : results[0])
    } catch (error) {
      if (batch) await client.query("ROLLBACK").catch(() => {})
      record("database-error", { code: error.code || "unknown" })
      return Response.json({ message: error.message, code: error.code }, { status: 400 })
    } finally { client.release() }
  }
  const destination = new URL(input instanceof Request ? input.url : input)
  if (!local(destination.hostname)) {
    record("blocked-fetch", { host: destination.hostname })
    throw new Error("QA blocks non-loopback fetch requests")
  }
  return nativeFetch(input, options)
}
record("transport-ready", { externalNetworkAllowed: false })
