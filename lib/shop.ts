import { getSql } from "@/lib/db"

export type ShopDocument = {
  id: number
  kind: "w9" | "coi"
  pathname: string
  filename: string
  expires_at: string | null
  uploaded_at: string
  uploaded_by: number | null
  status: string
  error: string
}

export async function listShopDocuments(): Promise<ShopDocument[]> {
  const sql = getSql()
  return (await sql`
    SELECT * FROM shop_documents ORDER BY kind`) as ShopDocument[]
}
