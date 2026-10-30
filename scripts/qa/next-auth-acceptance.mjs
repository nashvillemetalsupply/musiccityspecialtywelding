import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
// Next loads dotenv files itself after startup; stripping inherited env alone
// would not isolate a checkout that later gains ordinary provider credentials.
for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  assert.equal(existsSync(path.join(root, name)), false, `Remove ${name} from this isolated QA checkout before running`)
}
const appPortProbe = createServer()
await new Promise((done, reject) => {
  appPortProbe.once("error", reject)
  appPortProbe.listen(3050, "127.0.0.1", done)
})
await new Promise((done) => appPortProbe.close(done))
const directory = path.join(root, ".tmp", `next-auth-${Date.now()}`)
mkdirSync(directory, { recursive: true })
const cluster = path.join(directory, "data")
const pgBin = process.env.MCSW_POSTGRES_BIN || "C:/Program Files/PostgreSQL/17/bin"
const portServer = createServer()
await new Promise((done) => portServer.listen(0, "127.0.0.1", done))
const port = portServer.address().port
await new Promise((done) => portServer.close(done))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PATHEXT)$/i.test(key)))
Object.assign(env, {
  MCSW_DISPOSABLE_DATABASE: "1",
  DATABASE_URL: `postgresql://mcsw_qa@127.0.0.1:${port}/mcsw_predeploy?sslmode=disable`,
  DATABASE_URL_UNPOOLED: `postgresql://mcsw_qa@127.0.0.1:${port}/mcsw_predeploy?sslmode=disable`,
  OPS_LOGIN_EMAIL: "owner@acceptance.invalid", OPS_PUNCH_SECRET: randomBytes(32).toString("hex"),
  NEXT_PUBLIC_SITE_URL: "http://localhost:3050", TWILIO_WEBHOOK_BASE_URL: "https://qa.invalid",
  NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production", MCSW_POSTGRES_BIN: pgBin,
  MCSW_QA_NETWORK_LOG: path.join(directory, "network.jsonl"), MCSW_QA_DATA: path.join(directory, "synthetic-access.json"),
})
const stages = []
function run(label, executable, args, settings = {}) {
  return new Promise((accept, reject) => {
    const started = Date.now()
    const child = spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...settings })
    const timeout = setTimeout(() => child.kill(), 180000)
    let output = ""
    child.stdout.on("data", (chunk) => { output += chunk })
    child.stderr.on("data", (chunk) => { output += chunk })
    child.once("error", (error) => { clearTimeout(timeout); reject(error) })
    child.once(label === "start-database" ? "exit" : "close", (code) => {
      clearTimeout(timeout)
      if (label === "start-database") { child.stdout.destroy(); child.stderr.destroy() }
      writeFileSync(path.join(directory, `${label}.log`), output)
      stages.push({ label, code, durationMs: Date.now() - started })
      console.log(`${label}: ${code}`)
      if (code !== 0) reject(new Error(`${label} failed; inspect its local log`))
      else accept(output)
    })
  })
}
const exe = (name) => path.join(pgBin, `${name}.exe`)
const connection = ["-h", "127.0.0.1", "-p", String(port), "-U", "mcsw_qa", "-d", "mcsw_predeploy", "-At", "-v", "ON_ERROR_STOP=1"]
let next, started = false, startupAttempted = false, success = false, databaseRemoved = false
const nextOutput = []
try {
  assert.ok(existsSync(path.join(root, ".next/BUILD_ID")), "A production Next build is required")
  await run("initdb", exe("initdb"), ["-D", cluster, "-U", "mcsw_qa", "--auth=trust", "--encoding=UTF8", "--locale=C"])
  startupAttempted = true
  await run("start-database", exe("pg_ctl"), ["-D", cluster, "-l", path.join(directory, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"])
  started = true
  await run("createdb", exe("createdb"), ["-h", "127.0.0.1", "-p", String(port), "-U", "mcsw_qa", "mcsw_predeploy"])
  await run("migrate", process.execPath, ["--experimental-strip-types", "--import", pathToFileURL(path.join(root, "scripts/qa/local-postgres-transport.mjs")).href, "scripts/migrate.mjs"])
  const tokens = Object.fromEntries(["owner", "crew", "ownerBrowser", "crewBrowser", "expired"].map((key) => [key, randomBytes(32).toString("hex")]))
  const seeds = [
    "INSERT INTO operators(email,name,role) VALUES('owner@acceptance.invalid','Acceptance Owner','owner') ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role;",
    "INSERT INTO operators(email,name,role) VALUES('crew@acceptance.invalid','Acceptance Crew','crew') ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role;",
    "INSERT INTO leads(public_id,first_name,phone,phone_is_placeholder,email,service,source,is_test,message,crew_message,estimate_value_cents) VALUES('AUTH-ACCEPTANCE-JOB','Acceptance Gate','',true,'fixture@acceptance.invalid','Gate fabrication','isolated-acceptance',false,'OWNER_ONLY_ACCEPTANCE_913579','Weld the gate hinge',913579);",
    "INSERT INTO leads(public_id,first_name,phone,service,source,is_test) VALUES('AUTH-ACCEPTANCE-TEST','[INTERNAL TEST] Restricted Gate','','Gate fabrication','isolated-acceptance',true);",
    "INSERT INTO voice_transcription_intents(id,operator_id,content_type,status,recovery_key,blob_path,last_error) SELECT 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',id,'audio/webm','failed','done:acceptance','','Synthetic storage refusal' FROM operators WHERE email='owner@acceptance.invalid';",
  ]
  for (const [key, token] of Object.entries(tokens)) {
    const email = key.startsWith("crew") ? "crew@acceptance.invalid" : "owner@acceptance.invalid"
    const hash = createHash("sha256").update(token).digest("hex")
    seeds.push(`INSERT INTO ops_tokens(token_hash,purpose,email,operator_id,expires_at) SELECT '${hash}','login','${email}',id,now() ${key === "expired" ? "-" : "+"} interval '15 minutes' FROM operators WHERE email='${email}';`)
  }
  seeds.push("SELECT json_build_object('lead',(SELECT id FROM leads WHERE public_id='AUTH-ACCEPTANCE-JOB'),'testLead',(SELECT id FROM leads WHERE public_id='AUTH-ACCEPTANCE-TEST'));")
  writeFileSync(path.join(directory, "seed.sql"), seeds.join("\n"))
  const seeded = await run("seed", exe("psql"), [...connection, "-f", path.join(directory, "seed.sql")])
  const ids = JSON.parse(seeded.trim().split(/\r?\n/).at(-1))
  writeFileSync(env.MCSW_QA_DATA, JSON.stringify({ ...tokens, ...ids, port }), { mode: 0o600 })
  // A named loopback host gives Neon's stock HTTP endpoint formatter a valid
  // URL for Next's fetch wrapper; the preload handles it before any I/O.
  const nextEnv = { ...env, DATABASE_URL: env.DATABASE_URL.replace("@127.0.0.1:", "@localhost:"), DATABASE_URL_UNPOOLED: env.DATABASE_URL.replace("@127.0.0.1:", "@localhost:") }
  next = spawn(process.execPath, ["--import", pathToFileURL(path.join(root, "scripts/qa/local-next-postgres-preload.mjs")).href,
    "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3050"],
  { cwd: root, env: nextEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
  next.stdout.on("data", (chunk) => nextOutput.push(chunk.toString()))
  next.stderr.on("data", (chunk) => nextOutput.push(chunk.toString()))
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    if (next.exitCode !== null) throw new Error("Next production server exited")
    try { ready = (await fetch("http://127.0.0.1:3050/api/ops/cache-session")).status === 401 } catch {}
    if (ready) break
    await new Promise((done) => setTimeout(done, 500))
  }
  assert.equal(ready, true, "Production server must become ready")
  await run("http-browser", process.execPath, ["scripts/qa/next-auth-browser.mjs"])
  const network = readFileSync(env.MCSW_QA_NETWORK_LOG, "utf8").trim().split("\n").map(JSON.parse)
  assert.equal(network.filter((entry) => entry.kind.startsWith("blocked")).length, 0, "Application must not attempt external traffic")
  assert.equal(network.filter((entry) => entry.kind === "database-error").length, 0, "Actual route SQL must succeed")
  assert.ok(network.some((entry) => entry.kind === "database-request"))
  success = true
} finally {
  if (next && next.exitCode === null) {
    next.kill()
    await new Promise((done) => { next.once("exit", done); setTimeout(done, 5000) })
  }
  writeFileSync(path.join(directory, "next.log"), nextOutput.join(""))
  if (!started && startupAttempted && existsSync(path.join(cluster, "postmaster.pid"))) started = true
  if (started) await run("stop-database", exe("pg_ctl"), ["-D", cluster, "-m", "fast", "-w", "stop"])
  const safeRoot = path.join(root, ".tmp") + path.sep
  assert.ok(path.resolve(cluster).startsWith(safeRoot))
  if (existsSync(cluster)) rmSync(cluster, { recursive: true, force: true })
  databaseRemoved = !existsSync(cluster)
  for (const name of ["seed.sql", "synthetic-access.json", "postgres.log"]) rmSync(path.join(directory, name), { force: true })
  writeFileSync(path.join(directory, "summary.json"), JSON.stringify({ success, stages, port, appPort: 3050,
    productionSourceModified: false, actualNextHttp: true, actualPostgreSql: true, providerCalls: false,
    syntheticDatabaseRemoved: databaseRemoved, completedAt: new Date().toISOString() }, null, 2))
  console.log(`Evidence: ${directory}`)
}
