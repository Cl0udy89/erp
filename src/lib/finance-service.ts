import type { RowDataPacket, ResultSetHeader } from "mysql2/promise"

import { dbExecute, dbQuery, getDbPool } from "#/lib/db"
import {
  allocationTotalAmount,
  calculateAllocationFinancials,
  calculateDocumentAllocationStatus,
  money,
  monthRange
} from "#/lib/finance-domain"
import type {
  AllocationStatus,
  ClientTimeCostSummary,
  DocumentType,
  EmployeeHourlyRate,
  FinancialCategory,
  FinancialDocument,
  FinancialDocumentAllocation,
  FinancialFlowRow,
  FinancialReportRow,
  ImportStatus,
  Product,
  ProjectProfitabilityRow,
  ProjectTimeCostSummary,
  SourceSystem,
  StockMovement,
  StockMovementType,
  StockSummaryRow,
  TransactionType
} from "#/lib/finance-types"

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`

interface DocumentRow extends RowDataPacket {
  id: string
  document_number: string | null
  document_name: string | null
  document_type: DocumentType
  source_system: SourceSystem
  external_id: string | null
  contractor_name: string | null
  contractor_tax_id: string | null
  issue_date: Date | string | null
  sale_date: Date | string | null
  received_date: Date | string | null
  accounting_date: Date | string
  currency_code: string
  net_amount: number
  vat_amount: number
  gross_amount: number
  exchange_rate: number | null
  net_amount_pln: number
  vat_amount_pln: number
  gross_amount_pln: number
  description: string | null
  file_url: string | null
  import_status: ImportStatus
  allocation_status: AllocationStatus
  raw_payload: unknown
  allocated_amount: number | null
  remaining_amount: number | null
  created_at: Date | string
  updated_at: Date | string
}

interface AllocationRow extends RowDataPacket {
  id: string
  financial_document_id: string
  project_id: string
  project_name: string | null
  client_id: string | null
  client_name: string | null
  employee_id: string | null
  employee_name: string | null
  allocation_date: Date | string
  transaction_type: TransactionType
  category_id: string | null
  category_name: string | null
  description: string | null
  notes: string | null
  revenue_amount: number
  revenue_amount_pln: number
  goods_purchase_cost: number
  service_cost_net: number
  realized_goods_cost: number
  other_operating_cost: number
  foreign_amount: number | null
  currency_code: string | null
  exchange_rate: number | null
  cit_rate: number
  tax_effect: number
  tax_payable: number
  profit: number
  profit_after_tax: number
  created_at: Date | string
  updated_at: Date | string
}

interface CategoryRow extends RowDataPacket {
  id: string
  name: string
  code: string
  description: string | null
  is_active: number | boolean
}

interface ProductRow extends RowDataPacket {
  id: string
  name: string
  sku: string | null
  description: string | null
  default_purchase_price: number
  is_active: number | boolean
}

interface StockMovementRow extends RowDataPacket {
  id: string
  product_id: string
  product_name: string | null
  project_id: string | null
  project_name: string | null
  financial_document_id: string | null
  allocation_id: string | null
  movement_type: StockMovementType
  movement_date: Date | string
  quantity: number
  unit_price: number
  total_value: number
  description: string | null
}

interface ReportRow extends RowDataPacket {
  project_id: string
  project_name: string
  client_id: string | null
  client_name: string | null
  revenue_amount_pln: number
  goods_purchase_cost: number
  service_cost_net: number
  realized_goods_cost: number
  other_operating_cost: number
  profit: number
  tax_effect: number
  tax_payable: number
  profit_after_tax: number
  ytd_profit: number | null
}

interface StockSummaryDbRow extends RowDataPacket {
  product_id: string
  product_name: string
  sku: string | null
  quantity_on_hand: number
  stock_value: number
}

interface _FlowRow extends RowDataPacket {
  period: string
  revenue_amount_pln: number
  goods_purchase_cost: number
  service_cost_net: number
  realized_goods_cost: number
  other_operating_cost: number
  profit: number
  tax_payable: number
  profit_after_tax: number
}

export interface CreateFinancialDocumentInput {
  documentNumber?: string | null
  documentName?: string | null
  documentType: DocumentType
  sourceSystem?: SourceSystem
  externalId?: string | null
  contractorName?: string | null
  contractorTaxId?: string | null
  issueDate?: string | null
  saleDate?: string | null
  receivedDate?: string | null
  accountingDate: string
  currencyCode?: string
  netAmount?: number
  vatAmount?: number
  grossAmount?: number
  exchangeRate?: number | null
  description?: string | null
  fileUrl?: string | null
  importStatus?: ImportStatus
  rawPayload?: unknown
}

export interface CreateAllocationInput {
  projectId: string
  clientId?: string | null
  employeeId?: string | null
  allocationDate: string
  transactionType: TransactionType
  categoryId?: string | null
  description?: string | null
  notes?: string | null
  revenueAmount?: number | null
  goodsPurchaseCost?: number | null
  serviceCostNet?: number | null
  realizedGoodsCost?: number | null
  otherOperatingCost?: number | null
  foreignAmount?: number | null
  currencyCode?: string | null
  exchangeRate?: number | null
  citRate?: number | null
}

export interface PercentAllocationInput extends CreateAllocationInput {
  percent: number
  targetField?:
    | "revenueAmount"
    | "goodsPurchaseCost"
    | "serviceCostNet"
    | "realizedGoodsCost"
    | "otherOperatingCost"
}

function isoDate(value: Date | string | null) {
  if (!value) return null
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : new Date(value).toISOString().slice(0, 10)
}

function isoDateTime(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function bool(value: number | boolean) {
  return value === true || value === 1
}

function plnAmount(
  amount: number | null | undefined,
  currencyCode?: string,
  exchangeRate?: number | null
) {
  const value = money(amount)
  if ((currencyCode ?? "PLN") === "PLN") return value
  return exchangeRate ? money(value * exchangeRate) : value
}

function mapDocument(row: DocumentRow): FinancialDocument {
  return {
    id: row.id,
    documentNumber: row.document_number,
    documentName: row.document_name,
    documentType: row.document_type,
    sourceSystem: row.source_system,
    externalId: row.external_id,
    contractorName: row.contractor_name,
    contractorTaxId: row.contractor_tax_id,
    issueDate: isoDate(row.issue_date),
    saleDate: isoDate(row.sale_date),
    receivedDate: isoDate(row.received_date),
    accountingDate: isoDate(row.accounting_date) ?? "",
    currencyCode: row.currency_code,
    netAmount: money(row.net_amount),
    vatAmount: money(row.vat_amount),
    grossAmount: money(row.gross_amount),
    exchangeRate: row.exchange_rate,
    netAmountPln: money(row.net_amount_pln),
    vatAmountPln: money(row.vat_amount_pln),
    grossAmountPln: money(row.gross_amount_pln),
    description: row.description,
    fileUrl: row.file_url,
    importStatus: row.import_status,
    allocationStatus: row.allocation_status,
    rawPayload: row.raw_payload,
    allocatedAmount: money(row.allocated_amount),
    remainingAmount: money(row.remaining_amount),
    createdAt: isoDateTime(row.created_at),
    updatedAt: isoDateTime(row.updated_at)
  }
}

function mapAllocation(row: AllocationRow): FinancialDocumentAllocation {
  return {
    id: row.id,
    financialDocumentId: row.financial_document_id,
    projectId: row.project_id,
    projectName: row.project_name,
    clientId: row.client_id,
    clientName: row.client_name,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    allocationDate: isoDate(row.allocation_date) ?? "",
    transactionType: row.transaction_type,
    categoryId: row.category_id,
    categoryName: row.category_name,
    description: row.description,
    notes: row.notes,
    revenueAmount: money(row.revenue_amount),
    revenueAmountPln: money(row.revenue_amount_pln),
    goodsPurchaseCost: money(row.goods_purchase_cost),
    serviceCostNet: money(row.service_cost_net),
    realizedGoodsCost: money(row.realized_goods_cost),
    otherOperatingCost: money(row.other_operating_cost),
    foreignAmount: row.foreign_amount == null ? null : money(row.foreign_amount),
    currencyCode: row.currency_code,
    exchangeRate: row.exchange_rate,
    citRate: Number(row.cit_rate),
    taxEffect: money(row.tax_effect),
    taxPayable: money(row.tax_payable),
    profit: money(row.profit),
    profitAfterTax: money(row.profit_after_tax),
    createdAt: isoDateTime(row.created_at),
    updatedAt: isoDateTime(row.updated_at)
  }
}

function documentSelect() {
  return `
    SELECT
      d.*,
      COALESCE(SUM(
        ABS(a.revenue_amount_pln) +
        a.goods_purchase_cost +
        a.service_cost_net +
        a.realized_goods_cost +
        a.other_operating_cost
      ), 0) AS allocated_amount,
      d.net_amount_pln - COALESCE(SUM(
        ABS(a.revenue_amount_pln) +
        a.goods_purchase_cost +
        a.service_cost_net +
        a.realized_goods_cost +
        a.other_operating_cost
      ), 0) AS remaining_amount
    FROM erp_financial_documents d
    LEFT JOIN erp_financial_document_allocations a ON a.financial_document_id = d.id
  `
}

function allocationSelect() {
  return `
    SELECT
      a.*,
      p.name AS project_name,
      c.name AS client_name,
      e.name AS employee_name,
      fc.name AS category_name
    FROM erp_financial_document_allocations a
    JOIN erp_projects p ON p.id = a.project_id
    LEFT JOIN erp_clients c ON c.id = a.client_id
    LEFT JOIN erp_employees e ON e.id = a.employee_id
    LEFT JOIN erp_financial_categories fc ON fc.id = a.category_id
  `
}

export async function listFinancialDocuments(
  filters: {
    year?: number
    month?: number
    documentType?: string
    contractor?: string
    allocationStatus?: string
    projectId?: string
    sourceSystem?: string
  } = {}
) {
  const where: string[] = []
  const values: unknown[] = []
  let joinProject = ""

  if (filters.year && filters.month) {
    const range = monthRange(filters.year, filters.month)
    where.push("d.accounting_date BETWEEN ? AND ?")
    values.push(range.from, range.to)
  }
  if (filters.documentType) {
    where.push("d.document_type = ?")
    values.push(filters.documentType)
  }
  if (filters.contractor) {
    where.push("d.contractor_name LIKE ?")
    values.push(`%${filters.contractor}%`)
  }
  if (filters.allocationStatus) {
    where.push("d.allocation_status = ?")
    values.push(filters.allocationStatus)
  }
  if (filters.sourceSystem) {
    where.push("d.source_system = ?")
    values.push(filters.sourceSystem)
  }
  if (filters.projectId) {
    joinProject = "JOIN erp_financial_document_allocations ap ON ap.financial_document_id = d.id"
    where.push("ap.project_id = ?")
    values.push(filters.projectId)
  }

  const rows = await dbQuery<DocumentRow[]>(
    `
      ${documentSelect()}
      ${joinProject}
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY d.id
      ORDER BY d.accounting_date DESC, d.created_at DESC
    `,
    values
  )
  return rows.map(mapDocument)
}

export async function getFinancialDocument(idValue: string) {
  const rows = await dbQuery<DocumentRow[]>(
    `
      ${documentSelect()}
      WHERE d.id = ?
      GROUP BY d.id
    `,
    [idValue]
  )
  const document = rows[0] ? mapDocument(rows[0]) : null
  if (!document) return null
  const allocations = await listDocumentAllocations(idValue)
  return { document, allocations }
}

export async function createFinancialDocument(input: CreateFinancialDocumentInput) {
  if (!input.documentType) throw new Error("Document type is required")
  if (!input.accountingDate) throw new Error("Accounting date is required")
  if (!input.documentNumber && !input.documentName)
    throw new Error("Document number or name is required")

  const currencyCode = input.currencyCode ?? "PLN"
  const netAmount = money(input.netAmount)
  const vatAmount = money(input.vatAmount)
  const grossAmount =
    input.grossAmount == null ? money(netAmount + vatAmount) : money(input.grossAmount)
  const documentId = id("doc")

  await dbExecute(
    `
      INSERT INTO erp_financial_documents (
        id, document_number, document_name, document_type, source_system, external_id,
        contractor_name, contractor_tax_id, issue_date, sale_date, received_date, accounting_date,
        currency_code, net_amount, vat_amount, gross_amount, exchange_rate, net_amount_pln,
        vat_amount_pln, gross_amount_pln, description, file_url, import_status, allocation_status,
        raw_payload
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOT_ALLOCATED', ?)
    `,
    [
      documentId,
      input.documentNumber ?? null,
      input.documentName ?? null,
      input.documentType,
      input.sourceSystem ?? "MANUAL",
      input.externalId ?? null,
      input.contractorName ?? null,
      input.contractorTaxId ?? null,
      input.issueDate ?? null,
      input.saleDate ?? null,
      input.receivedDate ?? null,
      input.accountingDate,
      currencyCode,
      netAmount,
      vatAmount,
      grossAmount,
      input.exchangeRate ?? null,
      plnAmount(netAmount, currencyCode, input.exchangeRate),
      plnAmount(vatAmount, currencyCode, input.exchangeRate),
      plnAmount(grossAmount, currencyCode, input.exchangeRate),
      input.description ?? null,
      input.fileUrl ?? null,
      input.importStatus ?? "MANUAL",
      input.rawPayload == null ? null : JSON.stringify(input.rawPayload)
    ]
  )

  const created = await getFinancialDocument(documentId)
  if (!created) throw new Error("Failed to create financial document")
  return created.document
}

export async function updateFinancialDocument(
  idValue: string,
  input: Partial<CreateFinancialDocumentInput>
) {
  const current = await getFinancialDocument(idValue)
  if (!current) throw new Error("Financial document not found")

  const next = {
    ...current.document,
    ...input
  }
  const currencyCode = input.currencyCode ?? next.currencyCode
  const exchangeRate = input.exchangeRate ?? next.exchangeRate
  const netAmount = money(input.netAmount ?? next.netAmount)
  const vatAmount = money(input.vatAmount ?? next.vatAmount)
  const grossAmount = money(input.grossAmount ?? next.grossAmount)

  await dbExecute(
    `
      UPDATE erp_financial_documents
      SET
        document_number = ?,
        document_name = ?,
        document_type = ?,
        source_system = ?,
        external_id = ?,
        contractor_name = ?,
        contractor_tax_id = ?,
        issue_date = ?,
        sale_date = ?,
        received_date = ?,
        accounting_date = ?,
        currency_code = ?,
        net_amount = ?,
        vat_amount = ?,
        gross_amount = ?,
        exchange_rate = ?,
        net_amount_pln = ?,
        vat_amount_pln = ?,
        gross_amount_pln = ?,
        description = ?,
        file_url = ?,
        import_status = ?,
        raw_payload = ?
      WHERE id = ?
    `,
    [
      next.documentNumber,
      next.documentName,
      next.documentType,
      next.sourceSystem,
      next.externalId,
      next.contractorName,
      next.contractorTaxId,
      next.issueDate,
      next.saleDate,
      next.receivedDate,
      next.accountingDate,
      currencyCode,
      netAmount,
      vatAmount,
      grossAmount,
      exchangeRate,
      plnAmount(netAmount, currencyCode, exchangeRate),
      plnAmount(vatAmount, currencyCode, exchangeRate),
      plnAmount(grossAmount, currencyCode, exchangeRate),
      next.description,
      next.fileUrl,
      next.importStatus,
      next.rawPayload == null ? null : JSON.stringify(next.rawPayload),
      idValue
    ]
  )
  await refreshDocumentAllocationStatus(idValue)
  return getFinancialDocument(idValue)
}

export async function deleteFinancialDocument(idValue: string, cascade = false) {
  const allocations = await listDocumentAllocations(idValue)
  if (allocations.length > 0 && !cascade) {
    throw new Error("Document has allocations. Delete with cascade confirmation.")
  }
  await dbExecute("DELETE FROM erp_financial_documents WHERE id = ?", [idValue])
  return { success: true }
}

export async function listDocumentAllocations(documentId: string) {
  const rows = await dbQuery<AllocationRow[]>(
    `
      ${allocationSelect()}
      WHERE a.financial_document_id = ?
      ORDER BY a.allocation_date ASC, a.created_at ASC
    `,
    [documentId]
  )
  return rows.map(mapAllocation)
}

async function inferClientId(projectId: string, explicitClientId?: string | null) {
  if (explicitClientId !== undefined) return explicitClientId
  const rows = await dbQuery<Array<RowDataPacket & { client_id: string | null }>>(
    "SELECT client_id FROM erp_projects WHERE id = ?",
    [projectId]
  )
  return rows[0]?.client_id ?? null
}

export async function addDocumentAllocation(documentId: string, input: CreateAllocationInput) {
  if (!input.projectId) throw new Error("Project is required")
  if (!input.allocationDate) throw new Error("Allocation date is required")
  if (!input.transactionType) throw new Error("Transaction type is required")
  if (allocationTotalAmount(input) === 0)
    throw new Error("At least one financial amount is required")

  const allocationId = id("alloc")
  const financials = calculateAllocationFinancials(input)
  const clientId = await inferClientId(input.projectId, input.clientId)

  await dbExecute(
    `
      INSERT INTO erp_financial_document_allocations (
        id, financial_document_id, project_id, client_id, employee_id, allocation_date,
        transaction_type, category_id, description, notes, revenue_amount, revenue_amount_pln,
        goods_purchase_cost, service_cost_net, realized_goods_cost, other_operating_cost,
        foreign_amount, currency_code, exchange_rate, cit_rate, tax_effect, tax_payable,
        profit, profit_after_tax
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      allocationId,
      documentId,
      input.projectId,
      clientId,
      input.employeeId ?? null,
      input.allocationDate,
      input.transactionType,
      input.categoryId ?? null,
      input.description ?? null,
      input.notes ?? null,
      money(input.revenueAmount),
      financials.revenueAmountPln,
      money(input.goodsPurchaseCost),
      money(input.serviceCostNet),
      money(input.realizedGoodsCost),
      money(input.otherOperatingCost),
      input.foreignAmount ?? null,
      input.currencyCode ?? null,
      input.exchangeRate ?? null,
      input.citRate ?? 0.09,
      financials.taxEffect,
      financials.taxPayable,
      financials.profit,
      financials.profitAfterTax
    ]
  )

  await refreshDocumentAllocationStatus(documentId)
  const rows = await dbQuery<AllocationRow[]>(`${allocationSelect()} WHERE a.id = ?`, [
    allocationId
  ])
  return mapAllocation(rows[0]!)
}

