import { getSql } from "@/lib/db"

export type TroubleReportInput = {
  source: string
  message: string
  digest: string
  route: string
  reportedBy: number | null
  isTest: boolean
}

export function isTestContext() {
  return process.env.VERCEL_ENV?.trim().toLowerCase() !== "production"
}

export async function writeTroubleReport(report: TroubleReportInput) {
  const sql = getSql()
  await sql`
    INSERT INTO trouble_reports (source, message, digest, route, reported_by, is_test)
    VALUES (
      ${report.source}::text, ${report.message}::text, ${report.digest}::text,
      ${report.route}::text, ${report.reportedBy}::bigint, ${report.isTest}::boolean
    )`
}
