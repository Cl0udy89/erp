// Replicates exactly what backend does
import mysql from "mysql2/promise"

const dbUrl = process.env.DATABASE_URL
console.log("DATABASE_URL:", dbUrl?.slice(0, 30) + "...")
console.log("ADMIN_PASSWORD:", process.env.ADMIN_PASSWORD)

const pool = await mysql.createPool({ uri: dbUrl!, connectionLimit: 1 })
const [rows] = await pool.query<mysql.RowDataPacket[]>(
  "SELECT email, password_hash, is_active FROM erp_users WHERE email = ? AND is_active = 1 LIMIT 1",
  ["admin@sparksome.com"]
)
console.log("Rows found:", rows.length)
if (rows[0]) {
  const hash = (rows[0] as any).password_hash as string
  console.log("Hash:", hash.slice(0, 40))
  const ok = await Bun.password.verify("Admin1234!", hash)
  console.log("Admin1234! valid:", ok)
}
await pool.end()
