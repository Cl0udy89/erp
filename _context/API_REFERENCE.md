# API Reference
_Last updated: 2026-05-20 — Phase 7 endpoints added_

## Notes
- Routes use JWT cookie auth (Phase 2). Backend also has CORS enabled for browser-direct access.
- Backend API runs on port 4001 (browser-accessible via VITE_BACKEND_API_URL)
- Clockify sync service runs on port 4000

## Storage Settings (Phase 5)
- `GET /settings/storage/status` — Drive + Proxmox sync stats; auth: storage.manage; returns `{drive:{configured,synced,total,errors}, proxmox:{configured,synced,total,errors,lastSynced}}`
- `POST /settings/storage/retry-drive` — retry all docs with `drive_file_id IS NULL AND sync_error IS NOT NULL`; auth: storage.manage
- `POST /settings/storage/retry-proxmox` — retry all docs with `proxmox_synced_at IS NULL`; auth: storage.manage
- `POST /settings/storage/resync-document/:documentId` — re-sync single doc to both Drive + Proxmox (fire-and-forget); auth: storage.manage
- `POST /settings/storage/resync-all-drive` — queue all docs without `drive_file_id` for Drive sync (fire-and-forget); auth: storage.manage

## Documents (Phase 4)
- `POST /documents/upload` — multipart/form-data; fields: file, docType, workspaceId, notes?, entityType?, entityId?; auth: documents.upload; returns {document}
- `GET /documents?workspaceId=&entityType=&entityId=&docType=&q=&page=&limit=` — paginated list; auth: documents.view
- `GET /documents/:id` — single doc + linked_entities; auth: documents.view
- `GET /documents/:id/file` — stream file; PDF/image: inline; others: attachment; ?download=1 forces attachment; ?token= for browser direct; auth: documents.view
- `POST /documents/:id/link` — body: {entityType, entityId}; auth: documents.upload
- `POST /documents/:id/link/delete` — body: {entityType, entityId}; auth: documents.manage
- `POST /documents/:id/delete` — deletes DB row + file; 409 if employee contract ref; auth: documents.manage
- `POST /documents/:id/notes` — body: {notes}; auth: documents.upload
- `POST /employees/:employeeId/contract-document` — body: {documentId}; auth: employees.edit_all

## Health
`GET /health` → `{ ok: true, service: "backend-api" }`

## Workspaces
`GET /workspaces` → list all workspaces
`GET /workspaces/:workspaceId/users` → employees in workspace
`GET /workspaces/:workspaceId/projects` → projects
`GET /workspaces/:workspaceId/clients` → clients
`GET /workspaces/:workspaceId/invoices` → invoices (financial documents)
`GET /workspaces/:workspaceId/dashboard` → aggregated monthly metrics
`GET /workspaces/:workspaceId/projects/:projectId/tasks` → project tasks
`GET /workspaces/:workspaceId/time-entries` — list (query: startDate, endDate, projectId, userId)

## Projects
`POST /projects` — create project

## Time Entries (legacy — Clockify-compatible)
`POST /time-entries` — create entry (Clockify-style, use `/time-entries/manual` for Phase 0)
`POST /time-entries/:entryId/update` — update (Clockify-style)
`POST /time-entries/:entryId/delete` — delete (no lock check)

## Time Entries — Phase 0 (enhanced list + delete)
`GET /time-entries?workspaceId=X[&employeeId=Y&projectId=Z&from=DATE&to=DATE&source=S&page=N&limit=N]`
  → `{ entries: TimeEntryFull[], total: number }` — returns all Phase 0 fields (source, tags, timesheetId, etc.)
  → Default limit 100, max 500. Paginated.
  → `source` filter: clockify | manual | timer

`DELETE /time-entries/:entryId?workspaceId=X`
  → Deletes manual entry. Returns 409 if entry is in a submitted/approved timesheet (locked).
  → Use `POST /timer/discard` for running timers instead.

## Time Entries — Phase 0 (manual entry)
`POST /time-entries/manual`
  Body: `{ workspaceId, employeeId, projectId?, clientId?, description, billable?, startAt, endAt, tags?, timesheetId? }`
  → Saves entry with source='manual'. Also upserts task suggestion if description+projectId given.

`POST /time-entries/:entryId/manual-update`
  Body: `{ workspaceId, employeeId?, projectId?, clientId?, description?, billable?, startAt?, endAt?, tags?, timesheetId? }`

## Timer — Phase 0
`GET /timer/running?workspaceId=X&employeeId=Y`
  → `{ id, employeeId, workspaceId, projectId, clientId, description, startAt, tags }` or `null`

