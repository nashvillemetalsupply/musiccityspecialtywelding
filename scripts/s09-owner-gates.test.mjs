import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const crew = { id: 72, role: "crew" }

function actionPrefix(actionSource, actionName, stopAt, dependencies, afterAuthorization) {
  const start = actionSource.indexOf(`export async function ${actionName}(`)
  assert.ok(start >= 0, `missing Server Action ${actionName}`)
  const bodyStart = actionSource.indexOf("{", start) + 1
  const stop = actionSource.indexOf(stopAt, bodyStart)
  assert.ok(stop > bodyStart, `${actionName} must have a pre-I/O authorization boundary`)
  return new AsyncFunction(...dependencies, `${actionSource.slice(bodyStart, stop)}\n${afterAuthorization}`)
}

test("sendUsualPaperwork refuses a crew session before reading or sending paperwork", async () => {
  const accountActions = source("app/ops/accounts/[id]/actions.ts")
  const effects = { sql: 0, email: 0, event: 0 }
  const action = actionPrefix(accountActions, "sendUsualPaperwork", "  const personId", ["getAuthenticatedOperator", "getSql", "recordEvent", "sendEmail", "formData"], "getSql(); recordEvent(); sendEmail()")

  await assert.rejects(
    action(async () => crew, () => effects.sql++, () => effects.event++, () => effects.email++, new FormData()),
    /Owner access is required\./,
  )
  assert.deepEqual(effects, { sql: 0, email: 0, event: 0 })
  assert.match(accountActions, /detail: \{ deliveryStatus: "pending", documentIds: ready\.map\(\(item\) => item\.id\), isTest: false \}/)
})

test("undoLeadComplete refuses a crew session before reading or writing the lead", async () => {
  const actions = source("app/ops/actions.ts")
  const requireOwner = new Function("operator", "if (operator.role !== 'owner') throw new Error('Owner access is required for money and shop controls.')")
  const effects = { sql: 0, event: 0, notification: 0 }
  const action = actionPrefix(actions, "undoLeadComplete", "  const leadId", ["requireOperator", "requireOwner", "getSql", "recordEvent", "notifyAll", "formData"], "getSql(); recordEvent(); notifyAll()")

  await assert.rejects(
    action(async () => crew, requireOwner, () => effects.sql++, () => effects.event++, () => effects.notification++, new FormData()),
    /Owner access is required/,
  )
  assert.deepEqual(effects, { sql: 0, event: 0, notification: 0 })
  assert.ok(actions.indexOf("requireOwner(operator)", actions.indexOf("export async function undoLeadComplete"))
    < actions.indexOf("const leadId =", actions.indexOf("export async function undoLeadComplete")))
})
