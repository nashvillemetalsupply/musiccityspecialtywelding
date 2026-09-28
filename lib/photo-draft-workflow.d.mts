export type PhotoDraftKind = "scope" | "material" | "dimension"

export type PhotoDraftModelClaim = {
  kind: PhotoDraftKind
  text: string
  photo_reference: string
}

export type PhotoDraftWorkflowInput = {
  uploadId: string
  leadId: number
  filename: string
  caption: string
  photoReference: string
  isTest: boolean
}

export const photoDraftOutputSchema: import("zod").ZodType<{ claims: PhotoDraftModelClaim[] }>
export const PHOTO_DRAFT_SYSTEM_PROMPT: string

export function photoDraftFlagEnabled(environment?: Record<string, string | undefined>): boolean
export function containsPhotoDraftPrice(text: unknown): boolean
export function parsePhotoDraftOutput(value: unknown, expectedPhotoReference: string): PhotoDraftModelClaim[]
export function buildPhotoDraftPrompt(input: Pick<PhotoDraftWorkflowInput, "filename" | "caption">): string

export function schedulePhotoDraftAfterFinalize(
  upload: { id: string; status: string } | null | undefined,
  options: {
    enabled: boolean
    after: (callback: () => void | Promise<void>) => void
    run: (uploadId: string) => Promise<unknown>
    onError?: (error: unknown) => void
  },
): boolean

export function runPhotoDraftWorkflow(
  input: PhotoDraftWorkflowInput,
  dependencies: {
    persistIntent: (input: PhotoDraftWorkflowInput) => Promise<{ id: number; status: string }>
    claimIntent: (id: number) => Promise<boolean>
    generate: (input: { system: string; prompt: string; isTest: boolean; photoReference: string }) => Promise<unknown>
    writeClaim: (input: PhotoDraftModelClaim & {
      uploadId: string
      leadId: number
      sourceEventId: number
      isTest: boolean
      index: number
    }) => Promise<number | string>
    finishIntent: (id: number, outcome: { status: "done"; claimIds: Array<number | string> } | { status: "failed"; error: string }) => Promise<void>
  },
): Promise<{ status: string; claimIds: Array<number | string> }>

export function applyPhotoDraftDecision(
  input: {
    decision: "accept" | "reject"
    leadId: number
    operatorId: number
    isTest: boolean
    draft: { id: number; predicate: string; value: unknown; source_event_id: number }
  },
  dependencies: {
    recordDecisionEvent: (input: {
      leadId: number
      draftClaimId: number
      intentEventId: number
      decision: "accept" | "reject"
      isTest: boolean
      operatorId: number
    }) => Promise<{ id: number; decision: string } | null>
    addClaim: (input: Record<string, unknown>) => Promise<number>
    supersedeClaim: (oldId: number, newId: number) => Promise<void>
  },
): Promise<{ eventId: number; replacementId: number; decision: "accept" | "reject" }>
