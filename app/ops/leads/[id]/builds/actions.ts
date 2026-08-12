"use server"

import { revalidatePath } from "next/cache"
import { buildSheetsEnabled } from "@/lib/build-sheets-access"
import {
  addWorkingBuildFact,
  decideBuildFact,
  getBuildsWorkspace,
  lockCurrentBuildSheet,
  proposeBuildFactChange,
} from "@/lib/build-sheets"
import { getAuthenticatedOperator } from "@/lib/ops-auth"

async function readOwnerBuild(formData: FormData) {
  const operator = await getAuthenticatedOperator()
  if (!operator || operator.role !== "owner" || !buildSheetsEnabled()) {
    throw new Error("Owner-only Builds access is required.")
  }
  const leadId = Number(formData.get("leadId"))
  if (!Number.isInteger(leadId) || leadId <= 0) throw new Error("The internal test job is missing.")
  const workspace = await getBuildsWorkspace(leadId)
  if (!workspace) throw new Error("Builds only changes an [INTERNAL TEST] job.")
  return { operator, leadId }
}

function actionKey(formData: FormData) {
  const value = String(formData.get("actionKey") ?? "").trim().slice(0, 120)
  if (!value) throw new Error("The action receipt is missing. Reload and try once more.")
  return value
}

function refresh(leadId: number) {
  revalidatePath(`/ops/leads/${leadId}/builds`)
  revalidatePath(`/ops/leads/${leadId}`)
}

export async function decideBuildFactAction(formData: FormData) {
  const { operator, leadId } = await readOwnerBuild(formData)
  const claimId = Number(formData.get("claimId"))
  const kind = String(formData.get("kind") ?? "")
  if (!Number.isInteger(claimId) || !["confirm", "working", "reject"].includes(kind)) {
    throw new Error("Choose a current draft fact.")
  }
  await decideBuildFact({
    leadId,
    claimId,
    operatorId: operator.id,
    kind: kind as "confirm" | "working" | "reject",
    decisionKey: actionKey(formData),
  })
  refresh(leadId)
}

export async function proposeBuildFactChangeAction(formData: FormData) {
  const { operator, leadId } = await readOwnerBuild(formData)
  const sourceClaimId = Number(formData.get("claimId"))
  const value = Number(formData.get("value"))
  if (!Number.isInteger(sourceClaimId)) throw new Error("Choose the number being corrected.")
  await proposeBuildFactChange({
    leadId,
    sourceClaimId,
    operatorId: operator.id,
    value,
    actionKey: actionKey(formData),
  })
  refresh(leadId)
}

export async function addWorkingBuildFactAction(formData: FormData) {
  const { operator, leadId } = await readOwnerBuild(formData)
  const factKey = String(formData.get("factKey") ?? "").trim()
  const value = Number(formData.get("value"))
  await addWorkingBuildFact({
    leadId,
    factKey,
    operatorId: operator.id,
    value,
    actionKey: actionKey(formData),
  })
  refresh(leadId)
}

export async function lockBuildSheetAction(formData: FormData) {
  const { operator, leadId } = await readOwnerBuild(formData)
  await lockCurrentBuildSheet({
    leadId,
    operatorId: operator.id,
    lockKey: actionKey(formData),
  })
  refresh(leadId)
}