export async function updateDocumentAllocation(
  allocationId: string,
  input: Partial<CreateAllocationInput>
) {
  const rows = await dbQuery<AllocationRow[]>(`${allocationSelect()} WHERE a.id = ?`, [
    allocationId
  ])
  const current = rows[0]
  if (!current) throw new Error("Allocation not found")

  const next = {
    projectId: input.projectId ?? current.project_id,
    clientId: input.clientId ?? current.client_id,
    employeeId: input.employeeId ?? current.employee_id,
    allocationDate: input.allocationDate ?? isoDate(current.allocation_date) ?? "",
    transactionType: input.transactionType ?? current.transaction_type,
    categoryId: input.categoryId ?? current.category_id,
    description: input.description ?? current.description,
    notes: input.notes ?? current.notes,
    revenueAmount: input.revenueAmount ?? current.revenue_amount,
    goodsPurchaseCost: input.goodsPurchaseCost ?? current.goods_purchase_cost,
    serviceCostNet: input.serviceCostNet ?? current.service_cost_net,
    realizedGoodsCost: input.realizedGoodsCost ?? current.realized_goods_cost,
    otherOperatingCost: input.otherOperatingCost ?? current.other_operating_cost,
    foreignAmount: input.foreignAmount ?? current.foreign_amount,
    currencyCode: input.currencyCode ?? current.currency_code,
    exchangeRate: input.exchangeRate ?? current.exchange_rate,
    citRate: input.citRate ?? current.cit_rate
  }
  const financials = calculateAllocationFinancials(next)

  await dbExecute(
    `
      UPDATE erp_financial_document_allocations
      SET
        project_id = ?,
        client_id = ?,
        employee_id = ?,
        allocation_date = ?,
        transaction_type = ?,
        category_id = ?,
        description = ?,
        notes = ?,
        revenue_amount = ?,
        revenue_amount_pln = ?,
        goods_purchase_cost = ?,
        service_cost_net = ?,
        realized_goods_cost = ?,
        other_operating_cost = ?,
        foreign_amount = ?,
        currency_code = ?,
        exchange_rate = ?,
        cit_rate = ?,
        tax_effect = ?,
        tax_payable = ?,
        profit = ?,
        profit_after_tax = ?
      WHERE id = ?
    `,
    [
      next.projectId,
      next.clientId,
      next.employeeId,
      next.allocationDate,
      next.transactionType,
      next.categoryId,
      next.description,
      next.notes,
      money(next.revenueAmount),
      financials.revenueAmountPln,
      money(next.goodsPurchaseCost),
      money(next.serviceCostNet),
      money(next.realizedGoodsCost),
      money(next.otherOperatingCost),
      next.foreignAmount,
      next.currencyCode,
      next.exchangeRate,
      next.citRate,
      financials.taxEffect,
      financials.taxPayable,
      financials.profit,
      financials.profitAfterTax,
      allocationId
    ]
  )

  await refreshDocumentAllocationStatus(current.financial_document_id)
  const updated = await dbQuery<AllocationRow[]>(`${allocationSelect()} WHERE a.id = ?`, [
    allocationId
  ])
  return mapAllocation(updated[0]!)
}

