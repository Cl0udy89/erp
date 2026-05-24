# Implementation Status
_Last updated: 2026-05-21 — Phase 0–7 + Polish Pass complete_

## ✅ Done (inherited from interns + Tomasz)
- **Clockify sync:** Full paginated import (workspaces, clients, projects, employees, time entries). Port 4000.
- **Financial documents:** Create/update/delete, multi-project allocation, split by amount or %. Full CRUD.
- **Profit calculations:** CIT-aware, multi-currency, revenue/cost/margin per project. See `finance-domain.ts`.
- **Cash flow / reporting:** Monthly summary, YTD, project profitability, register view. All in backend API.
- **Inventory/stock:** Products table, stock movements (PURCHASE/ISSUE/SALE/CORRECTION). Basic UI exists.
- **Excel import:** Preview + commit flow, fuzzy name matching. Financial documents only.
- **i18n (EN/PL):** `src/locales/en.json` + `pl.json`, LanguageProvider in `__root.tsx`.
- **Employee profiles (partial):** Name, email, status, profile_picture, hourly_rate.
- **Client profiles (partial):** Name, email, archived flag.
- **Project model (partial):** Name, billable flag, color, client_id — no billing rate yet.
- **Dashboard:** Basic widgets, workspace selector.
- **Docker Compose:** 4 services (frontend, backend-api, clockify-sync, mysql). Production-ready.

## ✅ Phase 0 Backend — Complete (all endpoints ready)
- **DB migrations:** source/timesheet_id/tags on erp_time_entries; billing fields on erp_projects; erp_timesheets, erp_timesheet_templates, erp_task_suggestions tables
- **Timer API:** `POST /timer/start` (with 409 conflict guard), `POST /timer/stop`, `POST /timer/discard`, `GET /timer/running`
- **Manual entry API:** `POST /time-entries/manual`, `POST /time-entries/:entryId/manual-update`
- **Timesheets API:** CRUD + submit/approve/reject status transitions
- **Timesheet templates API:** Create/list/delete
- **Task suggestions API:** `GET /time-entries/suggestions?employeeId=X&projectId=Y&q=partial` — top 5 by used_count DESC; auto-upserted on every entry save
- **Enhanced list:** `GET /time-entries?workspaceId=X&...` — Phase 0 fields, paginated
- **Locked delete:** `DELETE /time-entries/:id?workspaceId=X` — 409 if entry in submitted/approved timesheet
- **Reports:** `GET /time-entries/reports/summary|detailed|weekly` — all implemented

## ✅ Phase 0 Frontend — Complete (2026-05-20)

### Files created / updated (Phase 0):
- `src/api/time-tracking.ts` — All server functions + React Query hooks for timer, manual entry, weekly report, timesheets, task suggestions, reports
- `src/lib/backend-client.ts` — Added `backendDelete()` helper
- `src/locales/en.json` + `pl.json` — `tracker.*` and `reports.*` i18n key groups
- `src/components/timer-widget.tsx` — Persistent navbar timer
- `src/components/time-entry-form.tsx` — Dialog form for create/edit/complete-timer modes
- `src/routes/time-entries.tsx` — 3-tab layout: Tracker / Weekly / Calendar
- `src/routes/time-reports.tsx` — Summary / Detailed (CSV + PDF export) / Weekly tabs
- `src/components/dashboard-layout.tsx` — TimerWidget in header, time-reports + timesheets nav items

## ✅ Phase 0 Deferred Items — Complete (2026-05-20)

### Approval UI (manager view)
- `src/routes/timesheets.tsx` — NEW: Pending tab (approve/reject with modal), History tab (filter by employee + month, expandable rejection notes)
- `src/api/time-tracking.ts` — Added `useManagerTimesheets` (all-workspace, no employeeId required)
- `src/routeTree.gen.ts` — Added TimesheetsRoute + TimeReportsRoute

### Timesheet templates UI
- `src/routes/time-entries.tsx` — Added TemplatesPanel in Weekly tab: list templates, save current week, apply, delete
- `src/api/time-tracking.ts` — Added `useTimesheetTemplates`, `useCreateTimesheetTemplate`, `useDeleteTimesheetTemplate`

