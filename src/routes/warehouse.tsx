import { createFileRoute } from "@tanstack/react-router"
import { Package, Plus, Check, X, ChevronDown, ChevronUp } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useQuery } from "@tanstack/react-query"

import { EmptyState } from "#/components/empty-state"
import { Skeleton } from "#/components/ui/skeleton"

import {
  useWarehouseDocs,
  useCreateWarehouseDoc,
  useConfirmWarehouseDoc,
  useCancelWarehouseDoc,
  type WarehouseDocument,
  type CreateWarehouseDocumentPayload
} from "#/api/warehouse"
import { queriesProjects } from "#/api/queries"
import { useAuth } from "#/lib/auth-context"
import { useTranslation } from "#/lib/i18n"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { Card, CardContent } from "#/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "#/components/ui/dialog"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table"
import { Textarea } from "#/components/ui/textarea"

export const Route = createFileRoute("/warehouse")({
  component: WarehousePage
})

function statusBadge(status: WarehouseDocument["status"], t: ReturnType<typeof useTranslation>["t"]) {
  if (status === "confirmed") return <Badge className="bg-green-100 text-green-800 border-green-200">{t.warehouse.confirmed}</Badge>
  if (status === "cancelled") return <Badge variant="destructive">{t.warehouse.cancelled}</Badge>
  return <Badge variant="outline">{t.warehouse.draft}</Badge>
}

function formatDate(d: string) {
  return d?.slice(0, 10) ?? "—"
}

interface NewDocItem {
  productName: string
  quantity: string
  unit: string
  unitPrice: string
}