export async function deleteDocumentAllocation(allocationId: string) {
  const rows = await dbQuery<Array<RowDataPacket & { financial_document_id: string }>>(
    "SELECT financial_document_id FROM erp_financial_document_allocations WHERE id = ?",
    [allocationId]
  )
  const documentId = rows[0]?.financial_document_id
  await dbExecute("DELETE FROM erp_financial_document_allocations WHERE id = ?", [allocationId])
  if (documentId) await refreshDocumentAllocationStatus(documentId)
  return { success: true }
}

export async function splitDocumentByAmounts(
  documentId: string,
  allocations: CreateAllocationInput[]
) {
  const created: FinancialDocumentAllocation[] = []
  for (const allocation of allocations) {
    created.push(await addDocumentAllocation(documentId, allocation))
  }
  return created
}

export async function splitDocumentByPercent(
  documentId: string,
  allocations: PercentAllocationInput[]
) {
  const details = await getFinancialDocument(documentId)
  if (!details) throw new Error("Financial document not found")

  const created: FinancialDocumentAllocation[] = []
  for (const allocation of allocations) {
    const targetField = allocation.targetField ?? "serviceCostNet"
    const amount = money(details.document.netAmountPln * (allocation.percent / 100))
    created.push(
      await addDocumentAllocation(documentId, {
        ...allocation,
        [targetField]: amount
      })
    )
  }
  return created
}

