import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"
import { backupConnectionEnvironment, dumpBackup } from "./backup-dump.mjs"

test("backup URL becomes distinct percent-decoded libpq fields without weakening TLS or read-only mode", () => {
  const env = backupConnectionEnvironment("postgresql://backup%40user:p%40ss%3Aword@db.example.invalid:6543/shop%20records?sslmode=require&channel_binding=require")
  assert.equal(env.PGHOST, "db.example.invalid")
  assert.equal(env.PGPORT, "6543")
  assert.equal(env.PGDATABASE, "shop records")
  assert.equal(env.PGUSER, "backup@user")
  assert.equal(env.PGPASSWORD, "p@ss:word")
  assert.equal(env.PGSSLMODE, "verify-full")
  assert.equal(env.PGCHANNELBINDING, "require")
  assert.equal(env.PGOPTIONS, "-c default_transaction_read_only=on")
  assert.equal(env.PGCONNECT_TIMEOUT, "15")
  assert.equal("DATABASE_URL_UNPOOLED" in env, false)
  const upgraded = backupConnectionEnvironment("postgres://u:p@db.example.invalid/shop?sslmode=disable&connect_timeout=99999")
  assert.equal(upgraded.PGSSLMODE, "verify-full")
  assert.equal(upgraded.PGPORT, "5432")
  assert.equal(upgraded.PGCONNECT_TIMEOUT, "15")
})

test("backup connection rejects missing credentials and options that could redirect or override the read-only session", () => {
  for (const value of [undefined, "bad", "https://u:p@db.example.invalid/shop",
    "postgres://u@db.example.invalid/shop", "postgres://u:p@db.example.invalid/",
    "postgres://u:p@db.example.invalid/shop?host=elsewhere.invalid",
    "postgres://u:p@db.example.invalid/shop?options=-c%20default_transaction_read_only=off",
    "postgres://u:p@db.example.invalid/shop?channel_binding=disable",
    "postgres://u:p@db.example.invalid/shop#fragment", "postgres://u:p%00@db.example.invalid/shop"]) {
    assert.throws(() => backupConnectionEnvironment(value))
  }
})

test("dump failure keeps credentials out of arguments and cleans only its owned container and certificate", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mcsw-backup-command-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const url = "postgres://synthetic_user:synthetic_secret@db.example.invalid/shop"
  const id = "a".repeat(64)
  const calls = []
  await assert.rejects(dumpBackup(url, directory, async (args, env, timeout) => {
    calls.push({ args, env, timeout })
    assert.equal(args.some((value) => value.includes("synthetic_secret") || value.includes(url)), false)
    if (args[0] === "run") {
      assert.equal(env.PGPASSWORD, "synthetic_secret")
      assert.equal(env.PGSSLMODE, "verify-full")
      assert.equal(env.PGOPTIONS, "-c default_transaction_read_only=on")
      assert.equal("DATABASE_URL_UNPOOLED" in env, false)
      assert.equal("BACKUP_ENCRYPTION_KEY" in env, false)
      assert.ok(args.includes("--no-password"))
      const cidPath = args[args.indexOf("--cidfile") + 1]
      await writeFile(cidPath, id)
      const certificate = join(directory, env.PGSSLROOTCERT.split("/").at(-1))
      assert.match(await readFile(certificate, "utf8"), /BEGIN CERTIFICATE/)
      throw new Error("Synthetic Docker failure")
    }
    assert.deepEqual(args, ["rm", "--force", id])
    assert.equal("PGPASSWORD" in env, false)
    assert.equal(timeout, 15000)
  }), /Synthetic Docker failure/)
  assert.equal(calls.length, 2)
  assert.deepEqual(await readdir(directory), [])
})

test("real libpq reaches the requested nondefault port and refuses a non-TLS server", async (t) => {
  const installed = join(process.env.MCSW_POSTGRES_BIN || "C:/Program Files/PostgreSQL/17/bin", "psql.exe")
  const psql = process.platform === "win32" && existsSync(installed) ? installed : "psql"
  const available = spawnSync(psql, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 5000 })
  if (available.error?.code === "ENOENT") return t.skip("PostgreSQL client is not installed")
  assert.equal(available.status, 0)
  const packets = []
  const sockets = new Set()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once("data", (chunk) => {
      packets.push(Buffer.from(chunk))
      socket.end("N") // PostgreSQL's explicit rejection of SSL negotiation.
    })
    socket.on("error", () => {})
    socket.once("close", () => sockets.delete(socket))
  })
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((done) => server.close(done))
  })
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", accept) })
  const port = server.address().port
  const runtime = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PATHEXT)$/i.test(key)))
  const env = { ...runtime, ...backupConnectionEnvironment(`postgres://fake_user:fake_secret@127.0.0.1:${port}/fake_database`) }
  const result = await new Promise((accept, reject) => {
    const child = spawn(psql, ["--no-password", "-At", "-c", "SELECT 1"], { env, windowsHide: true, timeout: 5000 })
    let output = ""
    child.stdout.on("data", (chunk) => { output += chunk })
    child.stderr.on("data", (chunk) => { output += chunk })
    child.once("error", reject)
    child.once("close", (code) => accept({ code, output }))
  })
  assert.notEqual(result.code, 0)
  assert.equal(packets.length, 1, "libpq must connect to the selected ephemeral port")
  assert.equal(packets[0].toString("hex"), "0000000804d2162f", "libpq must request TLS before sending authentication")
  assert.match(result.output, /SSL/i)
  assert.doesNotMatch(result.output, /fake_secret/)
})
