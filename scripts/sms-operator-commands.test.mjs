import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  ambiguousReply,
  nameReadings,
  OPERATOR_COMMAND_EVENT_KIND,
  OPERATOR_TEXT_GRAMMAR,
  parseDollarsToken,
  parseOperatorCommand,
  successReply,
} from "../lib/sms-operator-commands.ts"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("ordinary texts are not commands", () => {
  for (const body of ["", "Hi, can you weld a gate?", "I booked a flight", "Unpaid invoice question", "paidup"]) {
    assert.equal(parseOperatorCommand(body), null, body)
  }
})

test("booked, quoted, lost and paid parse by #id", () => {
  assert.deepEqual(parseOperatorCommand("booked #12"), { ok: true, verb: "booked", ref: { kind: "id", id: 12 }, amountCents: null, reason: "" })
  assert.deepEqual(parseOperatorCommand("Quoted #7"), { ok: true, verb: "quoted", ref: { kind: "id", id: 7 }, amountCents: null, reason: "" })
  assert.deepEqual(parseOperatorCommand("lost #12 too expensive"), { ok: true, verb: "lost", ref: { kind: "id", id: 12 }, amountCents: null, reason: "too expensive" })
  assert.deepEqual(parseOperatorCommand("paid #12 $450"), { ok: true, verb: "paid", ref: { kind: "id", id: 12 }, amountCents: 45000, reason: "" })
  assert.deepEqual(parseOperatorCommand("paid $1,250.50 #12"), { ok: true, verb: "paid", ref: { kind: "id", id: 12 }, amountCents: 125050, reason: "" })
})

test("names parse as words and never guess an id", () => {
  const parsed = parseOperatorCommand("paid Smith Fabrication $300")
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.ref, { kind: "name", words: ["Smith", "Fabrication"] })
  assert.equal(parsed.amountCents, 30000)
})

test("malformed commands answer with a usage line and carry no target", () => {
  for (const body of ["booked", "paid #12", "paid #12 $0", "paid #12 $abc", "lost #12", "lost Smith", "quoted"]) {
    const parsed = parseOperatorCommand(body)
    assert.equal(parsed?.ok, false, body)
    assert.ok(parsed.reply.length > 0)
  }
  assert.equal(parseOperatorCommand("paid #12 $999999999").ok, false)
})

test("dollar tokens are exact", () => {
  assert.equal(parseDollarsToken("$450"), 45000)
  assert.equal(parseDollarsToken("$450.5"), 45050)
  assert.equal(parseDollarsToken("$1,000"), 100000)
  assert.equal(parseDollarsToken("450"), null)
  assert.equal(parseDollarsToken("$4,50"), null)
})

test("lost by name tries the longest name first, the rest is the reason", () => {
  const readings = nameReadings("lost", ["Jane", "Smith", "went", "elsewhere"])
  assert.deepEqual(readings[0], { name: "jane smith went", reason: "elsewhere" })
  assert.deepEqual(readings.at(-1), { name: "jane", reason: "Smith went elsewhere" })
  assert.deepEqual(nameReadings("booked", ["Jane", "Smith"]), [{ name: "jane smith", reason: "" }])
})

test("ambiguous replies name at most three jobs and say nothing changed", () => {
  const rows = [1, 2, 3, 4].map((id) => ({ id, first_name: "Sam", last_name: "Lee", service: "Gate" }))
  const reply = ambiguousReply("Sam", rows)
  assert.match(reply, /Nothing changed/)
  assert.equal((reply.match(/#\d+/g) ?? []).length, 3)
})

test("owner-facing copy never says test, pilot or trial", () => {
  const copy = [
    OPERATOR_TEXT_GRAMMAR,
    successReply("booked", { id: 1, first_name: "A", last_name: "B" }),
    successReply("paid", { id: 1, first_name: "A", last_name: "B" }, { amountCents: 100 }),
    ambiguousReply("A", []),
    parseOperatorCommand("booked").reply,
    parseOperatorCommand("paid #1").reply,
    parseOperatorCommand("lost #1").reply,
  ]
  for (const line of copy) assert.doesNotMatch(line, /\b(test|pilot|trial)\b/i)
})

test("route: command branch sits after the raw message insert and before conversation resolution", () => {
  const route = read("app/api/twilio/sms/route.ts")
  const insert = route.indexOf("INSERT INTO messages")
  const branch = route.indexOf("handleOperatorText(")
  const resolve = route.indexOf("await resolvePhoneConversation(")
  assert.ok(insert > 0 && branch > insert && resolve > branch)
  assert.match(route, /if \(!systemSms && !consentKeyword\) \{\s*const command = await handleOperatorText\(/)
  assert.match(route, /if \(command\) return twiml\(command\.reply \? `<Message>\$\{escapeXml\(command\.reply\)\}<\/Message>` : ""\)/)
  assert.match(route, /if \(!messageId\) return twiml\(""\)/)
})

test("handler: operator table only, lost is owner-only, no side-channel send, no raw lead update", () => {
  const handler = read("lib/sms-operator-in.ts")
  assert.match(handler, /getOperatorByPhone/)
  assert.doesNotMatch(handler, /process\.env/)
  assert.doesNotMatch(handler, /ALLOWED_PHONES|ALLOWLIST/i)
  assert.match(handler, /parsed\.verb === "lost" && operator\.role !== "owner"/)
  assert.doesNotMatch(handler, /sendSms|notifyAll|notifyOwnerCellSms|fetch\(/)
  assert.doesNotMatch(handler, /UPDATE\s+leads/i)
  assert.match(handler, /const operator = await operatorForPhone\(input\.from\)\s*if \(!operator\) return null/)
  assert.ok(handler.indexOf("parseOperatorCommand(input.body)") < handler.indexOf("operatorForPhone(input.from)"))
  assert.ok(handler.indexOf("priorReply(input.sid)") > handler.indexOf("if (!operator) return null"))
  assert.match(handler, /requireLeadMutationAccess\(operator, leadId\)/)
})

test("handler: every SQL interpolation carries a cast and the shared sinks are used", () => {
  const handler = read("lib/sms-operator-in.ts")
  const blocks = [...handler.matchAll(/getSql\(\)`([^`]*)`/g)].map((m) => m[1])
  assert.ok(blocks.length >= 3)
  for (const block of blocks) assert.deepEqual([...block.matchAll(/\$\{[^}]+\}(?!::)/g)].map((m) => m[0]), [])
  assert.match(handler, /applyLeadStatus\(operator, \{ leadId, status: "quoted"/)
  assert.match(handler, /applyLeadStatus\(operator, \{ leadId, status: "lost"/)
  assert.match(handler, /completeLeadRecord\(operator, leadId, new FormData\(\)\)/)
  assert.match(handler, /recordPaymentRecord\(operator,/)
})

test("event kind is journaled but never extracted", () => {
  assert.equal(OPERATOR_COMMAND_EVENT_KIND, "sms.operator.in")
  const extract = read("lib/extract.ts")
  const list = extract.slice(extract.indexOf("EXTRACTABLE_EVENT_KINDS"), extract.indexOf("]", extract.indexOf("EXTRACTABLE_EVENT_KINDS")))
  assert.doesNotMatch(list, /sms\.operator\.in/)
})

test("digest carries the one-line grammar", () => {
  assert.match(read("app/api/ops/digest/route.ts"), /OPERATOR_TEXT_GRAMMAR/)
  assert.match(OPERATOR_TEXT_GRAMMAR, /booked #12.*paid #12 \$450.*quoted #12.*lost #12 reason/)
})