export async function refreshDocumentAllocationStatus(documentId: string) {
  const documentRows = await dbQuery<Array<RowDataPacket & { net_amount_pln: number }>>(
    "SELECT net_amount_pln FROM erp_financial_documents WHERE id = ?",
    [documentId]
  )
  const document = documentRows[0]
  if (!document) return
  const allocationRows = await dbQuery<Array<RowDataPacket & { amount: number }>>(
    `
      SELECT
        ABS(revenue_amount_pln) +
        goods_purchase_cost +
        service_cost_net +
        realized_goods_cost +
        other_operating_cost AS amount
      FROM erp_financial_document_allocations
      WHERE financial_document_id = ?
    `,
    [documentId]
  )
  const status = calculateDocumentAllocationStatus({
    netAmountPln: document.net_amount_pln,
    allocationAmounts: allocationRows.map((row) => row.amount)
  })
  await dbExecute("UPDATE erp_financial_documents SET allocation_status = ? WHERE id = ?", [
    status.allocationStatus,
    documentId
  ])
}

function reportRow(row: ReportRow): FinancialReportRow {
  const goodsPurchaseCost = money(row.goods_purchase_cost)
  const realizedGoodsCost = money(row.realized_goods_cost)
  const profit = money(row.profit)
  const stockingValue = money(goodsPurchaseCost - realizedGoodsCost)
  return {
    projectId: row.project_id,
    projectName: row.project_name,
    clientId: row.client_id,
    clientName: row.client_name,
    revenueAmountPln: money(row.revenue_amount_pln),
    goodsPurchaseCost,
    serviceCostNet: money(row.service_cost_net),
    realizedGoodsCost,
    otherOperatingCost: money(row.other_operating_cost),
    profit,
    taxEffect: money(row.tax_effect),
    taxPayable: money(row.tax_payable),
    profitAfterTax: money(row.profit_after_tax),
    stockingValue,
    profitWithoutGoods: money(profit + stockingValue),
    ytdProfit: money(row.ytd_profit)
  }
}

