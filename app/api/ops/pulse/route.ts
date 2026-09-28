import { getSql } from "@/lib/db"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { createOpsPulseGetHandler } from "@/lib/ops-pulse.ts"

export const GET = createOpsPulseGetHandler({
  getOperator: getAuthenticatedOperator,
  getSql,
})
