import type { AllocationStatus } from "#/lib/finance-types"

const DEFAULT_CIT_RATE = 0.09
const MONEY_TOLERANCE = 0.01

export interface AllocationFinancialInput {
  revenueAmount?: number | null
  goodsPurchaseCost?: number | null
  serviceCostNet?: number | null
  realizedGoodsCost?: number | null
  otherOperatingCost?: number | null
  foreignAmount?: number | null
  exchangeRate?: number | null
  citRate?: number | null
}

export interface AllocationFinancials {
  revenueAmountPln: number
  profit: number
  taxEffect: number
  taxPayable: number
  profitAfterTax: number
  stockingValue: number
  profitWithoutGoods: number
}

export interface DocumentAllocationStatusInput {
  netAmountPln: number
  allocationAmounts: number[]
}

export interface DocumentAllocationStatus {
  totalNetAmount: number
  allocatedAmount: number
  remainingAmount: number
  allocationStatus: AllocationStatus
}

export function money(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 0
  return Math.round(Number(value) * 100) / 100
}

export function calculateAllocationFinancials(
  allocation: AllocationFinancialInput
): AllocationFinancials {
  const exchangeRate = money(allocation.exchangeRate)
  const foreignAmount = money(allocation.foreignAmount)
  const revenueAmount = money(allocation.revenueAmount)
  const revenueAmountPln =
    foreignAmount !== 0 && exchangeRate !== 0 ? money(foreignAmount * exchangeRate) : revenueAmount

  const serviceCostNet = money(allocation.serviceCostNet)
  const goodsPurchaseCost = money(allocation.goodsPurchaseCost)
  const realizedGoodsCost = money(allocation.realizedGoodsCost)
  const otherOperatingCost = money(allocation.otherOperatingCost)
  const citRate = Number.isFinite(allocation.citRate)
    ? Number(allocation.citRate)
    : DEFAULT_CIT_RATE

  const profit = money(revenueAmountPln - serviceCostNet - realizedGoodsCost - otherOperatingCost)
  const taxEffect = money(profit * citRate)
  const taxPayable = money(Math.max(0, taxEffect))
  const profitAfterTax = money(profit - taxPayable)
  const stockingValue = money(goodsPurchaseCost - realizedGoodsCost)
  const profitWithoutGoods = money(profit + stockingValue)

  return {
    revenueAmountPln,
    profit,
    taxEffect,
    taxPayable,
    profitAfterTax,
    stockingValue,
    profitWithoutGoods
  }
}

export function calculateDocumentAllocationStatus(
  document: DocumentAllocationStatusInput
): DocumentAllocationStatus {
  const totalNetAmount = money(document.netAmountPln)
  const allocatedAmount = money(
    document.allocationAmounts.reduce((sum, item) => sum + money(item), 0)
  )
  const remainingAmount = money(totalNetAmount - allocatedAmount)

  let allocationStatus: AllocationStatus = "NOT_ALLOCATED"
  if (allocatedAmount > totalNetAmount + MONEY_TOLERANCE) {
    allocationStatus = "OVER_ALLOCATED"
  } else if (Math.abs(remainingAmount) <= MONEY_TOLERANCE && allocatedAmount > 0) {
    allocationStatus = "FULLY_ALLOCATED"
  } else if (allocatedAmount > MONEY_TOLERANCE) {
    allocationStatus = "PARTIALLY_ALLOCATED"
  }

  return {
    totalNetAmount,
    allocatedAmount,
    remainingAmount,
    allocationStatus
  }
}

export function allocationTotalAmount(allocation: AllocationFinancialInput) {
  const financials = calculateAllocationFinancials(allocation)
  return money(
    Math.abs(financials.revenueAmountPln) +
      money(allocation.goodsPurchaseCost) +
      money(allocation.serviceCostNet) +
      money(allocation.realizedGoodsCost) +
      money(allocation.otherOperatingCost)
  )
}

export function calculateTimeEntryCost(
  durationSeconds: number | null | undefined,
  hourlyRate: number | null | undefined
): number {
  if (!durationSeconds || !hourlyRate || hourlyRate <= 0) return 0
  return money((durationSeconds / 3600) * hourlyRate)
}

export function monthRange(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 0))
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    ytdFrom: `${year}-01-01`
  }
}
