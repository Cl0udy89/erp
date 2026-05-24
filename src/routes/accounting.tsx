import React, { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Download, ChevronDown, ChevronRight, AlertCircle } from "lucide-react"
import { toast } from "sonner"

import {
  useAccountingMonthly,
  useAccountingCostVsBilled,
  useAccountingByContractType,
  useExportHistory,
  useAccountingExport,
  useCitEstimate,
  useAccountingPeriods,
  useClosePeriod,
  useReopenPeriod,
  type AccountingEmployee,
  type ContractTypeGroup,
  type CitEstimateResponse
} from "#/api/accounting"
import { queriesUsers } from "#/api/queries"
import { useQuery } from "@tanstack/react-query"
import { useAuth } from "#/lib/auth-context"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card"
import { Input } from "#/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "#/components/ui/select"
import { Skeleton } from "#/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "#/components/ui/alert-dialog"
import { workspaceSearchSchema } from "#/lib/search-schema"
import { useTranslation } from "#/lib/i18n"
import { cn } from "#/lib/utils"

export const Route = createFileRoute("/accounting")({
  validateSearch: workspaceSearchSchema,
  component: AccountingPage
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function firstOfMonth(ym: string): string {
  return `${ym}-01`
}

function lastOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number)
  const last = new Date(y!, m!, 0).getDate()
  return `${ym}-${String(last).padStart(2, "0")}`
}

function fmtHours(h: number | null | undefined): string {
  if (h == null) return "—"
  return h.toFixed(2)
}

function fmtCost(v: number | null | undefined): string {
  if (v == null) return "—"
  return v.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " PLN"
}

function contractLabel(ct: string | null | undefined): string {
  const map: Record<string, string> = {
    uop: "UoP",
    zlecenie: "Zlecenie",
    b2b: "B2B",
    staz: "Staż",
    other: "Inne",
    unset: "Brak"
  }
  return ct ? (map[ct] ?? ct) : "—"
}

function marginColor(pct: number | null | undefined): string {
  if (pct == null) return "text-muted-foreground"
  if (pct >= 30) return "text-green-600"
  if (pct >= 10) return "text-yellow-600"
  return "text-red-600"
}

// ─── Employee Section (reused in Monthly and ByContractType tabs) ─────────────

