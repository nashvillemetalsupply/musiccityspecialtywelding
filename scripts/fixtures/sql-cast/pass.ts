const sql = getSql()
const rows = await sql`SELECT id FROM leads WHERE id = ${leadId}::bigint AND is_test = ${isTest}::boolean`