### PDF export
- `src/services/backend-api-service.ts` — `GET /time-entries/reports/pdf` endpoint (pure-JS buildSimplePdf, token via query param for browser download)
- `src/routes/time-reports.tsx` — PDF button on Detailed tab opens URL in new tab

## ✅ Phase 1A — Consultant Profile — Complete (2026-05-20)

### DB migrations (addColumnIfMissing in db.ts):
- `date_of_birth`, `contract_type`, `contract_number`, `contract_date`, `contract_document_id`, `supervisor_id`, `first_collaboration_date`, `position` on `erp_employees`
- Note: `hourly_rate` already exists (serves as internal_rate equivalent)

### Backend:
- `GET /employees/:employeeId/profile` — returns full Phase 1A profile
- `POST /employees/:employeeId/profile` — updates all Phase 1A fields

### Frontend:
- `src/routes/people.tsx` — Added ProfileDialog with Personal Info / Contract / Work sections; supervisor dropdown; "Link document" disabled with tooltip; hourly rate field (Phase 2 will hide from Consultant role)
- `src/api/time-tracking.ts` — `useEmployeeProfile`, `useUpdateEmployeeProfile`

## ✅ Phase 1B — Client Profile — Complete (2026-05-20)

### DB migrations:
- `nip`, `address`, `cooperation_type`, `notes` on `erp_clients`

### Backend:
- `GET /clients/:clientId/profile` — returns Phase 1B profile
- `POST /clients/:clientId/profile` — updates Phase 1B fields
- `GET /clients?workspaceId=X` — list all clients with Phase 1B fields

### Frontend:
- `src/routes/projects.tsx` — Added Clients tab with ClientProfileDialog (name/email/NIP/cooperation type/address/notes)
- `src/api/time-tracking.ts` — `useClientProfile`, `useUpdateClientProfile`

## ⏳ Not Started — Phase 1 remaining
- Per-project billing type/rate UI (backend columns exist from Phase 0)
- Consultant projects list in profile (assigned projects with date ranges)

## ✅ Phase 2 — Auth & RBAC — Complete (2026-05-20)

### Architecture:
- JWT HS256 in httpOnly cookies (access: 8h, refresh: 30d with DB revocation via token rotation)
- Passwords: `Bun.password.hash()` / `Bun.password.verify()` (Argon2id built-in)
- Forgot password: SHA-256 hashed token, SMTP email (console.warn if unconfigured)
- Auth middleware: `requireAuth(request)` → user object or Response(401); `requirePermission(user, workspaceId, permission)` → null or Response(403)
- `seedAdminUser()` — idempotent, reads ADMIN_EMAIL/ADMIN_PASSWORD from env
- `seedDefaultPermissions(workspaceId)` — seeds 23 permission keys with role defaults

### New tables:
- `erp_users` — credentials + role (admin/manager/consultant/accountant)
- `erp_refresh_tokens` — for session revocation (rotated on refresh)
- `erp_password_resets` — 1-hour expiry tokens (hashed)
- `erp_role_permissions` — configurable per-workspace permission flags

### New files:
- `src/lib/auth-service.ts` — JWT helpers, cookie helpers, password wrappers, permission cache (5-min TTL), email sender
- `src/lib/auth-context.tsx` — AuthProvider, useAuth(), usePermission(), getMeFn/loginFn/logoutFn server functions
- `src/routes/login.tsx` — Login page
- `src/routes/forgot-password.tsx` — Forgot password page
- `src/routes/reset-password.tsx` — Reset password page (reads ?token= from URL)
- `src/routes/settings/users.tsx` — User management (admin only)
- `src/routes/settings/permissions.tsx` — RBAC permission grid (admin only)

### Route protection:
- All existing routes now call `requireAuth()` at the top of each handler
- Permission checks per route group (time_entries, employees, clients, reports, documents, inventory, users, rbac)
- `stripSensitiveFields()` applied to all employee profile responses (hides hourly_rate from consultant role)
- `/internal/clockify/import` still uses the original bearer token check

### Cookie forwarding:
- `src/lib/backend-client.ts` — updated to forward Cookie header from SSR context via `vinxi/http`'s `getRequestHeader`

