# Key Functions Reference
_Last updated: 2026-05-20 — initial audit_

## Financial Calculations
`calculateProjectProfitability(allocations[])`
→ File: src/lib/finance-domain.ts
→ Returns: { revenue, goodsCost, serviceCost, realizedGoodsCost, otherCost, totalCost, profit, citRate, taxPayable, profitAfterTax }

`getProjectProfitability(workspaceId, year)`
→ File: src/lib/finance-service.ts
→ Aggregates allocations by project for a year → profitability table

`getMonthlyFinancialSummary(workspaceId, year, month)`
→ File: src/lib/finance-service.ts
→ Returns dashboard summary card data

`getProjectYtdReport(workspaceId, projectId, year)`
→ File: src/lib/finance-service.ts
→ Year-to-date breakdown by month for a project

## Clockify Integration
`syncClockifyData(workspaceId, startDate?, endDate?)`
→ File: src/lib/clockify-import-service.ts
→ Side effects: upserts into erp_employees, erp_clients, erp_projects, erp_time_entries

`fetchClockifyTimeEntries(workspaceId, params)`
→ File: src/lib/clockify.ts
→ Paginated fetch (5000 per page), returns raw Clockify entries

## DB Helpers
`dbQuery<T>(sql, values?)` — parameterized SELECT, returns typed rows
`dbExecute(sql, values?)` — parameterized INSERT/UPDATE/DELETE
`addColumnIfMissing(table, column, alterSql)` — idempotent migration helper
`addIndexIfMissing(table, indexName, alterSql)` — idempotent migration helper
→ File: src/lib/db.ts

## Excel Import
`parseExcelFile(buffer)` → File: src/lib/excel-import-service.ts
→ Parses xlsx buffer, fuzzy-matches project/client names, returns preview rows

`commitExcelImport(rows[], workspaceId)` → File: src/lib/excel-import-service.ts
→ Saves parsed rows as erp_financial_documents + erp_financial_document_allocations