function EmployeeSection({
  employee,
  defaultOpen = true
}: {
  employee: AccountingEmployee
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border rounded-md overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
        <span className="font-medium flex-1">{employee.name}</span>
        {employee.contractType && (
          <Badge variant="outline" className="shrink-0">{contractLabel(employee.contractType)}</Badge>
        )}
        <span className="text-sm text-muted-foreground shrink-0">
          {fmtHours(employee.totalHours)}h total
          {employee.billableHours !== employee.totalHours && ` (${fmtHours(employee.billableHours)}h billable)`}
        </span>
        {employee.totalCost != null ? (
          <span className="text-sm font-medium shrink-0">
            {fmtCost(employee.totalCost)}
          </span>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1 text-sm text-muted-foreground shrink-0">
                — <AlertCircle className="size-3 text-yellow-500" />
              </span>
            </TooltipTrigger>
            <TooltipContent>Internal rate not set for this employee</TooltipContent>
          </Tooltip>
        )}
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/20">
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Date</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Project</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Client</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Task</th>
                <th className="text-right px-4 py-2 font-medium text-muted-foreground">Hours</th>
                <th className="text-center px-4 py-2 font-medium text-muted-foreground">Billable</th>
              </tr>
            </thead>
            <tbody>
              {employee.entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    No entries
                  </td>
                </tr>
              ) : (
                employee.entries.map((entry, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/10">
                    <td className="px-4 py-2 tabular-nums">{entry.date}</td>
                    <td className="px-4 py-2">{entry.project}</td>
                    <td className="px-4 py-2 text-muted-foreground">{entry.client}</td>
                    <td className="px-4 py-2">{entry.task}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{entry.hours.toFixed(2)}</td>
                    <td className="px-4 py-2 text-center">{entry.billable ? "✓" : ""}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="bg-muted/20 font-medium">
                <td colSpan={4} className="px-4 py-2">Total</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtHours(employee.totalHours)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Monthly Report Tab ───────────────────────────────────────────────────────

function MonthlyReportTab({ workspaceId }: { workspaceId: string }) {
  const [month, setMonth] = useState(currentMonth())
  const [employeeFilter, setEmployeeFilter] = useState<string>("all")
  const [contractFilter, setContractFilter] = useState<string>("all")

  const { data: users } = useQuery({
    ...queriesUsers.workspaceUsers(workspaceId),
    enabled: !!workspaceId
  })

  const { data, isLoading } = useAccountingMonthly({
    workspaceId,
    month,
    employeeId: employeeFilter !== "all" ? employeeFilter : undefined,
    contractType: contractFilter !== "all" ? contractFilter : undefined
  })

  function downloadPdf() {
    // Same pattern as existing Detailed report PDF: open URL with ?token= in new tab
    const backendUrl = typeof window !== "undefined"
      ? ((import.meta as unknown as Record<string, unknown>)?.env as Record<string, string> | undefined)?.VITE_BACKEND_API_URL ?? "http://localhost:4001"
      : "http://localhost:4001"
    const token = typeof window !== "undefined"
      ? ((import.meta as unknown as Record<string, unknown>)?.env as Record<string, string> | undefined)?.VITE_API_INTERNAL_TOKEN ?? ""
      : ""
    const params = new URLSearchParams({ type: "monthly_pdf", workspaceId, month, token })
    if (employeeFilter !== "all") params.set("employeeId", employeeFilter)
    if (contractFilter !== "all") params.set("contractType", contractFilter)
    window.open(`${backendUrl}/accounting/export?${params.toString()}`, "_blank")
  }

  function downloadCsv() {
    const backendUrl = typeof window !== "undefined"
      ? ((import.meta as unknown as Record<string, unknown>)?.env as Record<string, string> | undefined)?.VITE_BACKEND_API_URL ?? "http://localhost:4001"
      : "http://localhost:4001"
    const token = typeof window !== "undefined"
      ? ((import.meta as unknown as Record<string, unknown>)?.env as Record<string, string> | undefined)?.VITE_API_INTERNAL_TOKEN ?? ""
      : ""
    const params = new URLSearchParams({ type: "monthly_csv", workspaceId, month, token })
    if (employeeFilter !== "all") params.set("employeeId", employeeFilter)
    if (contractFilter !== "all") params.set("contractType", contractFilter)
    window.open(`${backendUrl}/accounting/export?${params.toString()}`, "_blank")
  }

  const employees = data?.employees ?? []
  const totalHours = employees.reduce((s, e) => s + e.totalHours, 0)
  const totalCostRows = employees.map((e) => e.totalCost)
  const totalCost = totalCostRows.every((c) => c != null)
    ? totalCostRows.reduce((s, c) => s + (c ?? 0), 0)
    : null

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-muted-foreground font-medium block mb-1">Month</label>
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-40"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium block mb-1">Employee</label>
          <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All employees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All employees</SelectItem>
              {users?.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium block mb-1">Contract type</label>
          <Select value={contractFilter} onValueChange={setContractFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="uop">UoP</SelectItem>
              <SelectItem value="zlecenie">Zlecenie</SelectItem>
              <SelectItem value="b2b">B2B</SelectItem>
              <SelectItem value="staz">Staż</SelectItem>
              <SelectItem value="other">Other</SelectItem>
              <SelectItem value="unset">Not set</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={downloadPdf}>
            <Download className="size-4 mr-1" /> Download PDF
          </Button>
          <Button variant="outline" size="sm" onClick={downloadCsv}>
            <Download className="size-4 mr-1" /> Download CSV
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}
        </div>
      ) : employees.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No time entries found for this period
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {employees.map((emp) => (
            <EmployeeSection key={emp.employeeId} employee={emp} />
          ))}

          {/* Grand total */}
          <div className="flex justify-end gap-6 px-4 py-3 bg-muted/30 rounded-md text-sm font-medium">
            <span>Total: {fmtHours(totalHours)}h</span>
            <span>
              {totalCost != null ? fmtCost(totalCost) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1">
                      — <AlertCircle className="size-3 text-yellow-500" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Some employees have no internal rate set</TooltipContent>
                </Tooltip>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Cost vs Billed Tab ───────────────────────────────────────────────────────

function CostVsBilledTab({ workspaceId }: { workspaceId: string }) {
  const now = currentMonth()
  const [from, setFrom] = useState(firstOfMonth(now))
  const [to, setTo] = useState(lastOfMonth(now))
  const [groupBy, setGroupBy] = useState<"employee" | "project" | "client">("employee")
  const { t } = useTranslation()

  const { data, isLoading } = useAccountingCostVsBilled({ workspaceId, from, to, groupBy })

  function applyPreset(preset: string) {
    const d = new Date()
    if (preset === "this_month") {
      setFrom(firstOfMonth(now))
      setTo(lastOfMonth(now))
    } else if (preset === "last_month") {
      const lm = d.getMonth() === 0
        ? `${d.getFullYear() - 1}-12`
        : `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`
      setFrom(firstOfMonth(lm))
      setTo(lastOfMonth(lm))
    } else if (preset === "this_quarter") {
      const q = Math.floor(d.getMonth() / 3)
      const qStart = `${d.getFullYear()}-${String(q * 3 + 1).padStart(2, "0")}`
      const qEndMonth = `${d.getFullYear()}-${String(q * 3 + 3).padStart(2, "0")}`
      setFrom(firstOfMonth(qStart))
      setTo(lastOfMonth(qEndMonth))
    }
  }

  function downloadCsv() {
    const backendUrl = typeof window !== "undefined"
      ? ((import.meta as unknown as Record<string, unknown>)?.env as Record<string, string> | undefined)?.VITE_BACKEND_API_URL ?? "http://localhost:4001"
      : "http://localhost:4001"
    const token = typeof window !== "undefined"
      ? ((import.meta as unknown as Record<string, unknown>)?.env as Record<string, string> | undefined)?.VITE_API_INTERNAL_TOKEN ?? ""
      : ""
    const params = new URLSearchParams({ type: "cost_billed_csv", workspaceId, from, to, token })
    window.open(`${backendUrl}/accounting/export?${params.toString()}`, "_blank")
  }

  const rows = data?.rows ?? []

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-muted-foreground font-medium block mb-1">Preset</label>
          <Select onValueChange={applyPreset}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Custom" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="this_month">This month</SelectItem>
              <SelectItem value="last_month">Last month</SelectItem>
              <SelectItem value="this_quarter">This quarter</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium block mb-1">From</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium block mb-1">To</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium block mb-1">Group by</label>
          <div className="flex border rounded-md overflow-hidden">
            {(["employee", "project", "client"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGroupBy(g)}
                className={cn(
                  "px-3 py-1.5 text-sm capitalize transition-colors",
                  groupBy === g ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                )}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={downloadCsv}>
          <Download className="size-4 mr-1" /> Export CSV
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {t.accounting.noDataPeriod}
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-3 font-medium">{t.accounting.name}</th>
                <th className="text-right px-4 py-3 font-medium">{t.accounting.totalHoursCol}</th>
                <th className="text-right px-4 py-3 font-medium">{t.accounting.billableHrs}</th>
                {groupBy === "project" ? (
                  <>
                    <th className="text-right px-4 py-3 font-medium">{t.accounting.personnelCost}</th>
                    <th className="text-right px-4 py-3 font-medium">{t.accounting.materialsCost}</th>
                    <th className="text-right px-4 py-3 font-medium">{t.accounting.totalCostCol}</th>
                  </>
                ) : (
                  <th className="text-right px-4 py-3 font-medium">{t.accounting.costPln}</th>
                )}
                <th className="text-right px-4 py-3 font-medium">{t.accounting.billedPln}</th>
                <th className="text-right px-4 py-3 font-medium">{t.accounting.marginPln}</th>
                <th className="text-right px-4 py-3 font-medium">{t.accounting.marginPct}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b last:border-0 hover:bg-muted/10">
                  <td className="px-4 py-3 font-medium">{row.key}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtHours(row.totalHours)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtHours(row.billableHours)}</td>
                  {groupBy === "project" ? (
                    <>
                      <td className="px-4 py-3 text-right tabular-nums">{row.personnelCost != null ? fmtCost(row.personnelCost) : "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.materialsCost != null && row.materialsCost > 0 ? fmtCost(row.materialsCost) : "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{row.totalCost != null ? fmtCost(row.totalCost) : "—"}</td>
                    </>
                  ) : (
                    <td className="px-4 py-3 text-right tabular-nums">{row.cost != null ? fmtCost(row.cost) : "—"}</td>
                  )}
                  <td className="px-4 py-3 text-right tabular-nums">{row.billed != null ? fmtCost(row.billed) : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.margin != null ? fmtCost(row.margin) : "—"}
                  </td>
                  <td className={cn("px-4 py-3 text-right tabular-nums font-medium", marginColor(row.marginPercent))}>
                    {row.marginPercent != null ? `${row.marginPercent.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── By Contract Type Tab ─────────────────────────────────────────────────────

function ContractTypeCard({ group }: { group: ContractTypeGroup }) {
  const [open, setOpen] = useState(false)

  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            {contractLabel(group.contractType)} — {group.totalEmployees} employee{group.totalEmployees !== 1 ? "s" : ""}
          </span>
          <span className="flex gap-4 text-sm font-normal">
            <span>{fmtHours(group.totalHours)}h</span>
            <span>
              {group.totalCost != null ? fmtCost(group.totalCost) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      — <AlertCircle className="size-3 text-yellow-500" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Internal rates not set for some employees</TooltipContent>
                </Tooltip>
              )}
            </span>
          </span>
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3 pt-0">
          {group.employees.map((emp) => (
            <EmployeeSection key={emp.employeeId} employee={emp} defaultOpen={false} />
          ))}
        </CardContent>
      )}
    </Card>
  )
}

function ByContractTypeTab({ workspaceId }: { workspaceId: string }) {
  const [month, setMonth] = useState(currentMonth())
  const { data, isLoading } = useAccountingByContractType({ workspaceId, month })

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div>
          <label className="text-xs text-muted-foreground font-medium block mb-1">Month</label>
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-40"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : !data || data.groups.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No data for this month
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.groups.map((group) => (
            <ContractTypeCard key={group.contractType} group={group} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Export History Tab ───────────────────────────────────────────────────────

function ExportHistoryTab({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading } = useExportHistory(workspaceId)
  const exportMutation = useAccountingExport()

  function reDownload(params: {
    exportType: string
    params: { month?: string; from?: string; to?: string; employeeId?: string; contractType?: string }
  }) {
    exportMutation.mutate(
      {
        workspaceId,
        type: params.exportType as "monthly_pdf" | "monthly_csv" | "cost_billed_csv",
        ...params.params
      },
      {
        onSuccess: () => toast.success("Export re-triggered"),
        onError: (e) => toast.error("Export failed", { description: String(e) })
      }
    )
  }

  function formatParams(p: { month?: string; from?: string; to?: string; employeeId?: string; contractType?: string }) {
    const parts: string[] = []
    if (p.month) parts.push(p.month)
    if (p.from) parts.push(`${p.from} – ${p.to ?? ""}`)
    if (p.employeeId) parts.push(`emp: ${p.employeeId.slice(0, 8)}…`)
    if (p.contractType) parts.push(contractLabel(p.contractType))
    return parts.join(" / ") || "—"
  }

  const typeLabels: Record<string, string> = {
    monthly_pdf: "Monthly PDF",
    monthly_csv: "Monthly CSV",
    cost_billed_csv: "Cost vs Billed CSV"
  }

  if (isLoading) return <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No export history yet
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="border rounded-md overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="text-left px-4 py-3 font-medium">Date</th>
            <th className="text-left px-4 py-3 font-medium">Exported by</th>
            <th className="text-left px-4 py-3 font-medium">Type</th>
            <th className="text-left px-4 py-3 font-medium">Parameters</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {data.map((entry) => (
            <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/10">
              <td className="px-4 py-3 tabular-nums">
                {new Date(entry.createdAt).toLocaleString("pl-PL")}
              </td>
              <td className="px-4 py-3">{entry.exportedByName}</td>
              <td className="px-4 py-3">
                <Badge variant="outline">{typeLabels[entry.exportType] ?? entry.exportType}</Badge>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{formatParams(entry.params)}</td>
              <td className="px-4 py-3 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => reDownload({ exportType: entry.exportType, params: entry.params })}
                  disabled={exportMutation.isPending}
                >
                  Re-download
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── CIT Estimate Tab ─────────────────────────────────────────────────────────

function CitSection({
  title,
  total,
  children,
  warning,
  note
}: {
  title: string
  total: number | null
  children?: React.ReactNode
  warning?: string
  note?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border rounded-md overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
        <span className="font-medium flex-1">{title}</span>
        {warning && <AlertCircle className="size-4 text-yellow-500 shrink-0" />}
        <span className="text-sm font-medium shrink-0">{total != null ? fmtCost(total) : "—"}</span>
      </button>
      {open && (
        <div className="px-4 py-3 space-y-2 text-sm">
          {note && <p className="text-muted-foreground italic">{note}</p>}
          {warning && <p className="text-yellow-700 bg-yellow-50 rounded px-3 py-2">{warning}</p>}
          {children}
        </div>
      )}
    </div>
  )
}

function CitInvoiceTable({ rows }: { rows: CitEstimateResponse["revenue"]["breakdown"] }) {
  if (!rows.length) return <p className="text-muted-foreground">No invoices</p>
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b">
          <th className="text-left py-1 font-medium text-muted-foreground">Document</th>
          <th className="text-left py-1 font-medium text-muted-foreground">Counterparty</th>
          <th className="text-right py-1 font-medium text-muted-foreground">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.invoiceId} className="border-b last:border-0">
            <td className="py-1 tabular-nums">{r.documentNumber}</td>
            <td className="py-1 text-muted-foreground">{r.counterparty}</td>
            <td className="py-1 text-right tabular-nums">{fmtCost(r.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function CitPersonnelTable({ employees }: { employees: CitEstimateResponse["costs"]["personnel"]["uop"]["employees"] }) {
  if (!employees.length) return <p className="text-muted-foreground">No employees in this group</p>
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b">
          <th className="text-left py-1 font-medium text-muted-foreground">Employee</th>
          <th className="text-right py-1 font-medium text-muted-foreground">Hours</th>
          <th className="text-right py-1 font-medium text-muted-foreground">Rate</th>
          <th className="text-right py-1 font-medium text-muted-foreground">Cost</th>
        </tr>
      </thead>
      <tbody>
        {employees.map((e) => (
          <tr key={e.employeeId} className="border-b last:border-0">
            <td className="py-1">{e.name}</td>
            <td className="py-1 text-right tabular-nums">{fmtHours(e.hours)}h</td>
            <td className="py-1 text-right tabular-nums">{e.rate != null ? fmtCost(e.rate) + "/h" : "—"}</td>
            <td className="py-1 text-right tabular-nums">{e.cost != null ? fmtCost(e.cost) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function CitEstimateTab({ workspaceId }: { workspaceId: string }) {
  const now = new Date()
  const [mode, setMode] = useState<"month" | "year">("month")
  const [month, setMonth] = useState(currentMonth())
  const [year, setYear] = useState(String(now.getFullYear()))

  const { data, isLoading } = useCitEstimate({
    workspaceId,
    month: mode === "month" ? month : undefined,
    year: mode === "year" ? year : undefined
  })

  const p = data?.costs.personnel

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-muted-foreground font-medium block mb-1">Period</label>
          <div className="flex border rounded-md overflow-hidden">
            {(["month", "year"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "px-3 py-1.5 text-sm capitalize transition-colors",
                  mode === m ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                )}
              >
                {m === "month" ? "Monthly" : "Annual"}
              </button>
            ))}
          </div>
        </div>
        {mode === "month" ? (
          <div>
            <label className="text-xs text-muted-foreground font-medium block mb-1">Month</label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
          </div>
        ) : (
          <div>
            <label className="text-xs text-muted-foreground font-medium block mb-1">Year</label>
            <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} className="w-28" min="2020" max="2099" />
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : !data ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">No CIT data available</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Warnings */}
          {data.warnings.length > 0 && (
            <div className="space-y-1">
              {data.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-yellow-800 bg-yellow-50 rounded px-3 py-2">
                  <AlertCircle className="size-4 shrink-0 mt-0.5 text-yellow-600" />
                  {w}
                </div>
              ))}
            </div>
          )}

          {/* Revenue */}
          <CitSection title="Revenue" total={data.revenue.total}>
            <CitInvoiceTable rows={data.revenue.breakdown} />
          </CitSection>

          {/* Costs */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide px-1">Costs</h3>
            <CitSection title="Purchases" total={data.costs.purchases.total}>
              <CitInvoiceTable rows={data.costs.purchases.breakdown} />
            </CitSection>
            {p && (
              <>
                <CitSection title="Personnel — UoP" total={p.uop.total} note={p.uop.note}>
                  <CitPersonnelTable employees={p.uop.employees} />
                </CitSection>
                <CitSection title="Personnel — Zlecenie" total={p.zlecenie.total} note={p.zlecenie.note}>
                  <CitPersonnelTable employees={p.zlecenie.employees} />
                </CitSection>
                <CitSection title="Personnel — B2B" total={p.b2b.total} note={p.b2b.note}>
                  <CitPersonnelTable employees={p.b2b.employees} />
                </CitSection>
                <CitSection title="Personnel — Staż" total={p.staz.total} warning={p.staz.warning}>
                  <CitPersonnelTable employees={p.staz.employees} />
                </CitSection>
                {p.other.employees.length > 0 && (
                  <CitSection title="Personnel — Other" total={p.other.total}>
                    <CitPersonnelTable employees={p.other.employees} />
                  </CitSection>
                )}
              </>
            )}
          </div>

          {/* Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">CIT Estimate — {data.period}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Revenue</span>
                <span className="font-medium tabular-nums">{fmtCost(data.revenue.total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Costs</span>
                <span className="font-medium tabular-nums">{fmtCost(data.costs.total)}</span>
              </div>
              <div className="border-t pt-2 flex justify-between font-semibold">
                <span>Tax Base</span>
                <span className={cn("tabular-nums", data.taxBase < 0 ? "text-red-600" : "text-green-700")}>
                  {fmtCost(data.taxBase)}
                </span>
              </div>
              {data.taxBase > 0 && (
                <div className="pt-1 space-y-1 border-t">
                  <div className="flex justify-between text-muted-foreground">
                    <span>CIT 9% (small taxpayer)</span>
                    <span className="tabular-nums">{data.estimatedCit9 != null ? fmtCost(data.estimatedCit9) : "—"}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>CIT 19% (standard)</span>
                    <span className="tabular-nums">{data.estimatedCit19 != null ? fmtCost(data.estimatedCit19) : "—"}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

// ─── Periods Tab ──────────────────────────────────────────────────────────────

function generateLastMonths(n: number): Array<{ period: string }> {
  const result: Array<{ period: string }> = []
  const d = new Date()
  for (let i = 0; i < n; i++) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    result.push({ period: `${y}-${m}` })
    d.setMonth(d.getMonth() - 1)
  }
  return result
}

function PeriodsTab({ workspaceId }: { workspaceId: string }) {
  const { data: periods, isLoading } = useAccountingPeriods(workspaceId)
  const { user } = useAuth()
  const { t } = useTranslation()
  const closeMutation = useClosePeriod()
  const reopenMutation = useReopenPeriod()
  const [confirmPeriod, setConfirmPeriod] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<"close" | "reopen">("close")
  const isAdmin = user?.role === "admin"

  const displayPeriods = generateLastMonths(24)

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">{t.accounting.periodPeriod}</th>
                <th className="px-4 py-3 text-left font-medium">{t.accounting.periodStatus}</th>
                <th className="px-4 py-3 text-left font-medium">{t.accounting.periodClosedBy}</th>
                <th className="px-4 py-3 text-left font-medium">{t.accounting.periodClosedAt}</th>
                {isAdmin && <th className="px-4 py-3 text-right font-medium">{t.common.actions}</th>}
              </tr>
            </thead>
            <tbody>
              {displayPeriods.map((p) => {
                const record = periods?.find((r) => r.period === p.period)
                const isClosed = record?.status === "closed"
                return (
                  <tr key={p.period} className="border-b hover:bg-muted/50">
                    <td className="px-4 py-3 font-mono">{p.period}</td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
                        isClosed
                          ? "bg-red-100 text-red-700 dark:bg-red-900/20"
                          : "bg-green-100 text-green-700 dark:bg-green-900/20"
                      )}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", isClosed ? "bg-red-500" : "bg-green-500")} />
                        {isClosed ? t.accounting.periodClosed : t.accounting.periodOpen}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{record?.closedByName ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {record?.closedAt ? new Date(record.closedAt).toLocaleDateString("pl-PL") : "—"}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        {isClosed ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setConfirmPeriod(p.period); setConfirmAction("reopen") }}
                          >
                            {t.accounting.periodReopen}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            onClick={() => { setConfirmPeriod(p.period); setConfirmAction("close") }}
                          >
                            {t.accounting.periodClose}
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog open={!!confirmPeriod} onOpenChange={(o) => !o && setConfirmPeriod(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "close"
                ? `${t.accounting.periodCloseConfirm} ${confirmPeriod}?`
                : `${t.accounting.periodReopenConfirm} ${confirmPeriod}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "close"
                ? t.accounting.periodCloseDesc
                : t.accounting.periodReopenDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.action.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirmPeriod) return
                const fn = confirmAction === "close" ? closeMutation : reopenMutation
                fn.mutate(
                  { workspaceId, period: confirmPeriod },
                  {
                    onSuccess: () => {
                      toast.success(confirmAction === "close" ? t.toast.periodClosed : t.toast.periodReopened)
                      setConfirmPeriod(null)
                    },
                    onError: () => { toast.error(t.accounting.periodOpError) }
                  }
                )
              }}
            >
              {t.action.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function AccountingPage() {
  const search = Route.useSearch()
  const workspaceId = search.workspaceId ?? ""
  const { t } = useTranslation()

  if (!workspaceId) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        {t.accounting.selectWorkspace}
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold text-zinc-100 leading-none">{t.accounting.title}</h1>
          <p className="text-xs text-zinc-500 mt-1">Koszty i przychody</p>
        </div>
      </div>
      <div className="p-6 space-y-6">

      <Tabs defaultValue="monthly">
        <TabsList className="grid w-full grid-cols-6 max-w-3xl">
          <TabsTrigger value="monthly">{t.accounting.monthlyReport}</TabsTrigger>
          <TabsTrigger value="cost-billed">{t.accounting.costVsBilled}</TabsTrigger>
          <TabsTrigger value="by-contract">{t.accounting.byContractType}</TabsTrigger>
          <TabsTrigger value="cit">{t.accounting.citEstimate}</TabsTrigger>
          <TabsTrigger value="history">{t.accounting.exportHistory}</TabsTrigger>
          <TabsTrigger value="periods">Okresy</TabsTrigger>
        </TabsList>

        <TabsContent value="monthly" className="mt-6">
          <MonthlyReportTab workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value="cost-billed" className="mt-6">
          <CostVsBilledTab workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value="by-contract" className="mt-6">
          <ByContractTypeTab workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value="cit" className="mt-6">
          <CitEstimateTab workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value="history" className="mt-6">
          <ExportHistoryTab workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value="periods" className="mt-6">
          <PeriodsTab workspaceId={workspaceId} />
        </TabsContent>
      </Tabs>
      </div>
    </div>
  )
}