### Critical requirements met:
- Timing-attack prevention on login (dummy hash verify for not-found user)
- Consultant limited edit: only name/email/profile_picture allowed on own profile
- `employees.view_internal_rate` enforced at API level, not just UI
- Refresh token rotation on every /auth/refresh call

## ✅ Phase 3 — Accounting Reports — Complete (2026-05-20)

### DB migrations:
- `erp_export_log` table (workspace_id, exported_by, export_type, params JSON, created_at)
- `reports.accounting` permission added to seedDefaultPermissions (admin+manager+accountant: true, consultant: false)

### Backend (backend-api-service.ts):
- `GET /accounting/monthly` — time entries grouped by employee, month filter, optional employee/contract-type filter
- `GET /accounting/cost-vs-billed` — cost vs billed analysis, group by employee|project|client
- `GET /accounting/by-contract-type` — employees grouped by contract_type, ordered: uop/zlecenie/b2b/staz/other/unset
- `GET /accounting/export` — browser-download via `?token=` (PDF or CSV streaming)
- `POST /accounting/export` — same logic, logs to erp_export_log
- `GET /accounting/export-history` — last 100 exports DESC with user name

### Billing decisions documented (GET /accounting/cost-vs-billed):
- fixed: full fixed_amount per month (no proration) if any billable entries exist
- subscription: base + overage for hours above subscription_min_hours
- null rates: cost/billed returned as null (not 0) — surfaces in UI as "—"

### PDF export:
- `buildMultiPagePdf(pages[])` — new function, one page per employee + final summary page
- Reuses same pure-JS PDF approach, Courier font, no new dependencies
- Changed from single-page `buildSimplePdf` to multi-page by building proper Page/Content object arrays

### Frontend:
- `src/api/accounting.ts` — React Query hooks for all 5 endpoints
- `src/routes/accounting.tsx` — 4-tab layout: Monthly Report | Cost vs Billed | By Contract Type | Export History
- `src/components/dashboard-layout.tsx` — Accounting nav item (Calculator icon, shows if `reports.accounting` permission)
- `src/routeTree.gen.ts` — AccountingRoute registered
- `src/locales/en.json` + `pl.json` — `nav.accounting` key added

## ✅ Phase 4 — Document Management — Complete (2026-05-20)

### DB migrations:
- `erp_documents` table — id, workspace_id, uploaded_by, doc_type (ENUM 8 types), original_name, storage_path, mime_type, file_size_bytes, contains_personal_data, notes
- `erp_document_links` — junction table (document_id, entity_type ENUM, entity_id) with UNIQUE key
- `erp_financial_documents.document_id VARCHAR(64) NULL` — addColumnIfMissing
- `documents.manage` permission seeded (admin+manager: true, consultant+accountant: false)

### Backend (backend-api-service.ts):
- `POST /documents/upload` — multipart/form-data; local filesystem storage under UPLOADS_DIR env (default: ./uploads); path pattern: {workspaceId}/{docType}/{YYYY-MM}/{uuid}.{ext}
- `GET /documents` — list with filters (entityType, entityId, docType, q search, page/limit)
- `GET /documents/:id` — single document + linked entities
- `GET /documents/:id/file` — stream file; PDFs/images inline, others attachment; supports ?download=1; cookie auth + ?token= for direct browser access
- `POST /documents/:id/link` — add entity link (INSERT IGNORE)
- `POST /documents/:id/link/delete` — remove entity link
- `POST /documents/:id/delete` — delete record + file; 409 if employee contract_document_id references it
- `POST /documents/:id/notes` — update notes
- `POST /employees/:employeeId/contract-document` — set/clear contract_document_id on employee
- CORS headers added to all backend responses (reflects Origin, allows credentials) to support browser-direct multipart uploads

### Storage:
- Files stored at `{UPLOADS_DIR}/{workspaceId}/{docType}/{YYYY-MM}/{uuid}.{ext}`
- UPLOADS_DIR env var (default `./uploads`); MAX_FILE_SIZE_MB (default 25)
- Allowed types: pdf, jpg, jpeg, png, webp, docx, xlsx
- contains_personal_data auto-set to TRUE for id_document type