`POST /timer/start`
  Body: `{ workspaceId, employeeId }`
  → `{ id, startAt }` or 409 `{ error: "Timer already running..." }` if one exists

`POST /timer/stop`
  Body: `{ workspaceId, employeeId, description?, projectId?, clientId?, billable?, tags? }`
  → `{ id, endAt, durationSeconds }` or 404 if no running timer
  → Also upserts task suggestion if description+projectId given

`POST /timer/discard`
  Body: `{ workspaceId, employeeId }`
  → `{ success: true, discardedId }` or 404 if no running timer

## Timesheets — Phase 0
`GET /timesheets?workspaceId=X[&employeeId=Y&status=Z&periodStart=Y-M-D&periodEnd=Y-M-D]`
  → array of timesheet objects

`GET /timesheets/:timesheetId`
  → single timesheet or 404

`POST /timesheets`
  Body: `{ workspaceId, employeeId, periodStart, periodEnd, periodType? }`
  → `{ id }`

`POST /timesheets/:timesheetId/submit?workspaceId=X`
  → transitions draft → submitted (no-op if already submitted/approved)

`POST /timesheets/:timesheetId/approve`
  Body: `{ workspaceId, approvedBy }`
  → transitions submitted → approved

`POST /timesheets/:timesheetId/reject`
  Body: `{ workspaceId, rejectionNote }`
  → transitions submitted → rejected

`POST /timesheets/:timesheetId/delete`
  Body: `{ workspaceId }`
  → deletes only if status='draft'

## Timesheet Templates — Phase 0
`GET /timesheet-templates?workspaceId=X[&employeeId=Y]`
  → array of template objects

`POST /timesheet-templates`
  Body: `{ workspaceId, employeeId, name, templateData }`
  → `{ id }`

`POST /timesheet-templates/:templateId/delete`
  Body: `{ workspaceId }`
  → `{ success: true }`

## Task Suggestions — Phase 0
`GET /time-entries/suggestions?employeeId=X&projectId=Y[&q=partial]`
  → top 5 suggestions: `[{ taskName, usedCount }]`
  → ordered by usedCount DESC
  → Autocomplete: pass partial text as `q` to filter by prefix

## Financial Documents
`GET /finance/documents` — list (filters: year, month, status, type)
`GET /finance/documents/:id` — get detail
`POST /finance/documents` — create
`POST /finance/documents/:id/update`
`POST /finance/documents/:id/delete` — supports cascade option
`POST /finance/documents/:documentId/allocations` — allocate to projects
`POST /finance/allocations/:allocationId/update`
`POST /finance/allocations/:allocationId/delete`
`POST /finance/documents/:documentId/split-amounts` — split by fixed amounts
`POST /finance/documents/:documentId/split-percent` — split by percentages

## Financial Reports
`GET /finance/categories` — chart of accounts
`GET /finance/register` — accounting register (filters: year, month, projectId, clientId)
`GET /finance/flow-summary` — cash flow (from/to dates)
`GET /finance/project-profitability` — by year
`GET /finance/monthly-summary` — year/month summary
`GET /finance/project-monthly-report` — project detail
`GET /finance/project-ytd-report` — year-to-date
`GET /finance/documents-unallocated`
`GET /finance/documents-partial`

## Inventory
`GET /inventory/products`
`POST /inventory/products` — create product
`GET /inventory/movements` — list movements
`POST /inventory/movements` — create movement
`POST /inventory/movements/from-goods-purchase` — convert purchase invoice to stock
`POST /inventory/movements/goods-realization` — mark goods as realized
`GET /inventory/summary` — current stock levels + valuation

## Employees
`GET /employees/hourly-rates?workspaceId=X`
`POST /employees/:employeeId/hourly-rate` — body: `{ hourlyRate }`
`GET /employees/:employeeId/profile` — full Phase 1A profile (name, email, hourlyRate, dateOfBirth, contractType, contractNumber, contractDate, supervisorId, firstCollaborationDate, position)
`POST /employees/:employeeId/profile` — update any Phase 1A fields

## Clients — Phase 1B
`GET /clients?workspaceId=X` — list with Phase 1B fields
`GET /clients/:clientId/profile` — full Phase 1B profile (name, email, nip, address, cooperationType, notes)
`POST /clients/:clientId/profile` — update any Phase 1B fields

## Time Costs
`POST /time-entries/recalculate-costs` — recalculate all estimated costs
`GET /time-costs/by-project?workspaceId=X[&year=Y&month=M&startDate=D&endDate=D]`
`GET /time-costs/by-client?workspaceId=X[&year=Y&month=M&startDate=D&endDate=D]`

## Imports
`POST /imports/excel/preview` — parse Excel file, return preview rows
`POST /imports/excel/commit` — save previewed documents
`POST /internal/clockify/import` — [internal] Clockify data ingest (from sync service)

