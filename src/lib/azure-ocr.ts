/**
 * Azure Document Intelligence — prebuilt-invoice OCR
 *
 * Env vars required:
 *   AZURE_DOC_INTEL_ENDPOINT=https://your-resource.cognitiveservices.azure.com
 *   AZURE_DOC_INTEL_KEY=your-key
 *
 * API version: 2023-07-31 (GA)
 * Model: prebuilt-invoice
 */

const API_VERSION = "2023-07-31"

export interface OcrLineItem {
  description?: string
  quantity?: number
  unitPrice?: number
  totalPrice?: number
  vatRate?: string
}

export interface OcrExtractedFields {
  vendorName?: string
  vendorNip?: string         // Polish tax ID (NIP), 10 digits
  vendorAddress?: string
  invoiceNumber?: string
  invoiceDate?: string       // ISO 8601 date
  dueDate?: string
  totalAmount?: number
  taxAmount?: number         // VAT amount
  netAmount?: number
  currency?: string          // PLN, EUR, USD
  lineItems?: OcrLineItem[]
  confidence: number         // 0.0–1.0 overall confidence
}

function getConfig(): { endpoint: string; key: string } | null {
  const endpoint = process.env.AZURE_DOC_INTEL_ENDPOINT
  const key = process.env.AZURE_DOC_INTEL_KEY
  if (!endpoint || !key) return null
  return { endpoint: endpoint.replace(/\/$/, ""), key }
}

export function isOcrConfigured(): boolean {
  return getConfig() !== null
}

/**
 * Submit a PDF file (as Buffer/Uint8Array) for invoice analysis.
 * Returns the operation URL for polling.
 */
async function submitAnalysis(fileBuffer: Buffer, config: { endpoint: string; key: string }): Promise<string> {
  const url = `${config.endpoint}/formrecognizer/documentModels/prebuilt-invoice:analyze?api-version=${API_VERSION}`

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": config.key,
      "Content-Type": "application/pdf"
    },
    body: fileBuffer as unknown as BodyInit
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Azure OCR submit failed: ${response.status} ${text}`)
  }

  const operationLocation = response.headers.get("Operation-Location")
  if (!operationLocation) throw new Error("Azure OCR: no Operation-Location header in response")
  return operationLocation
}

/**
 * Poll Azure for analysis result. Returns null if still running.
 */
async function pollResult(operationUrl: string, key: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(operationUrl, {
    headers: { "Ocp-Apim-Subscription-Key": key }
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Azure OCR poll failed: ${response.status} ${text}`)
  }
  const data = await response.json() as Record<string, unknown>
  const status = data.status as string
  if (status === "failed") throw new Error(`Azure OCR analysis failed: ${JSON.stringify(data.error ?? {})}`)
  if (status !== "succeeded") return null
  return data
}

function extractString(field: unknown): string | undefined {
  if (!field || typeof field !== "object") return undefined
  const f = field as Record<string, unknown>
  return typeof f.content === "string" ? f.content.trim() || undefined : undefined
}

function extractNumber(field: unknown): number | undefined {
  if (!field || typeof field !== "object") return undefined
  const f = field as Record<string, unknown>
  if (f.value != null) {
    const n = Number(f.value)
    return isNaN(n) ? undefined : n
  }
  // Try currency value object
  const cv = f.valueNumber ?? (f.valueCurrency as Record<string, unknown> | undefined)?.amount
  if (cv != null) {
    const n = Number(cv)
    return isNaN(n) ? undefined : n
  }
  return undefined
}

function extractDate(field: unknown): string | undefined {
  if (!field || typeof field !== "object") return undefined
  const f = field as Record<string, unknown>
  if (typeof f.valueDate === "string") return f.valueDate
  if (typeof f.content === "string") return f.content.trim() || undefined
  return undefined
}

function extractCurrency(field: unknown): string | undefined {
  if (!field || typeof field !== "object") return undefined
  const f = field as Record<string, unknown>
  const cv = f.valueCurrency as Record<string, unknown> | undefined
  if (cv && typeof cv.currencyCode === "string") return cv.currencyCode
  return undefined
}

