const ADVISORY_LOCK_SQL = "SELECT pg_advisory_lock(hashtext('mcsw-migrate'))"
const ADVISORY_UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtext('mcsw-migrate'))"
const SCHEMA_MIGRATIONS_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`

async function applyNamedStep(client, step) {
  const existing = await client.query(
    "SELECT name FROM schema_migrations WHERE name = $1::text",
    [step.name],
  )
  if (existing.rows.length > 0) return

  await client.query("BEGIN")
  try {
    if (step.run) await step.run(client)
    else await client.query(step.query)

    await client.query(
      `INSERT INTO schema_migrations (name, applied_at)
       VALUES ($1::text, now())
       ON CONFLICT (name) DO NOTHING`,
      [step.name],
    )
    await client.query("COMMIT")
  } catch (error) {
    try {
      await client.query("ROLLBACK")
    } catch {
      // A lost session already rolls back its open transaction.
    }
    throw error
  }
}

export async function runWithMigrationLock({ pool, steps, runTail, onComplete }) {
  let client
  let lockAcquired = false
  let failure

  try {
    client = await pool.connect()
    await client.query("SET lock_timeout = '30s'")
    await client.query("SET statement_timeout = '5min'")
    // Neon may suspend a compute after inactivity even while a client is connected.
    // Ending a stalled idle session releases its session-level advisory lock.
    await client.query("SET idle_session_timeout = '4min'")
    await client.query(ADVISORY_LOCK_SQL)
    lockAcquired = true
    await client.query(SCHEMA_MIGRATIONS_SQL)

    for (const step of steps) await applyNamedStep(client, step)
    if (runTail) await applyNamedStep(client, { name: "legacy-procedural-tail", run: runTail })
    if (onComplete) await onComplete(client)
  } catch (error) {
    failure = error
  }

  if (client && lockAcquired) {
    try {
      await client.query(ADVISORY_UNLOCK_SQL)
    } catch (error) {
      failure ??= error
    }
  }

  if (client) {
    try {
      client.release(failure)
    } catch (error) {
      failure ??= error
    }
  }

  try {
    await pool.end()
  } catch (error) {
    failure ??= error
  }

  if (failure) throw failure
}
