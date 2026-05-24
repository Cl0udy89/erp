import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import z from "zod"

import { backendGet, backendPost } from "#/lib/backend-client"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AccountingEntry {
  date: string
  project: string
  client: string
  task: string
  hours: number
  billable: boolean
}

export interface AccountingEmployee {
  employeeId: string
  name: string
  contractType: string | null
  totalHours: number
  billableHours: number
  internalRate: number | null
  totalCost: number | null
  entries: AccountingEntry[]
}

export interface MonthlyReportResponse {
  month: string
  employees: AccountingEmployee[]
}

export interface CostBilledRow {
  key: string
  totalHours: number
  billableHours: number
  cost: number | null
  personnelCost: number | null
  materialsCost: number | null
  totalCost: number | null
  billed: number | null
  margin: number | null
  marginPercent: number | null
}

export interface CostVsBilledResponse {
  from: string
  to: string
  groupBy: string
  rows: CostBilledRow[]
}

export interface ContractTypeGroup {
  contractType: "uop" | "zlecenie" | "b2b" | "staz" | "other" | "unset"
  totalEmployees: number
  totalHours: number
  totalCost: number | null
  employees: AccountingEmployee[]
}

export interface ByContractTypeResponse {
  month: string
  groups: ContractTypeGroup[]
}

export interface ExportLogEntry {
  id: string
  exportType: string
  params: {
    month?: string
    from?: string
    to?: string
    employeeId?: string
    contractType?: string
  }
  createdAt: string
  exportedBy: string
  exportedByName: string
}

export interface AccountingExportRequest {
  workspaceId: string
  type: "monthly_pdf" | "monthly_csv" | "cost_billed_csv"
  month?: string
  from?: string
  to?: string
  employeeId?: string
  contractType?: string
}

// ─── Server Functions ─────────────────────────────────────────────────────────

const MonthlyReportInput = z.object({
  workspaceId: z.string(),
  month: z.string().optional(),
  employeeId: z.string().optional(),
  contractType: z.string().optional()
})

const getMonthlyReportFn = createServerFn({ method: "GET" })
  .inputValidator(MonthlyReportInput)
  .handler(async ({ data }) =>
    backendGet<MonthlyReportResponse>("/accounting/monthly", {
      workspaceId: data.workspaceId,
      month: data.month,
      employeeId: data.employeeId,
      contractType: data.contractType
    })
  )

const CostVsBilledInput = z.object({
  workspaceId: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  groupBy: z.enum(["employee", "project", "client"]).optional()
})

const getCostVsBilledFn = createServerFn({ method: "GET" })
  .inputValidator(CostVsBilledInput)
  .handler(async ({ data }) =>
    backendGet<CostVsBilledResponse>("/accounting/cost-vs-billed", {
      workspaceId: data.workspaceId,
      from: data.from,
      to: data.to,
      groupBy: data.groupBy
    })
  )

const ByContractTypeInput = z.object({
  workspaceId: z.string(),
  month: z.string().optional()
})

const getByContractTypeFn = createServerFn({ method: "GET" })
  .inputValidator(ByContractTypeInput)
  .handler(async ({ data }) =>
    backendGet<ByContractTypeResponse>("/accounting/by-contract-type", {
      workspaceId: data.workspaceId,
      month: data.month
    })
  )

const getExportHistoryFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ workspaceId: z.string() }))
  .handler(async ({ data }) =>
    backendGet<ExportLogEntry[]>("/accounting/export-history", {
      workspaceId: data.workspaceId
    })
  )

const triggerExportFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    workspaceId: z.string(),
    type: z.string(),
    month: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    employeeId: z.string().optional(),
    contractType: z.string().optional()
  }))
  .handler(async ({ data }) =>
    backendPost<{ id: string }>("/accounting/export", data)
  )

// ─── React Query Hooks ────────────────────────────────────────────────────────

export function useAccountingMonthly(params: {
  workspaceId: string
  month: string
  employeeId?: string
  contractType?: string
}) {
  return useQuery({
    queryKey: ["accounting", "monthly", params],
    queryFn: () => getMonthlyReportFn({ data: params }),
    enabled: !!params.workspaceId
  })
}

export function useAccountingCostVsBilled(params: {
  workspaceId: string
  from: string
  to: string
  groupBy: "employee" | "project" | "client"
}) {
  return useQuery({
    queryKey: ["accounting", "cost-vs-billed", params],
    queryFn: () => getCostVsBilledFn({ data: params }),
    enabled: !!params.workspaceId
  })
}

