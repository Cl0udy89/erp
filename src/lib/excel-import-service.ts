import type { RowDataPacket } from "mysql2/promise"
import * as XLSX from "xlsx"

import { dbQuery } from "#/lib/db"
import { money } from "#/lib/finance-domain"
import {
  addDocumentAllocation,
  createFinancialDocument,
  type CreateAllocationInput,
  type CreateFinancialDocumentInput
} from "#/lib/finance-service"
import type { DocumentType, TransactionType } from "#/lib/finance-types"

export interface ExcelImportPreviewRow {
  id: string
  sheetName: string
  sourceRow: number
  accepted: boolean
  warnings: string[]
  projectName: string
  projectId: string | null
  accountingDate: string
  documentName: string
  documentNumber: string | null
  contractorName: string | null
  documentType: DocumentType
  transactionType: TransactionType
  categoryName: string | null
  revenueForeign: number
  exchangeRate: number | null
  revenueAmount: number
  goodsPurchaseCost: number
  serviceCostNet: number
  realizedGoodsCost: number
  otherOperatingCost: number
  citRate: number
  notes: string | null
  allocationGroupKey: string
}

export interface ExcelImportPreview {
  fileName: string
  sheets: string[]
  rows: ExcelImportPreviewRow[]
  warnings: string[]
}

export interface ExcelImportCommitResult {
  documentsCreated: number
  allocationsCreated: number
  skippedRows: number
}

interface ProjectMatchRow extends RowDataPacket {
  id: string
  name: string
  client_id: string | null
  clientName: string | null
}

const MANUAL_ALIASES: Record<string, string> = {
  "mctc - tomek": "mctc",
  "mapaturbines - tomek": "mapa turbines",
  "ekipa - przemek, tomek": "boit",
  "szkolenia - przemek, tomek": "spark academy",
  "strony www -wp": "las ogrod",
  "utrzymanie spolki": "sparksome",
  marketing: "sparksome",
  jsystems: "szkolenia",
  radomsko: "radomska stacja pogotowia ratunkowego",
  "obsluga przetargow": "sparksome"
}

const HEADER_ALIASES: Record<string, string[]> = {
  project: ["projekt"],
  date: ["data wpisu", "data", "dzień", "dzien"],
  description: ["nazwa faktury / opis transakcji", "nazwa faktury", "opis transakcji", "opis"],
  type: ["typ transakcji", "typ"],
  foreignRevenue: ["przychód w walucie obcej", "przychod w walucie obcej"],
  exchangeRate: ["kurs waluty obcej", "kurs"],
  revenue: ["przychód", "przychod"],
  goodsPurchaseCost: ["koszt zakupu towaru"],
  serviceCostNet: ["koszt usług netto", "koszt uslug netto", "koszt usług", "koszt uslug"],
  realizedGoodsCost: ["zrealizowany koszt towaru"],
  otherOperatingCost: ["pozostałe koszty operacyjne", "pozostale koszty operacyjne"],
  citRate: ["stawka cit (%)", "stawka cit", "cit"],
  notes: ["uwagi"],
  category: ["kategoria"]
}

function textValue(value: unknown) {
  if (value == null) return ""
  if (value instanceof Date) return value.toISOString()
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value)
  }
  return JSON.stringify(value)
}

