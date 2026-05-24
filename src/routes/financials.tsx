import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { financeQueries, useAddDocumentAllocation, useCreateFinancialDocument } from "#/api/finance"
import { useSaldeoExport } from "#/api/accounting"
import { useCommitExcelImport, usePreviewExcelImport } from "#/api/imports"
import { queriesProjects } from "#/api/queries"
import { useEntityAudit, type AuditListResponse } from "#/api/audit"
import { EntityActivityLog } from "#/components/EntityActivityLog"
import { useAuth } from "#/lib/auth-context"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "#/components/ui/dialog"
import { Input } from "#/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "#/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "#/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs"
import type { ExcelImportPreview, ExcelImportPreviewRow } from "#/lib/excel-import-service"
import { useTranslation } from "#/lib/i18n"
import { getWorkspaceId, workspaceSearchSchema } from "#/lib/search-schema"
import { cn, formatDate, formatPLN } from "#/lib/utils"

export const Route = createFileRoute("/financials")({
  loader: async ({ context, location }) => {
    const workspaceId = getWorkspaceId(location.search)
    const now = new Date()
    await context.queryClient.prefetchQuery({
      ...financeQueries.documents({})
    })
    await context.queryClient.prefetchQuery({
      ...financeQueries.monthlySummary(now.getFullYear(), now.getMonth() + 1)
    })
    if (workspaceId) {
      await context.queryClient.prefetchQuery({ ...queriesProjects.workspaceProjects(workspaceId) })
    }
  },
  validateSearch: workspaceSearchSchema,
  component: FinancialsPage
})

const documentTypes = [
  "SALES_INVOICE",
  "COST_INVOICE",
  "CONTRACTOR_BILL",
  "INTERNAL_DOCUMENT",
  "VIRTUAL_REVENUE",
  "VIRTUAL_COST",
  "STOCK_DOCUMENT",
  "OTHER"
]

const transactionTypes = [
  "SERVICE_REVENUE",
  "COST",
  "VIRTUAL_REVENUE",
  "VIRTUAL_COST",
  "GOODS_PURCHASE",
  "GOODS_REALIZATION",
  "OTHER_OPERATING_COST",
  "CONTRACTOR_COST"
]

function currentMonth() {
  const now = new Date()
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    date: now.toISOString().slice(0, 10)
  }
}

function statusTone(status: string) {
  if (status === "FULLY_ALLOCATED") return "bg-emerald-100 text-emerald-800"
  if (status === "OVER_ALLOCATED") return "bg-red-100 text-red-800"
  if (status === "PARTIALLY_ALLOCATED") return "bg-amber-100 text-amber-800"
  return "bg-gray-100 text-gray-800"
}

function FinancialsPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const { workspaceId, tab } = Route.useSearch()
  const initial = currentMonth()
  const [year, setYear] = useState(initial.year)
  const [month, setMonth] = useState(initial.month)
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
  const [documentDialogOpen, setDocumentDialogOpen] = useState(false)
  const [allocationDialogOpen, setAllocationDialogOpen] = useState(false)
  const [documentForm, setDocumentForm] = useState({
    documentNumber: "",
    documentName: "",
    documentType: "COST_INVOICE",
    contractorName: "",
    accountingDate: initial.date,
    currencyCode: "PLN",
    netAmount: 0,
    vatAmount: 0,
    grossAmount: 0,
    description: ""
  })
  const [allocationForm, setAllocationForm] = useState({
    projectId: "",
    transactionType: "COST",
    allocationDate: initial.date,
    revenueAmount: 0,
    goodsPurchaseCost: 0,
    serviceCostNet: 0,
    realizedGoodsCost: 0,
    otherOperatingCost: 0,
    citRate: 0.09,
    description: "",
    notes: ""
  })
  const [importPreview, setImportPreview] = useState<ExcelImportPreview | null>(null)

  const { data: documents } = useQuery(financeQueries.documents({ year, month }))
  const { data: selectedDocument } = useQuery({
    ...financeQueries.document(selectedDocumentId ?? ""),
    enabled: !!selectedDocumentId
  })
  const { data: register } = useQuery(financeQueries.register({ year, month }))
  const { data: monthlySummary } = useQuery(financeQueries.monthlySummary(year, month))
  const { data: projects } = useQuery({
    ...queriesProjects.workspaceProjects(workspaceId ?? ""),
    enabled: !!workspaceId
  })
  const { data: categories } = useQuery(financeQueries.categories())
  const { data: unallocated } = useQuery(financeQueries.unallocatedDocuments())
  const { data: partiallyAllocated } = useQuery(financeQueries.partiallyAllocatedDocuments())

  const { data: _rawFinancialDocActivity } = useEntityAudit(
    workspaceId ?? undefined,
    "financial_document",
    selectedDocumentId ?? undefined
  )
  const financialDocActivity = _rawFinancialDocActivity as AuditListResponse | undefined

  const createDocument = useCreateFinancialDocument()
  const addAllocation = useAddDocumentAllocation()
  const previewImport = usePreviewExcelImport()
  const commitImport = useCommitExcelImport()
  const saldeoExport = useSaldeoExport()

  const stats = useMemo(() => {
    const rows = monthlySummary ?? []
    return {
      revenue: rows.reduce((sum, row) => sum + row.revenueAmountPln, 0),
      costs: rows.reduce(
        (sum, row) => sum + row.serviceCostNet + row.realizedGoodsCost + row.otherOperatingCost,
        0
      ),
      profit: rows.reduce((sum, row) => sum + row.profit, 0),
      tax: rows.reduce((sum, row) => sum + row.taxPayable, 0),
      profitAfterTax: rows.reduce((sum, row) => sum + row.profitAfterTax, 0),
      stock: rows.reduce((sum, row) => sum + row.stockingValue, 0)
    }
  }, [monthlySummary])

  const handleCreateDocument = () => {
    createDocument.mutate(
      {
        ...documentForm,
        documentType: documentForm.documentType as never,
        sourceSystem: "MANUAL",
        netAmount: Number(documentForm.netAmount),
        vatAmount: Number(documentForm.vatAmount),
        grossAmount: Number(documentForm.grossAmount)
      },
      {
        onSuccess: (created) => {
          setSelectedDocumentId(created.id)
          setDocumentDialogOpen(false)
          toast.success("Document created")
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : "Could not create document")
        }
      }
    )
  }

  const handleAddAllocation = () => {
    if (!selectedDocumentId) return
    addAllocation.mutate(
      {
        documentId: selectedDocumentId,
        allocation: {
          ...allocationForm,
          transactionType: allocationForm.transactionType as never,
          projectId: allocationForm.projectId,
          categoryId: categories?.[0]?.id,
          revenueAmount: Number(allocationForm.revenueAmount),
          goodsPurchaseCost: Number(allocationForm.goodsPurchaseCost),
          serviceCostNet: Number(allocationForm.serviceCostNet),
          realizedGoodsCost: Number(allocationForm.realizedGoodsCost),
          otherOperatingCost: Number(allocationForm.otherOperatingCost),
          citRate: Number(allocationForm.citRate)
        }
      },
      {
        onSuccess: () => {
          setAllocationDialogOpen(false)
          toast.success("Allocation added")
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : "Could not add allocation")
        }
      }
    )
  }

  const handleExcelFile = async (file: File | undefined) => {
    if (!file) return
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    previewImport.mutate(
      {
        fileName: file.name,
        contentBase64: btoa(binary)
      },
      {
        onSuccess: (preview) => {
          setImportPreview(preview as ExcelImportPreview)
          toast.success("Excel parsed", {
            description: `${(preview as ExcelImportPreview).rows.length} rows ready for review`
          })
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : "Could not parse Excel")
        }
      }
    )
  }

  const updateImportRow = (id: string, patch: Partial<ExcelImportPreviewRow>) => {
    setImportPreview((current) => {
      if (!current) return current
      return {
        ...current,
        rows: current.rows.map((row) => (row.id === id ? { ...row, ...patch } : row))
      }
    })
  }

  const handleCommitImport = () => {
    if (!importPreview) return
    commitImport.mutate(importPreview.rows, {
      onSuccess: (result) => {
        const summary = result as {
          documentsCreated: number
          allocationsCreated: number
          skippedRows: number
        }
        toast.success("Excel imported", {
          description: `${summary.documentsCreated} documents, ${summary.allocationsCreated} allocations, ${summary.skippedRows} skipped`
        })
        setImportPreview(null)
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : "Could not import Excel")
      }
    })
  }

  return (
    <div className="flex flex-col">
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold text-zinc-100 leading-none">{t.nav?.financials ?? "Faktury"}</h1>
          <p className="text-xs text-zinc-500 mt-1">Dokumenty finansowe</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            className="w-24"
            type="number"
            value={year}
            onChange={(event) => {
              setYear(Number(event.target.value))
            }}
          />
          <Input
            className="w-20"
            type="number"
            min={1}
            max={12}
            value={month}
            onChange={(event) => {
              setMonth(Number(event.target.value))
            }}
          />
          <Dialog open={documentDialogOpen} onOpenChange={setDocumentDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus data-icon="inline-start" />
                Document
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Add financial document</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3 py-4">
                <Input
                  placeholder="Number"
                  value={documentForm.documentNumber}
                  onChange={(event) => {
                    setDocumentForm({ ...documentForm, documentNumber: event.target.value })
                  }}
                />
                <Input
                  placeholder="Name"
                  value={documentForm.documentName}
                  onChange={(event) => {
                    setDocumentForm({ ...documentForm, documentName: event.target.value })
                  }}
                />
                <Select
                  value={documentForm.documentType}
                  onValueChange={(value) => {
                    setDocumentForm({ ...documentForm, documentType: value })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {documentTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Contractor"
                  value={documentForm.contractorName}
                  onChange={(event) => {
                    setDocumentForm({ ...documentForm, contractorName: event.target.value })
                  }}
                />
                <Input
                  type="date"
                  value={documentForm.accountingDate}
                  onChange={(event) => {
                    setDocumentForm({ ...documentForm, accountingDate: event.target.value })
                  }}
                />
                <Input
                  placeholder="Currency"
                  value={documentForm.currencyCode}
                  onChange={(event) => {
                    setDocumentForm({ ...documentForm, currencyCode: event.target.value })
                  }}
                />
                <Input
                  type="number"
                  placeholder="Net"
                  value={documentForm.netAmount}
                  onChange={(event) => {
                    setDocumentForm({ ...documentForm, netAmount: Number(event.target.value) })
                  }}
                />
                <Input
                  type="number"
                  placeholder="VAT"
                  value={documentForm.vatAmount}
                  onChange={(event) => {
                    setDocumentForm({ ...documentForm, vatAmount: Number(event.target.value) })
                  }}
                />
                <Input
                  type="number"
                  placeholder="Gross"
                  value={documentForm.grossAmount}
                  onChange={(event) => {
                    setDocumentForm({ ...documentForm, grossAmount: Number(event.target.value) })
                  }}
                />
                <Input
                  placeholder="Description"
                  value={documentForm.description}
                  onChange={(event) => {
                    setDocumentForm({ ...documentForm, description: event.target.value })
                  }}
                />
              </div>
              <Button onClick={handleCreateDocument} disabled={createDocument.isPending}>
                {createDocument.isPending ? "Saving..." : "Create document"}
              </Button>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="p-6 space-y-6">

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Revenue</CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-2xl font-bold">
            {formatPLN(stats.revenue)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Costs</CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-2xl font-bold">
            {formatPLN(stats.costs)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Profit</CardTitle>
          </CardHeader>
          <CardContent
            className={cn("font-mono text-2xl font-bold", stats.profit < 0 && "text-destructive")}
          >
            {formatPLN(stats.profit)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">CIT / Stocking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 font-mono text-sm">
            <div>{formatPLN(stats.tax)}</div>
            <div>{formatPLN(stats.stock)}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue={tab ?? "import"}>
        <TabsList>
          <TabsTrigger value="import">{t.financials.tabs.import}</TabsTrigger>
          <TabsTrigger value="documents">{t.financials.tabs.documents}</TabsTrigger>
          <TabsTrigger value="details">{t.financials.tabs.details}</TabsTrigger>
          <TabsTrigger value="register">{t.financials.tabs.register}</TabsTrigger>
          <TabsTrigger value="summary">{t.financials.tabs.summary}</TabsTrigger>
        </TabsList>

        <TabsContent value="documents">
          <Card>
            <CardHeader>
              <CardTitle>Financial documents</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Number / Name</TableHead>
                    <TableHead>Contractor</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="text-right">Allocated</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Saldeo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents?.map((document) => (
                    <TableRow
                      key={document.id}
                      className="cursor-pointer"
                      onClick={() => {
                        setSelectedDocumentId(document.id)
                      }}
                    >
                      <TableCell>{formatDate(document.accountingDate)}</TableCell>
                      <TableCell>{document.documentType}</TableCell>
                      <TableCell className="font-medium">
                        {document.documentNumber ?? document.documentName}
                      </TableCell>
                      <TableCell>{document.contractorName ?? "-"}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(document.netAmountPln)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(document.allocatedAmount)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(document.remainingAmount)}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusTone(document.allocationStatus)}>
                          {document.allocationStatus}
                        </Badge>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {(document as unknown as Record<string, unknown>).saldeo_exported_at ? (
                          <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 text-xs">
                            Saldeo ✓ {String((document as unknown as Record<string, unknown>).saldeo_exported_at).slice(0, 10)}
                          </Badge>
                        ) : (document as unknown as Record<string, unknown>).saldeo_export_error ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs text-red-600 border-red-300 h-6"
                            disabled={saldeoExport.isPending}
                            onClick={() => {
                              saldeoExport.mutate(document.id, {
                                onSuccess: () => toast.success("Exported to Saldeo"),
                                onError: (e) => toast.error(e instanceof Error ? e.message : "Saldeo export failed")
                              })
                            }}
                          >
                            Retry
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs h-6"
                            disabled={saldeoExport.isPending}
                            onClick={() => {
                              saldeoExport.mutate(document.id, {
                                onSuccess: () => toast.success("Exported to Saldeo"),
                                onError: (e) => toast.error(e instanceof Error ? e.message : "Saldeo export failed")
                              })
                            }}
                          >
                            Export
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="text-muted-foreground mt-4 text-sm">
                Unallocated: {unallocated?.length ?? 0}, partially allocated:{" "}
                {partiallyAllocated?.length ?? 0}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="details">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>
                {selectedDocument?.document.documentNumber ??
                  selectedDocument?.document.documentName ??
                  "Select document"}
              </CardTitle>
              <Dialog open={allocationDialogOpen} onOpenChange={setAllocationDialogOpen}>
                <DialogTrigger asChild>
                  <Button disabled={!selectedDocumentId}>
                    <Plus data-icon="inline-start" />
                    Allocation
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Add allocation</DialogTitle>
                  </DialogHeader>
                  <div className="grid grid-cols-2 gap-3 py-4">
                    <Select
                      value={allocationForm.projectId}
                      onValueChange={(value) => {
                        setAllocationForm({ ...allocationForm, projectId: value })
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Project" />
                      </SelectTrigger>
                      <SelectContent>
                        {projects?.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={allocationForm.transactionType}
                      onValueChange={(value) => {
                        setAllocationForm({ ...allocationForm, transactionType: value })
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {transactionTypes.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="date"
                      value={allocationForm.allocationDate}
                      onChange={(event) => {
                        setAllocationForm({ ...allocationForm, allocationDate: event.target.value })
                      }}
                    />
                    <Input
                      type="number"
                      placeholder="Revenue"
                      value={allocationForm.revenueAmount}
                      onChange={(event) => {
                        setAllocationForm({
                          ...allocationForm,
                          revenueAmount: Number(event.target.value)
                        })
                      }}
                    />
                    <Input
                      type="number"
                      placeholder="Goods purchase"
                      value={allocationForm.goodsPurchaseCost}
                      onChange={(event) => {
                        setAllocationForm({
                          ...allocationForm,
                          goodsPurchaseCost: Number(event.target.value)
                        })
                      }}
                    />
                    <Input
                      type="number"
                      placeholder="Service cost"
                      value={allocationForm.serviceCostNet}
                      onChange={(event) => {
                        setAllocationForm({
                          ...allocationForm,
                          serviceCostNet: Number(event.target.value)
                        })
                      }}
                    />
                    <Input
                      type="number"
                      placeholder="Realized goods"
                      value={allocationForm.realizedGoodsCost}
                      onChange={(event) => {
                        setAllocationForm({
                          ...allocationForm,
                          realizedGoodsCost: Number(event.target.value)
                        })
                      }}
                    />
                    <Input
                      type="number"
                      placeholder="Other cost"
                      value={allocationForm.otherOperatingCost}
                      onChange={(event) => {
                        setAllocationForm({
                          ...allocationForm,
                          otherOperatingCost: Number(event.target.value)
                        })
                      }}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="CIT rate"
                      value={allocationForm.citRate}
                      onChange={(event) => {
                        setAllocationForm({
                          ...allocationForm,
                          citRate: Number(event.target.value)
                        })
                      }}
                    />
                    <Input
                      placeholder="Notes"
                      value={allocationForm.notes}
                      onChange={(event) => {
                        setAllocationForm({ ...allocationForm, notes: event.target.value })
                      }}
                    />
                  </div>
                  <Button
                    onClick={handleAddAllocation}
                    disabled={addAllocation.isPending || !allocationForm.projectId}
                  >
                    {addAllocation.isPending ? "Saving..." : "Add allocation"}
                  </Button>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedDocument ? (
                <>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <div>
                      <p className="text-muted-foreground text-xs">Document net</p>
                      <p className="font-mono font-bold">
                        {formatPLN(selectedDocument.document.netAmountPln)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Allocated</p>
                      <p className="font-mono font-bold">
                        {formatPLN(selectedDocument.document.allocatedAmount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Remaining</p>
                      <p className="font-mono font-bold">
                        {formatPLN(selectedDocument.document.remainingAmount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Status</p>
                      <Badge className={statusTone(selectedDocument.document.allocationStatus)}>
                        {selectedDocument.document.allocationStatus}
                      </Badge>
                    </div>
                  </div>
                  {selectedDocument.document.allocationStatus === "PARTIALLY_ALLOCATED" && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                      Document is only partially allocated.
                    </div>
                  )}
                  {selectedDocument.document.allocationStatus === "OVER_ALLOCATED" && (
                    <div className="border-destructive bg-destructive/10 text-destructive rounded-md border p-3 text-sm">
                      Document is over allocated.
                    </div>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                        <TableHead className="text-right">Service</TableHead>
                        <TableHead className="text-right">Goods purchase</TableHead>
                        <TableHead className="text-right">Realized goods</TableHead>
                        <TableHead className="text-right">Profit</TableHead>
                        <TableHead className="text-right">CIT</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedDocument.allocations.map((allocation) => (
                        <TableRow key={allocation.id}>
                          <TableCell>{allocation.projectName}</TableCell>
                          <TableCell>{allocation.transactionType}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatPLN(allocation.revenueAmountPln)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatPLN(allocation.serviceCostNet)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatPLN(allocation.goodsPurchaseCost)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatPLN(allocation.realizedGoodsCost)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-mono",
                              allocation.profit < 0 && "text-destructive"
                            )}
                          >
                            {formatPLN(allocation.profit)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatPLN(allocation.taxPayable)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              ) : (
                <p className="text-muted-foreground">Select a document from the list.</p>
              )}

              {/* Recent activity — only for users with audit.view permission */}
              {hasPermission("audit.view") && selectedDocumentId && (
                <div className="mt-6 border-t pt-4">
                  <h3 className="mb-3 text-sm font-semibold">{t.audit.recentActivity}</h3>
                  <EntityActivityLog data={financialDocActivity} />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="import">
          <Card>
            <CardHeader>
              <CardTitle>Import rozliczeń projektów z Excela</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <Input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(event) => {
                    void handleExcelFile(event.target.files?.[0])
                  }}
                />
                <Button
                  disabled={!importPreview || commitImport.isPending}
                  onClick={handleCommitImport}
                >
                  {commitImport.isPending ? "Importuję..." : "Zaimportuj zaakceptowane wiersze"}
                </Button>
              </div>

              {importPreview?.warnings.map((warning) => (
                <div
                  key={warning}
                  className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
                >
                  {warning}
                </div>
              ))}

              {importPreview ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Import</TableHead>
                      <TableHead>Arkusz</TableHead>
                      <TableHead>Projekt</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Opis / dokument</TableHead>
                      <TableHead>Typ</TableHead>
                      <TableHead className="text-right">Przychód</TableHead>
                      <TableHead className="text-right">Usługi</TableHead>
                      <TableHead className="text-right">Towar</TableHead>
                      <TableHead className="text-right">Towar zreal.</TableHead>
                      <TableHead className="text-right">Inne</TableHead>
                      <TableHead>Uwagi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importPreview.rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={row.accepted}
                            onChange={(event) => {
                              updateImportRow(row.id, { accepted: event.target.checked })
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          {row.sheetName} #{row.sourceRow}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={row.projectId ?? ""}
                            onValueChange={(value) => {
                              updateImportRow(row.id, { projectId: value })
                            }}
                          >
                            <SelectTrigger className="w-[220px]">
                              <SelectValue placeholder={row.projectName || "Select project"} />
                            </SelectTrigger>
                            <SelectContent>
                              {projects?.map((project) => (
                                <SelectItem key={project.id} value={project.id}>
                                  {project.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="date"
                            value={row.accountingDate}
                            onChange={(event) => {
                              updateImportRow(row.id, { accountingDate: event.target.value })
                            }}
                            className="w-[150px]"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={row.documentName}
                            onChange={(event) => {
                              updateImportRow(row.id, { documentName: event.target.value })
                            }}
                            className="w-[260px]"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={row.transactionType}
                            onValueChange={(value) => {
                              updateImportRow(row.id, {
                                transactionType: value as ExcelImportPreviewRow["transactionType"]
                              })
                            }}
                          >
                            <SelectTrigger className="w-[180px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {transactionTypes.map((type) => (
                                <SelectItem key={type} value={type}>
                                  {type}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={row.revenueAmount}
                            onChange={(event) => {
                              updateImportRow(row.id, { revenueAmount: Number(event.target.value) })
                            }}
                            className="w-[110px] text-right"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={row.serviceCostNet}
                            onChange={(event) => {
                              updateImportRow(row.id, {
                                serviceCostNet: Number(event.target.value)
                              })
                            }}
                            className="w-[110px] text-right"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={row.goodsPurchaseCost}
                            onChange={(event) => {
                              updateImportRow(row.id, {
                                goodsPurchaseCost: Number(event.target.value)
                              })
                            }}
                            className="w-[110px] text-right"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={row.realizedGoodsCost}
                            onChange={(event) => {
                              updateImportRow(row.id, {
                                realizedGoodsCost: Number(event.target.value)
                              })
                            }}
                            className="w-[110px] text-right"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={row.otherOperatingCost}
                            onChange={(event) => {
                              updateImportRow(row.id, {
                                otherOperatingCost: Number(event.target.value)
                              })
                            }}
                            className="w-[110px] text-right"
                          />
                        </TableCell>
                        <TableCell className="text-amber-700">{row.warnings.join(", ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground">
                  Wrzuć plik Excel z rozliczeniami projektów, żeby wygenerować edytowalny podgląd
                  importu.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="register">
          <Card>
            <CardHeader>
              <CardTitle>Project financial register</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>LP</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Foreign</TableHead>
                    <TableHead className="text-right">FX</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Goods purchase</TableHead>
                    <TableHead className="text-right">Service cost</TableHead>
                    <TableHead className="text-right">Realized goods</TableHead>
                    <TableHead className="text-right">Other costs</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead className="text-right">CIT rate</TableHead>
                    <TableHead className="text-right">CIT</TableHead>
                    <TableHead>Category</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {register?.map((row, index) => (
                    <TableRow key={row.id}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell>{row.projectName}</TableCell>
                      <TableCell>{formatDate(row.allocationDate)}</TableCell>
                      <TableCell>{row.description ?? "-"}</TableCell>
                      <TableCell>{row.transactionType}</TableCell>
                      <TableCell className="text-right font-mono">
                        {row.foreignAmount ?? "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {row.exchangeRate ?? "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(row.revenueAmountPln)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(row.goodsPurchaseCost)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(row.serviceCostNet)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(row.realizedGoodsCost)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(row.otherOperatingCost)}
                      </TableCell>
                      <TableCell
                        className={cn("text-right font-mono", row.profit < 0 && "text-destructive")}
                      >
                        {formatPLN(row.profit)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {Math.round(row.citRate * 100)}%
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(row.taxPayable)}
                      </TableCell>
                      <TableCell>{row.categoryName ?? "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="summary">
          <Card>
            <CardHeader>
              <CardTitle>Projects monthly summary</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Service cost</TableHead>
                    <TableHead className="text-right">Goods purchase</TableHead>
                    <TableHead className="text-right">Realized goods</TableHead>
                    <TableHead className="text-right">Other costs</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead className="text-right">CIT</TableHead>
                    <TableHead className="text-right">After CIT</TableHead>
                    <TableHead className="text-right">Stocking</TableHead>
                    <TableHead className="text-right">YTD profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlySummary?.map((row) => (
                    <TableRow key={row.projectId}>
                      <TableCell>{row.projectName}</TableCell>
                      <TableCell>{row.clientName ?? "-"}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(row.revenueAmountPln)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(row.serviceCostNet)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(row.goodsPurchaseCost)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(row.realizedGoodsCost)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(row.otherOperatingCost)}
                      </TableCell>
                      <TableCell
                        className={cn("text-right font-mono", row.profit < 0 && "text-destructive")}
                      >
                        {formatPLN(row.profit)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(row.taxPayable)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(row.profitAfterTax)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(row.stockingValue)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(row.ytdProfit)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </div>
    </div>
  )
}