export async function getFinancialFlowSummary(fromDate: string, toDate: string) {
  const rows = await dbQuery<_FlowRow[]>(
    `
      SELECT
        DATE_FORMAT(allocation_date, '%Y-%m') AS period,
        COALESCE(SUM(revenue_amount_pln), 0) AS revenue_amount_pln,
        COALESCE(SUM(goods_purchase_cost), 0) AS goods_purchase_cost,
        COALESCE(SUM(service_cost_net), 0) AS service_cost_net,
        COALESCE(SUM(realized_goods_cost), 0) AS realized_goods_cost,
        COALESCE(SUM(other_operating_cost), 0) AS other_operating_cost,
        COALESCE(SUM(profit), 0) AS profit,
        COALESCE(SUM(tax_payable), 0) AS tax_payable,
        COALESCE(SUM(profit_after_tax), 0) AS profit_after_tax
      FROM erp_financial_document_allocations
      WHERE allocation_date BETWEEN ? AND ?
      GROUP BY DATE_FORMAT(allocation_date, '%Y-%m')
      ORDER BY period ASC
    `,
    [fromDate, toDate]
  )
  return rows.map(
    (row): FinancialFlowRow => ({
      period: row.period,
      revenue: money(row.revenue_amount_pln),
      goodsPurchaseCost: money(row.goods_purchase_cost),
      serviceCostNet: money(row.service_cost_net),
      realizedGoodsCost: money(row.realized_goods_cost),
      otherOperatingCost: money(row.other_operating_cost),
      profit: money(row.profit),
      taxPayable: money(row.tax_payable),
      profitAfterTax: money(row.profit_after_tax)
    })
  )
}

export async function getProjectProfitability(year: number, workspaceId: string) {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const rows = await dbQuery<
    Array<
      RowDataPacket & {
        project_id: string
        project_name: string
        client_name: string | null
        revenue_amount_pln: number
        service_cost_net: number
        realized_goods_cost: number
        other_operating_cost: number
        profit: number
      }
    >
  >(
    `
      SELECT
        p.id AS project_id,
        p.name AS project_name,
        c.name AS client_name,
        COALESCE(SUM(a.revenue_amount_pln), 0) AS revenue_amount_pln,
        COALESCE(SUM(a.service_cost_net), 0) AS service_cost_net,
        COALESCE(SUM(a.realized_goods_cost), 0) AS realized_goods_cost,
        COALESCE(SUM(a.other_operating_cost), 0) AS other_operating_cost,
        COALESCE(SUM(a.profit), 0) AS profit
      FROM erp_projects p
      LEFT JOIN erp_clients c ON c.id = p.client_id
      LEFT JOIN erp_financial_document_allocations a
        ON a.project_id = p.id AND a.allocation_date BETWEEN ? AND ?
      WHERE p.workspace_id = ?
      GROUP BY p.id, p.name, c.name
      ORDER BY profit DESC
    `,
    [from, to, workspaceId]
  )
  return rows.map(
    (row): ProjectProfitabilityRow => ({
      projectId: row.project_id,
      projectName: row.project_name,
      clientName: row.client_name,
      revenue: money(row.revenue_amount_pln),
      costs:
        money(row.service_cost_net) +
        money(row.realized_goods_cost) +
        money(row.other_operating_cost),
      profit: money(row.profit)
    })
  )
}

