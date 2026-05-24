import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import z from "zod"

import { backendGet, backendPost } from "#/lib/backend-client"
import {
  ALLOCATION_STATUSES,
  DOCUMENT_TYPES,
  IMPORT_STATUSES,
  SOURCE_SYSTEMS,
  STOCK_MOVEMENT_TYPES,
  TRANSACTION_TYPES,
  type ClientTimeCostSummary,
  type EmployeeHourlyRate,
  type FinancialCategory,
  type FinancialDocument,
  type FinancialDocumentAllocation,
  type FinancialFlowRow,
  type FinancialReportRow,
  type Product,
  type ProjectProfitabilityRow,
  type ProjectTimeCostSummary,
  type StockMovement,
  type StockSummaryRow
} from "#/lib/finance-types"

const optionalNumber = z.coerce.number().optional()
const nullableNumber = z.coerce.number().nullable().optional()

const DocumentInputSchema = z.object({
  documentNumber: z.string().optional().nullable(),
  documentName: z.string().optional().nullable(),
  documentType: z.enum(DOCUMENT_TYPES),
  sourceSystem: z.enum(SOURCE_SYSTEMS).optional(),
  externalId: z.string().optional().nullable(),
  contractorName: z.string().optional().nullable(),
  contractorTaxId: z.string().optional().nullable(),
  issueDate: z.string().optional().nullable(),
  saleDate: z.string().optional().nullable(),
  receivedDate: z.string().optional().nullable(),
  accountingDate: z.string(),
  currencyCode: z.string().optional(),
  netAmount: optionalNumber,
  vatAmount: optionalNumber,
  grossAmount: optionalNumber,
  exchangeRate: nullableNumber,
  description: z.string().optional().nullable(),
  fileUrl: z.string().optional().nullable(),
  importStatus: z.enum(IMPORT_STATUSES).optional(),
  rawPayload: z.unknown().optional()
})

const AllocationInputSchema = z.object({
  projectId: z.string(),
  clientId: z.string().optional().nullable(),
  employeeId: z.string().optional().nullable(),
  allocationDate: z.string(),
  transactionType: z.enum(TRANSACTION_TYPES),
  categoryId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  revenueAmount: nullableNumber,
  goodsPurchaseCost: nullableNumber,
  serviceCostNet: nullableNumber,
  realizedGoodsCost: nullableNumber,
  otherOperatingCost: nullableNumber,
  foreignAmount: nullableNumber,
  currencyCode: z.string().optional().nullable(),
  exchangeRate: nullableNumber,
  citRate: nullableNumber
})

const PercentAllocationInputSchema = AllocationInputSchema.extend({
  percent: z.coerce.number(),
  targetField: z
    .enum([
      "revenueAmount",
      "goodsPurchaseCost",
      "serviceCostNet",
      "realizedGoodsCost",
      "otherOperatingCost"
    ])
    .optional()
})

const DocumentFiltersSchema = z.object({
  year: z.coerce.number().optional(),
  month: z.coerce.number().optional(),
  documentType: z.string().optional(),
  contractor: z.string().optional(),
  allocationStatus: z.enum(ALLOCATION_STATUSES).optional(),
  projectId: z.string().optional(),
  sourceSystem: z.string().optional()
})

const IdParam = z.object({ id: z.string() })
const DocumentIdParam = z.object({ documentId: z.string() })
const AllocationIdParam = z.object({ allocationId: z.string() })

interface FinancialDocumentDetails {
  document: FinancialDocument
  allocations: FinancialDocumentAllocation[]
}

interface FinancialRegisterRow extends FinancialReportRow {
  id: string
  allocationDate: string
  description: string | null
  transactionType: string
  foreignAmount: number | null
  exchangeRate: number | null
  citRate: number
  categoryName: string | null
}

export const listFinancialDocumentsFn = createServerFn({ method: "GET" })
  .inputValidator(DocumentFiltersSchema)
  .handler(
    async ({ data }): Promise<any> => backendGet<FinancialDocument[]>("/finance/documents", data)
  )

export const getFinancialDocumentFn = createServerFn({ method: "GET" })
  .inputValidator(IdParam)
  .handler(
    async ({ data }): Promise<any> =>
      backendGet<FinancialDocumentDetails>(`/finance/documents/${data.id}`)
  )

export const createFinancialDocumentFn = createServerFn({ method: "POST" })
  .inputValidator(DocumentInputSchema)
  .handler(
    async ({ data }): Promise<any> => backendPost<FinancialDocument>("/finance/documents", data)
  )

