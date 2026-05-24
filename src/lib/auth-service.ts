import crypto from "crypto"
import { dbQuery } from "#/lib/db"

declare const Bun: {
  password: {
    hash(password: string, options?: { algorithm?: string }): Promise<string>
    verify(password: string, hash: string): Promise<boolean>
  }
}

// ─── JWT helpers (HS256, no external library) ──────────────────────────────

function base64url(str: string): string {
  return Buffer.from(str).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

export function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSeconds: number
): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const body = base64url(
    JSON.stringify({
      ...payload,
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
      iat: Math.floor(Date.now() / 1000)
    })
  )
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
  return `${header}.${body}.${sig}`
}

export function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split(".")
  if (parts.length !== 3) return null
  const [header, body, sig] = parts as [string, string, string]
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
  if (sig !== expected) return null
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString())
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

// ─── Cookie helpers ────────────────────────────────────────────────────────

export function setAuthCookies(
  response: Response,
  accessToken: string,
  refreshToken: string,
  isProd: boolean
): Response {
  const secure = isProd ? "; Secure" : ""
  const headers = new Headers(response.headers)
  headers.append(
    "Set-Cookie",
    `access_token=${accessToken}; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=28800`
  )
  headers.append(
    "Set-Cookie",
    `refresh_token=${refreshToken}; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=2592000`
  )
  return new Response(response.body, {
    status: response.status,
    headers
  })
}

export function clearAuthCookies(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.append(
    "Set-Cookie",
    "access_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
  )
  headers.append(
    "Set-Cookie",
    "refresh_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
  )
  return new Response(response.body, {
    status: response.status,
    headers
  })
}

export function getCookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie")
  if (!cookieHeader) return null
  const match = cookieHeader.split(";").find((c) => c.trim().startsWith(`${name}=`))
  if (!match) return null
  return match.trim().slice(name.length + 1)
}

// ─── Password helpers ──────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id" })
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash)
}

// ─── Token generation ──────────────────────────────────────────────────────

export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString("hex")
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex")
}

// ─── Permission cache (in-memory, 5-min TTL) ──────────────────────────────

interface CacheEntry {
  permissions: string[]
  expiresAt: number
}
const permissionCache = new Map<string, CacheEntry>()

export async function getPermissionsForRole(
  workspaceId: string,
  role: string
): Promise<string[]> {
  const key = `${workspaceId}:${role}`
  const entry = permissionCache.get(key)
  if (entry && entry.expiresAt > Date.now()) {
    return entry.permissions
  }

  interface PermRow { permission: string }
  const rows = await dbQuery<(PermRow & import("mysql2").RowDataPacket)[]>(
    `SELECT permission FROM erp_role_permissions
     WHERE workspace_id = ? AND role = ? AND granted = 1`,
    [workspaceId, role]
  )
  const permissions = rows.map((r) => r.permission)
  permissionCache.set(key, { permissions, expiresAt: Date.now() + 5 * 60 * 1000 })
  return permissions
}

export function invalidatePermissionCache(workspaceId: string, role: string): void {
  const key = `${workspaceId}:${role}`
  permissionCache.delete(key)
}

// ─── Email sender ──────────────────────────────────────────────────────────

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const smtpHost = process.env.SMTP_HOST
  if (!smtpHost) {
    console.warn(`[WARN] SMTP not configured — reset URL: ${resetUrl}`)
    return
  }

  // Dynamic import to avoid issues when nodemailer is not available
  const nodemailer = await import("nodemailer")
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(process.env.SMTP_PORT ?? 587),
    auth:
      process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
        : undefined
  })

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "noreply@sparksome.com",
    to,
    subject: "Sparksome ERP — Reset your password",
    text: `Click the link below to reset your password (valid for 1 hour):\n\n${resetUrl}`,
    html: `<p>Click the link below to reset your password (valid for 1 hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p>`
  })
}