export function useAccountingByContractType(params: {
  workspaceId: string
  month: string
}) {
  return useQuery({
    queryKey: ["accounting", "by-contract-type", params],
    queryFn: () => getByContractTypeFn({ data: params }),
    enabled: !!params.workspaceId
  })
}

export function useExportHistory(workspaceId: string) {
  return useQuery({
    queryKey: ["accounting", "export-history", workspaceId],
    queryFn: () => getExportHistoryFn({ data: { workspaceId } }),
    enabled: !!workspaceId
  })
}

export function useAccountingExport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (req: AccountingExportRequest) => triggerExportFn({ data: req }),
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["accounting", "export-history", vars.workspaceId] })
    }
  })
}

// ─── CIT Estimate ─────────────────────────────────────────────────────────────

export interface CitPersonnelEmployee {
  employeeId: string
  name: string
  hours: number
  rate: number | null
  cost: number | null
}

export interface CitPersonnelGroup {
  total: number
  employees: CitPersonnelEmployee[]
  note?: string
  warning?: string
}

export interface CitInvoiceBreakdown {
  invoiceId: string
  amount: number
  counterparty: string
  documentNumber: string
}

export interface CitEstimateResponse {
  period: string
  revenue: {
    total: number
    breakdown: CitInvoiceBreakdown[]
  }
  costs: {
    purchases: { total: number; breakdown: CitInvoiceBreakdown[] }
    personnel: {
      uop: CitPersonnelGroup
      zlecenie: CitPersonnelGroup
      b2b: CitPersonnelGroup & { note: string }
      staz: CitPersonnelGroup & { warning: string }
      other: CitPersonnelGroup
      total: number
    }
    total: number
  }
  taxBase: number
  estimatedCit9: number | null
  estimatedCit19: number | null
  warnings: string[]
}

const getCitEstimateFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({
    workspaceId: z.string(),
    month: z.string().optional(),
    year: z.string().optional()
  }))
  .handler(async ({ data }) =>
    backendGet<CitEstimateResponse>("/accounting/cit-estimate", {
      workspaceId: data.workspaceId,
      month: data.month,
      year: data.year
    })
  )

export function useCitEstimate(params: {
  workspaceId: string
  month?: string
  year?: string
}) {
  return useQuery({
    queryKey: ["accounting", "cit-estimate", params],
    queryFn: () => getCitEstimateFn({ data: params }),
    enabled: !!params.workspaceId
  })
}

// ─── Saldeo ───────────────────────────────────────────────────────────────────

export interface SaldeoStatusResponse {
  configured: boolean
  connectedCompany?: string | null
  error?: string
}

const getSaldeoStatusFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({}))
  .handler(async () => backendGet<SaldeoStatusResponse>("/saldeo/status", {}))

export function useSaldeoStatus() {
  return useQuery({
    queryKey: ["saldeo", "status"],
    queryFn: () => getSaldeoStatusFn({ data: {} }),
    staleTime: 60_000
  })
}

const saldeoExportFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ documentId: z.string() }))
  .handler(async ({ data }) =>
    backendPost<{ success: boolean; saldeoDocumentId: string; exportedAt: string }>(
      `/saldeo/export/${data.documentId}`,
      {}
    )
  )

export function useSaldeoExport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (documentId: string) => saldeoExportFn({ data: { documentId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["financials"] })
    }
  })
}

// ─── Accounting Periods ───────────────────────────────────────────────────────

export interface AccountingPeriod {
  id: string
  period: string
  status: 'open' | 'closed'
  closedBy: string | null
  closedByName: string | null
  closedAt: string | null
  notes: string | null
}

export const useAccountingPeriods = (workspaceId: string) =>
  useQuery({
    queryKey: ["accounting-periods", workspaceId],
    queryFn: async () => {
      const fn = createServerFn({ method: "GET" }).handler(async () =>
        backendGet<AccountingPeriod[]>(`/accounting/periods?workspaceId=${workspaceId}`)
      )
      return fn()
    },
    enabled: !!workspaceId
  })

export const useClosePeriod = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ workspaceId, period }: { workspaceId: string; period: string }) =>
      backendPost(`/accounting/periods/${period}/close`, { workspaceId }),
    onSuccess: (_, { workspaceId }) => { void qc.invalidateQueries({ queryKey: ["accounting-periods", workspaceId] }) }
  })
}

export const useReopenPeriod = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ workspaceId, period }: { workspaceId: string; period: string }) =>
      backendPost(`/accounting/periods/${period}/reopen`, { workspaceId }),
    onSuccess: (_, { workspaceId }) => { void qc.invalidateQueries({ queryKey: ["accounting-periods", workspaceId] }) }
  })
}
