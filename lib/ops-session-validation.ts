export type SessionTokenSql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => PromiseLike<Array<Record<string, unknown>>>

export async function validateSessionTokenWithSql(sql: SessionTokenSql, tokenHash: string) : Promise<Record<string, unknown> | null> {
  try {
    const rows = await sql`
      SELECT o.*, (t.last_used_at < now() - interval '1 hour') AS refresh_due
      FROM ops_tokens t
      JOIN operators o ON (
        o.id = t.operator_id OR
        (t.operator_id IS NULL AND lower(o.email) = lower(t.email))
      )
      WHERE t.token_hash = ${tokenHash}::text
        AND t.purpose = 'session'
        AND t.expires_at > now()
        AND t.last_used_at > now() - interval '14 days'
        AND o.active = true
      LIMIT 1`
    const session = rows[0]
    if (!session) return null

    if (session.refresh_due !== true) {
      const operator = { ...session }
      delete operator.refresh_due
      return operator
    }

    const refreshed = await sql`
      UPDATE ops_tokens t SET
        last_used_at = now(),
        expires_at = now() + interval '14 days'
      FROM operators o
      WHERE t.token_hash = ${tokenHash}::text
        AND t.purpose = 'session'
        AND t.expires_at > now()
        AND t.last_used_at > now() - interval '14 days'
        AND t.last_used_at < now() - interval '1 hour'
        AND o.active = true
        AND (
          o.id = t.operator_id OR
          (t.operator_id IS NULL AND lower(o.email) = lower(t.email))
        )
      RETURNING o.*`
    if (refreshed[0]) return refreshed[0]

    const current = await sql`
      SELECT o.*
      FROM ops_tokens t
      JOIN operators o ON (
        o.id = t.operator_id OR
        (t.operator_id IS NULL AND lower(o.email) = lower(t.email))
      )
      WHERE t.token_hash = ${tokenHash}::text
        AND t.purpose = 'session'
        AND t.expires_at > now()
        AND t.last_used_at > now() - interval '14 days'
        AND o.active = true
      LIMIT 1`
    return current[0] ?? null
  } catch {
    return null
  }
}
