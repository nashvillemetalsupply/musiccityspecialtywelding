import { randomBytes } from "node:crypto"

const allowedEmails = ["test@example.com", "Sales@musiccityspecialtywelding.com"]
export const A4_OPTIONAL_ENV = Object.freeze(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "OWNER_CELL_PHONE"])
const stubbedEnvironments = new WeakMap()
const present = (env, name) => typeof env[name] === "string" && Boolean(env[name].trim())

// Harness-only, process-local configuration. Never write an env file or fetch
// production credentials. The SID must pass the real Twilio configuration gate.
export function installA4Stubs(env) {
  let names = stubbedEnvironments.get(env)
  if (!names) { names = new Set(); stubbedEnvironments.set(env, names) }
  for (const name of A4_OPTIONAL_ENV) {
    if (present(env, name)) continue
    env[name] = name === "TWILIO_AUTH_TOKEN" ? randomBytes(32).toString("hex")
      : name === "TWILIO_ACCOUNT_SID" ? `AC${"0".repeat(32)}`
        : name === "TWILIO_PHONE_NUMBER" ? "+16155550101" : "+16155550199"
    names.add(name)
  }
  return A4_OPTIONAL_ENV.filter((name) => names.has(name))
}

// Diagnostics cross a provider boundary. Keep only useful scalar metadata,
// never stacks, request/response objects, connection strings or env dumps.
export function sanitizeDiagnostic(value, env = process.env) {
  let text = String(value ?? "")
  for (const [name, value] of Object.entries(env)) {
    if (!/(?:KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|PHONE|EMAIL|AUTH|SID)/i.test(name)
      || typeof value !== "string" || !value.trim() || allowedEmails.includes(value.trim())) continue
    const secret = value.trim()
    const encoded = encodeURIComponent(secret)
    const escaped = encoded.replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    for (const candidate of new Set([secret, encoded, escaped])) text = text.split(candidate).join("[redacted]")
  }
  // Protect the two explicitly public addresses from the base64-like token
  // rule, which would otherwise match the shop's long domain name.
  text = text.replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (email) => {
    const index = allowedEmails.findIndex((allowed) => allowed.toLowerCase() === email.toLowerCase())
    return index < 0 ? "[redacted]" : `@@email${index}@@`
  })
  text = text
    .replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s<>"'`]+/gi, "[redacted]")
    .replace(/\b[a-z][a-z\d+.-]*:[^\s<>"'`]+/gi, "[redacted]")
    .replace(/\bwww\.[^\s<>"'`]+/gi, "[redacted]")
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"'`]+/gi, "[redacted]")
    .replace(/(["']?(?:[A-Z][A-Z\d_]*[_-])?(?:api[_-]?key|key|access[_-]?token|refresh[_-]?token|token|password|secret|credential|authorization|auth[_-]?token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[redacted]")
    .replace(/\b(?:sk-ant-|sk[-_]|gh[pousr]_|xox[baprs]-)[A-Z\d_-]+/gi, "[redacted]")
    // Include base64url, which is common for JWTs and opaque provider keys.
    .replace(/(?<![A-Z\d+/_-])[A-Z\d+/_-]{21,}={0,2}(?![A-Z\d+/_-])/gi, "[redacted]")
    // Local/international forms, including reserved test phone numbers.
    .replace(/(?<!\w)(?:\+\d{1,3}[\s./\u2010-\u2015\u2212-]?)?(?:\(\d{2,4}\)[\s./\u2010-\u2015\u2212-]?)?(?:\d[\s./\u2010-\u2015\u2212-]?){6,14}\d(?!\w)/g, "[redacted]")
  for (let i = 0; i < allowedEmails.length; i++) text = text.replaceAll(`@@email${i}@@`, allowedEmails[i])
  return text
}

export function errorDiagnostic(stage, error, env = process.env) {
  const name = error?.name || (typeof error === "object" && error?.constructor?.name) || "Error"
  const model = error?.modelDiagnostics
  return {
    stage: sanitizeDiagnostic(stage, env),
    name: sanitizeDiagnostic(name, env),
    code: error?.code == null ? null : sanitizeDiagnostic(error.code, env),
    message: sanitizeDiagnostic(error?.message ?? error, env),
    ...(model && typeof model === "object" ? { model: {
      stop_reason: typeof model.stop_reason === "string" ? sanitizeDiagnostic(model.stop_reason, env) : null,
      content_block_types: Array.isArray(model.content_block_types)
        ? model.content_block_types.filter((type) => typeof type === "string").map((type) => sanitizeDiagnostic(type, env)) : [],
      // Copy token counts explicitly, never provider text or arbitrary nested
      // fields, even if an error carrying metadata came from another boundary.
      usage: model.usage && typeof model.usage === "object" ? Object.fromEntries(
        ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]
          .filter((key) => typeof model.usage[key] === "number" && Number.isFinite(model.usage[key]))
          .map((key) => [key, model.usage[key]]),
      ) : null,
    } } : {}),
  }
}

export function checkEnvironment(env) {
  // lib/db.ts:getSql reads DATABASE_URL. lib/assistant/turn.ts calls
  // lib/ai.ts:jsonWithClaude -> postClaude, which reads ANTHROPIC_API_KEY.
  // Gateway/OIDC auth is a separate lib/ai.ts:aiConfigured path, not this one.
  // A4 blocks all delivery; missing Twilio/owner values only support the real
  // in-process configuration and signature validators, never a provider send.
  const required = ["DATABASE_URL", "ANTHROPIC_API_KEY"]
  const stubbed = installA4Stubs(env)
  const has = (name) => present(env, name)
  const gatewayNames = ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"]
  const notes = [
    `lib/assistant/turn.ts uses lib/ai.ts jsonWithClaude: ANTHROPIC_API_KEY is ${has("ANTHROPIC_API_KEY") ? "present (supported assistant credential)" : "missing/empty (required assistant credential)"}.`,
    `Gateway credential names present: ${gatewayNames.filter(has).join(", ") || "none"}; missing/empty: ${gatewayNames.filter((name) => !has(name)).join(", ") || "none"}.`,
    "lib/ai.ts also supports AI_GATEWAY_API_KEY / VERCEL_OIDC_TOKEN / VERCEL for gateway calls. Gateway/OIDC credentials are not required for A4 and cannot replace ANTHROPIC_API_KEY on the assistant path.",
  ]
  notes.push(...stubbed.map((name) => `${name}: stubbed for A4; outbound blocked`))
  return { required, missing: required.filter((name) => !has(name)), stubbed, notes }
}

export async function runPreflight({ loadEnv, connect, env = process.env }) {
  const stages = []
  try {
    await loadEnv()
    stages.push({ stage: "env-load", pass: true })
  } catch (error) {
    stages.push({ stage: "env-load", pass: false, diagnostic: errorDiagnostic("env-load", error, env) },
      { stage: "env-check", pass: false, skipped: true }, { stage: "db-connect", pass: false, skipped: true })
    return { pass: false, stages }
  }
  const checked = checkEnvironment(env)
  const envStage = { stage: "env-check", pass: checked.missing.length === 0, ...checked }
  if (!envStage.pass) {
    const error = Object.assign(new Error(`Missing or empty required environment variables: ${checked.missing.join(", ")}`), { name: "ConfigurationError", code: "A4_ENV_MISSING" })
    envStage.diagnostic = errorDiagnostic("env-check", error, env)
  }
  stages.push(envStage)
  if (checked.missing.includes("DATABASE_URL")) {
    stages.push({ stage: "db-connect", pass: false, skipped: true })
    return { pass: false, stages }
  }
  try {
    const sql = await connect()
    // One database round trip, reads only. Do not import assistant/model code
    // here: even usage accounting would write to the shared database.
    const rows = await sql`SELECT 1 AS ok, to_regclass('assistant_sessions') AS assistant_sessions`
    if (Number(rows?.[0]?.ok) !== 1) throw Object.assign(new Error("Database SELECT 1 did not return 1."), { code: "A4_DB_CHECK" })
    if (!rows[0].assistant_sessions) throw Object.assign(new Error("assistant_sessions table is missing; apply the existing assistant migration before running A4."), { code: "A4_SCHEMA_MISSING" })
    stages.push({ stage: "db-connect", pass: true })
  } catch (error) {
    stages.push({ stage: "db-connect", pass: false, diagnostic: errorDiagnostic("db-connect", error, env) })
  }
  return { pass: stages.every(({ pass }) => pass), stages }
}
