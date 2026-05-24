import mysql from "mysql2/promise"

const pool = await mysql.createPool({
  uri: "mysql://erp:erp_dev_pass@localhost:3306/erp",
  connectionLimit: 1
})

const [rows] = await pool.query<mysql.RowDataPacket[]>(
  "SELECT password_hash FROM erp_users WHERE email = 'admin@sparksome.com' LIMIT 1"
)
const hash = (rows[0] as any)?.password_hash as string
console.log("Hash in DB:", hash?.slice(0, 40) + "...")

const ok1 = await Bun.password.verify("Admin1234!", hash)
const ok2 = await Bun.password.verify("changeme123", hash)
console.log("Admin1234! valid:", ok1)
console.log("changeme123 valid:", ok2)

await pool.end()