### PDF Viewer approach:
- Browser-native iframe-based renderer (no pdfjs-dist dependency)
- All modern browsers render PDFs natively in iframes; images use `<img>` tag
- docx/xlsx: file-icon + download-only
- Direct file URL uses `credentials: "include"` from browser → backend (CORS enabled)

### Frontend:
- `src/api/documents.ts` — server functions + React Query hooks for all document operations
- `src/components/pdf-viewer.tsx` — PdfViewer component (iframe for PDF, img for images, download-only for docx/xlsx)
- `src/routes/documents.tsx` — Two-panel document library (list + detail), upload drawer (drag-and-drop), link picker, inline notes editing, delete
- `src/components/dashboard-layout.tsx` — "Documents" nav item (FolderOpen icon, shows if documents.view permission)
- `src/locales/en.json` + `pl.json` — nav.documents key
- `src/routeTree.gen.ts` — DocumentsRoute registered
- `src/routes/people.tsx` — Contract section "Link document" button now active; shows existing contract_document_id; directs user to Documents sidebar

### Invoice table:
- No `erp_invoices` table exists. Closest is `erp_financial_documents` (already has `file_url TEXT NULL`).
- Added `document_id VARCHAR(64) NULL` to `erp_financial_documents` via addColumnIfMissing for future wiring.
- Invoice upload form integration deferred — `erp_financial_documents` form in financials.tsx can be wired in a follow-up.

## ✅ Phase 5 — Google Drive + Proxmox Storage — Complete (2026-05-20)

### DB migrations:
- `erp_documents`: drive_file_id, drive_folder_id, drive_synced_at, proxmox_synced_at, sync_error (addColumnIfMissing)
- `erp_drive_folders` table — cached folder IDs to avoid repeated Drive API lookups
- `storage.manage` permission seeded (admin only)

### Backend:
- `src/lib/drive-sync.ts` — raw Drive v3 REST API (no googleapis npm), service account JWT auth via Node.js crypto module; `getOrCreateDriveFolder` with in-memory race-condition mutex; resumable upload for >5 MB; shortcuts for secondary linked entities
- `src/lib/proxmox-sync.ts` — rsync over SSH via child_process.spawnSync; ssh mkdir -p first, then rsync -az --checksum
- `POST /documents/upload` now fires `syncDocumentToDrive` + `syncDocumentToProxmox` as background promises (fire-and-forget)
- 5 new `/settings/storage/*` routes; permission: storage.manage

### Implementation decisions:
- **No googleapis package** — raw Drive v3 REST via fetch to avoid Bun/Node.js compatibility risk. Service account JWT (RS256) built with Node.js crypto.createSign which Bun supports natively.
- **Race condition guard** — `inFlight` Map in drive-sync.ts: simultaneous uploads for the same new entity await the same folder-creation promise; zero duplicate Drive folder risk.
- **Proxmox mkdir** — `ssh mkdir -p {dir}` runs before rsync. rsync does NOT auto-create remote dirs, so the two-step is necessary.
- **sync_error concatenation** — Proxmox errors append to Drive errors with ` | ` separator so neither overwrites the other.

### Frontend:
- `src/lib/drive-sync.ts`, `src/lib/proxmox-sync.ts` — backend-only
- `src/api/documents.ts` — `DocumentRecord` updated with 5 sync fields; storage API hooks (useStorageStatus, useRetryDriveSync, useRetryProxmoxSync, useResyncDocument, useResyncAllDrive)
- `src/routes/documents.tsx` — DocRow now shows ☁ (Drive) + 🖥 (Proxmox) icons (green=synced, grey=pending, red=error) with hover tooltips
- `src/routes/settings/storage.tsx` — Storage settings page: Drive card + Proxmox card with stats, retry buttons, re-sync-all (with confirm dialog)
- `src/routeTree.gen.ts` — SettingsStorageRoute registered
- `src/components/dashboard-layout.tsx` — "Storage" nav item (HardDrive icon, shows if storage.manage permission)

## ✅ Phase 6 — Audit Trail — Complete (2026-05-20)

