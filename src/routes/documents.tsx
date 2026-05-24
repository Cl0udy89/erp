import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  FileText,
  Upload,
  Search,
  SearchX,
  Trash2,
  Link2,
  X,
  ChevronDown,
  Loader2,
  FilePlus,
  Cloud,
  Server
} from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"

import {
  useDocuments,
  useDocument,
  useDeleteDocument,
  useUpdateDocumentNotes,
  useLinkDocument,
  useUnlinkDocument,
  useOcrExtract,
  docTypeLabel,
  formatFileSize,
  isPreviewable,
  type DocumentRecord,
  type OcrExtractedFields
} from "#/api/documents"
import { PdfViewer } from "#/components/pdf-viewer"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "#/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger
} from "#/components/ui/dropdown-menu"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "#/components/ui/select"
import { Skeleton } from "#/components/ui/skeleton"
import { Textarea } from "#/components/ui/textarea"
import { useEntityAudit, type AuditListResponse } from "#/api/audit"
import { EntityActivityLog } from "#/components/EntityActivityLog"
import { useAuth } from "#/lib/auth-context"
import { useTranslation } from "#/lib/i18n"
import { workspaceSearchSchema } from "#/lib/search-schema"

export const Route = createFileRoute("/documents")({
  validateSearch: workspaceSearchSchema,
  component: DocumentsPage
})

// ─── Upload drawer ─────────────────────────────────────────────────────────────

const DOC_TYPES = [
  "contract", "invoice", "receipt", "id_document",
  "certificate", "nda", "amendment", "other"
] as const

function getBackendUrl(): string {
  if (typeof window !== "undefined") {
    return (
      ((import.meta as unknown as Record<string, unknown>)?.env as Record<string, string> | undefined)
        ?.VITE_BACKEND_API_URL ?? "http://localhost:4001"
    )
  }
  return "http://localhost:4001"
}

interface UploadDrawerProps {
  open: boolean
  onClose: () => void
  workspaceId: string
  defaultDocType?: string
  defaultEntityType?: string
  defaultEntityId?: string
  onUploaded?: (doc: DocumentRecord) => void
}

