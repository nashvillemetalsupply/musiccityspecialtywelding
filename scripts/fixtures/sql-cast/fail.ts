const sql = getSql()
const rows = await sql`SELECT id FROM leads WHERE id = ${leadId} AND is_test = ${isTest}::boolean`