## Clockify Sync Service (port 4000)
`POST /sync` — trigger Clockify sync
  Body: `{ workspaceId?: string, startDate?: string, endDate?: string }`

## Time Entry Reports — Phase 0
`GET /time-entries/reports/summary?workspaceId=X&from=DATE&to=DATE&groupBy=project|employee|client`
  → `[{ groupId, groupName, groupColor, totalHours, billableHours, estimatedCost }]`
  → Aggregated hours per group, ordered by totalHours DESC

`GET /time-entries/reports/detailed?workspaceId=X&from=DATE&to=DATE[&employeeId=Y&projectId=Z&sortBy=date|duration|project|employee&sortDir=asc|desc]`
  → `{ entries: TimeEntryFull+, total: number }` — every entry with projectName, employeeName, clientName joined

`GET /time-entries/reports/weekly?workspaceId=X&employeeId=Y&weekStart=YYYY-MM-DD`
  → `{ weekStart, weekEnd, days[7], rows[{ projectId, projectName, projectColor, taskName, timesheetId, timesheetStatus, cells: {date: {hours, seconds, entryIds[]}}, totalHours }], totalByDay, grandTotal }`
  → weekStart must be a Monday (not enforced server-side)
  → Used by the weekly timesheet grid component

## PDF Export
`GET /time-entries/reports/pdf?workspaceId=X&from=DATE&to=DATE[&employeeId=Y]&token=API_INTERNAL_TOKEN`
  → Returns PDF binary (Content-Type: application/pdf)
  → Uses `token` query param (not Authorization header) for browser window.open() download
  → Generates KARTA CZASU PRACY time card with Courier font, tabular layout

## Auth — Phase 2
All auth endpoints are public (no Authorization header) except GET /auth/me and POST /auth/logout.
Authenticated routes read JWT from `access_token` httpOnly cookie.

`POST /auth/login` body: `{ email, password }` → sets httpOnly cookies (access_token 8h, refresh_token 30d) + returns `{ user: { id, email, role, employeeId, name } }`
`POST /auth/logout` → clears cookies, deletes refresh token from DB
`POST /auth/refresh` → reads refresh_token cookie, rotates both tokens
`POST /auth/forgot-password` body: `{ email }` → always 200; sends reset email or logs URL to console
`POST /auth/reset-password` body: `{ token, newPassword }` → marks token used, invalidates all refresh tokens for user
`GET /auth/me` → `{ id, email, role, employeeId, name, permissions: string[] }` — requires auth

## Users — Phase 2 (admin only)
`GET /users?workspaceId=X` → list all users with employee info
`POST /users` body: `{ workspaceId, email, role, employeeId? }` → creates user + sends invite (or logs link)
`POST /users/:userId/role` body: `{ role }` → change role
`POST /users/:userId/deactivate` → is_active=false, invalidate all refresh tokens
`POST /users/:userId/activate` → is_active=true

## Permissions — Phase 2 (admin only)
`GET /permissions?workspaceId=X` → `[{ role, permission, granted }]`
`POST /permissions` body: `{ workspaceId, role, permission, granted }` → upsert one permission
`POST /permissions/reset` body: `{ workspaceId }` → reset all permissions to defaults

## Phase 0 Status — All Complete ✅
- ✅ Timer start/stop/discard/running
- ✅ Manual time entry create/update with lock check
- ✅ Enhanced GET /time-entries list (all Phase 0 fields, paginated, filtered)
- ✅ DELETE /time-entries/:id with timesheet lock guard
- ✅ Reports: summary, detailed (CSV + PDF), weekly grid
- ✅ Timesheets CRUD + submit/approve/reject
- ✅ Timesheet templates CRUD
- ✅ Task suggestions (autocomplete)
- ✅ Approval UI (/timesheets route — Pending + History tabs)
- ✅ Templates UI (in /time-entries Weekly tab)
- ✅ PDF export endpoint + frontend download button

## Phase 1 Status — Complete ✅
- ✅ Phase 1A: Employee profile (all Phase 1A fields)
- ✅ Phase 1B: Client profile (nip, address, cooperation_type, notes)


## Phase 3: Accounting Reports ✅

All routes require `reports.accounting` permission (admin, manager, accountant — NOT consultant).

### GET /accounting/monthly
Query: `workspaceId`, `month` (YYYY-MM), `employeeId?`, `contractType?`
Response: `{ month, employees: [{ employeeId, name, contractType, totalHours, billableHours, internalRate, totalCost, entries[] }] }`