export const updateFinancialDocumentFn = createServerFn({ method: "POST" })
  .inputValidator(IdParam.extend({ data: DocumentInputSchema.partial() }))
  .handler(
    async ({ data }): Promise<any> =>
      backendPost<FinancialDocument>(`/finance/documents/${data.id}/update`, data.data)
  )

export const deleteFinancialDocumentFn = createServerFn({ method: "POST" })
  .inputValidator(IdParam.extend({ cascade: z.boolean().optional() }))
  .handler(
    async ({ data }): Promise<any> =>
      backendPost<{ success: boolean }>(`/finance/documents/${data.id}/delete`, {
        cascade: data.cascade
      })
  )

export const addDocumentAllocationFn = createServerFn({ method: "POST" })
  .inputValidator(DocumentIdParam.extend({ allocation: AllocationInputSchema }))
  .handler(
    async ({ data }): Promise<any> =>
      backendPost<FinancialDocumentAllocation>(
        `/finance/documents/${data.documentId}/allocations`,
        data.allocation
      )
  )

export const updateDocumentAllocationFn = createServerFn({ method: "POST" })
  .inputValidator(AllocationIdParam.extend({ allocation: AllocationInputSchema.partial() }))
  .handler(
    async ({ data }): Promise<any> =>
      backendPost<FinancialDocumentAllocation>(
        `/finance/allocations/${data.allocationId}/update`,
        data.allocation
      )
  )

export const deleteDocumentAllocationFn = createServerFn({ method: "POST" })
  .inputValidator(AllocationIdParam)
  .handler(
    async ({ data }): Promise<any> =>
      backendPost<{ success: boolean }>(`/finance/allocations/${data.allocationId}/delete`)
  )

export const splitDocumentByAmountsFn = createServerFn({ method: "POST" })
  .inputValidator(DocumentIdParam.extend({ allocations: z.array(AllocationInputSchema) }))
  .handler(
    async ({ data }): Promise<any> =>
      backendPost<FinancialDocumentAllocation[]>(
        `/finance/documents/${data.documentId}/split-amounts`,
        {
          allocations: data.allocations
        }
      )
  )

export const splitDocumentByPercentFn = createServerFn({ method: "POST" })
  .inputValidator(DocumentIdParam.extend({ allocations: z.array(PercentAllocationInputSchema) }))
  .handler(
    async ({ data }): Promise<any> =>
      backendPost<FinancialDocumentAllocation[]>(
        `/finance/documents/${data.documentId}/split-percent`,
        {
          allocations: data.allocations
        }
      )
  )

export const listFinancialCategoriesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<any> => backendGet<FinancialCategory[]>("/finance/categories")
)

const ReportFiltersSchema = z.object({
  year: z.coerce.number(),
  month: z.coerce.number(),
  projectId: z.string().optional(),
  clientId: z.string().optional()
})

export const getFinancialRegisterFn = createServerFn({ method: "GET" })
  .inputValidator(ReportFiltersSchema)
  .handler(
    async ({ data }): Promise<any> => backendGet<FinancialRegisterRow[]>("/finance/register", data)
  )

export const getFinancialFlowSummaryFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ from: z.string(), to: z.string() }))
  .handler(
    async ({ data }): Promise<any> => backendGet<FinancialFlowRow[]>("/finance/flow-summary", data)
  )

export const getProjectProfitabilityFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ year: z.coerce.number(), workspaceId: z.string() }))
  .handler(
    async ({ data }): Promise<any> =>
      backendGet<ProjectProfitabilityRow[]>("/finance/project-profitability", data)
  )

export const getProjectsMonthlySummaryFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ year: z.coerce.number(), month: z.coerce.number() }))
  .handler(
    async ({ data }): Promise<any> =>
      backendGet<FinancialReportRow[]>("/finance/monthly-summary", data)
  )

export const getProjectMonthlyReportFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({ projectId: z.string(), year: z.coerce.number(), month: z.coerce.number() })
  )
  .handler(
    async ({ data }): Promise<any> =>
      backendGet<FinancialReportRow>("/finance/project-monthly-report", data)
  )

export const getProjectYtdReportFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({ projectId: z.string(), year: z.coerce.number(), month: z.coerce.number() })
  )
  .handler(
    async ({ data }): Promise<any> =>
      backendGet<FinancialReportRow[]>("/finance/project-ytd-report", data)
  )