function normalize(value: unknown) {
  return textValue(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .replaceAll(/\s+/g, " ")
}

function cell(row: unknown[], index: number | undefined) {
  if (index === undefined || index < 0) return ""
  return row[index]
}

function numeric(value: unknown) {
  if (typeof value === "number") return money(value)
  const parsed = Number(textValue(value).replaceAll(/\s/g, "").replace(",", "."))
  return Number.isFinite(parsed) ? money(parsed) : 0
}

function dateValue(value: unknown, fallbackYear?: number, fallbackMonth?: number) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`
    }
  }
  const text = textValue(value).trim()
  const match = text.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/)
  if (match) {
    const year = match[3]
      ? Number(match[3].length === 2 ? `20${match[3]}` : match[3])
      : (fallbackYear ?? new Date().getFullYear())
    return `${year}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`
  }
  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  if (fallbackYear && fallbackMonth)
    return `${fallbackYear}-${String(fallbackMonth).padStart(2, "0")}-01`
  return new Date().toISOString().slice(0, 10)
}

function monthFromSheetName(sheetName: string) {
  const normalized = normalize(sheetName)
  const months = [
    "styczen",
    "luty",
    "marzec",
    "kwiecien",
    "maj",
    "czerwiec",
    "lipiec",
    "sierpien",
    "wrzesien",
    "pazdziernik",
    "listopad",
    "grudzien"
  ]
  const monthIndex = months.findIndex((month) => normalized.includes(month))
  const yearMatch = normalized.match(/20\d{2}/)
  return {
    month: monthIndex >= 0 ? monthIndex + 1 : undefined,
    year: yearMatch ? Number(yearMatch[0]) : undefined
  }
}

/**
 * Checks if a cell value looks like a date string (e.g. "30.01.2025", "2025-01-30").
 */
function looksLikeDate(value: unknown): boolean {
  if (value instanceof Date) return true
  if (typeof value === "number") return XLSX.SSF.parse_date_code(value) != null
  const text = textValue(value).trim()
  if (!text) return false
  return /^\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?$/.test(text) || /^\d{4}-\d{2}-\d{2}/.test(text)
}

interface HeaderDetection {
  rowIndex: number
  /**
   * When true, the header row is missing a "Projekt" column.
   * In this layout, the project name is in the column labeled "Data wpisu" (col after LP),
   * and the actual date is shifted one column to the right.
   */
  missingProjectColumn: boolean
}

/**
 * Find the header row. Accepts rows that have "typ transakcji" (or alias)
 * even if "projekt" is missing – some older sheets store project names
 * in the column where "Data wpisu" header is and the date is shifted right.
 */
function findHeader(rows: unknown[][]): HeaderDetection {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex++) {
    const normalized = rows[rowIndex]?.map(normalize) ?? []
    const hasType = normalized.some(
      (item) => item && (item.includes("typ transakcji") || item === "typ")
    )
    if (!hasType) continue

    const hasProject = normalized.some((item) => item === "projekt")
    return { rowIndex, missingProjectColumn: !hasProject }
  }
  return { rowIndex: -1, missingProjectColumn: false }
}

interface ColumnMap {
  [key: string]: number | undefined
}

/**
 * Build column map, handling the alternative layout where "Projekt" column
 * is missing. In that case we detect the shifted layout from data rows.
 */
function buildColumnMap(
  header: unknown[],
  missingProjectColumn: boolean,
  dataRows: unknown[][]
): ColumnMap {
  const normalizedHeader = header.map(normalize)
  const map: ColumnMap = {}

  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    map[key] = normalizedHeader.findIndex(
      (headerName) =>
        headerName &&
        aliases.map(normalize).some((alias) => headerName === alias || headerName.includes(alias))
    )
    if (map[key] === -1) map[key] = undefined
  }

  if (missingProjectColumn && map.project === undefined) {
    // Alternate layout detected: [LP, ProjectName(no header), Date, Description, Type, ...]
    // The "Data wpisu" header is at what we think is the date column,
    // but data rows have project names there and dates one column to the right.
    //
    // Strategy: find the column that has "data wpisu" header, and check if
    // data rows in that column look like non-date text. If so, that column
    // is actually the project column, and the real date is one column right.

    const dataWpisuIndex = normalizedHeader.findIndex(
      (h) => h && (h.includes("data wpisu") || h === "data")
    )

    if (dataWpisuIndex >= 0) {
      // Check first few data rows: does this column contain dates or text?
      let textCount = 0
      let dateCount = 0
      for (const dataRow of dataRows.slice(0, 5)) {
        if (!dataRow || !Array.isArray(dataRow)) continue
        const val = dataRow[dataWpisuIndex]
        if (textValue(val).trim() === "") continue
        if (looksLikeDate(val)) dateCount++
        else textCount++
      }

      if (textCount > dateCount) {
        // This column is actually project names
        map.project = dataWpisuIndex

        // The real date is the next non-null column
        const nextCol = dataWpisuIndex + 1
        if (nextCol < header.length) {
          map.date = nextCol
        }
      }
    }

    // Last resort: if still no project column, use column 1 (after LP)
    if (map.project === undefined) {
      const lpIndex = normalizedHeader.findIndex((h) => h === "lp" || h === "lp.")
      map.project = lpIndex >= 0 ? lpIndex + 1 : 1
      // Shift date to column after project
      if (map.date === map.project) {
        map.date = map.project + 1
      }
    }
  }

  return map
}

/**
 * Infer document type from the "Typ transakcji" text in the Excel.
 * Handles: "Przychód - usługa", "Przychód - towar", "Koszt", "Koszt - towar",
 * "Przychód wirtualny", "Koszt wirtualny", etc.
 */
function inferDocumentType(typeValue: string): DocumentType {
  const type = normalize(typeValue)
  if (type.includes("przychod wirtualny")) return "VIRTUAL_REVENUE"
  if (type.includes("koszt wirtualny")) return "VIRTUAL_COST"
  if (type.includes("przychod") || type.includes("sprzedaz")) return "SALES_INVOICE"
  if (type.includes("rachunek") || type.includes("zlecen")) return "CONTRACTOR_BILL"
  if (type.includes("towar")) return "STOCK_DOCUMENT"
  if (type.includes("koszt")) return "COST_INVOICE"
  return "INTERNAL_DOCUMENT"
}

/**
 * Infer transaction type using BOTH the type text AND the amounts.
 * Text-based classification takes priority when the text is specific enough,
 * so that "Przychód - usługa" with 0 revenue still becomes SERVICE_REVENUE.
 */
function inferTransactionType(
  typeValue: string,
  row: Partial<ExcelImportPreviewRow>
): TransactionType {
  const type = normalize(typeValue)

  // --- Text-based: virtual types ---
  if (type.includes("przychod wirtualny")) return "VIRTUAL_REVENUE"
  if (type.includes("koszt wirtualny")) return "VIRTUAL_COST"

  // --- Text-based: explicit revenue in type text ---
  if (type.includes("przychod") || type.includes("sprzedaz")) return "SERVICE_REVENUE"

  // --- Text-based: explicit cost sub-types ---
  if (type.includes("koszt") && type.includes("towar")) return "GOODS_PURCHASE"
  if (type.includes("rachunek") || type.includes("zlecen")) return "CONTRACTOR_COST"

  // --- Amount-based fallback ---
  if ((row.revenueAmount ?? 0) > 0 || (row.revenueForeign ?? 0) > 0) return "SERVICE_REVENUE"
  if ((row.goodsPurchaseCost ?? 0) > 0) return "GOODS_PURCHASE"
  if ((row.realizedGoodsCost ?? 0) > 0) return "GOODS_REALIZATION"
  if ((row.otherOperatingCost ?? 0) > 0) return "OTHER_OPERATING_COST"

  // --- Default for generic "Koszt" ---
  if (type.includes("koszt")) return "COST"

  return "COST"
}

// ---------------------------------------------------------------------------
// Fuzzy project matching
// ---------------------------------------------------------------------------

/**
 * Tokenize a project name for comparison.
 * Strips common filler words, splits on spaces, hyphens, commas, etc.
 */
function tokenize(value: string): string[] {
  const normalized = normalize(value)
  const stopWords = new Set(["sp", "z", "oo", "zoo", "sa", "spolka", "spółka", "-", "–", ""])
  return normalized
    .split(/[\s,\-–/|]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !stopWords.has(token))
}

/**
 * Simple Levenshtein distance for short strings.
 */
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = []
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0]![j] = j
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost
      )
    }
  }
  return matrix[a.length]![b.length]!
}

/**
 * Score how well an Excel project name matches a DB project name.
 * Returns a value between 0 (no match) and 1 (perfect match).
 */
function matchScore(excelName: string, dbName: string): number {
  const exNorm = normalize(excelName)
  const dbNorm = normalize(dbName)

  // 1. Exact match
  if (exNorm === dbNorm) return 1.0

  // 2. One contains the other
  if (dbNorm.includes(exNorm) || exNorm.includes(dbNorm)) {
    const shorter = Math.min(exNorm.length, dbNorm.length)
    const longer = Math.max(exNorm.length, dbNorm.length)
    return 0.7 + 0.25 * (shorter / longer) // 0.70–0.95
  }

  // 3. Token-based Jaccard similarity
  const exTokens = tokenize(excelName)
  const dbTokens = tokenize(dbName)
  if (exTokens.length > 0 && dbTokens.length > 0) {
    let matched = 0
    for (const exToken of exTokens) {
      for (const dbToken of dbTokens) {
        // Exact token match or one token contains the other (for partial names)
        if (
          exToken === dbToken ||
          (exToken.length >= 3 && dbToken.includes(exToken)) ||
          (dbToken.length >= 3 && exToken.includes(dbToken))
        ) {
          matched++
          break
        }
        // Levenshtein for near-matches (typos) on longer tokens
        if (exToken.length >= 4 && dbToken.length >= 4) {
          const distance = levenshtein(exToken, dbToken)
          const maxLen = Math.max(exToken.length, dbToken.length)
          if (distance / maxLen <= 0.25) {
            matched += 0.8
            break
          }
        }
      }
    }
    const union = new Set([...exTokens, ...dbTokens]).size
    const jaccard = matched / union
    if (jaccard > 0) return Math.min(0.4 + jaccard * 0.55, 0.94) // 0.40–0.94
  }

  // 4. Levenshtein on full normalized strings (for short names)
  if (exNorm.length <= 20 && dbNorm.length <= 20) {
    const distance = levenshtein(exNorm, dbNorm)
    const maxLen = Math.max(exNorm.length, dbNorm.length)
    const similarity = 1 - distance / maxLen
    if (similarity >= 0.6) return similarity * 0.65 // 0.39–0.65
  }

  return 0
}

const MATCH_THRESHOLD = 0.45

async function projectMatches() {
  const rows = await dbQuery<ProjectMatchRow[]>(`
    SELECT p.id, p.name, p.client_id, c.name as clientName 
    FROM erp_projects p
    LEFT JOIN erp_clients c ON p.client_id = c.id
  `)
  return rows
}

/**
 * Find the best matching project for a given Excel project name.
 * Uses fuzzy matching with scoring.
 */
function findBestProject(
  excelProjectName: string,
  projects: ProjectMatchRow[]
): { project: ProjectMatchRow; score: number } | null {
  if (!excelProjectName.trim()) return null

  const normalizedExcelName = normalize(excelProjectName)

  // 1. Check manual aliases first
  const aliasTarget = MANUAL_ALIASES[normalizedExcelName]
  if (aliasTarget) {
    const matchedProject = projects.find(
      (p) =>
        normalize(p.name) === aliasTarget ||
        (p.clientName && normalize(p.clientName) === aliasTarget)
    )
    if (matchedProject) {
      return { project: matchedProject, score: 1.0 }
    }
  }

  let bestMatch: ProjectMatchRow | null = null
  let bestScore = 0

  for (const project of projects) {
    // 1. Score against project name
    const projectNameScore = matchScore(excelProjectName, project.name)

    // 2. Score against client name (if the Excel name is actually just the client name)
    const clientNameScore = project.clientName
      ? matchScore(excelProjectName, project.clientName)
      : 0

    // 3. Score against combined "Client - Project" name
    const combinedName = project.clientName ? `${project.clientName} ${project.name}` : project.name
    const combinedScore = matchScore(excelProjectName, combinedName)

    // 4. Score against "Client Project" (no separator)
    const combinedNoSeparator = project.clientName
      ? `${project.clientName}${project.name}`
      : project.name
    const combinedNoSepScore = matchScore(excelProjectName, combinedNoSeparator)

    const score = Math.max(
      projectNameScore,
      clientNameScore * 0.9,
      combinedScore,
      combinedNoSepScore
    )

    if (score > bestScore) {
      bestScore = score
      bestMatch = project
    }
  }

  if (bestMatch && bestScore >= MATCH_THRESHOLD) {
    return { project: bestMatch, score: bestScore }
  }

  return null
}

export async function previewExcelImport(
  fileName: string,
  contentBase64: string
): Promise<ExcelImportPreview> {
  const workbook = XLSX.read(Buffer.from(contentBase64, "base64"), {
    cellDates: true,
    type: "buffer"
  })
  const projects = await projectMatches()
  const rows: ExcelImportPreviewRow[] = []
  const warnings: string[] = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    // Skip template / summary sheets
    if (normalize(sheetName) === "template") continue

    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false })
    const detection = findHeader(rawRows)
    if (detection.rowIndex < 0) {
      warnings.push(`Pominięto arkusz "${sheetName}" - nie znaleziono nagłówków.`)
      continue
    }
    const headerRow = rawRows[detection.rowIndex] ?? []
    const dataRows = rawRows.slice(detection.rowIndex + 1)
    const columns = buildColumnMap(headerRow, detection.missingProjectColumn, dataRows)
    const sheetDate = monthFromSheetName(sheetName)

    if (detection.missingProjectColumn) {
      warnings.push(
        `Arkusz "${sheetName}" - brak kolumny "Projekt" w nagłówku, wykryto alternatywny układ.`
      )
    }

    for (let index = detection.rowIndex + 1; index < rawRows.length; index++) {
      const rawRow = rawRows[index] ?? []
      const projectName = textValue(cell(rawRow, columns.project)).trim()
      const description = textValue(cell(rawRow, columns.description)).trim()
      if (!projectName && !description) continue

      const typeText = textValue(cell(rawRow, columns.type)).trim()
      const result = findBestProject(projectName, projects)
      const rowWarnings: string[] = []

      if (!projectName) {
        rowWarnings.push("Brak nazwy projektu w wierszu.")
      } else if (!result) {
        rowWarnings.push(
          `Nie dopasowano projektu "${projectName}" - wybierz projekt przed importem.`
        )
      } else if (result.score < 0.95) {
        rowWarnings.push(
          `Dopasowano "${projectName}" → "${result.project.name}" (trafność: ${Math.round(result.score * 100)}%)`
        )
      }

      const partial = {
        revenueForeign: numeric(cell(rawRow, columns.foreignRevenue)),
        exchangeRate: numeric(cell(rawRow, columns.exchangeRate)) || null,
        revenueAmount: numeric(cell(rawRow, columns.revenue)),
        goodsPurchaseCost: numeric(cell(rawRow, columns.goodsPurchaseCost)),
        serviceCostNet: numeric(cell(rawRow, columns.serviceCostNet)),
        realizedGoodsCost: numeric(cell(rawRow, columns.realizedGoodsCost)),
        otherOperatingCost: numeric(cell(rawRow, columns.otherOperatingCost))
      }

      const totalAmount =
        Math.abs(
          partial.revenueAmount ||
            (partial.revenueForeign && partial.exchangeRate
              ? partial.revenueForeign * partial.exchangeRate
              : 0)
        ) +
        partial.goodsPurchaseCost +
        partial.serviceCostNet +
        partial.realizedGoodsCost +
        partial.otherOperatingCost

      if (totalAmount === 0) {
        rowWarnings.push("Brak kwot finansowych w wierszu.")
      }

      const row: ExcelImportPreviewRow = {
        id: `${sheetName}-${index + 1}`,
        sheetName,
        sourceRow: index + 1,
        accepted: true,
        warnings: rowWarnings,
        projectName,
        projectId: result?.project.id ?? null,
        accountingDate: dateValue(cell(rawRow, columns.date), sheetDate.year, sheetDate.month),
        documentName: description || `Import Excel ${sheetName} wiersz ${index + 1}`,
        documentNumber: null,
        contractorName: null,
        documentType: inferDocumentType(typeText),
        transactionType: inferTransactionType(typeText, partial),
        categoryName: textValue(cell(rawRow, columns.category)).trim() || null,
        revenueForeign: partial.revenueForeign,
        exchangeRate: partial.exchangeRate,
        revenueAmount: partial.revenueAmount,
        goodsPurchaseCost: partial.goodsPurchaseCost,
        serviceCostNet: partial.serviceCostNet,
        realizedGoodsCost: partial.realizedGoodsCost,
        otherOperatingCost: partial.otherOperatingCost,
        citRate:
          numeric(cell(rawRow, columns.citRate)) > 1
            ? numeric(cell(rawRow, columns.citRate)) / 100
            : numeric(cell(rawRow, columns.citRate)) || 0.09,
        notes: textValue(cell(rawRow, columns.notes)).trim() || null,
        allocationGroupKey: normalize(
          `${description}|${typeText}|${dateValue(cell(rawRow, columns.date), sheetDate.year, sheetDate.month)}`
        )
      }
      rows.push(row)
    }
  }

  return {
    fileName,
    sheets: workbook.SheetNames,
    rows,
    warnings
  }
}

function allocationAmount(row: ExcelImportPreviewRow) {
  return (
    Math.abs(
      row.revenueAmount ||
        (row.revenueForeign && row.exchangeRate ? row.revenueForeign * row.exchangeRate : 0)
    ) +
    row.goodsPurchaseCost +
    row.serviceCostNet +
    row.realizedGoodsCost +
    row.otherOperatingCost
  )
}

export async function commitExcelImport(
  rows: ExcelImportPreviewRow[]
): Promise<ExcelImportCommitResult> {
  const acceptedRows = rows.filter((row) => row.accepted)
  let documentsCreated = 0
  let allocationsCreated = 0
  let skippedRows = rows.length - acceptedRows.length

  const grouped = new Map<string, ExcelImportPreviewRow[]>()
  for (const row of acceptedRows) {
    if (!row.projectId) {
      skippedRows++
      continue
    }
    const group = grouped.get(row.allocationGroupKey) ?? []
    group.push(row)
    grouped.set(row.allocationGroupKey, group)
  }

  for (const group of grouped.values()) {
    const first = group[0]!
    const documentInput: CreateFinancialDocumentInput = {
      documentNumber: first.documentNumber,
      documentName: first.documentName,
      documentType: first.documentType,
      sourceSystem: "IMPORT",
      accountingDate: first.accountingDate,
      currencyCode: "PLN",
      netAmount: money(group.reduce((sum, row) => sum + allocationAmount(row), 0)),
      vatAmount: 0,
      grossAmount: money(group.reduce((sum, row) => sum + allocationAmount(row), 0)),
      contractorName: first.contractorName,
      description: `Import z Excela: ${first.sheetName}`,
      importStatus: "IMPORTED",
      rawPayload: { source: "excel", rows: group }
    }
    const document = await createFinancialDocument(documentInput)
    documentsCreated++

    for (const row of group) {
      if (allocationAmount(row) === 0) {
        skippedRows++
        continue
      }
      const allocation: CreateAllocationInput = {
        projectId: row.projectId!,
        allocationDate: row.accountingDate,
        transactionType: row.transactionType,
        description: row.documentName,
        notes: row.notes,
        revenueAmount: row.revenueAmount,
        goodsPurchaseCost: row.goodsPurchaseCost,
        serviceCostNet: row.serviceCostNet,
        realizedGoodsCost: row.realizedGoodsCost,
        otherOperatingCost: row.otherOperatingCost,
        foreignAmount: row.revenueForeign || null,
        currencyCode: null,
        exchangeRate: row.exchangeRate,
        citRate: row.citRate
      }
      await addDocumentAllocation(document.id, allocation)
      allocationsCreated++
    }
  }

  return {
    documentsCreated,
    allocationsCreated,
    skippedRows
  }
}
