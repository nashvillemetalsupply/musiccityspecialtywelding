// Run with the pinned Node runtime; requires a local PostgreSQL installation.
// Creates a fresh cluster, migrates twice, runs real persistence checks, and stops it.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { transformBackup } from "../backup-crypto.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const runDir = path.join(root, ".tmp", `predeploy-postgres-${Date.now()}`)
const cluster = path.join(runDir, "data")
const pgBin = process.env.MCSW_POSTGRES_BIN || "C:/Program Files/PostgreSQL/17/bin"
mkdirSync(runDir, { recursive: true })
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PATHEXT)$/i.test(key)))
const reservation = createServer()
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve))
const port = reservation.address().port
await new Promise((resolve) => reservation.close(resolve))
Object.assign(env, {
  MCSW_DISPOSABLE_DATABASE: "1",
  DATABASE_URL: `postgresql://mcsw_qa@127.0.0.1:${port}/mcsw_predeploy?sslmode=disable`,
  DATABASE_URL_UNPOOLED: `postgresql://mcsw_qa@127.0.0.1:${port}/mcsw_predeploy?sslmode=disable`,
  OPS_LOGIN_EMAIL: "owner@predeploy.invalid",
  NODE_ENV: "test",
})
const stages = []
function run(label, binary, args, acceptedCodes = [0]) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const child = spawn(binary, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    const timeout = setTimeout(() => child.kill(), 180_000)
    let output = ""
    child.stdout.on("data", (chunk) => { output += chunk })
    child.stderr.on("data", (chunk) => { output += chunk })
    child.once("error", (error) => { clearTimeout(timeout); reject(error) })
    // pg_ctl's daemon may inherit pipe handles on Windows after pg_ctl exits.
    child.once(label.startsWith("start") ? "exit" : "close", (code) => {
      clearTimeout(timeout)
      if (label.startsWith("start")) { child.stdout.destroy(); child.stderr.destroy() }
      writeFileSync(path.join(runDir, `${label}.log`), output)
      stages.push({ label, code, durationMs: Date.now() - started })
      console.log(`${label}: exit ${code}`)
      if (!acceptedCodes.includes(code)) reject(new Error(`${label} failed; see ${path.join(runDir, `${label}.log`)}\n${output.slice(-2500)}`))
      else resolve(output)
    })
  })
}
const exe = (name) => path.join(pgBin, `${name}${process.platform === "win32" ? ".exe" : ""}`)
const transport = path.join(root, "scripts/qa/local-postgres-transport.mjs")
const nodeArgs = ["--experimental-strip-types", "--import", pathToFileURL(transport).href]
let started = false
let startupAttempted = false
try {
  await run("initdb", exe("initdb"), ["-D", cluster, "-U", "mcsw_qa", "--auth=trust", "--encoding=UTF8", "--locale=C"])
  startupAttempted = true
  await run("start", exe("pg_ctl"), ["-D", cluster, "-l", path.join(runDir, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"])
  started = true
  await run("createdb", exe("createdb"), ["-h", "127.0.0.1", "-p", String(port), "-U", "mcsw_qa", "mcsw_predeploy"])
  await run("migrate-fresh", process.execPath, [...nodeArgs, "scripts/migrate.mjs"])
  await run("migrate-replay", process.execPath, [...nodeArgs, "scripts/migrate.mjs"])
  const result = await run("persistence", process.execPath, [...nodeArgs, "--test", "--test-reporter=tap", "scripts/build-sheets-persistence.test.mjs"])
  assert.match(result, /# pass 2\b/)
  assert.match(result, /# fail 0\b/)
  assert.match(result, /# skipped 0\b/)
  await run("backend-behavior", process.execPath, [...nodeArgs, "--test", "--test-reporter=tap", "scripts/qa/predeploy-postgres.behavior.mjs"])
  const durabilityQuery = "SELECT json_build_object('events',(SELECT count(*) FROM events),'messages',(SELECT count(*) FROM messages),'calls',(SELECT count(*) FROM calls),'uploads',(SELECT count(*) FROM closeout_photo_uploads),'migrations',(SELECT count(*) FROM schema_migrations))";
  const inspectArgs = ["-h", "127.0.0.1", "-p", String(port), "-U", "mcsw_qa", "-d", "mcsw_predeploy", "-At", "-v", "ON_ERROR_STOP=1", "-c", durabilityQuery]
  const beforeRestart = await run("durability-before", exe("psql"), inspectArgs)
  await run("stop-for-restart", exe("pg_ctl"), ["-D", cluster, "-m", "fast", "-w", "stop"])
  started = false
  await run("start-after-restart", exe("pg_ctl"), ["-D", cluster, "-l", path.join(runDir, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"])
  started = true
  const afterRestart = await run("durability-after", exe("psql"), inspectArgs)
  assert.deepEqual(JSON.parse(afterRestart), JSON.parse(beforeRestart))
  assert.ok(JSON.parse(afterRestart).messages > 0)
  const dumpPath = path.join(runDir, "synthetic-backup.dump")
  const connectionArgs = ["-h", "127.0.0.1", "-p", String(port), "-U", "mcsw_qa"]
  const tableCountsFile = path.join(runDir, "table-counts.sql")
  writeFileSync(tableCountsFile, "SELECT format('SELECT %L || ''|'' || count(*)::text FROM %I.%I;', schemaname || '.' || tablename, schemaname, tablename) FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename\n\\gexec\n")
  const sourceCounts = await run("source-table-counts", exe("psql"), [...connectionArgs, "-d", "mcsw_predeploy", "-At", "-v", "ON_ERROR_STOP=1", "-f", tableCountsFile])
  await run("dump-synthetic", exe("pg_dump"), [...connectionArgs, "-d", "mcsw_predeploy", "-Fc", "--no-owner", "--no-privileges", "-f", dumpPath])
  const encryptionStarted = Date.now()
  const encryptedPath = path.join(runDir, "synthetic-backup.dump.enc")
  const decryptedPath = path.join(runDir, "synthetic-backup.decrypted.dump")
  const temporaryKey = randomBytes(32).toString("hex")
  await transformBackup("encrypt", dumpPath, encryptedPath, temporaryKey)
  await transformBackup("decrypt", encryptedPath, decryptedPath, temporaryKey)
  const digest = (filename) => createHash("sha256").update(readFileSync(filename)).digest("hex")
  assert.equal(digest(decryptedPath), digest(dumpPath))
  assert.notEqual(digest(encryptedPath), digest(dumpPath))
  stages.push({ label: "authenticated-encryption-roundtrip", code: 0, durationMs: Date.now() - encryptionStarted })
  await run("create-restore-db", exe("createdb"), [...connectionArgs, "mcsw_predeploy_restore"])
  await run("restore-synthetic", exe("pg_restore"), [...connectionArgs, "-d", "mcsw_predeploy_restore", "--no-owner", "--no-privileges", "--exit-on-error", decryptedPath])
  const restored = await run("restore-counts", exe("psql"), [...connectionArgs, "-d", "mcsw_predeploy_restore", "-At", "-v", "ON_ERROR_STOP=1", "-c", durabilityQuery])
  assert.deepEqual(JSON.parse(restored), JSON.parse(beforeRestart))
  const restoredCounts = await run("restored-table-counts", exe("psql"), [...connectionArgs, "-d", "mcsw_predeploy_restore", "-At", "-v", "ON_ERROR_STOP=1", "-f", tableCountsFile])
  assert.equal(restoredCounts.trim(), sourceCounts.trim())
} finally {
  try {
    if (!started && startupAttempted && existsSync(path.join(cluster, "postmaster.pid"))) {
      await run("startup-status", exe("pg_ctl"), ["-D", cluster, "status"], [0, 3])
      started = stages.at(-1).code === 0
    }
    if (started) await run("stop", exe("pg_ctl"), ["-D", cluster, "-m", "fast", "-w", "stop"])
  } finally {
    writeFileSync(path.join(runDir, "result.json"), JSON.stringify({ runDir, port, stages, remoteConnections: false, providerCalls: false }, null, 2))
    console.log(`Evidence: ${runDir}`)
  }
}