export const getUnallocatedDocumentsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<any> => backendGet<FinancialDocument[]>("/finance/documents-unallocated")
)

export const getPartiallyAllocatedDocumentsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<any> => backendGet<FinancialDocument[]>("/finance/documents-partial")
)

const ProductInputSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  defaultPurchasePrice: optionalNumber
})

const StockMovementInputSchema = z.object({
  productId: z.string(),
  projectId: z.string().optional().nullable(),
  financialDocumentId: z.string().optional().nullable(),
  allocationId: z.string().optional().nullable(),
  movementType: z.enum(STOCK_MOVEMENT_TYPES),
  movementDate: z.string(),
  quantity: z.coerce.number(),
  unitPrice: z.coerce.number(),
  description: z.string().optional().nullable()
})

export const listProductsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<any> => backendGet<Product[]>("/inventory/products")
)

export const createProductFn = createServerFn({ method: "POST" })
  .inputValidator(ProductInputSchema)
  .handler(async ({ data }): Promise<any> => backendPost<Product>("/inventory/products", data))

export const listStockMovementsFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ productId: z.string().optional(), projectId: z.string().optional() }))
  .handler(
    async ({ data }): Promise<any> => backendGet<StockMovement[]>("/inventory/movements", data)
  )

export const createStockMovementFn = createServerFn({ method: "POST" })
  .inputValidator(StockMovementInputSchema)
  .handler(
    async ({ data }): Promise<any> => backendPost<StockMovement>("/inventory/movements", data)
  )

export const getStockSummaryFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<any> => backendGet<StockSummaryRow[]>("/inventory/summary")
)

export const getEmployeeHourlyRatesFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ workspaceId: z.string() }))
  .handler(
    async ({ data }): Promise<any> =>
      backendGet<EmployeeHourlyRate[]>("/employees/hourly-rates", { workspaceId: data.workspaceId })
  )

export const updateEmployeeHourlyRateFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ employeeId: z.string(), hourlyRate: z.number().nullable() }))
  .handler(
    async ({ data }): Promise<any> =>
      backendPost<EmployeeHourlyRate | null>(`/employees/${data.employeeId}/hourly-rate`, {
        hourlyRate: data.hourlyRate
      })
  )

export const recalculateTimeEntryCostsFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<any> => backendPost<{ success: boolean }>("/time-entries/recalculate-costs")
)

const TimeCostFiltersSchema = z.object({
  workspaceId: z.string(),
  year: z.coerce.number().optional(),
  month: z.coerce.number().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional()
})

export const getTimeCostsByProjectFn = createServerFn({ method: "GET" })
  .inputValidator(TimeCostFiltersSchema)
  .handler(
    async ({ data }): Promise<any> =>
      backendGet<ProjectTimeCostSummary[]>("/time-costs/by-project", data)
  )

export const getTimeCostsByClientFn = createServerFn({ method: "GET" })
  .inputValidator(TimeCostFiltersSchema)
  .handler(
    async ({ data }): Promise<any> =>
      backendGet<ClientTimeCostSummary[]>("/time-costs/by-client", data)
  )

export const createStockMovementFromGoodsPurchaseFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      allocationId: z.string(),
      productId: z.string(),
      quantity: z.coerce.number(),
      unitPrice: z.coerce.number()
    })
  )
  .handler(
    async ({ data }): Promise<any> =>
      backendPost<StockMovement>("/inventory/movements/from-goods-purchase", data)
  )

export const createGoodsRealizationForProjectFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      productId: z.string(),
      projectId: z.string(),
      quantity: z.coerce.number(),
      unitPrice: z.coerce.number(),
      movementDate: z.string(),
      description: z.string().optional().nullable()
    })
  )
  .handler(
    async ({ data }): Promise<any> =>
      backendPost<StockMovement>("/inventory/movements/goods-realization", data)
  )

