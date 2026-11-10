import { randomUUID } from "node:crypto"
import { getSql } from "../db.ts"
import type { AssistantInput } from "./input.ts"
import { AssistantRequestError } from "./input.ts"
import type { AssistantMessage, AssistantTurn } from "./turn.ts"
import type { AssistantClaim, AssistantResponse, AssistantSession, AssistantStoredTurn, AssistantStore } from "./service.ts"

const conflict = () => new AssistantRequestError("That chat is still being saved. Keep this page open and retry the same message.", 409)

export class PostgresAssistantStore implements AssistantStore {
  private intakeKey?: string

  constructor(intakeKey?: string) {
    this.intakeKey = intakeKey
  }

  async begin(input: AssistantInput): Promise<AssistantClaim | AssistantResponse> {
    const sql = getSql()
    await sql`
      INSERT INTO assistant_sessions (id, is_test)
      VALUES (${input.session_id}::uuid, ${input.is_test}::boolean)
      ON CONFLICT (id) DO NOTHING`
    const sessions = (await sql`SELECT id, next_turn, is_test, lead_id FROM assistant_sessions WHERE id = ${input.session_id}::uuid`) as AssistantSession[]
    const session = sessions[0]
    if (!session) throw new Error("Chat session was not saved.")
    const prior = (await sql`
      SELECT inbound, result, response, lead_captured FROM assistant_turns
      WHERE session_id = ${input.session_id}::uuid AND turn_index = ${input.turn_index}::int`) as AssistantStoredTurn[]
    if (prior[0]) {
      if (prior[0].inbound !== input.message || (input.is_test && !session.is_test && prior[0].response)) {
        throw new AssistantRequestError("An earlier version of this message was already saved. Start a new chat for a changed request.", 409)
      }
      if (prior[0].response) return prior[0].response
    }
    if (Number(session.next_turn) !== input.turn_index) throw new AssistantRequestError("Retry the previous message before sending another.", 409)
    const token = randomUUID()
    // A session has one writer. A fenced five-minute lease is reclaimable after a process dies.
    // A test marker can upgrade an unfiled chat, but can never relabel an existing real lead.
    const claimed = (await sql`
      UPDATE assistant_sessions SET lease_token = ${token}::uuid,
        lease_until = now() + interval '5 minutes', is_test = is_test OR ${input.is_test}::boolean,
        updated_at = now()
      WHERE id = ${input.session_id}::uuid AND next_turn = ${input.turn_index}::int
        AND (lease_until IS NULL OR lease_until < now())
        AND NOT (${input.is_test}::boolean AND is_test = false AND EXISTS (
          SELECT 1 FROM leads
          WHERE (intake_key = ${this.intakeKey ?? `assistant:${input.session_id}`}::text OR id = assistant_sessions.lead_id)
            AND is_test = false
        ))
      RETURNING id, next_turn, is_test, lead_id`) as AssistantSession[]
    if (!claimed[0]) throw conflict()
    const claim: AssistantClaim = {
      session: claimed[0], token,
      turn: prior[0] ?? { inbound: input.message, result: null, response: null, lead_captured: false },
    }
    try {
      const persisted = (await sql`
        INSERT INTO assistant_turns (session_id, turn_index, inbound, is_test)
        SELECT id, ${input.turn_index}::int, ${input.message}::text, is_test
        FROM assistant_sessions WHERE id = ${input.session_id}::uuid AND lease_token = ${token}::uuid AND lease_until > now()
        ON CONFLICT (session_id, turn_index) DO UPDATE SET inbound = assistant_turns.inbound
        WHERE assistant_turns.inbound = EXCLUDED.inbound
        RETURNING inbound`) as { inbound: string }[]
      if (!persisted[0]) throw conflict()
      // These are mutable assistant checkpoints, never journal events.
      if (claim.session.is_test) await sql`UPDATE assistant_turns SET is_test = true WHERE session_id = ${input.session_id}::uuid`
      await this.verifyLease(claim)
      return claim
    } catch (error) {
      await this.release(claim)
      throw error
    }
  }

  async history(sessionId: string, turnIndex: number): Promise<AssistantMessage[]> {
    const rows = (await getSql()`
      SELECT inbound, response FROM assistant_turns
      WHERE session_id = ${sessionId}::uuid AND turn_index <= ${turnIndex}::int
      ORDER BY turn_index ASC LIMIT 30`) as Array<{ inbound: string; response: AssistantResponse | null }>
    return rows.flatMap((row): AssistantMessage[] => [
      { role: "user", content: row.inbound },
      ...(row.response ? [{ role: "assistant" as const, content: row.response.reply }] : []),
    ])
  }

  async verifyLease(claim: AssistantClaim) {
    const rows = (await getSql()`
      UPDATE assistant_sessions SET lease_until = now() + interval '5 minutes'
      WHERE id = ${claim.session.id}::uuid AND lease_token = ${claim.token}::uuid AND lease_until > now()
      RETURNING id`) as { id: string }[]
    if (!rows[0]) throw conflict()
  }

  async saveModel(claim: AssistantClaim, index: number, result: AssistantTurn) {
    const rows = (await getSql()`
      UPDATE assistant_turns t SET result = ${JSON.stringify(result)}::jsonb
      FROM assistant_sessions s WHERE t.session_id = s.id
        AND s.id = ${claim.session.id}::uuid AND t.turn_index = ${index}::int
        AND s.lease_token = ${claim.token}::uuid AND s.lease_until > now()
      RETURNING t.session_id`) as { session_id: string }[]
    if (!rows[0]) throw conflict()
  }

  async saveLead(claim: AssistantClaim, index: number, leadId: number) {
    const rows = (await getSql()`
      WITH saved AS (
        UPDATE assistant_sessions SET lead_id = ${leadId}::bigint, updated_at = now()
        WHERE id = ${claim.session.id}::uuid AND lease_token = ${claim.token}::uuid AND lease_until > now()
        RETURNING id
      )
      UPDATE assistant_turns t SET lead_captured = true FROM saved s
      WHERE t.session_id = s.id AND t.turn_index = ${index}::int RETURNING t.session_id`) as { session_id: string }[]
    if (!rows[0]) throw conflict()
  }

  async finish(claim: AssistantClaim, index: number, response: AssistantResponse) {
    const rows = (await getSql()`
      WITH finished AS (
        UPDATE assistant_turns t SET response = ${JSON.stringify(response)}::jsonb
        FROM assistant_sessions s WHERE t.session_id = s.id
          AND s.id = ${claim.session.id}::uuid AND t.turn_index = ${index}::int
          AND s.lease_token = ${claim.token}::uuid AND s.lease_until > now()
        RETURNING t.session_id
      )
      UPDATE assistant_sessions s SET next_turn = ${index + 1}::int,
        lease_token = NULL, lease_until = NULL, updated_at = now()
      FROM finished f WHERE s.id = f.session_id RETURNING s.id`) as { id: string }[]
    if (!rows[0]) throw conflict()
  }

  async release(claim: AssistantClaim) {
    await getSql()`
      UPDATE assistant_sessions SET lease_token = NULL, lease_until = NULL
      WHERE id = ${claim.session.id}::uuid AND lease_token = ${claim.token}::uuid`
  }
}
