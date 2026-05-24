import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import z from "zod"

import { backendGet, backendPost } from "#/lib/backend-client"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LinkedEntity {
  entityType: "employee" | "client" | "project"
  entityId: string
}

export interface DocumentRecord {
  id: string
  workspace_id: string
  uploaded_by: string
  uploaded_by_name: string | null
  uploaded_by_email: string | null
  doc_type: "contract" | "invoice" | "receipt" | "id_document" | "certificate" | "nda" | "amendment" | "other"
  original_name: string
  storage_path: string
  mime_type: string
  file_size_bytes: number
  contains_personal_data: boolean
  notes: string | null
  created_at: string
  updated_at: string
  linked_entities?: LinkedEntity[] | null
  // Phase 5 sync fields
  drive_file_id: string | null
  drive_folder_id: string | null
  drive_synced_at: string | null
  proxmox_synced_at: string | null
  sync_error: string | null
}

export interface DocumentListResponse {
  documents: DocumentRecord[]
  total: number
  page: number
  limit: number
}

// ─── Server Functions ─────────────────────────────────────────────────────────

const ListDocumentsInput = z.object({
  workspaceId: z.string(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  docType: z.string().optional(),
  q: z.string().optional(),
  page: z.number().optional(),
  limit: z.number().optional()
})

const listDocumentsFn = createServerFn({ method: "GET" })
  .inputValidator(ListDocumentsInput)
  .handler(async ({ data }) =>
    backendGet<DocumentListResponse>("/documents", {
      workspaceId: data.workspaceId,
      entityType: data.entityType,
      entityId: data.entityId,
      docType: data.docType,
      q: data.q,
      page: data.page,
      limit: data.limit
    })
  )

const getDocumentFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) =>
    backendGet<DocumentRecord>(`/documents/${data.id}`, {})
  )

const linkDocumentFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    documentId: z.string(),
    entityType: z.string(),
    entityId: z.string()
  }))
  .handler(async ({ data }) =>
    backendPost<{ ok: boolean }>(`/documents/${data.documentId}/link`, {
      entityType: data.entityType,
      entityId: data.entityId
    })
  )

const unlinkDocumentFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    documentId: z.string(),
    entityType: z.string(),
    entityId: z.string()
  }))
  .handler(async ({ data }) =>
    backendPost<{ ok: boolean }>(`/documents/${data.documentId}/link/delete`, {
      entityType: data.entityType,
      entityId: data.entityId
    })
  )

const deleteDocumentFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) =>
    backendPost<{ ok: boolean }>(`/documents/${data.id}/delete`, {})
  )

const updateNotesFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), notes: z.string().nullable() }))
  .handler(async ({ data }) =>
    backendPost<{ ok: boolean }>(`/documents/${data.id}/notes`, { notes: data.notes })
  )

const setContractDocumentFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ employeeId: z.string(), documentId: z.string().nullable() }))
  .handler(async ({ data }) =>
    backendPost<{ ok: boolean }>(`/employees/${data.employeeId}/contract-document`, {
      documentId: data.documentId
    })
  )

// ─── Phase 5: Storage API ─────────────────────────────────────────────────────

export interface StorageStatus {
  drive: {
    configured: boolean
    synced: number
    total: number
    errors: number
  }
  proxmox: {
    configured: boolean
    synced: number
    total: number
    errors: number
    lastSynced: string | null
  }
}

export interface RetryResult {
  attempted: number
  succeeded: number
  stillFailing: number
}

const getStorageStatusFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ workspaceId: z.string() }))
  .handler(async () => backendGet<StorageStatus>("/settings/storage/status", {}))

const retryDriveFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({}))
  .handler(async () => backendPost<RetryResult>("/settings/storage/retry-drive", {}))

const retryProxmoxFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({}))
  .handler(async () => backendPost<RetryResult>("/settings/storage/retry-proxmox", {}))

const resyncDocumentFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ documentId: z.string() }))
  .handler(async ({ data }) =>
    backendPost<{ ok: boolean }>(`/settings/storage/resync-document/${data.documentId}`, {})
  )

const resyncAllDriveFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({}))
  .handler(async () =>
    backendPost<{ ok: boolean; queued: number }>("/settings/storage/resync-all-drive", {})
  )

// ─── React Query Hooks ────────────────────────────────────────────────────────

export function useDocuments(params: {
  workspaceId: string
  entityType?: string
  entityId?: string
  docType?: string
  q?: string
  page?: number
}) {
  return useQuery({
    queryKey: ["documents", params],
    queryFn: () => listDocumentsFn({ data: params }),
    enabled: !!params.workspaceId
  })
}

export function useDocument(id: string | null) {
  return useQuery({
    queryKey: ["documents", "detail", id],
    queryFn: () => getDocumentFn({ data: { id: id! } }),
    enabled: !!id
  })
}

export function useLinkDocument(_workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { documentId: string; entityType: string; entityId: string }) =>
      linkDocumentFn({ data }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["documents"] })
    }
  })
}

export function useUnlinkDocument(_workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { documentId: string; entityType: string; entityId: string }) =>
      unlinkDocumentFn({ data }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["documents"] })
    }
  })
}

export function useDeleteDocument(_workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteDocumentFn({ data: { id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["documents"] })
    }
  })
}

export function useUpdateDocumentNotes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { id: string; notes: string | null }) => updateNotesFn({ data }),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ["documents", "detail", vars.id] })
      void qc.invalidateQueries({ queryKey: ["documents"] })
    }
  })
}

export function useSetContractDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { employeeId: string; documentId: string | null }) =>
      setContractDocumentFn({ data }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["employees"] })
    }
  })
}

export function useStorageStatus(workspaceId: string) {
  return useQuery({
    queryKey: ["storage", "status", workspaceId],
    queryFn: () => getStorageStatusFn({ data: { workspaceId } }),
    enabled: !!workspaceId,
    refetchInterval: 30_000
  })
}

export function useRetryDriveSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => retryDriveFn({ data: {} }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["storage"] }) }
  })
}

export function useRetryProxmoxSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => retryProxmoxFn({ data: {} }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["storage"] }) }
  })
}

export function useResyncDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (documentId: string) => resyncDocumentFn({ data: { documentId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["documents"] })
      void qc.invalidateQueries({ queryKey: ["storage"] })
    }
  })
}

export function useResyncAllDrive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => resyncAllDriveFn({ data: {} }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["storage"] }) }
  })
}

// ─── OCR Extract ─────────────────────────────────────────────────────────────

export interface OcrExtractedFields {
  vendorName?: string
  vendorNip?: string
  vendorAddress?: string
  invoiceNumber?: string
  invoiceDate?: string
  dueDate?: string
  totalAmount?: number
  taxAmount?: number
  netAmount?: number
  currency?: string
  lineItems?: Array<{
    description?: string
    quantity?: number
    unitPrice?: number
    totalPrice?: number
    vatRate?: string
  }>
  confidence: number
  suggestedEmployeeMatch?: {
    employeeId: string
    employeeName: string | null
    confidence: number
    matchMethod: "nip" | "name" | "name_birthdate" | "none"
  } | null
}

const ocrExtractFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ documentId: z.string() }))
  .handler(async ({ data }) =>
    backendPost<OcrExtractedFields>(`/documents/${data.documentId}/ocr-extract`, {})
  )

export function useOcrExtract() {
  return useMutation({
    mutationFn: (documentId: string) => ocrExtractFn({ data: { documentId } })
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function docTypeLabel(type: DocumentRecord["doc_type"]): string {
  const labels: Record<DocumentRecord["doc_type"], string> = {
    contract: "Contract",
    invoice: "Invoice",
    receipt: "Receipt",
    id_document: "ID Document",
    certificate: "Certificate",
    nda: "NDA",
    amendment: "Amendment",
    other: "Other"
  }
  return labels[type] ?? type
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function isPreviewable(mimeType: string): "pdf" | "image" | "none" {
  if (mimeType === "application/pdf") return "pdf"
  if (mimeType.startsWith("image/")) return "image"
  return "none"
}
