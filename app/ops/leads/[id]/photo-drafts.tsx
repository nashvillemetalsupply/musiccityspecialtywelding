import type { PhotoDraftEntry } from "@/lib/photo-drafts"
import { shopClaimText } from "@/lib/shop-language"
import { SafeSubmitButton } from "../../safe-action-controls"
import { acceptPhotoDraft, rejectPhotoDraft } from "./claim-actions"

const KIND_LABELS: Record<string, string> = {
  photo_draft_scope: "Scope",
  photo_draft_material: "Material",
  photo_draft_dimension: "Dimensions",
}

type PhotoDraft = {
  id: number
  predicate: string
  text: string
  photoReference: string
}

type PhotoDraftGroup = {
  intentEventId: number
  status: string
  claims: PhotoDraft[]
}

export function PhotoDrafts({ leadId, entries }: { leadId: number; entries: PhotoDraftEntry[] }) {
  const groups = new Map<number, PhotoDraftGroup>()
  for (const entry of entries) {
    const group = groups.get(entry.intent_event_id) ?? {
      intentEventId: entry.intent_event_id,
      status: entry.extraction_status,
      claims: [],
    }
    if (entry.claim_id && entry.predicate) {
      const value = entry.value && typeof entry.value === "object" ? entry.value as Record<string, unknown> : {}
      group.claims.push({
        id: Number(entry.claim_id),
        predicate: entry.predicate,
        text: typeof value.text === "string" ? value.text : shopClaimText(value),
        photoReference: typeof value.photoReference === "string" ? value.photoReference : "",
      })
    }
    groups.set(entry.intent_event_id, group)
  }

  return <section className="card job-photo-drafts" aria-labelledby="photo-drafts-title">
    <header>
      <div>
        <h2 className="t-sub" id="photo-drafts-title">Photo drafts</h2>
        <p>Suggestions stay unconfirmed until you review them.</p>
      </div>
    </header>
    {groups.size === 0
      ? <p className="job-photo-drafts-empty">No photo details are waiting for review.</p>
      : <div className="job-photo-drafts-list">{[...groups.values()].map((group) => (
        <div className="job-photo-draft-group" key={group.intentEventId}>
          {group.status === "processing" && <p role="status">Reviewing the filed photo…</p>}
          {group.status === "pending" && <p role="status">Photo review is waiting to start.</p>}
          {group.status === "failed" && <p role="alert">Photo details could not be drafted. The uploaded photo is still filed.</p>}
          {group.claims.map((claim) => {
            const kindLabel = KIND_LABELS[claim.predicate] ?? "Detail"
            return <article className="job-photo-draft" key={claim.id} aria-labelledby={`photo-draft-${claim.id}`}>
              <div className="job-photo-draft-copy">
                <h3 id={`photo-draft-${claim.id}`}>{kindLabel}</h3>
                <p>{claim.text}</p>
                {claim.photoReference && <a
                  className="btn btn--sm btn--edge job-photo-draft-source"
                  href={`/api/ops/attachment?lead=${leadId}&path=${encodeURIComponent(claim.photoReference)}`}
                  target="_blank"
                  rel="noreferrer"
                >View source photo</a>}
              </div>
              <div className="job-photo-draft-actions">
                <form action={acceptPhotoDraft}>
                  <input type="hidden" name="leadId" value={leadId} />
                  <input type="hidden" name="claimId" value={claim.id} />
                  <SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Accept {kindLabel.toLowerCase()}</SafeSubmitButton>
                </form>
                <form action={rejectPhotoDraft}>
                  <input type="hidden" name="leadId" value={leadId} />
                  <input type="hidden" name="claimId" value={claim.id} />
                  <SafeSubmitButton className="btn btn--sm btn--edge" pendingLabel="Saving...">Reject {kindLabel.toLowerCase()}</SafeSubmitButton>
                </form>
              </div>
            </article>
          })}
        </div>
      ))}</div>}
  </section>
}
