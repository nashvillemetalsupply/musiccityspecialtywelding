import { handleHealthMonitor } from "@/lib/health-monitor"
import { GET as readHealth } from "../route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export function GET(req: Request) {
  return handleHealthMonitor(req, () => readHealth(req))
}
