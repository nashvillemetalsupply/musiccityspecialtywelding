"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import type { JobBoardStage } from "@/lib/ops-data"

const filters: Array<{ key: JobBoardStage; label: string; shortLabel: string }> = [
  { key: "board", label: "All Jobs", shortLabel: "All jobs" },
  { key: "attention", label: "Needs Attention", shortLabel: "Attention" },
  { key: "shop", label: "In Shop", shortLabel: "In shop" },
  { key: "waiting", label: "Waiting", shortLabel: "Waiting" },
  { key: "ready", label: "Ready", shortLabel: "Ready" },
]

export function boardHref(stage: JobBoardStage, query: string, page?: number) {
  const params = new URLSearchParams()
  if (stage !== "board") params.set("stage", stage)
  if (query.trim()) params.set("q", query.trim())
  if (page && page > 1) params.set("page", String(page))
  const suffix = params.toString()
  return `/ops${suffix ? `?${suffix}` : ""}#active-jobs`
}

export function ActiveJobControls({
  stage,
  query,
  counts,
}: {
  stage: JobBoardStage
  query: string
  counts: Record<JobBoardStage, number>
}) {
  const router = useRouter()
  const [draft, setDraft] = useState({ sourceQuery: query, value: query })
  const draftQuery = draft.sourceQuery === query ? draft.value : query
  const mounted = useRef(false)

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    const timer = window.setTimeout(() => {
      if (draftQuery.trim() !== query.trim()) router.replace(boardHref(stage, draftQuery))
    }, 320)
    return () => window.clearTimeout(timer)
  }, [draftQuery, query, router, stage])

  return <div className="jobs-index-tools">
    <form
      action="/ops"
      method="get"
      className="jobs-index-search"
      onSubmit={(event) => {
        event.preventDefault()
        router.push(boardHref(stage, draftQuery))
      }}
    >
      {stage !== "board" && <input type="hidden" name="stage" value={stage} />}
      <label htmlFor="home-job-search">Find a job</label>
      <input
        id="home-job-search"
        name="q"
        type="search"
        value={draftQuery}
        onChange={(event) => setDraft({ sourceQuery: query, value: event.target.value })}
        placeholder="Customer or job"
        autoComplete="off"
      />
      <button className="jobs-sr-only" type="submit" tabIndex={-1}>Search jobs</button>
    </form>

    <label className="jobs-index-select">
      <span>Show</span>
      <select
        value={stage}
        aria-label="Filter active jobs"
        onChange={(event) => router.push(boardHref(event.target.value as JobBoardStage, draftQuery))}
      >
        {filters.map((filter) => <option value={filter.key} key={filter.key}>{filter.label} ({counts[filter.key]})</option>)}
      </select>
    </label>

    <nav className="jobs-index-filters" aria-label="Filter active jobs">
      {filters.map((filter) => <Link
        aria-current={stage === filter.key ? "page" : undefined}
        className={stage === filter.key ? "is-active" : ""}
        href={boardHref(filter.key, draftQuery)}
        key={filter.key}
      >
        <span>{filter.shortLabel}</span>
        <strong>{counts[filter.key]}</strong>
      </Link>)}
    </nav>
  </div>
}