function UploadDrawer({
  open,
  onClose,
  workspaceId,
  defaultDocType,
  defaultEntityType,
  defaultEntityId,
  onUploaded
}: UploadDrawerProps) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [docType, setDocType] = useState<string>(defaultDocType ?? "other")
  const [notes, setNotes] = useState("")
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  function handleFile(f: File) {
    setFile(f)
    // Auto-detect doc type from name if not pre-set
    if (!defaultDocType) {
      const name = f.name.toLowerCase()
      if (name.includes("umow") || name.includes("contract")) setDocType("contract")
      else if (name.includes("faktura") || name.includes("invoice")) setDocType("invoice")
      else if (name.includes("nda")) setDocType("nda")
      else if (name.includes("aneks") || name.includes("amendment")) setDocType("amendment")
    }
  }

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("docType", docType)
      formData.append("workspaceId", workspaceId)
      if (notes.trim()) formData.append("notes", notes)
      if (defaultEntityType && defaultEntityId) {
        formData.append("entityType", defaultEntityType)
        formData.append("entityId", defaultEntityId)
      }

      const backendUrl = getBackendUrl()
      const resp = await fetch(`${backendUrl}/documents/upload`, {
        method: "POST",
        body: formData,
        credentials: "include"
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Upload failed" }))
        throw new Error((err as { error?: string }).error ?? "Upload failed")
      }

      const data = await resp.json() as { document: DocumentRecord }
      void qc.invalidateQueries({ queryKey: ["documents"] })
      toast.success(`"${file.name}" uploaded`)
      onUploaded?.(data.document)
      setFile(null)
      setNotes("")
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative ml-auto h-full w-full max-w-md bg-background shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">{t.documents.upload}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Drop zone */}
          <div
            className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors cursor-pointer ${
              dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-muted-foreground/60"
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const f = e.dataTransfer.files[0]
              if (f) handleFile(f)
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
            />
            {file ? (
              <div className="space-y-1">
                <FileText className="h-8 w-8 mx-auto text-primary" />
                <p className="font-medium text-sm">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {t.documents.dragDrop}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.documents.maxSize}
                </p>
              </div>
            )}
          </div>

          {/* Doc type */}
          <div className="space-y-1.5">
            <Label>{t.documents.docType}</Label>
            <Select value={docType} onValueChange={setDocType} disabled={!!defaultDocType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{docTypeLabel(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>{t.documents.notes}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any relevant notes..."
              rows={3}
            />
          </div>
        </div>

        <div className="border-t p-4">
          <Button
            className="w-full"
            disabled={!file || uploading}
            onClick={handleUpload}
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t.documents.uploading}
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                {t.action.upload}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Link picker dialog ────────────────────────────────────────────────────────

interface LinkPickerProps {
  open: boolean
  onClose: () => void
  documentId: string
  workspaceId: string
}

function LinkPickerDialog({ open, onClose, documentId, workspaceId }: LinkPickerProps) {
  const { t } = useTranslation()
  const [entityType, setEntityType] = useState<"employee" | "client" | "project">("employee")
  const [entityId, setEntityId] = useState("")
  const linkMutation = useLinkDocument(workspaceId)

  useDocuments({
    workspaceId,
    entityType
  })

  async function handleLink() {
    if (!entityId) return
    await linkMutation.mutateAsync({ documentId, entityType, entityId })
    toast.success("Link added")
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.documents.linkTo}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>{t.documents.entityType}</Label>
            <Select value={entityType} onValueChange={(v) => setEntityType(v as typeof entityType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="employee">Employee</SelectItem>
                <SelectItem value="client">Client</SelectItem>
                <SelectItem value="project">Project</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t.documents.entityId}</Label>
            <Input
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              placeholder="Paste entity ID..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.action.cancel}</Button>
          <Button onClick={handleLink} disabled={!entityId || linkMutation.isPending}>
            {linkMutation.isPending ? t.documents.linking : t.documents.link}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Document detail panel ─────────────────────────────────────────────────────

function DocTypeColor(type: DocumentRecord["doc_type"]): string {
  const map: Record<string, string> = {
    contract: "bg-blue-100 text-blue-800",
    invoice: "bg-green-100 text-green-800",
    receipt: "bg-emerald-100 text-emerald-800",
    id_document: "bg-red-100 text-red-800",
    certificate: "bg-purple-100 text-purple-800",
    nda: "bg-orange-100 text-orange-800",
    amendment: "bg-yellow-100 text-yellow-800",
    other: "bg-gray-100 text-gray-800"
  }
  return map[type] ?? "bg-gray-100 text-gray-800"
}

interface DetailPanelProps {
  documentId: string
  workspaceId: string
  onClose: () => void
}

function OcrConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence >= 0.85) return <span className="text-xs font-medium text-green-700 bg-green-100 rounded px-1.5 py-0.5">High confidence ({Math.round(confidence * 100)}%)</span>
  if (confidence >= 0.60) return <span className="text-xs font-medium text-yellow-700 bg-yellow-100 rounded px-1.5 py-0.5">Review suggested ({Math.round(confidence * 100)}%)</span>
  return <span className="text-xs font-medium text-red-700 bg-red-100 rounded px-1.5 py-0.5">Low confidence ({Math.round(confidence * 100)}%) — verify all fields</span>
}

function DetailPanel({ documentId, workspaceId, onClose }: DetailPanelProps) {
  const { t } = useTranslation()
  const { data: doc, isLoading } = useDocument(documentId)
  const [notes, setNotes] = useState<string | null>(null)
  const [linkPickerOpen, setLinkPickerOpen] = useState(false)
  const [ocrResult, setOcrResult] = useState<OcrExtractedFields | null>(null)
  const [matchDismissed, setMatchDismissed] = useState(false)
  const updateNotes = useUpdateDocumentNotes()
  const deleteDoc = useDeleteDocument(workspaceId)
  const unlinkDoc = useUnlinkDocument(workspaceId)
  const ocrExtract = useOcrExtract()
  const { user } = useAuth()
  const { data: _rawActivityData } = useEntityAudit(workspaceId, "document", documentId)
  const activityData = _rawActivityData as AuditListResponse | undefined

  const canManage = user?.permissions?.includes("documents.manage") ?? false

  // Editable notes: initialise from loaded doc
  const displayNotes = notes !== null ? notes : (doc?.notes ?? "")

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b p-4 space-y-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/3" />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (!doc) return null

  const backendUrl = getBackendUrl()
  const fileSrc = `${backendUrl}/documents/${doc.id}/file`
  const preview = isPreviewable(doc.mime_type)

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start justify-between border-b p-4 gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-semibold text-sm truncate" title={doc.original_name}>
            {doc.original_name}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className={DocTypeColor(doc.doc_type)}>
              {docTypeLabel(doc.doc_type)}
            </Badge>
            {doc.contains_personal_data && (
              <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 text-xs">
                GDPR sensitive
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {formatFileSize(doc.file_size_bytes)}
            </span>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Viewer area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {preview !== "none" ? (
          <PdfViewer src={fileSrc} filename={doc.original_name} mimeType={doc.mime_type} />
        ) : (
          <PdfViewer src={fileSrc} filename={doc.original_name} mimeType={doc.mime_type} />
        )}
      </div>

      {/* Meta */}
      <div className="border-t p-4 space-y-3 max-h-64 overflow-y-auto">
        {/* Notes */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t.documents.notes}</Label>
          <Textarea
            value={displayNotes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (displayNotes !== doc.notes) {
                void updateNotes.mutateAsync({ id: doc.id, notes: displayNotes || null })
                  .then(() => toast.success("Notes saved"))
              }
            }}
            placeholder="Add notes..."
            rows={2}
            className="text-sm resize-none"
          />
        </div>

        {/* Linked entities */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">{t.documents.linkedTo}</Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setLinkPickerOpen(true)}
            >
              <Link2 className="h-3 w-3 mr-1" />
              {t.documents.linkTo}
            </Button>
          </div>
          {doc.linked_entities && doc.linked_entities.length > 0 ? (
            <div className="space-y-1">
              {doc.linked_entities.map((link) => (
                <div
                  key={`${link.entityType}:${link.entityId}`}
                  className="flex items-center justify-between text-xs bg-muted/50 rounded px-2 py-1"
                >
                  <span className="capitalize">
                    {link.entityType}: <span className="font-mono">{link.entityId.slice(0, 12)}…</span>
                  </span>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-4 w-4"
                      onClick={() => {
                        void unlinkDoc.mutateAsync({
                          documentId: doc.id,
                          entityType: link.entityType,
                          entityId: link.entityId
                        })
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t.documents.noLinks}</p>
          )}
        </div>

        {/* OCR Auto-fill */}
        {doc.mime_type === "application/pdf" && canManage && (
          <div className="pt-1 space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={ocrExtract.isPending}
              onClick={() => {
                ocrExtract.mutate(doc.id, {
                  onSuccess: (fields) => {
                    setOcrResult(fields)
                    toast.success("OCR complete — review the extracted fields below")
                  },
                  onError: (err) => {
                    const msg = err instanceof Error ? err.message : String(err)
                    if (msg.includes("not configured")) {
                      toast.error("OCR not configured — contact admin")
                    } else {
                      toast.error(`OCR failed: ${msg}`)
                    }
                  }
                })
              }}
            >
              {ocrExtract.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />{t.documents.analyzingDoc}</>
              ) : (
                t.documents.autoFill
              )}
            </Button>

            {ocrResult && (
              <div className="text-xs border rounded p-2 space-y-1.5 bg-yellow-50/60 border-yellow-200">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-yellow-900">{t.documents.extractedFields}</span>
                  <OcrConfidenceBadge confidence={ocrResult.confidence} />
                </div>
                {ocrResult.vendorName && <div className="flex justify-between"><span className="text-muted-foreground">Vendor</span><span className="font-medium bg-yellow-100 px-1 rounded">{ocrResult.vendorName}</span></div>}
                {ocrResult.vendorNip && <div className="flex justify-between"><span className="text-muted-foreground">NIP</span><span className="font-medium bg-yellow-100 px-1 rounded">{ocrResult.vendorNip}</span></div>}
                {ocrResult.invoiceNumber && <div className="flex justify-between"><span className="text-muted-foreground">Invoice #</span><span className="font-medium bg-yellow-100 px-1 rounded">{ocrResult.invoiceNumber}</span></div>}
                {ocrResult.invoiceDate && <div className="flex justify-between"><span className="text-muted-foreground">Date</span><span className="font-medium bg-yellow-100 px-1 rounded">{ocrResult.invoiceDate}</span></div>}
                {ocrResult.dueDate && <div className="flex justify-between"><span className="text-muted-foreground">Due date</span><span className="font-medium bg-yellow-100 px-1 rounded">{ocrResult.dueDate}</span></div>}
                {ocrResult.netAmount != null && <div className="flex justify-between"><span className="text-muted-foreground">Net</span><span className="font-medium bg-yellow-100 px-1 rounded">{ocrResult.netAmount} {ocrResult.currency ?? "PLN"}</span></div>}
                {ocrResult.taxAmount != null && <div className="flex justify-between"><span className="text-muted-foreground">VAT</span><span className="font-medium bg-yellow-100 px-1 rounded">{ocrResult.taxAmount} {ocrResult.currency ?? "PLN"}</span></div>}
                {ocrResult.totalAmount != null && <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-medium bg-yellow-100 px-1 rounded">{ocrResult.totalAmount} {ocrResult.currency ?? "PLN"}</span></div>}
                <p className="text-[10px] text-yellow-700 pt-0.5">{t.documents.referenceOnly}</p>
              </div>
            )}

            {/* Consultant match suggestion */}
            {ocrResult?.suggestedEmployeeMatch && !matchDismissed && (() => {
              const m = ocrResult.suggestedEmployeeMatch!
              const pct = Math.round(m.confidence * 100)
              const isHigh = m.confidence >= 0.7
              return (
                <div className={`text-xs border rounded p-2 space-y-1.5 ${isHigh ? "bg-blue-50/60 border-blue-200" : "bg-orange-50/60 border-orange-200"}`}>
                  <p className={`font-medium ${isHigh ? "text-blue-900" : "text-orange-900"}`}>
                    {isHigh ? t.ocr.suggestedMatch : t.ocr.suggestedMatchLow}
                  </p>
                  <p className="text-muted-foreground">
                    {m.employeeName ?? m.employeeId}{" "}
                    <span className="font-medium">({pct}%)</span>{" "}
                    &mdash;{" "}
                    {m.matchMethod === "nip" ? t.ocr.matchMethodNip : t.ocr.matchMethodName}
                  </p>
                  <div className="flex gap-2 pt-0.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs"
                      onClick={() => setMatchDismissed(true)}
                    >
                      {t.ocr.dismiss}
                    </Button>
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {/* Recent activity */}
        <div className="space-y-1 pt-1">
          <Label className="text-xs text-muted-foreground">{t.audit.recentActivity}</Label>
          <EntityActivityLog data={activityData} compact />
        </div>

        {/* Delete */}
        {canManage && (
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={() => {
              if (confirm(`Delete "${doc.original_name}"? This cannot be undone.`)) {
                void deleteDoc.mutateAsync(doc.id)
                  .then(() => { toast.success("Document deleted"); onClose() })
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Delete failed"))
              }
            }}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t.action.delete}
          </Button>
        )}
      </div>

      <LinkPickerDialog
        open={linkPickerOpen}
        onClose={() => setLinkPickerOpen(false)}
        documentId={doc.id}
        workspaceId={workspaceId}
      />
    </div>
  )
}

// ─── Document row ──────────────────────────────────────────────────────────────

function SyncIcon({
  label,
  synced,
  error,
  Icon
}: {
  label: string
  synced: boolean
  error: string | null
  Icon: React.FC<{ className?: string }>
}) {
  const color = error
    ? "text-destructive"
    : synced
    ? "text-green-600"
    : "text-muted-foreground/40"
  const tip = error ? error : synced ? `${label}: synced` : `${label}: pending`
  return (
    <span title={tip} className={`shrink-0 ${color}`}>
      <Icon className="h-3.5 w-3.5" />
    </span>
  )
}

function DocRow({
  doc,
  selected,
  onSelect
}: {
  doc: DocumentRecord
  selected: boolean
  onSelect: () => void
}) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors ${
        selected ? "bg-muted" : ""
      }`}
      onClick={onSelect}
    >
      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium truncate">{doc.original_name}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className={`text-xs ${DocTypeColor(doc.doc_type)}`}>
            {docTypeLabel(doc.doc_type)}
          </Badge>
          <span className="text-xs text-muted-foreground">{formatFileSize(doc.file_size_bytes)}</span>
          <span className="text-xs text-muted-foreground">
            {new Date(doc.created_at).toLocaleDateString()}
          </span>
          {doc.uploaded_by_name && (
            <span className="text-xs text-muted-foreground">{doc.uploaded_by_name}</span>
          )}
        </div>
      </div>
      {/* Sync status icons */}
      <div className="flex items-center gap-1 shrink-0">
        <SyncIcon
          label="Google Drive"
          synced={!!doc.drive_file_id}
          error={doc.sync_error?.includes("Drive") ? doc.sync_error : null}
          Icon={Cloud}
        />
        <SyncIcon
          label="Proxmox"
          synced={!!doc.proxmox_synced_at}
          error={doc.sync_error?.includes("Proxmox") ? doc.sync_error : null}
          Icon={Server}
        />
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

const DOC_TYPE_FILTERS = [
  { value: "contract", label: "Contract" },
  { value: "invoice", label: "Invoice" },
  { value: "receipt", label: "Receipt" },
  { value: "id_document", label: "ID Document" },
  { value: "certificate", label: "Certificate" },
  { value: "nda", label: "NDA" },
  { value: "amendment", label: "Amendment" },
  { value: "other", label: "Other" }
]

function DocumentsPage() {
  const { workspaceId } = Route.useSearch()
  const { t } = useTranslation()
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [selectedDocTypes, setSelectedDocTypes] = useState<string[]>([])
  const [selectedEntityType, setSelectedEntityType] = useState<"" | "employee" | "client" | "project">("")
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  function handleSearchChange(val: string) {
    setSearch(val)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => setDebouncedSearch(val), 300)
  }

  const { data, isLoading } = useDocuments({
    workspaceId: workspaceId ?? "",
    docType: selectedDocTypes.length === 1 ? selectedDocTypes[0] : undefined,
    entityType: selectedEntityType || undefined,
    q: debouncedSearch || undefined
  })

  const documents = data?.documents ?? []

  if (!workspaceId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="space-y-4 text-center">
          <h2 className="text-2xl font-bold">Select a workspace</h2>
          <p className="text-muted-foreground">Choose a workspace from the sidebar to view documents.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* Page header */}
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold">{t.documents?.title ?? "Dokumenty"}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setUploadOpen(true)}>
            <FilePlus className="h-4 w-4 mr-2" />
            Upload
          </Button>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel: list */}
        <div className={`flex flex-col border-r ${selectedDocId ? "w-[380px] shrink-0" : "flex-1"}`}>
          {/* Search + filters */}
          <div className="p-3 border-b space-y-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder={t.documents.search}
                className="pl-8"
              />
            </div>
            <div className="flex gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="text-xs">
                    Type{selectedDocTypes.length > 0 ? ` (${selectedDocTypes.length})` : ""}
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {DOC_TYPE_FILTERS.map((f) => (
                    <DropdownMenuCheckboxItem
                      key={f.value}
                      checked={selectedDocTypes.includes(f.value)}
                      onCheckedChange={(checked) => {
                        setSelectedDocTypes((prev) =>
                          checked ? [...prev, f.value] : prev.filter((v) => v !== f.value)
                        )
                      }}
                    >
                      {f.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Select
                value={selectedEntityType}
                onValueChange={(v) => setSelectedEntityType(v as typeof selectedEntityType)}
              >
                <SelectTrigger className="h-8 text-xs w-36">
                  <SelectValue placeholder="Linked to…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  <SelectItem value="employee">Employees</SelectItem>
                  <SelectItem value="client">Clients</SelectItem>
                  <SelectItem value="project">Projects</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto divide-y">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-4 py-3 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))
            ) : documents.length === 0 ? (
              (debouncedSearch || selectedDocTypes.length > 0) ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <SearchX className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <p className="text-lg font-medium text-muted-foreground">{t.emptyState.documents.noResults}</p>
                  <p className="text-sm text-muted-foreground/70 mt-1">{t.emptyState.documents.noResultsHint}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <FileText className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <p className="text-lg font-medium text-muted-foreground">{t.emptyState.documents.title}</p>
                  <p className="text-sm text-muted-foreground/70 mt-1">{t.emptyState.documents.subtitle}</p>
                  <Button className="mt-4" onClick={() => setUploadOpen(true)}>{t.emptyState.documents.action}</Button>
                </div>
              )
            ) : (
              documents.map((doc) => (
                <DocRow
                  key={doc.id}
                  doc={doc}
                  selected={selectedDocId === doc.id}
                  onSelect={() => setSelectedDocId(selectedDocId === doc.id ? null : doc.id)}
                />
              ))
            )}
          </div>

          {/* Count */}
          {data?.total != null && (
            <div className="border-t px-4 py-2 text-xs text-muted-foreground shrink-0">
              {data.total} document{data.total !== 1 ? "s" : ""}
            </div>
          )}
        </div>

        {/* Right panel: detail */}
        {selectedDocId && (
          <div className="flex-1 min-w-0">
            <DetailPanel
              documentId={selectedDocId}
              workspaceId={workspaceId}
              onClose={() => setSelectedDocId(null)}
            />
          </div>
        )}
      </div>

      {/* Upload drawer */}
      <UploadDrawer
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        workspaceId={workspaceId}
      />
    </div>
  )
}