### DB migrations (db.ts):
- `erp_audit_log` table — id, workspace_id, actor_user_id, actor_name, actor_role, action, entity_type, entity_id, entity_label, changed_fields (JSON), metadata (JSON), ip_address, created_at(3)
- Indexes on (workspace_id, created_at DESC), (workspace_id, entity_type, entity_id), (workspace_id, actor_user_id)
- `drive_sync_error` + `proxmox_sync_error` columns on erp_documents (renamed from single `sync_error`)
- `migrateSyncErrorColumn()` migration function to copy existing sync_error data to both new columns
- `audit.view` permission seeded (admin+manager: true, consultant+accountant: false)

### Backend (src/lib/audit.ts):
- `AuditActor`, `AuditEntry`, `AuditAction` types
- `getClientIp(request)` — extracts real IP from X-Forwarded-For / X-Real-IP / socket
- `diffFields(old, new)` — shallow diff returning `{field: {from, to}}` for changed values only
- `audit(actor, entry)` — async INSERT into erp_audit_log (awaited)
- `auditAsync(actor, entry)` — fire-and-forget wrapper (never throws, never blocks response)

### Backend (backend-api-service.ts) — instrumented routes:
- `makeActor(user, request)` helper function
- POST /time-entries/manual → create
- POST /time-entries/:entryId/manual-update → update (diff against old)
- POST /time-entries/:entryId/delete → delete (with snapshot)
- POST /timer/stop → create (source: timer)
- POST /timesheets/:id/submit|approve|reject → submit/approve/reject
- GET /employees/:id/profile → view (non-consultant only, internal_rate field)
- POST /employees/:id/profile → update (diff) + extra view if hourly_rate changed
- POST /clients/:id/profile → update
- POST /documents/upload → create
- POST /documents/:id/link → link
- POST /documents/:id/link/delete → unlink
- POST /documents/:id/delete → delete (with snapshot)
- GET /documents/:id/file → view (only if contains_personal_data=true and authenticated user)
- POST /auth/login → login
- POST /auth/logout → logout (captures user before cookie clear)
- POST /users → create
- POST /users/:id/role → role_change (with old_role captured)
- POST /permissions → permission_change
- POST /accounting/export (real user only) → export
- Storage status queries updated: `sync_error LIKE '%Drive%'` → `drive_sync_error IS NOT NULL`

### Backend — GET /audit endpoint:
- Permission guard: `audit.view`
- Filters: workspaceId (required), entityType, entityId, actorUserId, action, from, to, q (search)
- Pagination: limit (max 200, default 50) + offset
- CSV export: format=csv returns streaming CSV up to 5000 rows
- JSON response: `{total, rows, limit, offset}`

### Frontend:
- `src/api/audit.ts` — `useAuditLog` hook, `auditCsvUrl` helper, `AuditRow`/`AuditListResponse` types
- `src/routes/audit.tsx` — Audit log page: filter bar (search, entity type, action, date range) + sortable table + expandable detail rows (changed fields diff, metadata JSON) + pagination + CSV export
- `src/components/dashboard-layout.tsx` — "Audit Log" nav item (Shield icon, shows if audit.view permission)
- `src/routeTree.gen.ts` — AuditRoute registered

## ✅ Phase 7 — Saldeo / OCR / Warehouse / CIT — Complete (2026-05-20)

### ✅ Part A — OCR (Azure Document Intelligence)
- `POST /documents/:id/ocr-extract` — calls Azure DI `prebuilt-invoice`; caches result in `erp_documents.ocr_data` (JSON) + `ocr_processed_at`
- Azure creds: `AZURE_DOC_INTEL_ENDPOINT` + `AZURE_DOC_INTEL_KEY` env vars
- `src/api/documents.ts` — `useDocumentOcr` hook, `OcrResult` type
- OCR panel in `src/routes/documents.tsx` (detail pane, "Extract with OCR" button)

### ✅ Part B — Saldeo Smart Integration
- `GET /saldeo/status` — checks configuration (SALDEO_API_KEY + SALDEO_COMPANY_ID)
- `POST /saldeo/export/:documentId` — exports a document to Saldeo; caches `saldeo_document_id` + `saldeo_exported_at` on `erp_financial_documents`
- `src/api/accounting.ts` — `useSaldeoStatus`, `useSaldeoExport` hooks
- Saldeo export button in document detail pane

