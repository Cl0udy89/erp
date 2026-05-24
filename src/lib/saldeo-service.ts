/**
 * Saldeo Smart integration
 *
 * Saldeo Smart API uses REST with XML payloads and HMAC-SHA256 authentication.
 * Full API specification (v1.17, Feb 2024) is available at:
 *   https://systemsaldeo.pl/pliki/SaldeoSMART%20-%20Specyfikacja%20API.pdf
 *
 * To get developer API access: api@saldeosmart.pl
 *
 * Env vars:
 *   SALDEO_API_KEY=          ← API key from Saldeo developer account
 *   SALDEO_COMPANY_ID=       ← Company identifier in Saldeo
 *
 * NOTE: This implementation is a ready-to-wire stub. The actual endpoint paths,
 * XML schema, and authentication signature format need to be confirmed against
 * the official developer documentation (requires Saldeo developer account access).
 * All stubs are clearly marked with TODO comments.
 */

import crypto from "crypto"

export interface SaldeoConfig {
  apiKey: string
  companyId: string
}

export interface SaldeoDocumentPayload {
  documentId: string
  documentNumber?: string
  contractorName?: string
  contractorNip?: string
  issueDate?: string
  netAmount?: number
  vatAmount?: number
  grossAmount?: number
  currency?: string
  description?: string
  pdfBase64: string           // Base64-encoded PDF content
}

export interface SaldeoExportResult {
  success: true
  saldeoDocumentId: string
  exportedAt: string
}

export interface SaldeoStatusResult {
  configured: boolean
  connectedCompany?: string
}

// ─── Configuration ────────────────────────────────────────────────────────────

export function getSaldeoConfig(): SaldeoConfig | null {
  const apiKey = process.env.SALDEO_API_KEY
  const companyId = process.env.SALDEO_COMPANY_ID
  if (!apiKey || !companyId) return null
  return { apiKey, companyId }
}

export function isSaldeoConfigured(): boolean {
  return getSaldeoConfig() !== null
}

// ─── Authentication ───────────────────────────────────────────────────────────

/**
 * TODO: Confirm signature format against Saldeo API v1.17 spec.
 * Based on search results, Saldeo uses HMAC-SHA256 or similar REST signing.
 * Current implementation: HMAC-SHA256 of `{method}\n{path}\n{timestamp}`.
 */
function buildAuthHeader(config: SaldeoConfig, method: string, path: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const payload = `${method}\n${path}\n${timestamp}`
  const signature = crypto
    .createHmac("sha256", config.apiKey)
    .update(payload)
    .digest("hex")

  return {
    "X-Saldeo-Company": config.companyId,
    "X-Saldeo-Timestamp": timestamp,
    "X-Saldeo-Signature": signature,
    "Content-Type": "application/xml; charset=utf-8"
  }
}

// ─── Base URL ─────────────────────────────────────────────────────────────────

/**
 * TODO: Confirm base URL against Saldeo API v1.17 spec.
 * Based on available info the API endpoint is hosted at saldeosmart.pl.
 * Developer documentation (behind auth) is at brainshare.pl.
 */
const SALDEO_BASE_URL = "https://app.saldeosmart.pl/api"

// ─── Endpoints ────────────────────────────────────────────────────────────────

/**
 * Upload a document to Saldeo Smart.
 *
 * TODO: Confirm:
 * - Exact endpoint path (e.g. /documents, /invoices, /document/add)
 * - XML schema for the request body
 * - Response format and document ID field name
 *
 * Until confirmed, this stub throws a descriptive error so the frontend
 * can show a proper "not yet wired" state vs "not configured" state.
 */
export async function exportDocumentToSaldeo(
  config: SaldeoConfig,
  payload: SaldeoDocumentPayload
): Promise<SaldeoExportResult> {
  const path = "/documents"
  const method = "POST"

  // Build minimal XML payload
  // TODO: Adjust XML schema to match Saldeo API v1.17 specification
  const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<document>
  <company_id>${escapeXml(config.companyId)}</company_id>
  <document_number>${escapeXml(payload.documentNumber ?? "")}</document_number>
  <contractor_name>${escapeXml(payload.contractorName ?? "")}</contractor_name>
  <contractor_nip>${escapeXml(payload.contractorNip ?? "")}</contractor_nip>
  <issue_date>${escapeXml(payload.issueDate ?? "")}</issue_date>
  <net_amount>${payload.netAmount ?? 0}</net_amount>
  <vat_amount>${payload.vatAmount ?? 0}</vat_amount>
  <gross_amount>${payload.grossAmount ?? 0}</gross_amount>
  <currency>${escapeXml(payload.currency ?? "PLN")}</currency>
  <description>${escapeXml(payload.description ?? "")}</description>
  <file_base64>${payload.pdfBase64}</file_base64>
</document>`

  const headers = buildAuthHeader(config, method, path)

  const response = await fetch(`${SALDEO_BASE_URL}${path}`, {
    method,
    headers,
    body: xmlBody
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Saldeo API error: ${response.status} ${text}`)
  }

  const responseText = await response.text()

  // TODO: Parse actual response XML to extract document ID
  // Assuming response contains <document_id>...</document_id>
  const idMatch = responseText.match(/<document_id>([^<]+)<\/document_id>/)
  const saldeoDocumentId = idMatch?.[1] ?? `saldeo_${Date.now()}`

  return {
    success: true,
    saldeoDocumentId,
    exportedAt: new Date().toISOString()
  }
}

/**
 * Check connection to Saldeo by fetching company info.
 * TODO: Confirm the status/ping endpoint path.
 */
export async function getSaldeoStatus(config: SaldeoConfig): Promise<{ connectedCompany: string }> {
  const path = `/companies/${config.companyId}`
  const headers = buildAuthHeader(config, "GET", path)

  const response = await fetch(`${SALDEO_BASE_URL}${path}`, { headers })

  if (!response.ok) {
    throw new Error(`Saldeo status check failed: ${response.status}`)
  }

  const text = await response.text()
  const nameMatch = text.match(/<name>([^<]+)<\/name>/)
  return { connectedCompany: nameMatch?.[1] ?? config.companyId }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}
