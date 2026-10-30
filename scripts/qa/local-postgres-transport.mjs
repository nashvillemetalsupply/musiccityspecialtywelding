// QA only: transport the real Neon wire protocol to a disposable loopback database.
// No SQL is interpreted or mocked here, and no remote destination is permitted.
import { createConnection } from "node:net"
import { WebSocketServer } from "ws"
import { neonConfig } from "@neondatabase/serverless"

const url = new URL(process.env.DATABASE_URL || "postgres://invalid")
if (process.env.MCSW_DISPOSABLE_DATABASE !== "1" || url.hostname !== "127.0.0.1"
  || url.pathname !== "/mcsw_predeploy" || url.username !== "mcsw_qa" || !url.port
  || process.env.DATABASE_URL_UNPOOLED !== process.env.DATABASE_URL) {
  throw new Error("Local persistence QA requires an explicitly isolated loopback database")
}
const server = new WebSocketServer({ host: "127.0.0.1", port: 0 })
await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject) })
server.on("connection", (socket) => {
  const tcp = createConnection({ host: "127.0.0.1", port: Number(url.port) })
  socket.on("message", (data) => tcp.write(data))
  tcp.on("data", (data) => { if (socket.readyState === 1) socket.send(data) })
  socket.on("close", () => tcp.destroy())
  socket.on("error", () => tcp.destroy())
  tcp.on("close", () => socket.close())
  tcp.on("error", () => socket.close())
})
server._server.unref()
neonConfig.wsProxy = () => `127.0.0.1:${server.address().port}`
neonConfig.useSecureWebSocket = false
neonConfig.pipelineConnect = false
neonConfig.pipelineTLS = false
neonConfig.forceDisablePgSSL = true
