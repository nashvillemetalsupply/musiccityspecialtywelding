import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import * as checkpointHelpers from "../lib/gmail-ingest-checkpoint.ts"

const routePath = new URL("../app/api/ingest/gmail/route.ts", import.meta.url)
const routeSource = ts.transpileModule(readFileSync(routePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const messageId = "retry-message"
const historyId = "history-123"
const dayMs = 24 * 60 * 60 * 1000

function harness({
  pendingMessageIds = [messageId],
  legacyAttempts = 0,
  legacyLastAttempt = null,
  list = async () => ({ ids: [], historyId }),
  profile = async () => historyId,
} = {}) {
  let checkpoint = { pendingIds: pendingMessageIds, historyId }
  let committedHistory = null
  const retries = new Map(pendingMessageIds.map((id) => [id, {
    attempts: legacyAttempts,
    lastAttempt: legacyLastAttempt === null ? null : Date.parse(legacyLastAttempt),
    firstFailure: null,
    deadLettered: false,
  }]))
  let now
  let messageAvailable = false
  const events = []
  const alerts = []
  const listedSince = []
  const fetchedIds = []
  const recordedRuns = []
  const sql = async (parts, ...values) => {
    const query = parts.join(" ? ").replace(/\s+/g, " ").trim()
    if (query.startsWith("INSERT INTO sync_state") && query.includes("gmail-ingest-lease")) {
      return [{ key: "gmail-ingest-lease" }]
    }
    if (query.includes("SELECT value FROM sync_state") && query.includes("gmail-ingest-checkpoint")) {
      return checkpoint ? [{ value: checkpoint }] : []
    }
    if (query.startsWith("SELECT message_id FROM gmail_ingest_failures")) {
      return values[0].filter((id) => retries.get(id)?.attempts > 0).map((id) => ({ message_id: id }))
    }
    if (query.includes("INSERT INTO gmail_ingest_failures")) {
      const id = values[1]
      const retry = retries.get(id)
      assert.ok(retry, `Expected failure for ${id}`)
      if (query.includes("WITH first_failure AS")) {
        assert.match(query, /COALESCE\(\(SELECT last_attempt_at FROM gmail_ingest_failures/)
        assert.match(query, /ON CONFLICT \(key\) DO UPDATE SET updated_at = sync_state.updated_at/)
        assert.match(query, /updated_at <= now\(\) - interval '24 hours'/)
        retry.firstFailure ??= retry.lastAttempt ?? now
      }
      retry.attempts++
      retry.lastAttempt = now
      return [{ attempts: retry.attempts, old_enough: retry.firstFailure !== null && now - retry.firstFailure >= dayMs }]
    }
    if (query.includes("INSERT INTO sync_state") && query.includes("gmail-ingest-checkpoint")) {
      if (query.includes("WITH cleared_retry AS")) {
        const [key, needsRetry, id, retainAttempts] = values
        assert.equal(key, `gmail-ingest-first-failure:${id}`)
        assert.equal(needsRetry, retainAttempts)
        const retry = retries.get(id)
        if (retry && !needsRetry) {
          retry.firstFailure = null
          if (!retry.deadLettered) retry.attempts = 0
        }
      }
      checkpoint = JSON.parse(values.at(-1))
      return []
    }
    if (query.startsWith("DELETE FROM sync_state") && query.includes("gmail-ingest-checkpoint")) {
      checkpoint = null
      return []
    }
    if (query.startsWith("UPDATE gmail_ingest_failures")) {
      retries.get(values[0]).deadLettered = true
      return []
    }
    if (query.startsWith("INSERT INTO sync_state") && query.includes("'gmail'::text")) {
      committedHistory = JSON.parse(values[0]).historyId
      return []
    }
    if (query.startsWith("INSERT INTO automation_runs")) {
      recordedRuns.push({ ok: values[1], detail: JSON.parse(values[2]) })
      return []
    }
    if (query.startsWith("SELECT et.lead_id")
        || query.startsWith("INSERT INTO external_threads")
        || query.startsWith("UPDATE sync_state")) return []
    if (query.includes("SELECT value FROM sync_state") && query.includes("'gmail'::text")) return []
    throw new Error(`Unexpected Gmail retry SQL: ${query}`)
  }
  const deps = {
    "next/server": { after() {} },
    "@/lib/db": { getSql: () => sql },
    "@/lib/events": { recordEvent: async (event) => events.push(event) },
    "@/lib/extract": {},
    "@/lib/gmail": {
      gmailConfigured: () => true,
      gmailAccessToken: async () => "fixture",
      listGmailMessageIds: async (_token, since) => {
        listedSince.push(since)
        return list(since)
      },
      getMailboxHistoryId: profile,
      getGmailMessage: async (_token, id) => {
        assert.ok(checkpoint?.pendingIds.includes(id), "the pending ID is persisted before its message is processed")
        fetchedIds.push(id)
        if (retries.has(id) && !messageAvailable) throw new Error("Temporary Gmail outage")
        return { threadId: `thread-${id}`, internalDate: now }
      },
      gmailHeaders: () => ({ from: "welder@example.invalid", to: "shop@example.invalid", subject: "Repair quote" }),
      gmailHeaderValues: () => [],
      gmailPlaintext: () => "Can you repair my trailer?",
      emailAddress: (value) => value,
      emailName: () => "Customer",
      gmailAttachmentDescriptors: () => [],
    },
    "@/lib/ingest": { resolveEmailConversation: async () => ({
      person: { id: 1, display_name: "Customer", is_test: false }, leadId: 2, createdLead: true,
    }) },
    "@/lib/email-in-ack": { acknowledgeNewEmailLead: async () => {} },
    "@/lib/notify": { notifyAll: async (alert) => { alerts.push(alert) } },
    "@/lib/ops-auth": { isAuthorizedCron: () => true },
    "@/lib/gmail-routing.ts": {
      looksLikeIntuitPaymentEnvelope: () => false,
      isAuthenticatedIntuitPayment: () => false,
      shouldSkipGmailMessage: () => false,
    },
    "@/lib/people": {},
    "@/lib/attachment-retry": {},
    "@/lib/shop-brain-invariants.ts": { isGmailMessageGone: () => false },
    "@/lib/payment-ledger": {},
    "@/lib/gmail-ingest-checkpoint.ts": checkpointHelpers,
  }
  const route = { exports: {} }
  const factory = vm.runInNewContext(`(function (exports, require) { ${routeSource}\n})`, {
    Request, Response, URL, crypto, Error, console: { error() {} },
  })
  factory(route.exports, (name) => {
    assert.ok(Object.hasOwn(deps, name), `Unexpected Gmail retry import: ${name}`)
    return deps[name]
  })
  return {
    alerts,
    events,
    fetchedIds,
    listedSince,
    recordedRuns,
    mailboxState: () => ({ checkpoint, committedHistory }),
    retryState: () => {
      const { attempts, firstFailure, deadLettered } = retries.get(messageId)
      return { attempts, firstFailure, deadLettered }
    },
    async run(instant, recovered = false) {
      now = Date.parse(instant)
      messageAvailable = recovered
      const response = await route.exports.GET(new Request("https://fixture.invalid/api/ingest/gmail"))
      return response.json()
    },
  }
}

test("Gmail ingests a message at 02:50 after five failed attempts from 02:00 through 02:45", async () => {
  const h = harness()
  for (const minute of ["00", "05", "15", "30", "45"]) {
    const result = await h.run(`2026-11-21T02:${minute}:00Z`)
    assert.equal(result.failures, 1)
    assert.equal(result.deadLettered, 0)
    assert.equal(result.pending, 1)
    assert.equal(result.checkpointAdvanced, false)
  }
  const recovered = await h.run("2026-11-21T02:50:00Z", true)
  assert.equal(recovered.inserted, 1)
  assert.equal(recovered.failures, 0)
  assert.equal(recovered.checkpointAdvanced, true)
  assert.deepEqual(h.events.map((event) => event.kind), ["email.in"])
  assert.equal(h.alerts.length, 1)
  assert.equal(h.alerts[0].sourceEventId, 1)
  assert.deepEqual(h.retryState(), { attempts: 0, firstFailure: null, deadLettered: false })
})

test("elapsed time and attempt cap must both be reached before a Gmail failure is terminal", async () => {
  const h = harness()
  assert.equal((await h.run("2026-11-21T02:00:00Z")).pending, 1)
  for (const minute of ["00", "15", "30"]) {
    const result = await h.run(`2026-11-22T02:${minute}:00Z`)
    assert.equal(result.pending, 1)
    assert.equal(result.deadLettered, 0)
  }
  const terminal = await h.run("2026-11-22T02:45:00Z")
  assert.equal(terminal.deadLettered, 1)
  assert.equal(terminal.pending, 0)
  assert.equal(terminal.checkpointAdvanced, true)
  assert.deepEqual(h.events.map((event) => event.kind), ["email.ingest-dead-letter"])
  assert.equal(h.alerts.length, 1)
  assert.deepEqual(h.retryState(), { attempts: 5, firstFailure: null, deadLettered: true })
})

test("legacy Gmail failure rows use the last known failure until the first timestamp can be retained", async () => {
  const h = harness({ legacyAttempts: 4, legacyLastAttempt: "2026-11-21T02:00:00Z" })
  const tooSoon = await h.run("2026-11-22T01:59:59Z")
  assert.equal(tooSoon.deadLettered, 0)
  assert.equal(tooSoon.pending, 1)
  assert.equal((await h.run("2026-11-22T02:00:00Z")).deadLettered, 1)
})

test("a pending Gmail retry leaves room for new messages while the committed cursor waits", async () => {
  const newMessage = "new-message"
  const observedHistory = "history-124"
  const h = harness({
    list: async (since) => since === historyId
      ? { ids: [newMessage, messageId], historyId: observedHistory }
      : { ids: [], historyId: observedHistory },
  })
  const partial = await h.run("2026-11-21T02:00:00Z")
  assert.equal(partial.failures, 1)
  assert.equal(partial.inserted, 1)
  assert.deepEqual(h.events.map((event) => event.externalId), [newMessage])
  assert.deepEqual(h.mailboxState(), {
    checkpoint: { pendingIds: [messageId], historyId: observedHistory },
    committedHistory: null,
  })

  const recovered = await h.run("2026-11-21T02:05:00Z", true)
  assert.equal(recovered.checkpointAdvanced, true)
  assert.deepEqual(h.listedSince, [historyId, observedHistory])
  assert.deepEqual(h.events.map((event) => event.externalId), [newMessage, messageId])
  assert.deepEqual(h.mailboxState(), { checkpoint: null, committedHistory: observedHistory })
})

test("fresh Gmail mail ingests before any of fifty failing retries and attempts are capped", async () => {
  const pendingMessageIds = Array.from({ length: 50 }, (_, index) => `retry-${index}`)
  const newMessage = "new-message"
  const observedHistory = "history-124"
  const h = harness({
    pendingMessageIds,
    legacyAttempts: 4,
    legacyLastAttempt: "2026-11-21T01:50:00Z",
    list: async (since) => since === historyId
      ? { ids: [newMessage], historyId: observedHistory }
      : { ids: [], historyId: observedHistory },
  })

  const partial = await h.run("2026-11-21T02:00:00Z")
  assert.equal(partial.inserted, 1)
  assert.equal(partial.failures, 5)
  assert.equal(partial.pending, 50)
  assert.equal(partial.checkpointAdvanced, false)
  assert.deepEqual(h.fetchedIds, [newMessage, ...pendingMessageIds.slice(0, 5)])
  assert.deepEqual(h.mailboxState(), {
    checkpoint: {
      pendingIds: [...pendingMessageIds.slice(5), ...pendingMessageIds.slice(0, 5)],
      historyId: observedHistory,
    },
    committedHistory: null,
  })

  await h.run("2026-11-21T02:15:00Z")
  assert.deepEqual(h.fetchedIds.slice(6), pendingMessageIds.slice(5, 10))
})

test("expired checkpoint history uses the existing bounded fallback and keeps pending IDs", async () => {
  const operations = []
  const h = harness({
    list: async (since) => {
      operations.push(`list:${since}`)
      if (since) throw Object.assign(new Error("Expired Gmail cursor"), { status: 404 })
      return { ids: ["new-message", messageId], historyId: null }
    },
    profile: async () => {
      operations.push("profile")
      return "profile-history"
    },
  })
  const partial = await h.run("2026-11-21T02:00:00Z")
  assert.deepEqual(operations, [`list:${historyId}`, "profile", "list:null"])
  assert.equal(partial.failures, 1)
  assert.equal(partial.inserted, 1)
  assert.deepEqual(h.mailboxState(), {
    checkpoint: { pendingIds: [messageId], historyId: "profile-history" },
    committedHistory: null,
  })
})

for (const expiredHistory of [false, true]) {
  test(`a full saved Gmail batch drains during a ${expiredHistory ? "fallback" : "history"} listing error without advancing`, async () => {
    const pendingMessageIds = Array.from({ length: checkpointHelpers.GMAIL_MESSAGE_CAP }, (_, index) => `saved-${index}`)
    const h = harness({
      pendingMessageIds,
      list: async (since) => {
        if (expiredHistory && since) throw Object.assign(new Error("Expired Gmail cursor"), { status: 404 })
        throw new Error("Gmail listing unavailable")
      },
      profile: async () => "unconfirmed-profile-history",
    })

    const partial = await h.run("2026-11-21T02:00:00Z", true)
    assert.equal(partial.ok, false)
    assert.equal(partial.inserted, pendingMessageIds.length)
    assert.equal(partial.pending, 0)
    assert.equal(partial.checkpointAdvanced, false)
    assert.equal(partial.error, "Gmail listing unavailable")
    assert.deepEqual(h.fetchedIds, pendingMessageIds)
    assert.deepEqual(h.mailboxState(), {
      checkpoint: { pendingIds: [], historyId },
      committedHistory: null,
    })
    assert.equal(h.recordedRuns[0].ok, false)
    assert.equal(h.recordedRuns[0].detail.error, partial.error)
  })
}

test("a Gmail listing error still throws when there is less than a full saved batch", async () => {
  const h = harness({ list: async () => { throw new Error("Gmail listing unavailable") } })
  await assert.rejects(h.run("2026-11-21T02:00:00Z"), /Gmail listing unavailable/)
  assert.deepEqual(h.fetchedIds, [])
  assert.equal(h.recordedRuns[0].ok, false)
})