export const financeQueries = {
  documents: (filters: z.infer<typeof DocumentFiltersSchema> = {}) => ({
    queryKey: ["erp", "finance", "documents", JSON.stringify(filters)],
    queryFn: async () => (await listFinancialDocumentsFn({ data: filters })) as FinancialDocument[]
  }),
  document: (id: string) => ({
    queryKey: ["erp", "finance", "documents", id],
    queryFn: async () =>
      (await getFinancialDocumentFn({ data: { id } })) as FinancialDocumentDetails
  }),
  categories: () => ({
    queryKey: ["erp", "finance", "categories"],
    queryFn: async () => (await listFinancialCategoriesFn()) as FinancialCategory[]
  }),
  register: (filters: z.infer<typeof ReportFiltersSchema>) => ({
    queryKey: ["erp", "finance", "register", JSON.stringify(filters)],
    queryFn: async () => (await getFinancialRegisterFn({ data: filters })) as FinancialRegisterRow[]
  }),
  flowSummary: (from: string, to: string) => ({
    queryKey: ["erp", "finance", "flow", from, to],
    queryFn: async () =>
      (await getFinancialFlowSummaryFn({ data: { from, to } })) as FinancialFlowRow[]
  }),
  projectProfitability: (year: number, workspaceId: string) => ({
    queryKey: ["erp", "finance", "profitability", year, workspaceId],
    queryFn: async () =>
      (await getProjectProfitabilityFn({
        data: { year, workspaceId }
      })) as ProjectProfitabilityRow[]
  }),
  monthlySummary: (year: number, month: number) => ({
    queryKey: ["erp", "finance", "summary", year, month],
    queryFn: async () =>
      (await getProjectsMonthlySummaryFn({ data: { year, month } })) as FinancialReportRow[]
  }),
  unallocatedDocuments: () => ({
    queryKey: ["erp", "finance", "documents", "unallocated"],
    queryFn: async () => (await getUnallocatedDocumentsFn()) as FinancialDocument[]
  }),
  partiallyAllocatedDocuments: () => ({
    queryKey: ["erp", "finance", "documents", "partial"],
    queryFn: async () => (await getPartiallyAllocatedDocumentsFn()) as FinancialDocument[]
  }),
  products: () => ({
    queryKey: ["erp", "inventory", "products"],
    queryFn: async () => (await listProductsFn()) as Product[]
  }),
  stockMovements: () => ({
    queryKey: ["erp", "inventory", "movements"],
    queryFn: async () => (await listStockMovementsFn({ data: {} })) as StockMovement[]
  }),
  stockSummary: () => ({
    queryKey: ["erp", "inventory", "summary"],
    queryFn: async () => (await getStockSummaryFn()) as StockSummaryRow[]
  }),
  employeeHourlyRates: (workspaceId: string) => ({
    queryKey: ["erp", "employees", "hourly-rates", workspaceId],
    queryFn: async () =>
      (await getEmployeeHourlyRatesFn({ data: { workspaceId } })) as EmployeeHourlyRate[]
  }),
  timeCostsByProject: (
    workspaceId: string,
    filters?: { year?: number; month?: number; startDate?: string; endDate?: string }
  ) => ({
    queryKey: ["erp", "time-costs", "by-project", workspaceId, JSON.stringify(filters ?? {})],
    queryFn: async () =>
      (await getTimeCostsByProjectFn({
        data: { workspaceId, ...filters }
      })) as ProjectTimeCostSummary[]
  }),
  timeCostsByClient: (
    workspaceId: string,
    filters?: { year?: number; month?: number; startDate?: string; endDate?: string }
  ) => ({
    queryKey: ["erp", "time-costs", "by-client", workspaceId, JSON.stringify(filters ?? {})],
    queryFn: async () =>
      (await getTimeCostsByClientFn({
        data: { workspaceId, ...filters }
      })) as ClientTimeCostSummary[]
  })
}

export function useCreateFinancialDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: z.infer<typeof DocumentInputSchema>) =>
      (await createFinancialDocumentFn({ data })) as FinancialDocument,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["erp", "finance"] })
  })
}

export function useAddDocumentAllocation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { documentId: string; allocation: z.infer<typeof AllocationInputSchema> }) =>
      addDocumentAllocationFn({ data }) as Promise<FinancialDocumentAllocation>,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["erp", "finance"] })
  })
}

export function useCreateProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: z.infer<typeof ProductInputSchema>) =>
      (await createProductFn({ data })) as Product,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["erp", "inventory"] })
  })
}

export function useCreateStockMovement() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: z.infer<typeof StockMovementInputSchema>) =>
      (await createStockMovementFn({ data })) as StockMovement,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["erp", "inventory"] })
  })
}

export function useUpdateEmployeeHourlyRate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: { employeeId: string; hourlyRate: number | null }) =>
      (await updateEmployeeHourlyRateFn({ data })) as EmployeeHourlyRate | null,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["erp", "employees"] })
      await queryClient.invalidateQueries({ queryKey: ["erp", "time-costs"] })
    }
  })
}