### ✅ Part C — Warehouse PZ/WZ
- `erp_warehouse_documents` + `erp_warehouse_document_items` tables in db.ts
- `POST /warehouse/documents` — creates draft PZ/WZ with auto-generated doc_number (`PZ/YYYY/MM/001`)
- Sequence is race-safe: MAX(seq) + retry on ER_DUP_ENTRY (up to 3 attempts)
- `GET /warehouse/documents` + `GET /warehouse/documents/:id` — list + detail
- `POST /warehouse/documents/:id/confirm` — draft → confirmed
- `POST /warehouse/documents/:id/cancel` — any → cancelled (with reason)
- Auto-PZ: uploading a document with `docType=invoice` automatically creates a draft PZ linked to it (fire-and-forget, catches own errors)
- `warehouse.manage` + `warehouse.view` permissions seeded

### ✅ Part D — CIT Tax Base Estimate
- `GET /accounting/cit-estimate?workspaceId=X&month=YYYY-MM|year=YYYY` — full response shape
- Revenue: `erp_financial_documents` where `document_type IN ('SALES_INVOICE','REVENUE')`
- Purchases: `erp_financial_documents` where `document_type IN ('PURCHASE_INVOICE','EXPENSE','GOODS_PURCHASE')`
- Personnel: `erp_time_entries × erp_employees.hourly_rate` grouped by contract_type; B2B excluded from sum (already in purchases)
- B2B double-count guard: `personnel.b2b.total = 0`, note field explains; separate warning in warnings[]
- Warnings: missing rate count, B2B present, staz present
- Fires `auditAsync` (action='view', entityType='cit_estimate', metadata={period})
- Frontend: `CitEstimateTab` in `src/routes/accounting.tsx` (5th tab, grid-cols-5)
- `useCitEstimate` hook in `src/api/accounting.ts`

## ✅ i18n — Complete (2026-05-21)
- Infrastructure: LanguageProvider in `__root.tsx`, `useTranslation()` hook, `src/locales/en.json` + `pl.json`
- localStorage key: `erp_lang` (`pl` default)
- Language toggle: header dropdown in DashboardLayout
- ~206 new translation keys added: auth.*, action.*, common.*, timesheets.*, accounting.*, documents.*, warehouse.*, audit.*, settings.*, people.*, projects.*
- Pages wired: Login, DashboardLayout nav (all items), Timesheets approval, Accounting (tabs/title), Audit (title/filters/buttons)
- Pages with partial wiring (keys exist, wiring deferred): Documents, Warehouse, People, Settings sub-pages
- PDF language selector: deferred (keys ready in locales)

## ✅ Login Bug — Fixed (2026-05-21)
- **Root cause**: `loginFn` and `logoutFn` in `auth-context.tsx` called `backendPost()` which dropped backend `Set-Cookie` headers. Browser never received auth cookies → page refresh always logged user out.
- **Fix**: `loginFn` now does direct `fetch` to backend and calls `appendResponseHeader("set-cookie", ...)` from `vinxi/http` to forward cookies to the browser. `logoutFn` similarly forwards cookie-clearing headers.
- **Auth ping**: Added `GET /auth/ping` endpoint (requires cookie, returns `{ok, userId, role}`).

## ❌ Known Issues / Tech Debt
- No request validation on POST body (catch-all `.catch(() => ({}))`)
- No audit logging on financial records
- `erp_time_entries.task_id` is a Clockify FK — needs refactoring for internal entries (Phase 1)
- `JWT_SECRET` must be set in .env (min 32 chars) before going to production
- SMTP not configured by default — reset emails are logged to console
- `API_INTERNAL_TOKEN` does double duty: inter-service auth AND browser-download session bypass. It's a static secret with no expiry. If leaked, grants download access to all exports/files/audit CSV across all workspaces.
- Timer start/stop conflict check uses `SELECT COUNT(*)` before `INSERT` with no row-level lock — narrow TOCTOU race under simultaneous requests (acceptable for team size).

## ✅ Polish Pass — Complete (2026-05-21)

