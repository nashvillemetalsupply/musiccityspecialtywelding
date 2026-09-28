export type NormalizedCspReport = {
  effectiveDirective: string
  violatedDirective: string
  blocked: string
  source?: string
  route: string
  statusCode?: number
}

export type TroubleReportInput = {
  source: string
  message: string
  digest: string
  route: string
  reportedBy: number | null
  isTest: boolean
}

export const MAX_CSP_REPORT_BYTES: number = 16 * 1024
const MAX_REPORT_COUNT = 10
const BODY_READ_TIMEOUT_MS = 1_000
const REPORT_WORK_TIMEOUT_MS = 1_500
const CONTENT_TYPE_LEGACY = "application/csp-report"
const CONTENT_TYPE_REPORTING_API = "application/reports+json"
type CspReportRecord = Record<string, unknown>

function emptyResponse() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })
}

async function withTimeout<T>(operation: () => T | Promise<T>, timeoutMs: number, timeoutValue: T) {
  let timeoutId
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(timeoutValue), timeoutMs)
        timeoutId.unref?.()
      }),
    ])
  } finally {
    clearTimeout(timeoutId)
  }
}

function requestContentType(request: Request) {
  return (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase()
}

async function readJsonBody(request: Request) {
  const contentLength = request.headers.get("content-length")
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_CSP_REPORT_BYTES) return null

  const reader = request.body?.getReader()
  if (!reader) return null

  const chunks = []
  let totalBytes = 0
  let timeoutId
  const readBody = (async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_CSP_REPORT_BYTES) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }

    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  })()

  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      void reader.cancel().catch(() => undefined)
      resolve(null)
    }, BODY_READ_TIMEOUT_MS)
    timeoutId.unref?.()
  })

  try {
    return await Promise.race([readBody, timeout])
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

function reportRecords(contentType: "application/csp-report" | "application/reports+json", body: any): CspReportRecord[] {
  if (contentType === CONTENT_TYPE_LEGACY) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return []
    const report = body["csp-report"]
    return report && typeof report === "object" && !Array.isArray(report) ? [report] : []
  }

  if (contentType !== CONTENT_TYPE_REPORTING_API || !Array.isArray(body)) return []
  return body
    .filter((report) => report && typeof report === "object" && report.type === "csp-violation" && report.body && typeof report.body === "object")
    .map((report) => ({ ...report.body, documentURL: report.body.documentURL || report.url }))
    .slice(0, MAX_REPORT_COUNT)
}

function safeLabel(value: unknown, maximumLength: 2048 | 80 = 80) {
  if (typeof value !== "string") return ""
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximumLength)
}

function normalizedLocation(value: unknown) {
  const input = safeLabel(value, 2_048)
  if (!input) return ""

  const keyword = input.toLowerCase()
  if (["inline", "eval", "wasm-eval", "self", "<anonymous>"].includes(keyword)) return keyword
  if (keyword.startsWith("data:")) return "data:"
  if (keyword.startsWith("javascript:")) return "javascript:"
  if (keyword.startsWith("blob:")) {
    try {
      const url = new URL(input.slice(5))
      return url.protocol === "http:" || url.protocol === "https:"
        ? `blob:${url.origin}${url.pathname}`
        : "blob:"
    } catch {
      return "blob:"
    }
  }

  try {
    const url = new URL(input)
    if (url.protocol === "http:" || url.protocol === "https:") return `${url.origin}${url.pathname}`
    return `${url.protocol}`
  } catch {
    if (input.startsWith("/") && !input.startsWith("//")) return input.split(/[?#]/, 1)[0].slice(0, 240)
    return "unknown"
  }
}

function directiveName(value: unknown) {
  const label = safeLabel(value, 80).toLowerCase()
  return /^[a-z][a-z0-9-]*$/.test(label) ? label : "unknown"
}

function safeRoute(value: unknown) {
  const location = normalizedLocation(value)
  let pathname = ""
  try {
    pathname = new URL(location).pathname
  } catch {
    pathname = location.startsWith("/") ? location : ""
  }
  if (pathname === "/") return "/"
  if (pathname.startsWith("/j/")) return "/j/:token"
  if (pathname.startsWith("/services/")) return "/services/:slug"
  if (pathname.startsWith("/ops/leads/")) return "/ops/leads/:id"
  if (pathname.startsWith("/ops/accounts/")) return "/ops/accounts/:id"
  return `/${pathname.split("/").filter(Boolean)[0] || "unknown"}`
}

function normalizeReport(report: CspReportRecord) {
  const effectiveDirective = directiveName(report["effective-directive"] || report.effectiveDirective)
  const violatedDirective = directiveName(report["violated-directive"] || report.violatedDirective || effectiveDirective)
  const blocked = normalizedLocation(report["blocked-uri"] || report.blockedURL || report.blockedUrl)
  const source = normalizedLocation(report["source-file"] || report.sourceFile)
  const document = report["document-uri"] || report.documentURL || report.documentUrl
  const route = safeRoute(document)
  const statusCode = Number(report["status-code"] ?? report.statusCode)

  return {
    effectiveDirective,
    violatedDirective,
    blocked: blocked || "unknown",
    source: source || undefined,
    route,
    statusCode: Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? statusCode : undefined,
  }
}

export async function parseCspReports(request: Request) : Promise<NormalizedCspReport[]> {
  const contentType = requestContentType(request)
  if (contentType !== CONTENT_TYPE_LEGACY && contentType !== CONTENT_TYPE_REPORTING_API) return []
  const body = await readJsonBody(request)
  if (!body) return []
  return reportRecords(contentType, body).map(normalizeReport)
}

export function createCspReportPost({ rateLimit, writeTroubleReport, isTestContext }: {
  rateLimit: (request: Request) => boolean | Promise<boolean>
  writeTroubleReport: (report: TroubleReportInput) => unknown | Promise<unknown>
  isTestContext: () => boolean
}) : (request: Request) => Promise<Response> {
  return async function POST(request) {
    try {
      const isRateLimited = await withTimeout(() => rateLimit(request), REPORT_WORK_TIMEOUT_MS, true)
      if (isRateLimited) return emptyResponse()

      const reports = await parseCspReports(request)
      if (reports.length === 0) return emptyResponse()

      const sample = reports.slice(0, MAX_REPORT_COUNT)
      const primary = sample[0]
      const message = JSON.stringify({ version: 1, reports: sample }).slice(0, 4_000)
      await withTimeout(() => writeTroubleReport({
          source: "csp-report",
          message,
          digest: primary.violatedDirective,
          route: primary.route,
          reportedBy: null,
          isTest: isTestContext(),
        }), REPORT_WORK_TIMEOUT_MS, undefined)
    } catch {
      // Browsers retry noisily if a report endpoint returns an error.
    }
    return emptyResponse()
  }
}
