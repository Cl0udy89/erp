import { describe, expect, it } from "vitest"

import {
  calculateAllocationFinancials,
  calculateDocumentAllocationStatus,
  monthRange
} from "#/lib/finance-domain"

describe("finance domain calculations", () => {
  it("calculates service revenue with CIT", () => {
    const result = calculateAllocationFinancials({ revenueAmount: 1000, citRate: 0.09 })

    expect(result.profit).toBe(1000)
    expect(result.taxEffect).toBe(90)
    expect(result.taxPayable).toBe(90)
    expect(result.profitAfterTax).toBe(910)
  })

  it("calculates cost and does not create negative tax payable", () => {
    const result = calculateAllocationFinancials({ serviceCostNet: 500, citRate: 0.09 })

    expect(result.profit).toBe(-500)
    expect(result.taxEffect).toBe(-45)
    expect(result.taxPayable).toBe(0)
    expect(result.profitAfterTax).toBe(-500)
  })

  it("calculates foreign revenue", () => {
    const result = calculateAllocationFinancials({
      foreignAmount: 100,
      exchangeRate: 4.23,
      citRate: 0.09
    })

    expect(result.revenueAmountPln).toBe(423)
  })

  it("does not reduce profit by goods purchase cost", () => {
    const result = calculateAllocationFinancials({
      goodsPurchaseCost: 1000,
      realizedGoodsCost: 0
    })

    expect(result.profit).toBe(0)
    expect(result.stockingValue).toBe(1000)
  })

  it("reduces profit and stocking by realized goods cost", () => {
    const result = calculateAllocationFinancials({
      realizedGoodsCost: 300
    })

    expect(result.profit).toBe(-300)
    expect(result.stockingValue).toBe(-300)
  })

  it("marks document split across projects as fully allocated", () => {
    const result = calculateDocumentAllocationStatus({
      netAmountPln: 1000,
      allocationAmounts: [400, 600]
    })

    expect(result.allocationStatus).toBe("FULLY_ALLOCATED")
    expect(result.remainingAmount).toBe(0)
  })

  it("marks document as partially allocated", () => {
    const result = calculateDocumentAllocationStatus({
      netAmountPln: 1000,
      allocationAmounts: [300]
    })

    expect(result.allocationStatus).toBe("PARTIALLY_ALLOCATED")
    expect(result.remainingAmount).toBe(700)
  })

  it("marks document as over allocated", () => {
    const result = calculateDocumentAllocationStatus({
      netAmountPln: 1000,
      allocationAmounts: [800, 500]
    })

    expect(result.allocationStatus).toBe("OVER_ALLOCATED")
    expect(result.remainingAmount).toBe(-300)
  })

  it("creates month and YTD ranges without mixing months", () => {
    expect(monthRange(2025, 3)).toEqual({
      from: "2025-03-01",
      to: "2025-03-31",
      ytdFrom: "2025-01-01"
    })
  })
})
