// Read-only Blob reset check. No object reads, uploads, env changes, or IDs in output.
// Run after 2026-11-12T08:05:39.574Z; metadata recovery alone is not upload acceptance.
// From crm-polish with Node 24: node scripts/qa/blob-reset-check.mjs --config-root ../..
// Uses existing CLI login and config-root/.env.local + .vercel/project.json privately.
// Node exit codes: 0 metadata available, 2 still blocked/unknown, 1 check failed.
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { parseEnv } from "node:util"

const expectedReset = "2026-11-12T08:05:39.574Z"
const summary = { checkedAt: new Date().toISOString(), expectedReset, readOnly: true }
let stage = "arguments"

function safeEnum(value, allowed) {
  return allowed.includes(value) ? value : "unknown"
}

function date(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 8.64e15
    ? new Date(value).toISOString() : null
}

try {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== "--config-root")) throw new Error("arguments")
  stage = "local-configuration"
  const configRoot = path.resolve(args[1] || ".")
  const config = JSON.parse(readFileSync(path.join(configRoot, ".vercel/project.json"), "utf8"))
  const token = parseEnv(readFileSync(path.join(configRoot, ".env.local"), "utf8")).BLOB_READ_WRITE_TOKEN?.trim()
  if (!/^vercel_blob_rw_[A-Za-z0-9]+_[A-Za-z0-9]+$/.test(token || "")) throw new Error("configuration")
  if (!/^team_[A-Za-z0-9]+$/.test(config.orgId || "")) throw new Error("configuration")
  const cli = process.env.MCSW_VERCEL_CLI || path.join(process.env.APPDATA || "", "npm/node_modules/vercel/dist/index.js")
  function get(endpoint) {
    const result = spawnSync(process.execPath, [cli, "api", endpoint, "--method", "GET", "--raw", "--non-interactive"],
      { cwd: configRoot, encoding: "utf8", timeout: 55000, maxBuffer: 4 * 1024 * 1024, windowsHide: true })
    // Never forward raw CLI output/errors: those can contain private identifiers.
    if (result.status !== 0 || result.error) throw new Error("cli")
    return JSON.parse(result.stdout)
  }
  stage = "store-metadata"
  const storeResponse = get(`/v1/storage/stores/store_${token.split("_")[3]}?teamId=${encodeURIComponent(config.orgId)}`)
  const store = storeResponse.store || storeResponse
  stage = "team-metadata"
  const teamResponse = get(`/v2/teams/${config.orgId}`)
  const team = teamResponse.team || teamResponse
  const block = team.featureBlocks?.blob
  summary.store = {
    status: safeEnum(store.status, ["ready", "available", "active", "limits-exceeded-suspended", "suspended", "disabled"]),
    billingState: safeEnum(store.billingState, ["active", "suspended", "default", "free", "paid"]),
    usageQuotaExceeded: typeof store.usageQuotaExceeded === "boolean" ? store.usageQuotaExceeded : null,
    access: safeEnum(store.access, ["private", "public"]),
    region: safeEnum(store.region, ["iad1"]),
    files: Number.isSafeInteger(store.count) ? store.count : null,
    bytes: Number.isSafeInteger(store.size) ? store.size : null,
  }
  summary.provider = {
    plan: safeEnum(team.billing?.plan, ["hobby", "pro", "enterprise"]),
    isCurrentlyBlocked: typeof block?.isCurrentlyBlocked === "boolean" ? block.isCurrentlyBlocked : null,
    blockedFrom: date(block?.blockedFrom), blockedUntil: date(block?.blockedUntil),
  }
  const storeSuspended = summary.store.status.includes("suspended") || summary.store.status === "disabled" || summary.store.billingState === "suspended"
  summary.metadataUsable = ["ready", "available", "active"].includes(summary.store.status)
    && !storeSuspended && summary.store.usageQuotaExceeded === false
    && summary.provider.isCurrentlyBlocked !== true
  summary.uploadVerified = false
  process.exitCode = summary.metadataUsable ? 0 : 2
} catch {
  summary.failedStage = stage
  summary.error = "Read-only metadata check failed; verify local configuration, CLI authentication, and network access privately."
  process.exitCode = 1
}
console.log(JSON.stringify(summary, null, 2))