### Steps completed:
- **STEP 1**: Added new i18n keys to en.json + pl.json: `pdf.*`, `clockify.*`, `billing.*` sections; additions to `people.*`, `projects.*`, `audit.*`, `warehouse.*`, `documents.*`, `settings.*` sections.
- **STEP 2–7**: Wired i18n in `people.tsx`, `projects.tsx`, `documents.tsx`, `warehouse.tsx`, `settings/users.tsx`, `settings/storage.tsx`. All pages now fully translated.
- **STEP 8**: PDF language selector — `lang` param added to `GET /time-entries/reports/pdf` backend; `pdfLang` state (localStorage `erp_pdf_lang`) + language toggle UI added to `time-reports.tsx`.
- **STEP 9**: Per-project billing type/rate UI — `createErpProject` + new `updateErpProject` in `erp-write-service.ts`; `PUT /projects/:id` in backend; billing section (type selector + conditional rate inputs) in Create Project dialog in `projects.tsx`; `CreateProjectSchema` in `mutations.ts` extended.
- **STEP 10**: Clockify import button — `handleClockifyImport` function + "Import from Clockify" button added to `time-entries.tsx` header area; posts to sync service `/import` endpoint with toast feedback.
- **STEP 11**: Entity-level activity sections — `useEntityAudit` hook added to `src/api/audit.ts`; "Recent activity" section added to `ProfileDialog` in `people.tsx`, `ClientProfileDialog` in `projects.tsx`, and `DetailPanel` in `documents.tsx`. Shows last 10 audit events for the entity.
- **STEP 12**: `manual_avatar_override` flag — DB column `TINYINT(1) DEFAULT 0` on `erp_employees` (addColumnIfMissing); `upsertUsers` in `clockify-import-service.ts` uses `IF(manual_avatar_override = 1, profile_picture, VALUES(profile_picture))` to skip overwrite; `updateEmployeeProfile` in `erp-write-service.ts` sets flag=1 when `profilePicture` is updated; `POST /employees/:id/reset-avatar` endpoint clears flag; `useResetEmployeeAvatar` hook in `time-tracking.ts`; override badge + reset button in `ProfileDialog`; `getEmployeeProfile` in `erp-repository.ts` returns `manualAvatarOverride` field.
- **STEP 13**: Updated `_context/IMPLEMENTATION_STATUS.md`, `_context/DB_SCHEMA.md`, `CLAUDE.md`.

### New endpoints added:
- `POST /employees/:employeeId/reset-avatar` — clears manual_avatar_override, re-enables Clockify sync for profile picture

### New hooks added:
- `useEntityAudit(workspaceId, entityType, entityId)` in `src/api/audit.ts`
- `useResetEmployeeAvatar()` in `src/api/time-tracking.ts`

## ✅ Period Locking — Complete (2026-05-21)

- `erp_accounting_periods` table: `id, workspace_id, period (YYYY-MM), status ENUM('open','closed'), closed_by, closed_at, notes`
- `accounting.close_period` permission seeded (admin only)
- `isPeriodOpen(workspaceId, dateString)` helper in backend-api-service.ts — returns true if no row OR status != 'closed'
- HTTP 423 guards on 7 endpoints: POST /time-entries/manual, /manual-update, /:id/delete, POST /finance/documents, /finance/documents/:id/update, POST /warehouse/documents, /warehouse/documents/:id/confirm
- 3 new routes: GET /accounting/periods, POST /accounting/periods/:period/close|reopen — admin only, audit logged
- Frontend: `useAccountingPeriods`, `useClosePeriod`, `useReopenPeriod` hooks in accounting.ts; "Okresy" 6th tab in accounting.tsx with 24-month status table, open/closed badges, admin-only close/reopen buttons, AlertDialog confirmation
- New `src/components/ui/alert-dialog.tsx` (Radix AlertDialog)

## ✅ Project P&L Materials — Complete (2026-05-21)

- `project_id VARCHAR(64) NULL` + `idx_warehouse_project` index added to `erp_warehouse_documents` via addColumnIfMissing
- `POST /warehouse/documents` now accepts and stores `projectId`
- Warehouse create form: optional "Projekt (opcjonalnie)" dropdown passes projectId
- `GET /accounting/cost-vs-billed`: when groupBy=project, fetches confirmed PZ item totals grouped by project_id and adds `materialsCost` field; recalculates `totalCost = personnelCost + materialsCost`, `margin`, `marginPercent`
- `CostBilledRow` interface extended with `personnelCost`, `materialsCost`, `totalCost`
- Cost vs Billed table: when groupBy=project, shows Personnel cost | Materials cost | Total cost | Billed | Margin columns

