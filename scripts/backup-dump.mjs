import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { writeFile, readFile, unlink } from "node:fs/promises"
import { resolve, join } from "node:path"
import { rootCertificates } from "node:tls"
import { pathToFileURL } from "node:url"

// libpq does not expand a URI supplied through PGDATABASE. Keep each connection
// field explicit, and never pass credentials in process arguments or logs.
export function backupConnectionEnvironment(value) {
  let url
  try { url = new URL(value) } catch { throw new Error("Invalid backup connection.") }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hash) {
    throw new Error("Invalid backup connection.")
  }
  const allowed = new Set(["sslmode", "channel_binding", "connect_timeout"])
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) {
    throw new Error("Unsupported backup connection option.")
  }
  let user, password, database
  try {
    user = decodeURIComponent(url.username)
    password = decodeURIComponent(url.password)
    database = decodeURIComponent(url.pathname.slice(1))
  } catch { throw new Error("Invalid backup connection.") }
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (![host, user, password, database].every((part) => part && !/[\0\r\n]/.test(part))) {
    throw new Error("Incomplete backup connection.")
  }
  const channelBinding = url.searchParams.get("channel_binding") || "prefer"
  if (!["prefer", "require"].includes(channelBinding)) {
    throw new Error("Backup channel binding cannot be disabled.")
  }
  return {
    PGHOST: host,
    PGPORT: url.port || "5432",
    PGDATABASE: database,
    PGUSER: user,
    PGPASSWORD: password,
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: "system",
    PGCHANNELBINDING: channelBinding,
    PGCONNECT_TIMEOUT: "15",
    PGOPTIONS: "-c default_transaction_read_only=on",
    PGAPPNAME: "mcsw-readonly-backup",
  }
}

async function runDocker(args, env, timeout) {
  await new Promise((accept, reject) => {
    const child = spawn("docker", args, { env, stdio: "ignore", windowsHide: true, timeout })
    child.once("error", () => reject(new Error("Backup dump failed.")))
    child.once("close", (code) => code === 0 ? accept() : reject(new Error("Backup dump failed.")))
  })
}

export async function dumpBackup(databaseUrl, workspace = process.cwd(), run = runDocker) {
  const connection = backupConnectionEnvironment(databaseUrl)
  const directory = resolve(workspace)
  const certificateName = `.mcsw-backup-ca-${randomBytes(12).toString("hex")}.pem`
  const certificatePath = join(directory, certificateName)
  const containerPath = join(directory, `${certificateName}.cid`)
  let completed = false
  // Node's bundled public trust roots avoid relying on a container's optional
  // CA package. libpq still verifies both the server certificate and hostname.
  await writeFile(certificatePath, rootCertificates.join("\n"), { flag: "wx", mode: 0o600 })
  const runtime = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(PATH|HOME|USERPROFILE|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP)$/i.test(key)))
  try {
    const env = { ...runtime, ...connection, PGSSLROOTCERT: `/backup/${certificateName}` }
    const args = ["run", "--rm", "--cidfile", containerPath, ...Object.keys(connection).flatMap((key) => ["--env", key]),
      "--volume", `${directory}:/backup`, "--workdir", "/backup", "postgres:17-alpine",
      "pg_dump", "--no-password", "--format=custom", "--no-owner", "--no-acl",
      "--file=/backup/mcsw-backup.dump"]
    await run(args, env, 20 * 60 * 1000)
    completed = true
  } finally {
    // A killed Docker client may leave its container alive. On failure, stop
    // only the container ID created by this invocation; never enumerate others.
    if (!completed) {
      const id = (await readFile(containerPath, "utf8").catch(() => "")).trim()
      if (/^[a-f0-9]{64}$/.test(id)) await run(["rm", "--force", id], runtime, 15000).catch(() => {})
    }
    await unlink(containerPath).catch(() => {})
    await unlink(certificatePath)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  dumpBackup(process.env.DATABASE_URL_UNPOOLED).then(() => {
    console.log("Read-only backup dump completed.")
  }).catch(() => {
    console.error("Backup dump failed. Check the connection secret, PostgreSQL version, TLS trust, and Docker availability.")
    process.exitCode = 1
  })
}