export async function getProjectsMonthlySummary(year: number, month: number) {
  const range = monthRange(year, month)
  const rows = await dbQuery<ReportRow[]>(
    `
      SELECT
        p.id AS project_id,
        p.name AS project_name,
        p.client_id,
        c.name AS client_name,
        COALESCE(SUM(CASE WHEN a.allocation_date BETWEEN ? AND ? THEN a.revenue_amount_pln ELSE 0 END), 0) AS revenue_amount_pln,
        COALESCE(SUM(CASE WHEN a.allocation_date BETWEEN ? AND ? THEN a.goods_purchase_cost ELSE 0 END), 0) AS goods_purchase_cost,
        COALESCE(SUM(CASE WHEN a.allocation_date BETWEEN ? AND ? THEN a.service_cost_net ELSE 0 END), 0) AS service_cost_net,
        COALESCE(SUM(CASE WHEN a.allocation_date BETWEEN ? AND ? THEN a.realized_goods_cost ELSE 0 END), 0) AS realized_goods_cost,
        COALESCE(SUM(CASE WHEN a.allocation_date BETWEEN ? AND ? THEN a.other_operating_cost ELSE 0 END), 0) AS other_operating_cost,
        COALESCE(SUM(CASE WHEN a.allocation_date BETWEEN ? AND ? THEN a.profit ELSE 0 END), 0) AS profit,
        COALESCE(SUM(CASE WHEN a.allocation_date BETWEEN ? AND ? THEN a.tax_effect ELSE 0 END), 0) AS tax_effect,
        COALESCE(SUM(CASE WHEN a.allocation_date BETWEEN ? AND ? THEN a.tax_payable ELSE 0 END), 0) AS tax_payable,
        COALESCE(SUM(CASE WHEN a.allocation_date BETWEEN ? AND ? THEN a.profit_after_tax ELSE 0 END), 0) AS profit_after_tax,
        COALESCE(SUM(CASE WHEN a.allocation_date BETWEEN ? AND ? THEN a.profit ELSE 0 END), 0) AS ytd_profit
      FROM erp_projects p
      LEFT JOIN erp_clients c ON c.id = p.client_id
      LEFT JOIN erp_financial_document_allocations a ON a.project_id = p.id
      GROUP BY p.id, p.name, p.client_id, c.name
      ORDER BY p.name ASC
    `,
    [
      range.from,
      range.to,
      range.from,
      range.to,
      range.from,
      range.to,
      range.from,
      range.to,
      range.from,
      range.to,
      range.from,
      range.to,
      range.from,
      range.to,
      range.from,
      range.to,
      range.from,
      range.to,
      range.ytdFrom,
      range.to
    ]
  )
  return rows.map(reportRow)
}

export async function getProjectMonthlyReport(projectId: string, year: number, month: number) {
  const summary = await getProjectsMonthlySummary(year, month)
  return summary.find((row) => row.projectId === projectId) ?? null
}

export async function getProjectYtdReport(projectId: string, year: number, month: number) {
  const range = monthRange(year, month)
  const rows = await dbQuery<
    Array<RowDataPacket & { profit: number; tax_effect: number; tax_payable: number }>
  >(
    `
      SELECT
        COALESCE(SUM(profit), 0) AS profit,
        COALESCE(SUM(tax_effect), 0) AS tax_effect,
        COALESCE(SUM(tax_payable), 0) AS tax_payable
      FROM erp_financial_document_allocations
      WHERE project_id = ? AND allocation_date BETWEEN ? AND ?
    `,
    [projectId, range.ytdFrom, range.to]
  )
  return {
    projectId,
    year,
    month,
    profit: money(rows[0]?.profit),
    taxEffect: money(rows[0]?.tax_effect),
    taxPayable: money(rows[0]?.tax_payable)
  }
}

export async function getFinancialRegister(filters: {
  year: number
  month: number
  projectId?: string
  clientId?: string
}) {
  const range = monthRange(filters.year, filters.month)
  const where = ["a.allocation_date BETWEEN ? AND ?"]
  const values: unknown[] = [range.from, range.to]
  if (filters.projectId) {
    where.push("a.project_id = ?")
    values.push(filters.projectId)
  }
  if (filters.clientId) {
    where.push("a.client_id = ?")
    values.push(filters.clientId)
  }
  const rows = await dbQuery<AllocationRow[]>(
    `
      ${allocationSelect()}
      WHERE ${where.join(" AND ")}
      ORDER BY a.allocation_date ASC, p.name ASC
    `,
    values
  )
  return rows.map(mapAllocation)
}

export async function getUnallocatedDocuments() {
  return listFinancialDocuments({ allocationStatus: "NOT_ALLOCATED" })
}

export async function getPartiallyAllocatedDocuments() {
  return listFinancialDocuments({ allocationStatus: "PARTIALLY_ALLOCATED" })
}

export async function listFinancialCategories() {
  const rows = await dbQuery<CategoryRow[]>(
    "SELECT id, name, code, description, is_active FROM erp_financial_categories WHERE is_active = true ORDER BY name ASC"
  )
  return rows.map(
    (row): FinancialCategory => ({
      id: row.id,
      name: row.name,
      code: row.code,
      description: row.description,
      isActive: bool(row.is_active)
    })
  )
}

export async function listProducts() {
  const rows = await dbQuery<ProductRow[]>(
    "SELECT id, name, sku, description, default_purchase_price, is_active FROM erp_products ORDER BY name ASC"
  )
  return rows.map(
    (row): Product => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      description: row.description,
      defaultPurchasePrice: money(row.default_purchase_price),
      isActive: bool(row.is_active)
    })
  )
}