function extractConfidence(field: unknown): number {
  if (!field || typeof field !== "object") return 0
  const f = field as Record<string, unknown>
  if (typeof f.confidence === "number") return f.confidence
  return 0
}

/**
 * Normalise Polish NIP: strip spaces/hyphens, return 10-digit string or undefined
 */
function normaliseNip(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const digits = raw.replace(/[\s-]/g, "")
  return /^\d{10}$/.test(digits) ? digits : raw
}

/**
 * Parse Azure prebuilt-invoice result into our normalized schema.
 */
function parseInvoiceResult(data: Record<string, unknown>): OcrExtractedFields {
  const analyzeResult = data.analyzeResult as Record<string, unknown> | undefined
  const documents = analyzeResult?.documents as Array<Record<string, unknown>> | undefined
  const doc = documents?.[0]
  const fields = (doc?.fields as Record<string, unknown> | undefined) ?? {}
  const docConfidence = typeof doc?.confidence === "number" ? doc.confidence : 0

  const vendorName = extractString(fields.VendorName)
  const rawNip = extractString(fields.VendorTaxId)
  const vendorNip = normaliseNip(rawNip)
  const vendorAddress = extractString(fields.VendorAddress)
  const invoiceNumber = extractString(fields.InvoiceId)
  const invoiceDate = extractDate(fields.InvoiceDate)
  const dueDate = extractDate(fields.DueDate)

  // Amounts — Azure returns TotalTax, SubTotal, InvoiceTotal
  const totalAmount = extractNumber(fields.InvoiceTotal)
  const taxAmount = extractNumber(fields.TotalTax)
  const netAmount = extractNumber(fields.SubTotal)

  // Currency — check AmountDue or InvoiceTotal field
  const currency =
    extractCurrency(fields.InvoiceTotal) ??
    extractCurrency(fields.AmountDue) ??
    extractCurrency(fields.SubTotal)

  // Line items
  const itemsField = fields.Items as Record<string, unknown> | undefined
  const rawItems = itemsField?.valueArray as Array<Record<string, unknown>> | undefined
  const lineItems: OcrLineItem[] = (rawItems ?? []).map((item) => {
    const props = (item.valueObject as Record<string, unknown> | undefined) ?? {}
    return {
      description: extractString(props.Description),
      quantity: extractNumber(props.Quantity),
      unitPrice: extractNumber(props.UnitPrice),
      totalPrice: extractNumber(props.Amount),
      vatRate: extractString(props.TaxRate)
    }
  }).filter((li) => li.description || li.totalPrice)

  // Overall confidence: average of all high-value fields that were found
  const confValues = [
    extractConfidence(fields.VendorName),
    extractConfidence(fields.InvoiceId),
    extractConfidence(fields.InvoiceDate),
    extractConfidence(fields.InvoiceTotal)
  ].filter((c) => c > 0)

  const avgConfidence = confValues.length > 0
    ? confValues.reduce((a, b) => a + b, 0) / confValues.length
    : docConfidence

  return {
    vendorName,
    vendorNip,
    vendorAddress,
    invoiceNumber,
    invoiceDate,
    dueDate,
    totalAmount,
    taxAmount,
    netAmount,
    currency,
    lineItems: lineItems.length > 0 ? lineItems : undefined,
    confidence: Math.round(avgConfidence * 1000) / 1000
  }
}

/**
 * Analyse a PDF file stored at the given path.
 * Polls Azure until result is ready or max retries exceeded.
 */
export async function extractInvoiceFields(fileBuffer: Buffer): Promise<OcrExtractedFields> {
  const config = getConfig()
  if (!config) throw new Error("Azure Document Intelligence is not configured")

  const operationUrl = await submitAnalysis(fileBuffer, config)

  const MAX_RETRIES = 30
  const POLL_INTERVAL_MS = 1000

  for (let i = 0; i < MAX_RETRIES; i++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    const result = await pollResult(operationUrl, config.key)
    if (result) return parseInvoiceResult(result)
  }

  throw new Error("Azure OCR timed out after 30 seconds")
}
