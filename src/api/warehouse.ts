import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import z from "zod"

import { backendGet, backendPost } from "#/lib/backend-client"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WarehouseDocumentItem {
  id: string
  warehouse_document_id: string
  product_id: string | null
  product_name: string
  quantity: number
  unit: string | null
  unit_price: number | null
}

export interface WarehouseDocument {
  id: string
  doc_type: "PZ" | "WZ"
  doc_number: string
  doc_date: string
  status: "draft" | "confirmed" | "cancelled"
  notes: string | null
  financial_doc_id: string | null
  counterparty_id: string | null
  counterparty_type: "client" | "supplier" | null
  counterparty_name: string | null
  created_by: string
  created_at: string
  item_count?: number
}

export interface WarehouseDocumentDetail extends WarehouseDocument {
  items: WarehouseDocumentItem[]
}

export interface WarehouseListResponse {
  total: number
  rows: WarehouseDocument[]
  limit: number
  offset: number
}

export interface CreateWarehouseDocumentPayload {
  docType: "PZ" | "WZ"
  financialDocId?: string
  counterpartyId?: string
  counterpartyType?: "client" | "supplier"
  docDate: string
  notes?: string
  projectId?: string
  items: Array<{
    productId?: string
    productName: string
    quantity: number
    unit?: string
    unitPrice?: number
  }>
}

// ─── Server functions ─────────────────────────────────────────────────────────

const listWarehouseDocsFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({
    workspaceId: z.string(),
    docType: z.string().optional(),
    status: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    limit: z.number().optional(),
    offset: z.number().optional()
  }))
  .handler(async ({ data }) =>
    backendGet<WarehouseListResponse>("/warehouse/documents", {
      workspaceId: data.workspaceId,
      docType: data.docType,
      status: data.status,
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
      limit: String(data.limit ?? 50),
      offset: String(data.offset ?? 0)
    })
  )

const getWarehouseDocFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) =>
    backendGet<WarehouseDocumentDetail>(`/warehouse/documents/${data.id}`, {})
  )

const createWarehouseDocFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    docType: z.enum(["PZ", "WZ"]),
    financialDocId: z.string().optional(),
    counterpartyId: z.string().optional(),
    counterpartyType: z.enum(["client", "supplier"]).optional(),
    docDate: z.string(),
    notes: z.string().optional(),
    projectId: z.string().optional(),
    items: z.array(z.object({
      productId: z.string().optional(),
      productName: z.string(),
      quantity: z.number(),
      unit: z.string().optional(),
      unitPrice: z.number().optional()
    }))
  }))
  .handler(async ({ data }) =>
    backendPost<{ id: string; docNumber: string; status: string }>("/warehouse/documents", data)
  )

const confirmWarehouseDocFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) =>
    backendPost<{ ok: boolean; status: string }>(`/warehouse/documents/${data.id}/confirm`, {})
  )

const cancelWarehouseDocFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), reason: z.string().optional() }))
  .handler(async ({ data }) =>
    backendPost<{ ok: boolean; status: string }>(`/warehouse/documents/${data.id}/cancel`, { reason: data.reason })
  )

// ─── React Query Hooks ────────────────────────────────────────────────────────

export function useWarehouseDocs(params: {
  workspaceId: string
  docType?: "PZ" | "WZ"
  status?: string
  dateFrom?: string
  dateTo?: string
  limit?: number
  offset?: number
}) {
  return useQuery({
    queryKey: ["warehouse", "docs", params],
    queryFn: () => listWarehouseDocsFn({ data: params }),
    enabled: !!params.workspaceId
  })
}

export function useWarehouseDoc(id: string) {
  return useQuery({
    queryKey: ["warehouse", "doc", id],
    queryFn: () => getWarehouseDocFn({ data: { id } }),
    enabled: !!id
  })
}

export function useCreateWarehouseDoc() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateWarehouseDocumentPayload) => createWarehouseDocFn({ data: payload }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["warehouse", "docs"] })
    }
  })
}

export function useConfirmWarehouseDoc() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => confirmWarehouseDocFn({ data: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["warehouse"] })
    }
  })
}

export function useCancelWarehouseDoc() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      cancelWarehouseDocFn({ data: { id, reason } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["warehouse"] })
    }
  })
}
