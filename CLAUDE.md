# Sparksome ERP — CLAUDE.md

## Project Summary
Internal ERP for Sparksome Venture (5–10 person Polish IT consulting firm). Replaces a broken Excel spreadsheet. TypeScript monorepo with three Bun services + MySQL, deployed via Docker Compose. Clockify goes paid in **June 2026** — internal time tracking is the highest-priority build.

## Tech Stack
- **Runtime:** Bun 1.3.13 (all services)
- **Frontend:** TanStack Start + TanStack Router + TanStack Query + React 19 + Tailwind CSS 4 + Radix UI/shadcn components + Recharts
- **Backend:** Bun.serve (lightweight HTTP, port 4001)
- **Sync service:** Bun process (port 4000) — Clockify sync only
- **Database:** MySQL 8.4 (via mysql2/promise)
- **Validation:** Zod 4 everywhere
- **i18n:** PL default, EN toggle — `src/locales/en.json` + `pl.json`, LanguageProvider in `__root.tsx`, `useTranslation()` hook, localStorage key `erp_lang`. Language toggle in DashboardLayout header. All pages fully wired after Polish Pass (2026-05-21).
- **ORM:** None — raw SQL via `dbQuery()` / `dbExecute()` in `src/lib/db.ts`

## Key File Locations
```
src/
  lib/
    db.ts                    ← schema init (addColumnIfMissing pattern), all migrations here
    erp-repository.ts        ← all read queries
    erp-write-service.ts     ← all write operations
    finance-service.ts       ← financial calculations
    finance-domain.ts        ← pure business logic (tested)
    finance-types.ts         ← shared types
    clockify.ts              ← Clockify API wrapper
    clockify-import-service.ts
  services/
    backend-api-service.ts   ← REST API server (all routes defined here)
    clockify-sync-service.ts ← Clockify sync worker
  api/                       ← TanStack Query hooks (frontend)
  routes/                    ← File-based pages (TanStack Router)
  components/ui/             ← shadcn-style components
  locales/en.json, pl.json   ← i18n strings
_context/                    ← Living context files (read these first each session)
```

## How to Start Dev Server
```bash
# Full stack (Docker)
docker compose up

# Frontend only (requires backend running separately)
bun run dev

# Backend API only
bun run src/services/backend-api-service.ts

# Clockify sync only
bun run src/services/clockify-sync-service.ts
```

## How to Run Tests
```bash
bun test
# or
bun run test
```

## Database Schema Pattern
Schema is auto-created on startup in `src/lib/db.ts → createSchema()`.
Add new columns with `addColumnIfMissing()`, new indexes with `addIndexIfMissing()`.
Never edit existing CREATE TABLE statements — use `addColumnIfMissing` at the bottom.

## Auth (Current State — Phase 2 COMPLETE)
- JWT HS256 in httpOnly cookies (`access_token` 8h, `refresh_token` 30d), argon2id passwords
- `seedAdminUser()` creates `admin@sparksome.com` / `changeme123` if ADMIN_EMAIL/ADMIN_PASSWORD not set
- **Login cookie bug fixed (2026-05-21)**: `loginFn`/`logoutFn` in `auth-context.tsx` now forward `Set-Cookie` headers from backend to browser via `appendResponseHeader` from `vinxi/http`. Previous code used `backendPost()` which silently dropped those headers.
- `GET /auth/ping` endpoint added — requires valid session cookie, returns `{ok, userId, role}`
- RBAC: 4 roles (admin/manager/consultant/accountant), 23 permission keys, configurable per workspace

## Key Architectural Decisions
- **Option A chosen** — extend existing codebase, not migrate to Odoo/ERPNext
- **No ORM** — raw SQL with parameterized queries. Keep it.
- **MySQL 8.4** — keep it. No migration to Postgres.
- **Bun** — all services. No Node.js.
- **IDs:** Clockify-sourced entities use Clockify's string IDs. Internally created entities use `crypto.randomUUID()`.
- **`erp_time_entries` is the single table** for both Clockify-synced and manually entered time. Distinguish via `source` column.
- **Consultant's internal hourly rate** (`erp_employees.hourly_rate`) must NEVER be exposed to Consultant role.
- **Per-project billing rates** — not per-client. `erp_projects.billing_rate`.

## Phase Build Order
- **Phase 0–7:** ALL COMPLETE as of 2026-05-20
- **Polish Pass:** ALL COMPLETE as of 2026-05-21 (i18n full wiring, PDF lang selector, per-project billing UI, Clockify import button, entity activity sections, manual_avatar_override)

## Known Gotchas
- Schema uses `addColumnIfMissing` — if you add a column to the CREATE TABLE, it won't apply to existing DBs. Always use `addColumnIfMissing` for new columns on existing tables.
- `dbQuery` vs `dbExecute`: use `dbQuery` for SELECT, `dbExecute` for INSERT/UPDATE/DELETE.
- Clockify IDs are strings (not UUIDs), up to 64 chars.
- `erp_time_entries.end_at` NULL = timer still running.
- Financial amounts: always store both original currency AND PLN equivalent.
- CIT rate per row — don't hardcode 9%, use `erp_tax_rates` table.
- `manual_avatar_override` flag on `erp_employees`: when 1, `upsertUsers` in clockify-import-service.ts skips updating profile_picture. Auto-set when profile_picture is updated via POST /employees/:id/profile. Reset via POST /employees/:id/reset-avatar.
- PDF language: `pdfLang` stored in localStorage as `erp_pdf_lang` (default 'pl'). Passed as `?lang=` query param to `GET /time-entries/reports/pdf`.
- Entity audit activity: `useEntityAudit(workspaceId, entityType, entityId)` in `src/api/audit.ts` — fetches last 10 audit events for any entity. Used in employee profile, client profile, and document detail panels.

## Read First Each Session
`_context/IMPLEMENTATION_STATUS.md` — current build state
`_context/DB_SCHEMA.md` — current tables and columns
`_context/API_REFERENCE.md` — all implemented endpoints