### GET /accounting/cost-vs-billed
Query: `workspaceId`, `from`, `to`, `groupBy` (employee|project|client, default: employee)
Response: `{ from, to, groupBy, rows: [{ key, totalHours, billableHours, cost, billed, margin, marginPercent }] }`

**Billing calculation decisions:**
- `hourly`: hours × billing_rate
- `fixed`: full fixed_amount for the month (not prorated) if any billable entries exist
- `subscription`: fixed_amount + max(0, totalHours - subscription_min_hours) × subscription_overage_rate
- null rate/amount → cost/billed = null (not 0)

### GET /accounting/by-contract-type
Query: `workspaceId`, `month` (YYYY-MM)
Response: `{ month, groups: [{ contractType, totalEmployees, totalHours, totalCost, employees[] }] }`
Contract types ordered: uop → zlecenie → b2b → staz → other → unset

### GET /accounting/export  (browser download via ?token=)
### POST /accounting/export (cookie auth, logs to erp_export_log)
Body / query params: `workspaceId`, `type` (monthly_pdf|monthly_csv|cost_billed_csv), `month?`, `from?`, `to?`, `employeeId?`, `contractType?`
- monthly_pdf: multi-employee KARTA CZASU PRACY + summary page, pure-JS PDF
- monthly_csv: UTF-8 BOM CSV with all time entries
- cost_billed_csv: per-employee cost vs billed summary CSV

### GET /accounting/export-history
Query: `workspaceId`
Response: `[{ id, exportType, params, createdAt, exportedBy, exportedByName }]` — last 100 exports DESC

### GET /accounting/cit-estimate ✅ Phase 7D
Query: `workspaceId`, `month` (YYYY-MM) OR `year` (YYYY) — if neither, defaults to current month
Auth: `reports.accounting`
Response:
```
{
  period: string,
  revenue: { total: number, breakdown: [{ invoiceId, documentNumber, amount, counterparty }] },
  costs: {
    purchases: { total: number, breakdown: [...] },
    personnel: {
      uop:      { total: number, employees: [{ employeeId, name, hours, rate, cost }] },
      zlecenie: { total: number, employees: [...] },
      b2b:      { total: 0, note: "Included in purchase invoices — not double-counted", employees: [...] },
      staz:     { total: number, employees: [...], warning: string },
      other:    { total: number, employees: [...] },
      total:    number
    },
    total: number
  },
  taxBase: number,
  estimatedCit9:  number | null,   ← null if taxBase ≤ 0
  estimatedCit19: number | null,
  warnings: string[]
}
```
**B2B double-count guard:** B2B employee costs are set to null / excluded from personnel sum — their invoices already appear in purchase costs.
**Audit:** fires auditAsync (action='view', entityType='cit_estimate') on every call.

## Phase 7 — OCR / Saldeo / Warehouse ✅

### GET /documents/:id/ocr ← POST /documents/:id/ocr-extract
Triggers Azure Document Intelligence `prebuilt-invoice` on the uploaded file.
Caches result in `erp_documents.ocr_data` + `ocr_processed_at`.
Auth: `documents.manage`; 503 if AZURE_DOC_INTEL_ENDPOINT/AZURE_DOC_INTEL_KEY not set.

### GET /saldeo/status
Returns `{ configured: bool, status?: string }`. 503 body if not configured.
Auth: `reports.accounting`

### POST /saldeo/export/:documentId
Exports the financial document to Saldeo Smart.
Stores `saldeo_document_id` + `saldeo_exported_at` on `erp_financial_documents`.
Auth: `reports.accounting`; 503 if not configured.

### GET /warehouse/documents
Query: `workspaceId`, `docType?` (PZ|WZ), `status?`, `from?`, `to?`, `page?`, `limit?`
Response: `{ total, rows: [warehouse doc + items] }`; auth: `warehouse.view`

### POST /warehouse/documents
Body: `{ docType: "PZ"|"WZ", financialDocId?, counterpartyId?, counterpartyType?, docDate, notes?, items?: [{ productName, quantity, unit?, unitPrice?, productId? }] }`
Creates draft warehouse document with auto-generated doc_number format: `PZ/YYYY/MM/001`.
Sequence is race-safe (MAX seq + retry on ER_DUP_ENTRY).
Auth: `warehouse.manage`
**Auto-trigger:** uploading a document with `docType=invoice` auto-creates a draft PZ linked to that document.

### GET /warehouse/documents/:id
Returns single warehouse doc with items; auth: `warehouse.view`

### POST /warehouse/documents/:id/confirm
Transitions `draft → confirmed`; auth: `warehouse.manage`

### POST /warehouse/documents/:id/cancel
Body: `{ reason? }`; transitions to `cancelled`; auth: `warehouse.manage`
