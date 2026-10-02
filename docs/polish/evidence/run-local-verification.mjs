import { spawn } from "node:child_process"
import { closeSync, openSync } from "node:fs"
import { connect } from "node:net"
import { resolve } from "node:path"

const phase = String(process.argv[2] || "").toUpperCase()
if (!["P01", "P02", "P03"].includes(phase)) {
  console.error("Usage: node docs/polish/evidence/run-local-verification.mjs P01|P02|P03")
  process.exit(2)
}

const host = "127.0.0.1"
const port = 3041
const verificationTimeoutMs = 120_000
const evidenceDir = resolve("docs/polish/evidence")
const nextBin = resolve("node_modules/next/dist/bin/next")
const verifier = resolve(evidenceDir, "verify-local-fixes.mjs")
const serverLog = resolve(evidenceDir, `${phase}-local-server.log`)

function waitForExit(child) {
  if (!child) return Promise.resolve({ code: null, signal: null })
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("exit", (code, signal) => resolvePromise({ code, signal }))
    child.once("error", rejectPromise)
  })
}

async function assertPortUnused() {
  await new Promise((resolvePromise, rejectPromise) => {
    const socket = connect({ host, port })
    socket.once("connect", () => {
      socket.destroy()
      rejectPromise(new Error(`Refusing to start: ${host}:${port} is already in use.`))
    })
    socket.once("error", error => {
      socket.destroy()
      if (error?.code === "ECONNREFUSED") resolvePromise()
      else rejectPromise(error)
    })
  })
}

async function terminateOwnedChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  const exit = waitForExit(child)
  const signalSent = child.kill("SIGTERM")
  if (!signalSent && child.exitCode === null && child.signalCode === null) {
    throw new Error(`Could not terminate owned child PID ${child.pid}.`)
  }
  await exit
}

let nextChild
let verifyChild
let logFd
try {
  await assertPortUnused()
  logFd = openSync(serverLog, "w")
  nextChild = spawn(process.execPath, [
    nextBin,
    "start",
    "--hostname",
    host,
    "--port",
    String(port),
  ], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ["ignore", logFd, logFd],
  })
  closeSync(logFd)
  logFd = undefined

  const nextExit = waitForExit(nextChild)
  verifyChild = spawn(process.execPath, [verifier, phase], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  verifyChild.stdout.pipe(process.stdout)
  verifyChild.stderr.pipe(process.stderr)
  const verifyExit = waitForExit(verifyChild)

  let timer
  const timeout = new Promise(resolvePromise => {
    timer = setTimeout(() => resolvePromise({ kind: "timeout" }), verificationTimeoutMs)
  })
  const outcome = await Promise.race([
    verifyExit.then(result => ({ kind: "verification", result })),
    nextExit.then(result => ({ kind: "server-exit", result })),
    timeout,
  ])
  clearTimeout(timer)

  if (outcome.kind === "timeout") {
    await terminateOwnedChild(verifyChild)
    throw new Error(`${phase} verification exceeded ${verificationTimeoutMs / 1000} seconds.`)
  }
  if (outcome.kind === "server-exit") {
    await terminateOwnedChild(verifyChild)
    throw new Error(`Owned Next server exited before verification completed (code=${outcome.result.code}, signal=${outcome.result.signal || "none"}). See ${serverLog}.`)
  }
  if (outcome.result.code !== 0) {
    throw new Error(`${phase} verifier exited with code ${outcome.result.code}. See its JSON evidence and ${serverLog}.`)
  }

  console.log(JSON.stringify({
    phase,
    ok: true,
    verifierExitCode: outcome.result.code,
    serverLog,
  }))
} catch (error) {
  console.error(JSON.stringify({
    phase,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    serverLog,
  }))
  process.exitCode = 1
} finally {
  if (logFd !== undefined) closeSync(logFd)
  try {
    await terminateOwnedChild(nextChild)
  } catch (error) {
    console.error(JSON.stringify({
      phase,
      ok: false,
      cleanupError: error instanceof Error ? error.message : String(error),
      ownedServerPid: nextChild?.pid ?? null,
    }))
    process.exitCode = 1
  }
}
