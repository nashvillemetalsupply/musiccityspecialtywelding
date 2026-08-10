import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  eventIsOwnerOnly,
  OWNER_ONLY_EVENT_KINDS,
  OWNER_ONLY_EVENT_NAMESPACE_PATTERN,
  OWNER_ONLY_EVENT_SENSITIVITIES,
} from "../lib/event-visibility.mjs"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("crew financial event visibility fails closed for known and future namespaces", () => {
  for (const kind of [
    "invoice.payment-received",
    "email.deposit",
    "quote.confirmed",
    "lead.invoice.cleared",
    "finance.adjusted",
    "lead.payment.refunded",
    "account-estimate-revised",
  ]) {
    assert.equal(eventIsOwnerOnly(kind, null), true, `${kind} must stay owner-only`)
  }

  assert.ok(OWNER_ONLY_EVENT_KINDS.includes("invoice.payment-received"))
  assert.ok(OWNER_ONLY_EVENT_KINDS.includes("email.deposit"))
  assert.match("lead.invoice.cleared", new RegExp(OWNER_ONLY_EVENT_NAMESPACE_PATTERN, "i"))
})

test("event sensitivity is fail-closed without hiding ordinary shop updates", () => {
  for (const sensitivity of OWNER_ONLY_EVENT_SENSITIVITIES) {
    assert.equal(eventIsOwnerOnly("note.text", { sensitivity }), true)
  }
  assert.equal(eventIsOwnerOnly("note.text", { sensitivity: "crew-safe" }), false)
  assert.equal(eventIsOwnerOnly("glass.uploaded", { sensitivity: "photo" }), false)
  assert.equal(eventIsOwnerOnly("status.changed", null), false)
})

test("activity, search, projection, and Ask share the financial gate", () => {
  const events = source("lib/events.ts")
  const visibility = source("lib/visibility.ts")
  const ask = source("app/api/ops/ask/route.ts")

  assert.ok((events.match(/OWNER_ONLY_EVENT_NAMESPACE_PATTERN/g) ?? []).length >= 4)
  assert.ok((events.match(/OWNER_ONLY_EVENT_SENSITIVITIES/g) ?? []).length >= 4)
  assert.match(visibility, /eventIsOwnerOnly\(event\.kind, event\.detail\)/)
  assert.ok((ask.match(/projectEventForRole\(event, operator\.role\)/g) ?? []).length >= 4)
})
