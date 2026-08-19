import type { Metadata } from "next"
import { JobControlPreview } from "./job-control-preview"
import "./job-control.css"

export const metadata: Metadata = {
  title: "MCS Welding Job Control",
  robots: { index: false, follow: false },
}

export default function JobControlPreviewPage() {
  return <JobControlPreview />
}
