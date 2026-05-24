const hash = await Bun.password.hash("Admin1234!", { algorithm: "argon2id" })
console.log(hash)
