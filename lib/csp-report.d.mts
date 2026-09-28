export const MAX_CSP_REPORT_BYTES: number

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

export function parseCspReports(request: Request): Promise<NormalizedCspReport[]>
export function createCspReportPost(dependencies: {
  rateLimit: (request: Request) => boolean | Promise<boolean>
  writeTroubleReport: (report: TroubleReportInput) => unknown | Promise<unknown>
  isTestContext: () => boolean
}): (request: Request) => Promise<Response>
