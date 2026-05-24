import mysql from "mysql2/promise"
const pool = await mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 })
const hash = await Bun.password.hash("Test1234", { algorithm: "argon2id" })
await pool.execute("UPDATE erp_users SET password_hash=? WHERE email='admin@sparksome.com'", [hash])
const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT email FROM erp_users LIMIT 1")
console.log("Updated. User:", (rows[0] as any)?.email)
console.log("Test: verify Test1234:", await Bun.password.verify("Test1234", hash))
await pool.end()
