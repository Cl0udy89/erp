# Architecture
_Last updated: 2026-05-20_

## Stack
- **Frontend:** TanStack Start (SSR React), TanStack Router (file-based), TanStack Query, React 19, Tailwind CSS 4, Radix UI, Recharts — Port 3000
- **Backend API:** Bun.serve (raw HTTP), mysql2/promise — Port 4001
- **Sync service:** Bun.serve, Clockify API client — Port 4000
- **Database:** MySQL 8.4 — Port 3306
- **Deployment:** Docker Compose on Proxmox/VPS (single-tenant, no cloud lock-in)

## Services
```
[Browser] → Frontend :3000 (TanStack Start SSR)
                ↓ REST (Bearer token)
          Backend API :4001 (Bun.serve)
                ↓ mysql2
            MySQL :3306

[Frontend] → Clockify Sync :4000
                ↓ REST (Bearer token)
          Backend API :4001  ← also receives imported data
                ↓ Clockify REST API
           api.clockify.me

[Backend API — after each upload, fire-and-forget]
          → Google Drive v3 REST API (service account JWT)
          → Proxmox NAS via rsync over SSH
```

## Storage Layer (Phase 5)
- **Local FS** (`UPLOADS_DIR`): primary source of truth; path pattern `{wsId}/{docType}/{YYYY-MM}/{uuid}.{ext}`
- **Google Drive**: service account auth (RS256 JWT via Node.js crypto); raw Drive v3 REST API (no googleapis npm); folder cache in `erp_drive_folders`; race-condition guard via in-memory Map of in-flight promises
- **Proxmox**: rsync over SSH (`child_process.spawnSync`); `ssh mkdir -p` before rsync; remote path mirrors local structure
- Both syncs are **fire-and-forget** — upload response returns immediately after local write; failures logged to `erp_documents.sync_error`
- Credentials: see `_context/CREDENTIALS_SETUP.md`

## Folder Structure
```
src/
  lib/
    db.ts                    ← schema init + migration helpers
    erp-repository.ts        ← all read queries
    erp-write-service.ts     ← all write operations
    finance-service.ts       ← financial calculations
    finance-domain.ts        ← pure business logic (unit tested)
    finance-types.ts         ← shared TypeScript types
    clockify.ts              ← Clockify API client
    clockify-import-service.ts ← maps Clockify data → DB rows
    clockify-schemas.ts      ← Zod schemas for Clockify API responses
    excel-import-service.ts  ← Excel → financial documents
    i18n.tsx                 ← i18n provider + useTranslation hook
    backend-client.ts        ← frontend REST client with auth header
    search-schema.ts         ← Zod schemas for search/filter params
    utils.ts                 ← shared utilities
  services/
    backend-api-service.ts   ← all REST routes (monolithic, single file)
    clockify-sync-service.ts ← Clockify sync trigger
  api/                       ← TanStack Query hooks (one file per domain)
    finance.ts, imports.ts, mutations.ts, queries.ts, sync.ts
  routes/                    ← TanStack Router file-based pages
    __root.tsx, index.tsx, financials.tsx, inventory.tsx
    invoices.tsx, people.tsx, projects.tsx, reports.tsx, time-entries.tsx
  components/
    dashboard-layout.tsx     ← sidebar nav, workspace selector
    ui/                      ← shadcn-style primitives
  locales/
    en.json, pl.json         ← i18n strings
  env.ts                     ← Zod-validated environment config
  router.tsx                 ← router configuration
_context/                    ← living context files (always up to date)
```

## Key Decisions Made
- **2026-05-21:** CORS policy — origin is validated against `ALLOWED_ORIGINS` env var (comma-separated, default `http://localhost:3000`). Only whitelisted origins are reflected. No wildcard fallback. Must be set to production domain before go-live.
- **2026-05-21:** `API_INTERNAL_TOKEN` is used for both inter-service auth AND browser-download token bypass (`?token=` on PDF/file/CSV routes). Static secret with no expiry. Treat as a secret credential. Future improvement: per-user short-lived download tokens.
- **2026-05-21:** Timesheet lock — both DELETE and manual-update of time entries are blocked (409) when the entry's timesheet is in `submitted` or `approved` status. Lock check reuses `canDeleteTimeEntry()` for both operations.
- **2026-05-20:** Option A chosen — extend TypeScript codebase, not Odoo/ERPNext
- **2026-05-20:** No ORM — raw SQL with parameterized queries via mysql2
- **2026-05-20:** MySQL 8.4 kept — no migration to Postgres
- **2026-05-20:** `erp_time_entries` is single table for Clockify + manual entries (distinguished by `source` column to be added in Phase 0)
- **2026-05-20:** Billing rates are per-project, not per-client
- **2026-05-20:** Auth deferred to Phase 2 — system on trusted Docker network until then
- **2026-05-20:** Consultant's internal `hourly_rate` is the most sensitive field — must never reach Consultant role API responses
- **2026-05-20:** Phase build order: 0 (time tracking) → 1 (profiles) → 2 (auth) → 3 (reports) → 4 (docs) → 5 (storage) → 6 (audit) → 7 (Saldeo/deferred)