export async function createProduct(input: {
  name: string
  sku?: string | null
  description?: string | null
  defaultPurchasePrice?: number
}) {
  const productId = id("product")
  await dbExecute(
    `
      INSERT INTO erp_products (id, name, sku, description, default_purchase_price)
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      productId,
      input.name,
      input.sku ?? null,
      input.description ?? null,
      money(input.defaultPurchasePrice)
    ]
  )
  return (await listProducts()).find((product) => product.id === productId)!
}

export async function listStockMovements(filters: { productId?: string; projectId?: string } = {}) {
  const where: string[] = []
  const values: unknown[] = []
  if (filters.productId) {
    where.push("sm.product_id = ?")
    values.push(filters.productId)
  }
  if (filters.projectId) {
    where.push("sm.project_id = ?")
    values.push(filters.projectId)
  }
  const rows = await dbQuery<StockMovementRow[]>(
    `
      SELECT
        sm.*,
        p.name AS product_name,
        pr.name AS project_name
      FROM erp_stock_movements sm
      JOIN erp_products p ON p.id = sm.product_id
      LEFT JOIN erp_projects pr ON pr.id = sm.project_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY sm.movement_date DESC, sm.created_at DESC
    `,
    values
  )
  return rows.map(
    (row): StockMovement => ({
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      projectId: row.project_id,
      projectName: row.project_name,
      financialDocumentId: row.financial_document_id,
      allocationId: row.allocation_id,
      movementType: row.movement_type,
      movementDate: isoDate(row.movement_date) ?? "",
      quantity: Number(row.quantity),
      unitPrice: money(row.unit_price),
      totalValue: money(row.total_value),
      description: row.description
    })
  )
}

export async function createStockMovement(input: {
  productId: string
  projectId?: string | null
  financialDocumentId?: string | null
  allocationId?: string | null
  movementType: StockMovementType
  movementDate: string
  quantity: number
  unitPrice: number
  description?: string | null
}) {
  const movementId = id("stock")
  const totalValue = money(input.quantity * input.unitPrice)
  await dbExecute(
    `
      INSERT INTO erp_stock_movements (
        id, product_id, project_id, financial_document_id, allocation_id,
        movement_type, movement_date, quantity, unit_price, total_value, description
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      movementId,
      input.productId,
      input.projectId ?? null,
      input.financialDocumentId ?? null,
      input.allocationId ?? null,
      input.movementType,
      input.movementDate,
      input.quantity,
      money(input.unitPrice),
      totalValue,
      input.description ?? null
    ]
  )
  return (await listStockMovements()).find((movement) => movement.id === movementId)!
}

export async function createStockMovementFromGoodsPurchase(input: {
  allocationId: string
  productId: string
  quantity: number
  unitPrice: number
}) {
  const rows = await dbQuery<AllocationRow[]>(`${allocationSelect()} WHERE a.id = ?`, [
    input.allocationId
  ])
  const allocation = rows[0]
  if (!allocation) throw new Error("Allocation not found")
  return createStockMovement({
    productId: input.productId,
    projectId: allocation.project_id,
    financialDocumentId: allocation.financial_document_id,
    allocationId: allocation.id,
    movementType: "PURCHASE",
    movementDate: isoDate(allocation.allocation_date) ?? new Date().toISOString().slice(0, 10),
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    description: allocation.description
  })
}

export async function createGoodsRealizationForProject(input: {
  productId: string
  projectId: string
  quantity: number
  unitPrice: number
  movementDate: string
  description?: string | null
}) {
  return createStockMovement({
    productId: input.productId,
    projectId: input.projectId,
    movementType: "ISSUE_TO_PROJECT",
    movementDate: input.movementDate,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    description: input.description
  })
}

export async function getStockSummary() {
  const rows = await dbQuery<StockSummaryDbRow[]>(
    `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.sku,
        COALESCE(SUM(CASE
          WHEN sm.movement_type IN ('OPENING_BALANCE', 'PURCHASE', 'RETURN') THEN sm.quantity
          WHEN sm.movement_type IN ('ISSUE_TO_PROJECT', 'SALE') THEN -sm.quantity
          ELSE sm.quantity
        END), 0) AS quantity_on_hand,
        COALESCE(SUM(CASE
          WHEN sm.movement_type IN ('OPENING_BALANCE', 'PURCHASE', 'RETURN') THEN sm.total_value
          WHEN sm.movement_type IN ('ISSUE_TO_PROJECT', 'SALE') THEN -sm.total_value
          ELSE sm.total_value
        END), 0) AS stock_value
      FROM erp_products p
      LEFT JOIN erp_stock_movements sm ON sm.product_id = p.id
      GROUP BY p.id, p.name, p.sku
      ORDER BY p.name ASC
    `
  )
  return rows.map(
    (row): StockSummaryRow => ({
      productId: row.product_id,
      productName: row.product_name,
      sku: row.sku,
      quantityOnHand: Number(row.quantity_on_hand),
      stockValue: money(row.stock_value)
    })
  )
}

export async function getEmployeeHourlyRates(workspaceId: string): Promise<EmployeeHourlyRate[]> {
  const rows = await dbQuery<
    Array<RowDataPacket & { id: string; name: string; hourly_rate: number | null }>
  >("SELECT id, name, hourly_rate FROM erp_employees WHERE workspace_id = ? ORDER BY name ASC", [
    workspaceId
  ])
  return rows.map((row) => ({
    employeeId: row.id,
    employeeName: row.name,
    hourlyRate: row.hourly_rate == null ? null : money(row.hourly_rate)
  }))
}

export async function updateEmployeeHourlyRate(
  employeeId: string,
  hourlyRate: number | null
): Promise<EmployeeHourlyRate | null> {
  const rateValue = hourlyRate == null ? null : money(hourlyRate)
  await dbExecute("UPDATE erp_employees SET hourly_rate = ? WHERE id = ?", [rateValue, employeeId])
  await recalculateEmployeeTimeEntryCosts(employeeId)
  const rows = await dbQuery<
    Array<RowDataPacket & { id: string; name: string; hourly_rate: number | null }>
  >("SELECT id, name, hourly_rate FROM erp_employees WHERE id = ?", [employeeId])
  if (!rows.length) return null
  return {
    employeeId: rows[0]!.id,
    employeeName: rows[0]!.name,
    hourlyRate: rows[0]!.hourly_rate == null ? null : money(rows[0]!.hourly_rate)
  }
}

