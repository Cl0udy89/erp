export const DOCUMENT_TYPES = [
  "SALES_INVOICE",
  "COST_INVOICE",
  "CONTRACTOR_BILL",
  "INTERNAL_DOCUMENT",
  "VIRTUAL_REVENUE",
  "VIRTUAL_COST",
  "STOCK_DOCUMENT",
  "OTHER"
] as const

export const SOURCE_SYSTEMS = [
  "MANUAL",
  "CLOCKIFY",
  "EXTERNAL_ERP",
  "KSEF",
  "IMPORT",
  "SYSTEM"
] as const

export const IMPORT_STATUSES = [
  "MANUAL",
  "IMPORTED",
  "NEEDS_REVIEW",
  "ACCEPTED",
  "REJECTED"
] as const

export const ALLOCATION_STATUSES = [
  "NOT_ALLOCATED",
  "PARTIALLY_ALLOCATED",
  "FULLY_ALLOCATED",
  "OVER_ALLOCATED"
] as const

export const TRANSACTION_TYPES = [
  "SERVICE_REVENUE",
  "COST",
  "VIRTUAL_REVENUE",
  "VIRTUAL_COST",
  "GOODS_PURCHASE",
  "GOODS_REALIZATION",
  "OTHER_OPERATING_COST",
  "CONTRACTOR_COST"
] as const

export const STOCK_MOVEMENT_TYPES = [
  "OPENING_BALANCE",
  "PURCHASE",
  "ISSUE_TO_PROJECT",
  "SALE",
  "CORRECTION",
  "RETURN"
] as const

export type DocumentType = (typeof DOCUMENT_TYPES)[number]
export type SourceSystem = (typeof SOURCE_SYSTEMS)[number]
export type ImportStatus = (typeof IMPORT_STATUSES)[number]
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number]
export type TransactionType = (typeof TRANSACTION_TYPES)[number]
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number]

export interface FinancialDocument {
  id: string
  documentNumber: string | null
  documentName: string | null
  documentType: DocumentType
  sourceSystem: SourceSystem
  externalId: string | null
  contractorName: string | null
  contractorTaxId: string | null
  issueDate: string | null
  saleDate: string | null
  receivedDate: string | null
  accountingDate: string
  currencyCode: string
  netAmount: number
  vatAmount: number
  grossAmount: number
  exchangeRate: number | null
  netAmountPln: number
  vatAmountPln: number
  grossAmountPln: number
  description: string | null
  fileUrl: string | null
  importStatus: ImportStatus
  allocationStatus: AllocationStatus
  rawPayload: unknown
  allocatedAmount: number
  remainingAmount: number
  createdAt: string
  updatedAt: string
}

export interface FinancialDocumentAllocation {
  id: string
  financialDocumentId: string
  projectId: string
  projectName: string | null
  clientId: string | null
  clientName: string | null
  employeeId: string | null
  employeeName: string | null
  allocationDate: string
  transactionType: TransactionType
  categoryId: string | null
  categoryName: string | null
  description: string | null
  notes: string | null
  revenueAmount: number
  revenueAmountPln: number
  goodsPurchaseCost: number
  serviceCostNet: number
  realizedGoodsCost: number
  otherOperatingCost: number
  foreignAmount: number | null
  currencyCode: string | null
  exchangeRate: number | null
  citRate: number
  taxEffect: number
  taxPayable: number
  profit: number
  profitAfterTax: number
  createdAt: string
  updatedAt: string
}

export interface FinancialCategory {
  id: string
  name: string
  code: string
  description: string | null
  isActive: boolean
}

export interface FinancialReportRow {
  projectId: string
  projectName: string
  clientId: string | null
  clientName: string | null
  revenueAmountPln: number
  goodsPurchaseCost: number
  serviceCostNet: number
  realizedGoodsCost: number
  otherOperatingCost: number
  profit: number
  taxEffect: number
  taxPayable: number
  profitAfterTax: number
  stockingValue: number
  profitWithoutGoods: number
  ytdProfit: number
}

export interface Product {
  id: string
  name: string
  sku: string | null
  description: string | null
  defaultPurchasePrice: number
  isActive: boolean
}

export interface StockMovement {
  id: string
  productId: string
  productName: string | null
  projectId: string | null
  projectName: string | null
  financialDocumentId: string | null
  allocationId: string | null
  movementType: StockMovementType
  movementDate: string
  quantity: number
  unitPrice: number
  totalValue: number
  description: string | null
}

export interface StockSummaryRow {
  productId: string
  productName: string
  sku: string | null
  quantityOnHand: number
  stockValue: number
}

export interface FinancialFlowRow {
  period: string
  revenue: number
  goodsPurchaseCost: number
  serviceCostNet: number
  realizedGoodsCost: number
  otherOperatingCost: number
  profit: number
  taxPayable: number
  profitAfterTax: number
}

export interface EmployeeHourlyRate {
  employeeId: string
  employeeName: string
  hourlyRate: number | null
}

export interface ProjectTimeCostSummary {
  projectId: string
  projectName: string
  clientId: string | null
  clientName: string | null
  totalSeconds: number
  estimatedCost: number
}

export interface ClientTimeCostSummary {
  clientId: string | null
  clientName: string | null
  totalSeconds: number
  estimatedCost: number
}

export interface ProjectProfitabilityRow {
  projectId: string
  projectName: string
  clientName: string | null
  revenue: number
  costs: number
  profit: number
}

export type MatchMethod = "nip" | "name" | "name_birthdate" | "none"
