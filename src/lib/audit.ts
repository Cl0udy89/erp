import crypto from "crypto"

import { dbExecute, dbQuery } from "#/lib/db"
import type { RowDataPacket } from "mysql2"

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "view"
  | "login"
  | "logout"
  | "export"
  | "approve"
  | "reject"
  | "submit"
  | "role_change"
  | "permission_change"
  | "link"
  | "unlink"

export interface AuditEntry {
  workspaceId: string
  action: AuditAction
  entityType: string
  entityId: string
  entityLabel?: string
  changedFields?: Record<string, { from: unknown; to: unknown }>
  metadata?: Record<string, unknown>
}

export interface AuditActor {
  id: string
  email: string
  role: string
  ipAddress?: string | null
}

export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null
  return null
}

export function diffFields(
  oldRecord: Record<string, unknown>,
  newRecord: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> {
  const changed: Record<string, { from: unknown; to: unknown }> = {}
  const allKeys = new Set([...Object.keys(oldRecord), ...Object.keys(newRecord)])
  for (const key of allKeys) {
    const a = oldRecord[key]
    const b = newRecord[key]
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changed[key] = { from: a, to: b }
    }
  }
  return changed
}

async function resolveActorName(userId: string, email: string): Promise<string> {
  try {
    const rows = await dbQuery<RowDataPacket[]>(
      `SELECT e.name FROM erp_users u
       LEFT JOIN erp_employees e ON e.id = u.employee_id
       WHERE u.id = ? LIMIT 1`,
      [userId]
    )
    const name = rows[0]?.name as string | null | undefined
    return name ?? email
  } catch {
    return email
  }
}

export async function audit(actor: AuditActor, entry: AuditEntry): Promise<void> {
  const actorName = await resolveActorName(actor.id, actor.email)
  const id = `aud_${crypto.randomUUID()}`
  await dbExecute(
    `INSERT INTO erp_audit_log
      (id, workspace_id, actor_user_id, actor_name, actor_role, action,
       entity_type, entity_id, entity_label, changed_fields, metadata, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      entry.workspaceId,
      actor.id,
      actorName,
      actor.role,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.entityLabel ?? null,
      entry.changedFields && Object.keys(entry.changedFields).length > 0
        ? JSON.stringify(entry.changedFields)
        : null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      actor.ipAddress ?? null
    ]
  )
}

export function auditAsync(actor: AuditActor, entry: AuditEntry): void {
  audit(actor, entry).catch((err) => console.error("[Audit log failed]", err))
}
