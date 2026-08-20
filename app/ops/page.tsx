import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

// The board is the front door; two job lists was always one too many.
export default function OpsPage() {
  redirect("/board")
}
