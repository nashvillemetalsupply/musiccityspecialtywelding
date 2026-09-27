export type SessionTokenSql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>

export function validateSessionTokenWithSql(
  sql: SessionTokenSql,
  tokenHash: string,
): Promise<Record<string, unknown> | null>