function NewDocDialog({
  docType,
  workspaceId,
  onClose
}: {
  docType: "PZ" | "WZ"
  workspaceId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const create = useCreateWarehouseDoc()
  const today = new Date().toISOString().slice(0, 10)
  const [docDate, setDocDate] = useState(today)
  const [notes, setNotes] = useState("")
  const [projectId, setProjectId] = useState<string>("")
  const [items, setItems] = useState<NewDocItem[]>([
    { productName: "", quantity: "1", unit: "szt.", unitPrice: "" }
  ])

  const { data: projects } = useQuery({
    ...queriesProjects.workspaceProjects(workspaceId),
    enabled: !!workspaceId
  })

  const addItem = () => setItems((prev) => [...prev, { productName: "", quantity: "1", unit: "szt.", unitPrice: "" }])
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i))
  const updateItem = (i: number, field: keyof NewDocItem, value: string) =>
    setItems((prev) => prev.map((it, idx) => idx === i ? { ...it, [field]: value } : it))

  const handleSubmit = () => {
    const validItems = items.filter((it) => it.productName.trim())
    if (validItems.length === 0) { toast.error(t.warehouse.addItemError); return }

    const payload: CreateWarehouseDocumentPayload = {
      docType,
      docDate,
      notes: notes || undefined,
      projectId: projectId || undefined,
      items: validItems.map((it) => ({
        productName: it.productName.trim(),
        quantity: Number(it.quantity) || 1,
        unit: it.unit || undefined,
        unitPrice: it.unitPrice ? Number(it.unitPrice) : undefined
      }))
    }

    create.mutate(payload, {
      onSuccess: (res: unknown) => {
        toast.success(`${t.toast.saveSuccess} — ${(res as { docNumber?: string })?.docNumber ?? ""}`)
        onClose()
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : t.toast.saveError)
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New {docType} Document</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>{t.warehouse.date}</Label>
              <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t.warehouse.notes}</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={1} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t.warehouse.projectOptional}</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder={t.warehouse.selectProject} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t.warehouse.noProject}</SelectItem>
                {projects?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t.warehouse.items}</Label>
              <Button variant="outline" size="sm" onClick={addItem}><Plus className="h-3 w-3 mr-1" />{t.warehouse.addItem}</Button>
            </div>
            {items.map((item, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <Input className="col-span-5" placeholder={t.warehouse.productName} value={item.productName} onChange={(e) => updateItem(i, "productName", e.target.value)} />
                <Input className="col-span-2" placeholder={t.warehouse.qty} type="number" value={item.quantity} onChange={(e) => updateItem(i, "quantity", e.target.value)} />
                <Input className="col-span-2" placeholder={t.warehouse.unit} value={item.unit} onChange={(e) => updateItem(i, "unit", e.target.value)} />
                <Input className="col-span-2" placeholder={t.warehouse.price} type="number" value={item.unitPrice} onChange={(e) => updateItem(i, "unitPrice", e.target.value)} />
                <Button variant="ghost" size="icon" className="col-span-1 h-8 w-8" onClick={() => removeItem(i)}><X className="h-3 w-3" /></Button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.action.cancel}</Button>
          <Button onClick={handleSubmit} disabled={create.isPending}>
            {create.isPending ? t.warehouse.creating : `${t.warehouse.create} ${docType}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CancelDialog({ docId, onClose }: { docId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const cancel = useCancelWarehouseDoc()
  const [reason, setReason] = useState("")

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t.warehouse.cancelDoc}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>{t.warehouse.reason}</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason for cancellation…" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.warehouse.back}</Button>
          <Button variant="destructive" disabled={cancel.isPending} onClick={() => {
            cancel.mutate({ id: docId, reason: reason || undefined }, {
              onSuccess: () => { toast.success(t.toast.deleteSuccess); onClose() },
              onError: (e) => toast.error(e instanceof Error ? e.message : t.toast.deleteError)
            })
          }}>
            {cancel.isPending ? t.warehouse.cancelling : t.warehouse.cancelDoc}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DocTable({ docType, workspaceId }: { docType: "PZ" | "WZ"; workspaceId: string }) {
  const { t } = useTranslation()
  const [newDocOpen, setNewDocOpen] = useState(false)
  const [cancelDocId, setCancelDocId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const confirm = useConfirmWarehouseDoc()
  const { data, isLoading } = useWarehouseDocs({ workspaceId, docType })
  const { user } = useAuth()
  const canManage = user?.permissions?.includes("warehouse.manage") ?? false

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canManage && (
          <Button size="sm" onClick={() => setNewDocOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />{t.warehouse.newDoc} {docType}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !data?.rows.length ? (
            <EmptyState
              icon={Package}
              title={t.warehouse.noDocsTitle}
              subtitle={`${t.warehouse.noDocsSubtitle} ${docType}`}
              action={canManage ? `${t.warehouse.newDoc} ${docType}` : undefined}
              onAction={canManage ? () => setNewDocOpen(true) : undefined}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>{t.warehouse.number}</TableHead>
                  <TableHead>{t.warehouse.date}</TableHead>
                  <TableHead>{t.warehouse.counterparty}</TableHead>
                  <TableHead>{t.warehouse.items}</TableHead>
                  <TableHead>{t.warehouse.status}</TableHead>
                  {canManage && <TableHead>{t.common.actions}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((doc) => (
                  <>
                    <TableRow key={doc.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expandedId === doc.id ? null : doc.id)}>
                      <TableCell>{expandedId === doc.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</TableCell>
                      <TableCell className="font-mono text-sm font-medium">{doc.doc_number}</TableCell>
                      <TableCell>{formatDate(doc.doc_date)}</TableCell>
                      <TableCell>{doc.counterparty_name ?? "—"}</TableCell>
                      <TableCell>{doc.item_count ?? 0}</TableCell>
                      <TableCell>{statusBadge(doc.status, t)}</TableCell>
                      {canManage && (
                        <TableCell onClick={(e) => e.stopPropagation()} className="space-x-1">
                          {doc.status === "draft" && (
                            <>
                              <Button size="sm" variant="outline" className="h-6 text-xs" disabled={confirm.isPending}
                                onClick={() => confirm.mutate(doc.id, {
                                  onSuccess: () => toast.success(`${doc.doc_number} — ${t.toast.saveSuccess}`),
                                  onError: (e) => toast.error(e instanceof Error ? e.message : t.toast.saveError)
                                })}>
                                <Check className="h-3 w-3 mr-1" />{t.action.confirm}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-6 text-xs text-destructive"
                                onClick={() => setCancelDocId(doc.id)}>
                                {t.action.cancel}
                              </Button>
                            </>
                          )}
                          {doc.status === "confirmed" && (
                            <Button size="sm" variant="ghost" className="h-6 text-xs text-destructive"
                              onClick={() => setCancelDocId(doc.id)}>
                              {t.action.cancel}
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                    {expandedId === doc.id && doc.notes && (
                      <TableRow key={`${doc.id}-notes`}>
                        <TableCell colSpan={canManage ? 7 : 6} className="bg-muted/30 text-xs text-muted-foreground px-4 py-2">
                          {doc.notes}
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {newDocOpen && <NewDocDialog docType={docType} workspaceId={workspaceId} onClose={() => setNewDocOpen(false)} />}
      {cancelDocId && <CancelDialog docId={cancelDocId} onClose={() => setCancelDocId(null)} />}
    </div>
  )
}

function WarehousePage() {
  const { user } = useAuth()
  const { t } = useTranslation()
  const workspaceId = user?.workspaceId ?? ""

  return (
    <div className="flex flex-col">
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold text-zinc-100 leading-none">{t.nav?.warehouse ?? "Magazyn"}</h1>
          <p className="text-xs text-zinc-500 mt-1">Dokumenty PZ/WZ</p>
        </div>
      </div>
      <div className="p-6 space-y-6">

      <Tabs defaultValue="pz">
        <TabsList className="grid w-64 grid-cols-2">
          <TabsTrigger value="pz">{t.warehouse.pz}</TabsTrigger>
          <TabsTrigger value="wz">{t.warehouse.wz}</TabsTrigger>
        </TabsList>

        <TabsContent value="pz" className="mt-6">
          <DocTable docType="PZ" workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value="wz" className="mt-6">
          <DocTable docType="WZ" workspaceId={workspaceId} />
        </TabsContent>
      </Tabs>
      </div>
    </div>
  )
}
