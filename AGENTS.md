# Agent Guide — SparkSome ERP

## Project Overview

Full-stack ERP for managing finances, time tracking, inventory, and projects.
Tech: Bun + Vite+ + TanStack Start + MySQL 8.4 + React 19.

## Architecture

```
frontend (port 3000) → backend-api (port 4001) → MySQL (port 3306)
```

Frontend: Vite+ with TanStack Router (file-based routing in `src/routes/`).
Backend: TanStack Start server functions (`src/api/queries.ts`, `src/api/mutations.ts`).
Database: direct MySQL via `mysql2/promise`.

## Key Directories

| Path                 | Purpose                                                   |
| -------------------- | --------------------------------------------------------- |
| `src/api/`           | Server functions (queries, mutations, Excel imports)      |
| `src/components/`    | UI components — `dashboard-layout/`, `ui/` (shadcn/radix) |
| `src/lib/`           | Business logic, DB schema, backend client, i18n, schemas  |
| `src/routes/`        | Page routes (TanStack Router file-based routing)          |
| `src/services/`      | API service clients                                       |
| `src/integrations/`  | TanStack Query provider setup                             |
| `docker-compose.yml` | clockify-sync, backend-api, mysql services                |

## Database Schema (`src/lib/db.ts`)

Tables auto-create on startup. Key tables:

- `erp_workspaces` — multi-tenant workspaces
- `erp_clients`, `erp_projects`, `erp_employees`
- `erp_time_entries` — Clockify sync source
- `erp_financial_documents`, `erp_financial_document_allocations` — financial docs
- `erp_products`, `erp_stock_movements` — inventory
- `erp_accounting_periods`, `erp_sync_runs`

Validation: Zod schemas in `src/lib/schemas/`.

## Authentication

Internal token-based. `API_INTERNAL_TOKEN` in `Authorization: Bearer <token>` header.
Frontend never touches MySQL directly — all comms via `backend-api`.
Backend client: `src/lib/backend-client.ts`.

## Business Domains

### Finance (`src/lib/finance-domain.ts`, `src/lib/finance-service.ts`)

Revenue/cost tracking, CIT calculations, document allocations to projects.

### Time Tracking

Clockify sync via dedicated microservice. User time entries → `erp_time_entries`.

### Inventory

Product stock with movement types: OPENING_BALANCE, PURCHASE, ISSUE_TO_PROJECT, SALE, CORRECTION, RETURN.

## API Patterns

```typescript
// Read — src/api/queries.ts
createServerFn({ method: "GET" }).handler(async () => backendGet("/workspaces"))

// Write — src/api/mutations.ts
createServerFn({ method: "POST" }).handler(async ({ data }) =>
  backendPost("/financial-documents", data)
)
```

## i18n

`src/lib/i18n.tsx` + `src/locales/en.json`, `src/locales/pl.json`.

## Commands

- `vp check` — format, lint, typecheck
- `vp build` — production build
- `docker-compose up` — start services (mysql, backend-api, clockify-sync)

## Clockify Integration

API docs: `./Clockify-API-Documentation.html`
Sync runs via `clockify-sync` microservice → `erp_time_entries`.

## Important Patterns

- Frontend uses TanStack Query for all data fetching
- Zod validation on all API inputs/outputs
- Tailwind CSS v4 + Radix UI components
- React 19 with Server Components support