export async function recalculateEmployeeTimeEntryCosts(employeeId: string): Promise<number> {
  const rateRows = await dbQuery<Array<RowDataPacket & { hourly_rate: number | null }>>(
    "SELECT hourly_rate FROM erp_employees WHERE id = ?",
    [employeeId]
  )
  const hourlyRate = rateRows[0]?.hourly_rate
  if (!hourlyRate || hourlyRate <= 0) {
    await dbExecute(
      "UPDATE erp_time_entries SET estimated_cost = NULL, hourly_rate_used = NULL WHERE employee_id = ?",
      [employeeId]
    )
    return 0
  }
  const [result] = await getDbPool().execute<ResultSetHeader>(
    `
      UPDATE erp_time_entries
      SET estimated_cost = ROUND((duration_seconds / 3600) * ?, 2),
          hourly_rate_used = ?
      WHERE employee_id = ? AND duration_seconds IS NOT NULL
    `,
    [hourlyRate, hourlyRate, employeeId]
  )
  return result.affectedRows
}

export async function recalculateAllTimeEntryCosts(): Promise<void> {
  const employees = await dbQuery<
    Array<RowDataPacket & { id: string; hourly_rate: number | null }>
  >("SELECT id, hourly_rate FROM erp_employees WHERE hourly_rate IS NOT NULL AND hourly_rate > 0")
  for (const emp of employees) {
    await dbExecute(
      `
        UPDATE erp_time_entries
        SET estimated_cost = ROUND((duration_seconds / 3600) * ?, 2),
            hourly_rate_used = ?
        WHERE employee_id = ? AND duration_seconds IS NOT NULL
      `,
      [emp.hourly_rate, emp.hourly_rate, emp.id]
    )
  }
  await dbExecute(
    `
      UPDATE erp_time_entries
      SET estimated_cost = NULL, hourly_rate_used = NULL
      WHERE employee_id NOT IN (
        SELECT id FROM erp_employees WHERE hourly_rate IS NOT NULL AND hourly_rate > 0
      )
    `
  )
}

interface TimeCostProjectRow extends RowDataPacket {
  project_id: string | null
  project_name: string | null
  client_id: string | null
  client_name: string | null
  total_seconds: number
  estimated_cost: number
}

interface TimeCostClientRow extends RowDataPacket {
  client_id: string | null
  client_name: string | null
  total_seconds: number
  estimated_cost: number
}

export async function getTimeCostsByProject(
  workspaceId: string,
  filters?: { year?: number; month?: number; startDate?: string; endDate?: string }
): Promise<ProjectTimeCostSummary[]> {
  const where = ["te.workspace_id = ?", "te.estimated_cost IS NOT NULL"]
  const values: unknown[] = [workspaceId]
  if (filters?.startDate) {
    where.push("te.work_date >= ?")
    values.push(filters.startDate)
  }
  if (filters?.endDate) {
    where.push("te.work_date <= ?")
    values.push(filters.endDate)
  } else if (filters?.year && filters?.month) {
    const range = monthRange(filters.year, filters.month)
    where.push("te.work_date BETWEEN ? AND ?")
    values.push(range.from, range.to)
  }
  const rows = await dbQuery<TimeCostProjectRow[]>(
    `
      SELECT
        te.project_id AS project_id,
        p.name AS project_name,
        te.client_id AS client_id,
        c.name AS client_name,
        COALESCE(SUM(te.duration_seconds), 0) AS total_seconds,
        COALESCE(SUM(te.estimated_cost), 0) AS estimated_cost
      FROM erp_time_entries te
      JOIN erp_projects p ON p.id = te.project_id
      LEFT JOIN erp_clients c ON c.id = te.client_id
      WHERE ${where.join(" AND ")}
      GROUP BY te.project_id, p.name, te.client_id, c.name
      ORDER BY estimated_cost DESC
    `,
    values
  )
  return rows.map((row) => ({
    projectId: row.project_id ?? "",
    projectName: row.project_name ?? "",
    clientId: row.client_id,
    clientName: row.client_name,
    totalSeconds: Number(row.total_seconds),
    estimatedCost: money(row.estimated_cost)
  }))
}

export async function getTimeCostsByClient(
  workspaceId: string,
  filters?: { year?: number; month?: number; startDate?: string; endDate?: string }
): Promise<ClientTimeCostSummary[]> {
  const where = ["te.workspace_id = ?", "te.estimated_cost IS NOT NULL"]
  const values: unknown[] = [workspaceId]
  if (filters?.startDate) {
    where.push("te.work_date >= ?")
    values.push(filters.startDate)
  }
  if (filters?.endDate) {
    where.push("te.work_date <= ?")
    values.push(filters.endDate)
  } else if (filters?.year && filters?.month) {
    const range = monthRange(filters.year, filters.month)
    where.push("te.work_date BETWEEN ? AND ?")
    values.push(range.from, range.to)
  }
  const rows = await dbQuery<TimeCostClientRow[]>(
    `
      SELECT
        te.client_id AS client_id,
        c.name AS client_name,
        COALESCE(SUM(te.duration_seconds), 0) AS total_seconds,
        COALESCE(SUM(te.estimated_cost), 0) AS estimated_cost
      FROM erp_time_entries te
      LEFT JOIN erp_clients c ON c.id = te.client_id
      WHERE ${where.join(" AND ")}
      GROUP BY te.client_id, c.name
      ORDER BY estimated_cost DESC
    `,
    values
  )
  return rows.map((row) => ({
    clientId: row.client_id,
    clientName: row.client_name,
    totalSeconds: Number(row.total_seconds),
    estimatedCost: money(row.estimated_cost)
  }))
}

export async function transaction<T>(fn: () => Promise<T>) {
  const connection = await getDbPool().getConnection()
  try {
    await connection.beginTransaction()
    const result = await fn()
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}
