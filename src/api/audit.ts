import { useQuery } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import z from "zod"

import { backendGet } from "#/lib/backend-client"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditRow {
  id: string
  workspace_id: string
  actor_user_id: string
  actor_name: string
  actor_role: string
  action: string
  entity_type: string
  entity_id: string
  entity_label: string | null
  changed_fields: Record<string, { from: unknown; to: unknown }> | null
  metadata: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

export interface AuditListResponse {
  total: number
  rows: AuditRow[]
  limit: number
  offset: number
}

// ─── Server Functions ─────────────────────────────────────────────────────────

const AuditQueryInput = z.object({
  workspaceId: z.string(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  actorUserId: z.string().optional(),
  action: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional()
})

type AuditQueryParams = z.infer<typeof AuditQueryInput>

const fetchAuditLogFn = createServerFn({ method: "GET" })
  .inputValidator(AuditQueryInput)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .handler(async ({ data }): Promise<any> => {
    const queryParams: Record<string, string | number | boolean | null | undefined> = {
      workspaceId: data.workspaceId
    }
    if (data.entityType) queryParams.entityType = data.entityType
    if (data.entityId) queryParams.entityId = data.entityId
    if (data.actorUserId) queryParams.actorUserId = data.actorUserId
    if (data.action) queryParams.action = data.action
    if (data.from) queryParams.from = data.from
    if (data.to) queryParams.to = data.to
    if (data.q) queryParams.q = data.q
    if (data.limit !== undefined) queryParams.limit = data.limit
    if (data.offset !== undefined) queryParams.offset = data.offset
    return backendGet<AuditListResponse>("/audit", queryParams)
  })

// ─── React Query Hooks ────────────────────────────────────────────────────────

export function useAuditLog(params: AuditQueryParams) {
  return useQuery({
    queryKey: ["audit", params],
    queryFn: () => fetchAuditLogFn({ data: params }),
    enabled: !!params.workspaceId
  })
}

export function useEntityAudit(
  workspaceId: string | undefined,
  entityType: string,
  entityId: string | undefined
) {
  return useQuery({
    queryKey: ["audit", "entity", workspaceId, entityType, entityId],
    queryFn: () =>
      fetchAuditLogFn({
        data: {
          workspaceId: workspaceId!,
          entityType,
          entityId: entityId ?? undefined,
          limit: 10
        }
      }),
    enabled: !!workspaceId && !!entityId
  })
}

export function auditCsvUrl(workspaceId: string, backendUrl: string, token: string, filters: Partial<AuditQueryParams> = {}): string {
  const p = new URLSearchParams({ workspaceId, format: "csv", token })
  if (filters.entityType) p.set("entityType", filters.entityType)
  if (filters.entityId) p.set("entityId", filters.entityId)
  if (filters.actorUserId) p.set("actorUserId", filters.actorUserId)
  if (filters.action) p.set("action", filters.action)
  if (filters.from) p.set("from", filters.from)
  if (filters.to) p.set("to", filters.to)
  if (filters.q) p.set("q", filters.q)
  return `${backendUrl}/audit?${p.toString()}`
}