## ✅ UI Wow Pass — Complete (2026-05-21)

### 3A Dashboard (src/routes/index.tsx)
- 4 KPI cards (border-l-4 accent): Hours this month (blue), Revenue this month (green), Pending timesheets (amber), Drive sync errors (red) — all clickable links, refetchInterval 60s
- ActiveTimerPanel: real-time ticking elapsed time via setInterval, Start timer button if no running timer
- PendingApprovalsPanel: managers see pending timesheets with quick Approve buttons; consultants see own projects
- Recent activity: admins see last 5 audit events; others see own last 5 time entries

### 3B Sidebar (src/components/dashboard-layout.tsx)
- `GET /workspace/badge-counts` endpoint: pendingTimesheets, syncErrors, staleDraftWarehouse
- Notification badges: amber on Timesheets (pending count), red on Storage (sync errors), amber on Warehouse (stale drafts)
- Collapsible sidebar: chevron toggle, localStorage `erp_sidebar_collapsed`, w-64 ↔ w-16
- Icons-only mode with Tooltip labels on hover when collapsed
- User section: DropdownMenu with initials avatar, shows name+role, logout item

### 3C Empty States
- `src/components/empty-state.tsx` shared component (icon, title, subtitle, optional action button)
- Applied to: people.tsx (no employees), projects.tsx (no projects/clients), time-entries.tsx (no entries), warehouse.tsx (no PZ/WZ docs), audit.tsx (no results), timesheets.tsx (no pending/history)

### 3D Skeleton Loading
- warehouse.tsx: 5 skeleton rows while loading
- Other pages already had skeleton states from previous phases

### 3E Page Headers
- Subtitles added to: time-entries.tsx, people.tsx, accounting.tsx, warehouse.tsx, audit.tsx, timesheets.tsx

### 3F Micro-interactions
- Button loading spinners: people.tsx ProfileDialog save, timesheets.tsx approve/reject buttons
- Table row hover: warehouse.tsx rows get hover:bg-muted/50

## 🔶 Deferred Items

### Not built — requires future work:
1. **Invoice form ↔ document linking** — `erp_financial_documents.document_id` column added, but the financials.tsx upload/edit form does not expose a picker. Wiring requires a document picker component in the financial document dialog.
2. **contract_document_id inline picker** — Employee profile "Link document" button navigates user to Documents sidebar instead of opening an inline picker.
3. **Multi-workspace user login** — First workspace match on login. No workspace selection at login screen.
4. **Saldeo API stub** — Ready-to-wire stub. Actual endpoint paths, XML schema, HMAC signature format need Saldeo API v1.17 spec.
5. ✅ **Consultant projects list** — DONE (2026-05-21). `GET /employees/:employeeId/projects` backend route (infers assignment from `erp_time_entries`). `useEmployeeProjects` hook. "Przypisane projekty" section in ProfileDialog (people.tsx) with Skeleton, badge per status, client name.
6. ✅ **Financial document audit trail** — DONE (2026-05-21). `auditAsync` added to POST /finance/documents (create), POST /finance/documents/:id/update (update with diffFields), POST /finance/documents/:id/delete (with snapshot). Saldeo export was already audited. `EntityActivityLog` component extracted to `src/components/EntityActivityLog.tsx`; used in people.tsx, projects.tsx, documents.tsx, financials.tsx (details tab, gated on `audit.view` permission).
7. ✅ **UI Polish DONE (2026-05-21)** — Documents empty state (two-variant: no-docs + no-results-with-filters), full i18n for Phase 10 hardcoded strings (dashboard KPI labels, sidebar collapse, accounting period tab, CostVsBilled columns, warehouse project dropdown), Ctrl+Enter + hint added to ProfileDialog and CreateProject dialog, form validation (red border + error) on employee name, toasts standardised across warehouse/accounting/projects.
