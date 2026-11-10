import assert from "node:assert/strict"

// Only the provider and SQL boundaries are fixtures. Routes, storage, intake,
// person matching, journal writes, handoffs and reply guards still run normally.
export function createDryFixture() {
  const sessions = new Map(), turns = new Map(), leads = new Map(), people = new Map(), calls = new Map()
  const events = [], identities = new Map(), attempts = new Map()
  const copy = (value) => structuredClone(value)
  const sessionTurns = (id) => [...turns.values()].filter((t) => t.session_id === id).sort((a, b) => a.turn_index - b.turn_index)
  const env = {
    NEXT_PUBLIC_ASSISTANT_CHAT: "1", ASSISTANT_VOICE: "1",
    TWILIO_WEBHOOK_BASE_URL: "https://example.test", NODE_ENV: "test",
  }
  const sql = async (strings, ...v) => {
    for (let i = 0; i < v.length; i++) assert.match(strings[i + 1], /^::\w+/, "SQL value needs a cast")
    const q = strings.join(" ? ").replace(/\s+/g, " ").trim()
    if (q.includes("/* a4:session */")) return copy(sessions.has(v[0]) ? [sessions.get(v[0])] : [])
    if (q.includes("/* a4:turns */")) return copy(sessionTurns(v[0]))
    if (q.includes("/* a4:leads */")) return copy([...leads.values()].filter((l) => l.intake_key === v[0]))
    if (q.includes("/* a4:events */")) return copy(events.filter((e) => e.detail?.sessionId === v[0] || e.external_id === v[1] || (v[2] && e.lead_id === v[2])))
    if (q.includes("/* a4:outbound */")) return [{ notifications: 0, sms: 0, email: 0 }]
    if (q.includes("/* a4:people */")) return copy([...people.values()].filter((p) => p.id === v[0]))
    if (q.includes("/* a4:call */")) return copy(calls.has(v[0]) ? [calls.get(v[0])] : [])
    if (q.includes("/* a4:age */")) { const s = sessions.get(v[0]); if (s?.is_test) s.idle = true; return s?.is_test ? [{ id: s.id }] : [] }
    if (q.startsWith("INSERT INTO rate_limits")) { attempts.set(v[0], (attempts.get(v[0]) ?? 0) + 1); return [] }
    if (q.startsWith("SELECT count(*)::int AS count FROM rate_limits")) return [{ count: attempts.get(v[0]) ?? 0 }]
    if (q.startsWith("INSERT INTO assistant_sessions")) {
      if (!sessions.has(v[0])) sessions.set(v[0], { id: v[0], is_test: v[1] ?? false, next_turn: 0, lead_id: null, lease_token: null })
      return []
    }
    if (q.startsWith("SELECT id, next_turn, is_test, lead_id FROM assistant_sessions")) return copy(sessions.has(v[0]) ? [sessions.get(v[0])] : [])
    if (q.startsWith("SELECT inbound, result, response, lead_captured")) return copy(turns.has(`${v[0]}:${v[1]}`) ? [turns.get(`${v[0]}:${v[1]}`)] : [])
    if (q.startsWith("UPDATE assistant_sessions SET lease_token = NULL")) {
      const s = sessions.get(v[0]); if (s?.lease_token === v[1]) s.lease_token = null; return []
    }
    if (q.startsWith("UPDATE assistant_sessions SET lease_token")) {
      const idle = !q.includes("is_test = is_test OR")
      const s = sessions.get(v[idle ? 1 : 2])
      if (!s || s.lease_token || (idle ? !s.idle || s.lead_id : s.next_turn !== v[3])) return []
      s.lease_token = v[0]; if (!idle) s.is_test ||= v[1]
      return copy([s])
    }
    if (q.startsWith("INSERT INTO assistant_turns")) {
      const s = sessions.get(v[2]); if (!s || s.lease_token !== v[3]) return []
      const key = `${s.id}:${v[0]}`
      if (!turns.has(key)) turns.set(key, { session_id: s.id, turn_index: v[0], inbound: v[1], is_test: s.is_test, result: null, response: null, lead_captured: false })
      return [{ inbound: turns.get(key).inbound }]
    }
    if (q.startsWith("UPDATE assistant_turns SET is_test")) { for (const t of sessionTurns(v[0])) t.is_test = true; return [] }
    if (q.startsWith("SELECT inbound, response FROM assistant_turns")) return copy(sessionTurns(v[0]).filter((t) => t.turn_index <= v[1]))
    if (q.startsWith("UPDATE assistant_sessions SET lease_until")) return sessions.get(v[0])?.lease_token === v[1] ? [{ id: v[0] }] : []
    if (q.startsWith("UPDATE assistant_turns t SET result")) {
      if (sessions.get(v[1])?.lease_token !== v[3]) return []
      turns.get(`${v[1]}:${v[2]}`).result = JSON.parse(v[0]); return [{ session_id: v[1] }]
    }
    if (q.startsWith("WITH saved AS")) {
      const s = sessions.get(v[1]); if (s?.lease_token !== v[2]) return []
      s.lead_id = v[0]; turns.get(`${s.id}:${v[3]}`).lead_captured = true; return [{ session_id: s.id }]
    }
    if (q.startsWith("WITH finished AS")) {
      const s = sessions.get(v[1]); if (s?.lease_token !== v[3]) return []
      turns.get(`${s.id}:${v[2]}`).response = JSON.parse(v[0]); s.next_turn = v[4]; s.lease_token = null; return [{ id: s.id }]
    }
    if (q.includes("AS days_to_close")) return []
    if (q.startsWith("SELECT id, is_test FROM leads WHERE intake_key") || q.startsWith("SELECT id, public_id, first_name")) return copy([...leads.values()].filter((l) => l.intake_key === v[0]))
    if (q.startsWith("SELECT id, is_test FROM leads WHERE id") || q.startsWith("SELECT person_id, is_test FROM leads")) return copy(leads.has(v[0]) ? [leads.get(v[0])] : [])
    if (q.startsWith("WITH inserted_lead AS")) {
      const old = [...leads.values()].find((l) => l.intake_key === v[25]); if (old) return copy([old])
      const l = { id: leads.size + 1, public_id: v[0], first_name: v[1], last_name: v[2], phone: v[3], email: v[4], message: v[6], source: v[9], is_test: v[20], intake_key: v[25], person_id: null, status: "new", phone_is_placeholder: v[21] }
      assert.equal(l.is_test, true, "dry intake must stay in test partition"); leads.set(l.id, l); return copy([l])
    }
    if (q.startsWith("WITH matches AS")) return copy([...people.values()].filter((p) => p.is_test === v[0] && ((v[1] && p.phones.includes(v[1])) || (v[3] && p.emails.includes(v[3])))))
    if (q.startsWith("INSERT INTO people")) {
      const p = { id: people.size + 1, display_name: v[0], company: v[1], company_key: v[2], phones: v[3], emails: v[4], is_test: v[5], account_key: "", merged_into: null }
      assert.equal(p.is_test, true); people.set(p.id, p); return copy([p])
    }
    if (q.startsWith("INSERT INTO person_identities")) {
      const literal = q.includes("VALUES ('phone'") ? "phone" : q.includes("VALUES ('email'") ? "email" : null
      const [kind, value, isTest, id] = literal ? [literal, ...v] : v
      const key = `${kind}:${value}:${isTest}`; if (identities.has(key)) return []
      identities.set(key, id); return [{ person_id: id }]
    }
    if (q.startsWith("UPDATE people SET account_key")) {
      const p = people.get(v[6]); Object.assign(p, { account_key: v[0], company_key: v[1], phones: v[2], emails: v[3] }); return copy([p])
    }
    if (q.startsWith("UPDATE people SET phones")) {
      const p = people.get(v[6]); Object.assign(p, { phones: v[0], emails: v[1], company_key: v[4], account_key: v[5] }); return copy([p])
    }
    if (q.startsWith("UPDATE leads l SET person_id")) { leads.get(v[0]).person_id = v[1]; return [] }
    if (q.startsWith("INSERT INTO events")) {
      const hasExternal = q.includes("ON CONFLICT (kind, external_id)")
      const e = { id: events.length + 1, kind: v[1], lead_id: v[4], person_id: v[5], external_id: hasExternal ? v[6] : "", body: v[hasExternal ? 7 : 6], detail: JSON.parse(v[hasExternal ? 9 : 8] ?? "null") }
      if (e.external_id && events.some((old) => old.kind === e.kind && old.external_id === e.external_id)) return []
      e.is_test = Boolean(e.detail?.isTest || /\[INTERNAL TEST\]/i.test(e.body) || leads.get(e.lead_id)?.is_test || people.get(e.person_id)?.is_test)
      assert.equal(e.is_test, true, "all dry journal writes must stay test"); events.push(e); return [{ id: e.id }]
    }
    if (q.startsWith("SELECT l.phone, l.person_id")) {
      const l = leads.get(v[1]), e = events.find((e) => e.id === v[0]); if (!l || !e || l.is_test !== v[2]) return []
      return [{ ...copy(l), person_is_test: people.get(l.person_id)?.is_test ?? false, receipt_fields: e.detail?.fields, assistant_partial: l.message.includes("Partial assistant request.") }]
    }
    if (q.startsWith("UPDATE leads SET notes")) return []
    if (q.startsWith("SELECT COALESCE(s.lead_id")) {
      const s = sessions.get(v[2]); if (!s) return []
      return [{ lead_id: s.lead_id ?? v[0], lead_is_test: leads.get(s.lead_id ?? v[0])?.is_test ?? null, is_test: s.is_test || sessionTurns(s.id).some((t) => /\[INTERNAL TEST\]/i.test(t.inbound)) }]
    }
    if (q.startsWith("UPDATE assistant_sessions s SET is_test")) { const s = sessions.get(v[0]); s.is_test = true; return [{ id: s.id }] }
    if (q.startsWith("SELECT turn_index, inbound")) return copy(sessionTurns(v[0]))
    if (q.startsWith("SELECT body, detail FROM events")) return copy(events.filter((e) => e.kind === "assistant.handoff-request" && e.external_id === v[0]))
    if (q.startsWith("SELECT id, lead_id FROM events")) return copy(events.filter((e) => e.kind === "assistant.handoff" && e.external_id === v[0]))
    if (q.startsWith("UPDATE assistant_sessions SET lead_id = COALESCE")) { const s = sessions.get(v[1]); s.lead_id ??= v[0]; return [{ lead_id: s.lead_id }] }
    if (q.startsWith("SELECT e.detail FROM events")) return [] // all test handoffs are complete without provider delivery
    if (q.startsWith("SELECT id, next_turn") && q.includes("FROM assistant_sessions")) return copy([...sessions.values()].filter((s) => s.idle && !s.lead_id && v.includes(s.id)))
    if (q.startsWith("SELECT inbound FROM assistant_turns")) return copy(sessionTurns(v[0]))
    if (q.startsWith("INSERT INTO calls")) {
      assert.match(v[0], /^CA_INTERNAL_TEST_[0-9a-f]{32}$/i)
      calls.set(v[0], { twilio_sid: v[0], direction: "in", from_phone: v[1], to_phone: v[2], is_test: true, detail: JSON.parse(v[3]), lead_id: null, person_id: null }); return []
    }
    if (q.startsWith("SELECT c.from_phone")) {
      const c = calls.get(v[0]); return c ? [{ ...copy(c), lead_is_test: leads.get(c.lead_id)?.is_test ?? null }] : []
    }
    if (q.startsWith("WITH linked AS")) { const c = calls.get(v[0]); c.lead_id = v[1]; c.person_id = leads.get(v[1]).person_id; return [{ lead_id: c.lead_id }] }
    throw new Error(`Unimplemented dry SQL shape: ${q.slice(0, 130)}`)
  }
  let modelCalls = 0
  const model = async ({ prompt, system, isTest }) => {
    assert.equal(isTest, true)
    const { conversation } = JSON.parse(prompt)
    const users = conversation.filter((m) => m.role === "user"), text = users.map((m) => m.content).join("\n")
    assert.ok(users.every((m) => m.content.startsWith("[INTERNAL TEST]")))
    assert.ok([...turns.values()].some((t) => t.inbound === users.at(-1).content && !t.response), "inbound must persist before model")
    modelCalls++
    const fields = {
      name: /A4 Test Customer/.test(text) ? "A4 Test Customer" : null,
      callback_phone: /615-555-0100/.test(text) ? "+16155550100" : null,
      need: /repair a steel gate hinge/.test(text) ? "repair a steel gate hinge" : "",
      material_size: null, location: null, timing: null, callback_window: null,
      is_job: /repair a steel gate hinge/.test(text) ? "yes" : "unsure",
    }
    const reply = !fields.need ? "What needs welding or repair?" : !fields.name ? "What name should the shop use?"
      : !fields.callback_phone && !system.includes("This is a phone conversation") ? "What callback number should the shop use?"
        : "What time works for a callback?"
    return { reply, handoff_reason: null, fields }
  }
  return { env, sql, model, modelCalls: () => modelCalls }
}
