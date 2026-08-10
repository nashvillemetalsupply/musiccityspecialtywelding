"use server"

import { revalidatePath } from "next/cache"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { getAuthenticatedOperator } from "@/lib/ops-auth"
import { normalizePhone } from "@/lib/people"
import { twilioSmsConfigured } from "@/lib/twilio"
import { sendSmsPersisted } from "@/lib/messages"

async function requireOwner() {
  const operator = await getAuthenticatedOperator()
  if (!operator || operator.role !== "owner") throw new Error("Owner access is required.")
  return operator
}

export async function saveCrewMember(formData: FormData) {
  const owner = await requireOwner()
  const name = String(formData.get("name") ?? "").trim().slice(0, 100)
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 254)
  const cell = normalizePhone(String(formData.get("cellPhone") ?? ""))
  const role = String(formData.get("role") ?? "crew") === "owner" ? "owner" : "crew"
  if (!name || !email) throw new Error("Name and email are required.")

  const sql = getSql()
  if (cell) {
    const duplicate = (await sql`
      SELECT id, name FROM operators
      WHERE active = true AND cell_phone = ${cell}::text AND lower(email) <> lower(${email}::text)
      LIMIT 1`) as { id: number; name: string }[]
    if (duplicate[0]) throw new Error(`${cell} already belongs to ${duplicate[0].name || "another team member"}. Each team cell must be unique.`)
  }
  const rows = (await sql`
    INSERT INTO operators (email, name, role, cell_phone, active)
    VALUES (${email}::text, ${name}::text, ${role}::text, ${cell}::text, true)
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      cell_phone = EXCLUDED.cell_phone,
      active = true
    RETURNING id`) as { id: number }[]
  await recordEvent({
    kind: "operator.added",
    actorType: "operator",
    actorId: owner.id,
    body: `${name} was added to the team`,
    detail: { operatorId: rows[0].id, role },
  })

  if (cell && twilioSmsConfigured()) {
    await sendSmsPersisted({
      to: cell,
      body: `${name}, Philippe added you to MCSW Jobs. Sign in here: https://musiccityspecialtywelding.com/ops`,
      operatorId: owner.id,
      idempotencyKey: `operator-invite:${rows[0].id}`,
    }).catch((error) => console.error("Crew invite text needs attention:", error))
  }
  revalidatePath("/ops/shop")
}

export async function setCrewActive(formData: FormData) {
  const owner = await requireOwner()
  const id = Number(formData.get("operatorId"))
  const active = String(formData.get("active") ?? "") === "1"
  if (!Number.isInteger(id) || id <= 0 || id === Number(owner.id)) {
    throw new Error("That team member cannot be changed here.")
  }
  const sql = getSql()
  if (active) {
    const target = (await sql`SELECT cell_phone FROM operators WHERE id = ${id}::bigint LIMIT 1`) as { cell_phone: string }[]
    if (target[0]?.cell_phone) {
      const duplicate = (await sql`
        SELECT id FROM operators
        WHERE active = true AND cell_phone = ${target[0].cell_phone}::text AND id <> ${id}::bigint
        LIMIT 1`) as { id: number }[]
      if (duplicate[0]) throw new Error("That cell number already belongs to an active team member.")
    }
  }
  await sql`UPDATE operators SET active = ${active}::boolean WHERE id = ${id}::bigint`
  await recordEvent({
    kind: active ? "operator.activated" : "operator.deactivated",
    actorType: "operator",
    actorId: owner.id,
    body: `Team member ${id} was ${active ? "reactivated" : "deactivated"}`,
  })
  revalidatePath("/ops/shop")
}

export async function setGlassAutoPost(formData: FormData) {
  const owner = await requireOwner()
  const enabled = String(formData.get("enabled") ?? "") === "1"
  if (enabled && Number(owner.glass_clean_approvals) < 10) {
    throw new Error("Approve 10 clean Customer Page captions before turning on auto-post.")
  }
  const sql = getSql()
  await sql`
    UPDATE operators SET glass_auto_post = ${enabled}::boolean
    WHERE id = ${owner.id}::bigint AND role = 'owner'`
  await recordEvent({
    kind: "glass.auto-post-changed",
    actorType: "operator",
    actorId: owner.id,
    body: enabled ? "Owner turned on trusted Customer Page photo posting" : "Owner returned Customer Page photos to approval",
  })
  revalidatePath("/ops/shop")
}
