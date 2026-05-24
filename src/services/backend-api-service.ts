import crypto from "crypto"
import fs from "fs"
import path from "path"

import { requireEnv } from "#/env"
import {
  clearAuthCookies,
  generateSecureToken,
  getCookieValue,
  getPermissionsForRole,
  hashPassword,
  invalidatePermissionCache,
  sendPasswordResetEmail,
  setAuthCookies,
  sha256,
  signJwt,
  verifyJwt,
  verifyPassword
} from "#/lib/auth-service"
import { importClockifyPayload } from "#/lib/clockify-import-service"
import {
  canDeleteTimeEntry,
  getClientProfile,
  getEmployeeProfile,
  getRunningTimer,
  getTaskSuggestions,
  getTimeDetailedReport,
  getTimesheet,
  getTimeSummaryReport,
  getTimeWeeklyReport,
  listClientsWithProjects,
  listDbClients,
  listDbInvoices,
  listDbProjects,
  listDbTasks,
  listDbTimeEntries,
  listDbUsers,
  listDbWorkspaces,
  listTimeEntriesV2,
  listTimesheetTemplates,
  listTimesheets
} from "#/lib/erp-repository"
import {
  approveTimesheet,
  createErpProject,
  createErpTimeEntry,
  createManualTimeEntry,
  createTimesheet,
  createTimesheetTemplate,
  deleteErpTimeEntry,
  deleteTimesheet,
  deleteTimesheetTemplate,
  discardTimer,
  rejectTimesheet,
  startTimer,
  stopTimer,
  submitTimesheet,
  updateClientProfile,
  updateEmployeeProfile,
  updateErpTimeEntry,
  updateManualTimeEntry,
  upsertTaskSuggestion
} from "#/lib/erp-write-service"
import { dbExecute, dbQuery, seedDefaultPermissions } from "#/lib/db"
import { auditAsync, diffFields, getClientIp, type AuditActor } from "#/lib/audit"
import { commitExcelImport, previewExcelImport } from "#/lib/excel-import-service"
import {
  syncDocumentToDrive,
  retryFailedDriveSyncs,
  isDriveConfigured
} from "#/lib/drive-sync"
import {
  syncDocumentToProxmox,
  retryFailedProxmoxSyncs,
  isProxmoxConfigured
} from "#/lib/proxmox-sync"
import {
  addDocumentAllocation,
  createFinancialDocument,
  createGoodsRealizationForProject,
  createProduct,
  createStockMovement,
  createStockMovementFromGoodsPurchase,
  deleteDocumentAllocation,
  deleteFinancialDocument,
  getEmployeeHourlyRates,
  getFinancialDocument,
  getFinancialFlowSummary,
  getFinancialRegister,
  getTimeCostsByClient,
  getTimeCostsByProject,
  getPartiallyAllocatedDocuments,
  getProjectMonthlyReport,
  getProjectProfitability,
  getProjectYtdReport,
  getProjectsMonthlySummary,
  getStockSummary,
  getUnallocatedDocuments,
  listFinancialCategories,
  listFinancialDocuments,
  listProducts,
  listStockMovements,
  recalculateAllTimeEntryCosts,
  splitDocumentByAmounts,
  splitDocumentByPercent,
  updateDocumentAllocation,
  updateEmployeeHourlyRate,
  updateFinancialDocument
} from "#/lib/finance-service"
import { extractInvoiceFields, isOcrConfigured } from "#/lib/azure-ocr"
import { matchDocumentToEmployee } from "#/lib/consultant-matching-service"
import {
  exportDocumentToSaldeo,
  getSaldeoConfig,
  getSaldeoStatus,
  isSaldeoConfigured
} from "#/lib/saldeo-service"

declare const Bun: {
  serve(options: { port: number; fetch(request: Request): Response | Promise<Response> }): unknown
  password: {
    hash(password: string, options?: { algorithm?: string }): Promise<string>
    verify(password: string, hash: string): Promise<boolean>
  }
}

const internalToken = requireEnv("API_INTERNAL_TOKEN")

type Handler = (
  request: Request,
  params: Record<string, string>,
  url: URL
) => Response | Promise<Response>

const routes: Array<{ method: string; pattern: RegExp; keys: string[]; handler: Handler }> = []

function route(method: string, pattern: string, handler: Handler) {
  const keys = [...pattern.matchAll(/:([A-Za-z]+)/g)].map((match) => match[1]!)
  const regex = new RegExp(`^${pattern.replaceAll(/:([A-Za-z]+)/g, "([^/]+)")}$`)
  routes.push({ method, pattern: regex, keys, handler })
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff"
    }
  })
}

async function readJson(request: Request) {
  if (request.headers.get("content-length") === "0") return {}
  return request.json().catch(() => ({})) as Promise<Record<string, unknown>>
}

function query(url: URL) {
  return Object.fromEntries(url.searchParams.entries())
}

function numberParam(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined
  return Number(value)
}

function authorize(request: Request) {
  const header = request.headers.get("authorization")
  return header === `Bearer ${internalToken}`
}

// ─── Phase 2: Auth helpers ─────────────────────────────────────────────────

type AuthUser = {
  id: string
  workspaceId: string
  role: string
  employeeId: string
  email: string
}

function requireAuth(request: Request): AuthUser | Response {
  const token = getCookieValue(request, "access_token")
  if (!token) return jsonResponse({ error: "Unauthorized" }, 401)
  let jwtSecret: string
  try {
    jwtSecret = requireEnv("JWT_SECRET")
  } catch {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }
  const payload = verifyJwt(token, jwtSecret)
  if (!payload) return jsonResponse({ error: "Unauthorized" }, 401)
  return payload as AuthUser
}

async function requirePermission(
  user: AuthUser,
  workspaceId: string,
  permission: string
): Promise<Response | null> {
  const perms = await getPermissionsForRole(workspaceId, user.role)
  if (!perms.includes(permission))
    return jsonResponse({ error: "Forbidden", permission }, 403)
  return null
}

function stripSensitiveFields<T extends object>(obj: T, user: AuthUser): T {
  const clone = { ...obj } as Record<string, unknown>
  if (user.role === "consultant") {
    delete clone["hourlyRate"]
    delete clone["hourly_rate"]
  }
  return clone as T
}

function makeActor(user: AuthUser, request: Request): AuditActor {
  return { id: user.id, email: user.email, role: user.role, ipAddress: getClientIp(request) }
}

const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=2,p=1$dGVzdA$dGVzdA"

// ─── Phase 2: toMysqlDateTime helper ──────────────────────────────────────

function toMysqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ")
}

route("GET", "/health", () => jsonResponse({ ok: true, service: "backend-api" }))

route("GET", "/workspaces", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  return jsonResponse(await listDbWorkspaces())
})
route("GET", "/workspaces/:workspaceId/users", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  return jsonResponse(await listDbUsers(params.workspaceId!))
})
route("GET", "/workspaces/:workspaceId/projects", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  return jsonResponse(await listDbProjects(params.workspaceId!))
})
route("GET", "/workspaces/:workspaceId/clients", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  return jsonResponse(await listDbClients(params.workspaceId!))
})
route("GET", "/workspaces/:workspaceId/invoices", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  return jsonResponse(await listDbInvoices(params.workspaceId!))
})
route("GET", "/workspaces/:workspaceId/time-entries", async (request, params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  return jsonResponse(
    await listDbTimeEntries(params.workspaceId!, {
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      projectId: url.searchParams.get("projectId") ?? undefined,
      userId: url.searchParams.get("userId") ?? undefined
    })
  )
})
route("GET", "/workspaces/:workspaceId/dashboard", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const workspaceId = params.workspaceId!
  const [users, projects, timeEntries, invoices] = await Promise.all([
    listDbUsers(workspaceId),
    listDbProjects(workspaceId),
    listDbTimeEntries(workspaceId),
    listDbInvoices(workspaceId)
  ])
  return jsonResponse({ users, projects, timeEntries, invoices })
})
route("GET", "/workspaces/:workspaceId/projects/:projectId/tasks", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  return jsonResponse(await listDbTasks(params.workspaceId!, params.projectId!))
})

route("POST", "/projects", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  return jsonResponse(await createErpProject((await readJson(request)) as never))
})
route("PUT", "/projects/:id", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const body = await readJson(request) as Record<string, unknown>
  const { updateErpProject } = await import("#/lib/erp-write-service")
  await updateErpProject({ id: params.id!, workspaceId: user.workspaceId, ...(body as Record<string, unknown>) })
  return jsonResponse({ ok: true })
})
route("POST", "/time-entries", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  return jsonResponse(await createErpTimeEntry((await readJson(request)) as never))
})
route("POST", "/time-entries/:entryId/update", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const body = await readJson(request)
  return jsonResponse(await updateErpTimeEntry({ ...body, entryId: params.entryId } as never))
})
route("POST", "/time-entries/:entryId/delete", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const body = await readJson(request)

  const [entryRow] = await dbQuery<import("mysql2").RowDataPacket[]>(
    "SELECT description, workspace_id, start_at FROM erp_time_entries WHERE id = ? LIMIT 1",
    [params.entryId]
  )

  // Period lock check
  if (entryRow) {
    const startAt = String(entryRow.start_at ?? "").slice(0, 10)
    if (startAt && !(await isPeriodOpen(String(entryRow.workspace_id ?? user.workspaceId), startAt))) {
      return jsonResponse({ error: "period_locked", period: startAt.slice(0, 7) }, 423)
    }
  }

  const result = await deleteErpTimeEntry({ ...body, entryId: params.entryId } as never)

  if (entryRow) {
    auditAsync(makeActor(user, request), {
      workspaceId: String(body.workspaceId ?? entryRow.workspace_id ?? user.workspaceId),
      action: "delete",
      entityType: "time_entry",
      entityId: params.entryId!,
      entityLabel: String(entryRow.description ?? ""),
      metadata: { snapshot: entryRow }
    })
  }

  return jsonResponse(result)
})

route("GET", "/finance/documents", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.view")
  if (denied) return denied
  return jsonResponse(
    await listFinancialDocuments({
      ...query(url),
      year: numberParam(url.searchParams.get("year")),
      month: numberParam(url.searchParams.get("month"))
    })
  )
})
route("GET", "/finance/documents/:id", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.view")
  if (denied) return denied
  return jsonResponse(await getFinancialDocument(params.id!))
})
route("POST", "/finance/documents", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.upload")
  if (denied) return denied
  const body = await readJson(request)
  const issueDate = String((body as any).issueDate ?? (body as any).issue_date ?? "")
  if (issueDate && !(await isPeriodOpen(user.workspaceId, issueDate))) {
    return jsonResponse({ error: "period_locked", period: issueDate.slice(0, 7) }, 423)
  }
  const doc = await createFinancialDocument(body as never)
  auditAsync(makeActor(user, request), {
    workspaceId: user.workspaceId,
    action: "create",
    entityType: "financial_document",
    entityId: doc.id,
    entityLabel: `${doc.documentType} ${doc.documentNumber ?? doc.id}`,
    metadata: { snapshot: doc }
  })
  return jsonResponse(doc)
})
route("POST", "/finance/documents/:id/update", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.upload")
  if (denied) return denied
  const body = await readJson(request)
  const issueDate = String((body as any).issueDate ?? (body as any).issue_date ?? "")
  if (issueDate && !(await isPeriodOpen(user.workspaceId, issueDate))) {
    return jsonResponse({ error: "period_locked", period: issueDate.slice(0, 7) }, 423)
  }
  const oldResult = await getFinancialDocument(params.id!)
  const result = await updateFinancialDocument(params.id!, body as never)
  if (oldResult && result) {
    const changed = diffFields(oldResult.document as unknown as Record<string, unknown>, result.document as unknown as Record<string, unknown>)
    if (Object.keys(changed).length > 0) {
      auditAsync(makeActor(user, request), {
        workspaceId: user.workspaceId,
        action: "update",
        entityType: "financial_document",
        entityId: params.id!,
        entityLabel: `${result.document.documentType} ${result.document.documentNumber ?? params.id!}`,
        changedFields: changed
      })
    }
  }
  return jsonResponse(result)
})
route("POST", "/finance/documents/:id/delete", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.upload")
  if (denied) return denied
  const body = await readJson(request)
  const docToDelete = await getFinancialDocument(params.id!)
  const result = await deleteFinancialDocument(params.id!, body.cascade === true)
  if (docToDelete) {
    auditAsync(makeActor(user, request), {
      workspaceId: user.workspaceId,
      action: "delete",
      entityType: "financial_document",
      entityId: params.id!,
      entityLabel: `${docToDelete.document.documentType} ${docToDelete.document.documentNumber ?? params.id!}`,
      metadata: { snapshot: docToDelete.document }
    })
  }
  return jsonResponse(result)
})
route("POST", "/finance/documents/:documentId/allocations", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.upload")
  if (denied) return denied
  return jsonResponse(await addDocumentAllocation(params.documentId!, (await readJson(request)) as never))
})
route("POST", "/finance/allocations/:allocationId/update", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.upload")
  if (denied) return denied
  return jsonResponse(
    await updateDocumentAllocation(params.allocationId!, (await readJson(request)) as never)
  )
})
route("POST", "/finance/allocations/:allocationId/delete", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.upload")
  if (denied) return denied
  return jsonResponse(await deleteDocumentAllocation(params.allocationId!))
})
route("POST", "/finance/documents/:documentId/split-amounts", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.upload")
  if (denied) return denied
  const body = await readJson(request)
  return jsonResponse(await splitDocumentByAmounts(params.documentId!, body.allocations as never))
})
route("POST", "/finance/documents/:documentId/split-percent", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.upload")
  if (denied) return denied
  const body = await readJson(request)
  return jsonResponse(await splitDocumentByPercent(params.documentId!, body.allocations as never))
})
route("GET", "/finance/categories", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  return jsonResponse(await listFinancialCategories())
})
route("GET", "/finance/register", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.view")
  if (denied) return denied
  return jsonResponse(
    await getFinancialRegister({
      year: Number(url.searchParams.get("year")),
      month: Number(url.searchParams.get("month")),
      projectId: url.searchParams.get("projectId") ?? undefined,
      clientId: url.searchParams.get("clientId") ?? undefined
    })
  )
})
route("GET", "/finance/flow-summary", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.view")
  if (denied) return denied
  const from = url.searchParams.get("from") ?? `${new Date().getFullYear()}-01-01`
  const to = url.searchParams.get("to") ?? `${new Date().getFullYear()}-12-31`
  return jsonResponse(await getFinancialFlowSummary(from, to))
})
route("GET", "/finance/project-profitability", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "reports.view")
  if (denied) return denied
  const year = Number(url.searchParams.get("year") ?? new Date().getFullYear())
  const workspaceId = url.searchParams.get("workspaceId")
  if (!workspaceId) return new Response("Missing workspaceId", { status: 400 })
  return jsonResponse(await getProjectProfitability(year, workspaceId))
})
route("GET", "/finance/monthly-summary", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "reports.view")
  if (denied) return denied
  return jsonResponse(
    await getProjectsMonthlySummary(
      Number(url.searchParams.get("year")),
      Number(url.searchParams.get("month"))
    )
  )
})
route("GET", "/finance/project-monthly-report", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "reports.view")
  if (denied) return denied
  return jsonResponse(
    await getProjectMonthlyReport(
      url.searchParams.get("projectId")!,
      Number(url.searchParams.get("year")),
      Number(url.searchParams.get("month"))
    )
  )
})
route("GET", "/finance/project-ytd-report", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "reports.view")
  if (denied) return denied
  return jsonResponse(
    await getProjectYtdReport(
      url.searchParams.get("projectId")!,
      Number(url.searchParams.get("year")),
      Number(url.searchParams.get("month"))
    )
  )
})
route("GET", "/finance/documents-unallocated", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.view")
  if (denied) return denied
  return jsonResponse(await getUnallocatedDocuments())
})
route("GET", "/finance/documents-partial", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.view")
  if (denied) return denied
  return jsonResponse(await getPartiallyAllocatedDocuments())
})

route("GET", "/inventory/products", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "inventory.view")
  if (denied) return denied
  return jsonResponse(await listProducts())
})
route("POST", "/inventory/products", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "inventory.edit")
  if (denied) return denied
  return jsonResponse(await createProduct((await readJson(request)) as never))
})
route("GET", "/inventory/movements", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "inventory.view")
  if (denied) return denied
  return jsonResponse(await listStockMovements(query(url)))
})
route("POST", "/inventory/movements", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "inventory.edit")
  if (denied) return denied
  return jsonResponse(await createStockMovement((await readJson(request)) as never))
})
route("GET", "/inventory/summary", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "inventory.view")
  if (denied) return denied
  return jsonResponse(await getStockSummary())
})
route("POST", "/inventory/movements/from-goods-purchase", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "inventory.edit")
  if (denied) return denied
  return jsonResponse(await createStockMovementFromGoodsPurchase((await readJson(request)) as never))
})
route("POST", "/inventory/movements/goods-realization", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "inventory.edit")
  if (denied) return denied
  return jsonResponse(await createGoodsRealizationForProject((await readJson(request)) as never))
})

route("GET", "/employees/hourly-rates", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "employees.view_internal_rate")
  if (denied) return denied
  const workspaceId = url.searchParams.get("workspaceId")
  if (!workspaceId) return new Response("Missing workspaceId", { status: 400 })
  return jsonResponse(await getEmployeeHourlyRates(workspaceId))
})
route("POST", "/employees/:employeeId/hourly-rate", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "employees.edit_all")
  if (denied) return denied
  const body = await readJson(request)
  const hourlyRate = body.hourlyRate == null ? null : Number(body.hourlyRate)
  const [oldRow] = await dbQuery<import("mysql2").RowDataPacket[]>(
    "SELECT hourly_rate, name FROM erp_employees WHERE id = ? LIMIT 1",
    [params.employeeId]
  )
  const result = await updateEmployeeHourlyRate(params.employeeId!, hourlyRate)
  const changed = diffFields(
    { hourlyRate: oldRow?.hourly_rate ?? null },
    { hourlyRate: hourlyRate }
  )
  if (Object.keys(changed).length > 0) {
    auditAsync(makeActor(user, request), {
      workspaceId: user.workspaceId,
      action: "update",
      entityType: "employee",
      entityId: params.employeeId!,
      entityLabel: oldRow?.name as string | undefined,
      changedFields: changed
    })
  }
  return jsonResponse(result)
})
route("POST", "/time-entries/recalculate-costs", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "employees.edit_all")
  if (denied) return denied
  await recalculateAllTimeEntryCosts()
  return jsonResponse({ success: true })
})

// ─── Phase 0: Enhanced time entry list ───────────────────────────────────────

route("GET", "/time-entries", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const workspaceId = url.searchParams.get("workspaceId")
  if (!workspaceId) return new Response("Missing workspaceId", { status: 400 })

  // If user doesn't have read_all, restrict to own entries
  const perms = await getPermissionsForRole(workspaceId, user.role)
  const canReadAll = perms.includes("time_entries.read_all")
  const employeeIdFilter = canReadAll
    ? (url.searchParams.get("employeeId") ?? undefined)
    : user.employeeId

  return jsonResponse(
    await listTimeEntriesV2(workspaceId, {
      employeeId: employeeIdFilter,
      projectId: url.searchParams.get("projectId") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      source: url.searchParams.get("source") ?? undefined,
      page: url.searchParams.get("page") ? Number(url.searchParams.get("page")) : undefined,
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined
    })
  )
})

// ─── Phase 0: Delete with timesheet lock check ────────────────────────────────

route("DELETE", "/time-entries/:entryId", async (request, params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const entryId = params.entryId!
  const workspaceId = url.searchParams.get("workspaceId") ?? ""
  if (!workspaceId) return new Response("Missing workspaceId", { status: 400 })
  const allowed = await canDeleteTimeEntry(entryId)
  if (!allowed) {
    return jsonResponse({ error: "Entry is locked in a submitted or approved timesheet" }, 409)
  }
  return jsonResponse(await deleteErpTimeEntry({ workspaceId, entryId }))
})

// ─── Phase 0: Reports ─────────────────────────────────────────────────────────

route("GET", "/time-entries/reports/summary", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const workspaceId = url.searchParams.get("workspaceId")
  if (!workspaceId) return new Response("Missing workspaceId, from, or to", { status: 400 })
  const denied = await requirePermission(user, workspaceId, "reports.view")
  if (denied) return denied
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")
  const groupBy = url.searchParams.get("groupBy") ?? "project"
  if (!from || !to) {
    return new Response("Missing workspaceId, from, or to", { status: 400 })
  }
  if (!["project", "employee", "client"].includes(groupBy)) {
    return new Response("groupBy must be project|employee|client", { status: 400 })
  }
  return jsonResponse(
    await getTimeSummaryReport(workspaceId, {
      from,
      to,
      groupBy: groupBy as "project" | "employee" | "client"
    })
  )
})

route("GET", "/time-entries/reports/detailed", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const workspaceId = url.searchParams.get("workspaceId")
  if (!workspaceId) return new Response("Missing workspaceId, from, or to", { status: 400 })
  const denied = await requirePermission(user, workspaceId, "reports.view")
  if (denied) return denied
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")
  if (!from || !to) {
    return new Response("Missing workspaceId, from, or to", { status: 400 })
  }
  return jsonResponse(
    await getTimeDetailedReport(workspaceId, {
      from,
      to,
      employeeId: url.searchParams.get("employeeId") ?? undefined,
      projectId: url.searchParams.get("projectId") ?? undefined,
      sortBy: url.searchParams.get("sortBy") ?? undefined,
      sortDir: url.searchParams.get("sortDir") ?? undefined
    })
  )
})

route("GET", "/time-entries/reports/weekly", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const workspaceId = url.searchParams.get("workspaceId")
  const weekStart = url.searchParams.get("weekStart")
  // If not read_all, force to own employeeId
  const perms = workspaceId ? await getPermissionsForRole(workspaceId, user.role) : []
  const canReadAll = perms.includes("time_entries.read_all")
  const employeeId = canReadAll
    ? (url.searchParams.get("employeeId") ?? undefined)
    : user.employeeId
  if (!workspaceId || !employeeId || !weekStart) {
    return new Response("Missing workspaceId, employeeId, or weekStart", { status: 400 })
  }
  return jsonResponse(await getTimeWeeklyReport(workspaceId, { employeeId, weekStart }))
})

// ─── Phase 0: Manual entry create/update ─────────────────────────────────────

route("POST", "/time-entries/manual", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const body = await readJson(request)

  // Period lock check
  const entryDate = String((body as any).startAt ?? "")
  if (entryDate) {
    const wsId = String((body as any).workspaceId ?? user.workspaceId)
    if (!(await isPeriodOpen(wsId, entryDate))) {
      return jsonResponse({ error: "period_locked", period: entryDate.slice(0, 7) }, 423)
    }
  }

  const result = await createManualTimeEntry(body as never)

  auditAsync(makeActor(user, request), {
    workspaceId: String(body.workspaceId ?? user.workspaceId),
    action: "create",
    entityType: "time_entry",
    entityId: (result as any).id ?? "unknown",
    entityLabel: String(body.description ?? ""),
    metadata: { snapshot: { description: body.description, projectId: body.projectId, startAt: body.startAt, endAt: body.endAt } }
  })

  // Upsert task suggestion if description + projectId provided
  if (
    body.description &&
    typeof body.description === "string" &&
    body.description.trim() &&
    body.projectId &&
    body.workspaceId &&
    body.employeeId
  ) {
    await upsertTaskSuggestion({
      workspaceId: String(body.workspaceId),
      employeeId: String(body.employeeId),
      projectId: String(body.projectId),
      taskName: String(body.description)
    })
  }

  return jsonResponse(result)
})

route("POST", "/time-entries/:entryId/manual-update", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const allowed = await canDeleteTimeEntry(params.entryId!)
  if (!allowed) {
    return jsonResponse({ error: "Entry is locked in a submitted or approved timesheet" }, 409)
  }
  const body = await readJson(request)

  const [oldEntry] = await dbQuery<import("mysql2").RowDataPacket[]>(
    "SELECT description, project_id, client_id, billable, start_at, end_at, tags FROM erp_time_entries WHERE id = ? LIMIT 1",
    [params.entryId]
  )

  // Period lock check
  const entryDateStr = String((body as any).startAt ?? "")
  if (entryDateStr) {
    const wsId = String((body as any).workspaceId ?? user.workspaceId)
    if (!(await isPeriodOpen(wsId, entryDateStr))) {
      return jsonResponse({ error: "period_locked", period: entryDateStr.slice(0, 7) }, 423)
    }
  } else {
    // Check the original entry's date
    const origDate = oldEntry?.start_at ? String(oldEntry.start_at).slice(0, 10) : ""
    if (origDate && !(await isPeriodOpen(user.workspaceId, origDate))) {
      return jsonResponse({ error: "period_locked", period: origDate.slice(0, 7) }, 423)
    }
  }

  const result = await updateManualTimeEntry({ ...body, entryId: params.entryId } as never)

  const newFields: Record<string, unknown> = {}
  if (body.description !== undefined) newFields.description = body.description
  if (body.projectId !== undefined) newFields.project_id = body.projectId
  if (body.billable !== undefined) newFields.billable = body.billable
  const oldFields: Record<string, unknown> = {}
  for (const k of Object.keys(newFields)) oldFields[k] = oldEntry?.[k]
  const changed = diffFields(oldFields, newFields)
  if (Object.keys(changed).length > 0) {
    auditAsync(makeActor(user, request), {
      workspaceId: String(body.workspaceId ?? user.workspaceId),
      action: "update",
      entityType: "time_entry",
      entityId: params.entryId!,
      changedFields: changed
    })
  }

  if (
    body.description &&
    typeof body.description === "string" &&
    body.description.trim() &&
    body.projectId &&
    body.workspaceId &&
    body.employeeId
  ) {
    await upsertTaskSuggestion({
      workspaceId: String(body.workspaceId),
      employeeId: String(body.employeeId),
      projectId: String(body.projectId),
      taskName: String(body.description)
    })
  }

  return jsonResponse(result)
})

// ─── Phase 0: Timer ───────────────────────────────────────────────────────────

route("GET", "/timer/running", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const workspaceId = url.searchParams.get("workspaceId")
  const employeeId = url.searchParams.get("employeeId")
  if (!workspaceId || !employeeId)
    return new Response("Missing workspaceId or employeeId", { status: 400 })
  const timer = await getRunningTimer(workspaceId, employeeId)
  return jsonResponse(timer ?? null)
})

route("POST", "/timer/start", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const body = await readJson(request)
  const workspaceId = String(body.workspaceId ?? "")
  const employeeId = String(body.employeeId ?? "")
  if (!workspaceId || !employeeId)
    return new Response("Missing workspaceId or employeeId", { status: 400 })
  // Enforce ownership: consultant can only start timer for self
  const perms = await getPermissionsForRole(workspaceId, user.role)
  if (!perms.includes("time_entries.edit_others") && employeeId !== user.employeeId) {
    return jsonResponse({ error: "Forbidden: cannot start timer for another employee" }, 403)
  }
  const result = await startTimer({ workspaceId, employeeId })
  if ("conflict" in result && result.conflict) {
    return jsonResponse({ error: "Timer already running for this employee" }, 409)
  }
  return jsonResponse(result)
})

route("POST", "/timer/stop", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const body = await readJson(request)
  const workspaceId = String(body.workspaceId ?? "")
  const employeeId = String(body.employeeId ?? "")
  if (!workspaceId || !employeeId)
    return new Response("Missing workspaceId or employeeId", { status: 400 })

  const perms = await getPermissionsForRole(workspaceId, user.role)
  if (!perms.includes("time_entries.edit_others") && employeeId !== user.employeeId) {
    return jsonResponse({ error: "Forbidden: cannot stop timer for another employee" }, 403)
  }

  const result = await stopTimer({
    workspaceId,
    employeeId,
    description: body.description as string | undefined,
    projectId: body.projectId as string | undefined,
    clientId: body.clientId as string | undefined,
    billable: body.billable as boolean | undefined,
    tags: body.tags as string[] | undefined
  })

  if ("notFound" in result && result.notFound) {
    return jsonResponse({ error: "No running timer found" }, 404)
  }

  // Upsert task suggestion
  if (body.description && typeof body.description === "string" && body.description.trim() && body.projectId) {
    await upsertTaskSuggestion({
      workspaceId,
      employeeId,
      projectId: String(body.projectId),
      taskName: String(body.description)
    })
  }

  auditAsync(makeActor(user, request), {
    workspaceId,
    action: "create",
    entityType: "time_entry",
    entityId: (result as any).id ?? "timer",
    entityLabel: String(body.description ?? ""),
    metadata: { source: "timer" }
  })

  return jsonResponse(result)
})

route("POST", "/timer/discard", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const body = await readJson(request)
  const workspaceId = String(body.workspaceId ?? "")
  const employeeId = String(body.employeeId ?? "")
  if (!workspaceId || !employeeId)
    return new Response("Missing workspaceId or employeeId", { status: 400 })
  const result = await discardTimer({ workspaceId, employeeId })
  if ("notFound" in result && result.notFound) {
    return jsonResponse({ error: "No running timer found" }, 404)
  }
  return jsonResponse(result)
})

// ─── Phase 0: Timesheets ──────────────────────────────────────────────────────

route("GET", "/timesheets", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const workspaceId = url.searchParams.get("workspaceId")
  if (!workspaceId) return new Response("Missing workspaceId", { status: 400 })
  // Filter to own if no approve permission
  const perms = await getPermissionsForRole(workspaceId, user.role)
  const canApprove = perms.includes("timesheets.approve")
  const employeeIdFilter = canApprove
    ? (url.searchParams.get("employeeId") ?? undefined)
    : user.employeeId
  return jsonResponse(
    await listTimesheets(workspaceId, {
      employeeId: employeeIdFilter,
      status: url.searchParams.get("status") ?? undefined,
      periodStart: url.searchParams.get("periodStart") ?? undefined,
      periodEnd: url.searchParams.get("periodEnd") ?? undefined
    })
  )
})

route("GET", "/timesheets/:timesheetId", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const ts = await getTimesheet(params.timesheetId!)
  if (!ts) return jsonResponse({ error: "Not found" }, 404)
  return jsonResponse(ts)
})

route("POST", "/timesheets", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const body = await readJson(request)
  return jsonResponse(await createTimesheet(body as never))
})

route("POST", "/timesheets/:timesheetId/submit", async (request, params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const workspaceId = url.searchParams.get("workspaceId") ?? ""

  const [tsRow] = await dbQuery<import("mysql2").RowDataPacket[]>(
    "SELECT employee_id, period_start, period_end FROM erp_timesheets WHERE id = ? LIMIT 1",
    [params.timesheetId]
  )

  const result = await submitTimesheet({ timesheetId: params.timesheetId!, workspaceId })

  auditAsync(makeActor(user, request), {
    workspaceId,
    action: "submit",
    entityType: "timesheet",
    entityId: params.timesheetId!,
    entityLabel: tsRow ? `${tsRow.period_start} – ${tsRow.period_end}` : params.timesheetId,
  })

  return jsonResponse(result)
})

route("POST", "/timesheets/:timesheetId/approve", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "timesheets.approve")
  if (denied) return denied
  const body = await readJson(request)
  const result = await approveTimesheet({
    timesheetId: params.timesheetId!,
    workspaceId: String(body.workspaceId ?? ""),
    approvedBy: String(body.approvedBy ?? user.employeeId)
  })
  auditAsync(makeActor(user, request), {
    workspaceId: String(body.workspaceId ?? user.workspaceId),
    action: "approve",
    entityType: "timesheet",
    entityId: params.timesheetId!,
  })
  return jsonResponse(result)
})

route("POST", "/timesheets/:timesheetId/reject", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "timesheets.approve")
  if (denied) return denied
  const body = await readJson(request)
  const result = await rejectTimesheet({
    timesheetId: params.timesheetId!,
    workspaceId: String(body.workspaceId ?? ""),
    rejectionNote: String(body.rejectionNote ?? "")
  })
  auditAsync(makeActor(user, request), {
    workspaceId: String(body.workspaceId ?? user.workspaceId),
    action: "reject",
    entityType: "timesheet",
    entityId: params.timesheetId!,
    metadata: { rejectionNote: body.rejectionNote }
  })
  return jsonResponse(result)
})

route("POST", "/timesheets/:timesheetId/delete", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const body = await readJson(request)
  return jsonResponse(
    await deleteTimesheet({
      timesheetId: params.timesheetId!,
      workspaceId: String(body.workspaceId ?? "")
    })
  )
})

// ─── Phase 0: Timesheet templates ────────────────────────────────────────────

route("GET", "/timesheet-templates", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const workspaceId = url.searchParams.get("workspaceId")
  if (!workspaceId) return new Response("Missing workspaceId", { status: 400 })
  return jsonResponse(
    await listTimesheetTemplates(workspaceId, url.searchParams.get("employeeId") ?? undefined)
  )
})

route("POST", "/timesheet-templates", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const body = await readJson(request)
  return jsonResponse(await createTimesheetTemplate(body as never))
})

route("POST", "/timesheet-templates/:templateId/delete", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const body = await readJson(request)
  return jsonResponse(
    await deleteTimesheetTemplate({
      templateId: params.templateId!,
      workspaceId: String(body.workspaceId ?? "")
    })
  )
})

// ─── Phase 0: Task suggestions ────────────────────────────────────────────────

route("GET", "/time-entries/suggestions", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const employeeId = url.searchParams.get("employeeId")
  const projectId = url.searchParams.get("projectId")
  if (!employeeId || !projectId)
    return new Response("Missing employeeId or projectId", { status: 400 })
  const q = url.searchParams.get("q") ?? undefined
  return jsonResponse(await getTaskSuggestions(employeeId, projectId, q))
})
route("GET", "/time-costs/by-project", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const workspaceId = url.searchParams.get("workspaceId")
  if (!workspaceId) return new Response("Missing workspaceId", { status: 400 })
  const denied = await requirePermission(user, workspaceId, "reports.view")
  if (denied) return denied
  const year = numberParam(url.searchParams.get("year"))
  const month = numberParam(url.searchParams.get("month"))
  const startDate = url.searchParams.get("startDate") ?? undefined
  const endDate = url.searchParams.get("endDate") ?? undefined
  return jsonResponse(await getTimeCostsByProject(workspaceId, { year, month, startDate, endDate }))
})
route("GET", "/time-costs/by-client", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const workspaceId = url.searchParams.get("workspaceId")
  if (!workspaceId) return new Response("Missing workspaceId", { status: 400 })
  const denied = await requirePermission(user, workspaceId, "reports.view")
  if (denied) return denied
  const year = numberParam(url.searchParams.get("year"))
  const month = numberParam(url.searchParams.get("month"))
  const startDate = url.searchParams.get("startDate") ?? undefined
  const endDate = url.searchParams.get("endDate") ?? undefined
  return jsonResponse(await getTimeCostsByClient(workspaceId, { year, month, startDate, endDate }))
})

// ─── Phase 2: Auth routes ─────────────────────────────────────────────────

route("POST", "/auth/login", async (request) => {
  const body = await readJson(request)
  const email = String(body.email ?? "")
  const password = String(body.password ?? "")

  interface UserRow {
    id: string
    workspace_id: string
    employee_id: string
    email: string
    password_hash: string
    role: string
    is_active: number
  }
  const rows = await dbQuery<(UserRow & import("mysql2").RowDataPacket)[]>(
    "SELECT u.*, e.name as employee_name FROM erp_users u LEFT JOIN erp_employees e ON e.id = u.employee_id WHERE u.email = ? AND u.is_active = 1 LIMIT 1",
    [email]
  )

  if (rows.length === 0) {
    // Timing-safe: always run a verify even if user not found
    await Bun.password.verify("dummy_password_to_prevent_timing_attack", DUMMY_HASH).catch(() => false)
    return jsonResponse({ error: "Invalid credentials" }, 401)
  }

  const user = rows[0]!
  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) {
    return jsonResponse({ error: "Invalid credentials" }, 401)
  }

  const jwtSecret = requireEnv("JWT_SECRET")
  const isProd = process.env.NODE_ENV === "production"

  const accessToken = signJwt(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      workspaceId: user.workspace_id,
      employeeId: user.employee_id
    },
    jwtSecret,
    28800 // 8h
  )

  const refreshToken = generateSecureToken()
  const refreshTokenHash = sha256(refreshToken)
  const refreshExpiry = toMysqlDateTime(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
  const refreshId = `rt_${crypto.randomUUID()}`

  await dbExecute(
    "INSERT INTO erp_refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
    [refreshId, user.id, refreshTokenHash, refreshExpiry]
  )

  await dbExecute("UPDATE erp_users SET last_login_at = NOW() WHERE id = ?", [user.id])

  const responseBody = jsonResponse({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      workspaceId: user.workspace_id,
      employeeId: user.employee_id,
      name: (user as any).employee_name ?? email
    }
  })

  auditAsync(
    { id: user.id, email: user.email, role: user.role, ipAddress: getClientIp(request) },
    {
      workspaceId: user.workspace_id,
      action: "login",
      entityType: "user",
      entityId: user.id,
      entityLabel: user.email,
    }
  )

  return setAuthCookies(responseBody, accessToken, refreshToken, isProd)
})

route("POST", "/auth/logout", async (request) => {
  // Capture user info for audit BEFORE clearing cookies
  const logoutUser = requireAuth(request)
  const refreshToken = getCookieValue(request, "refresh_token")
  if (refreshToken) {
    const hash = sha256(refreshToken)
    await dbExecute("DELETE FROM erp_refresh_tokens WHERE token_hash = ?", [hash])
  }
  if (!(logoutUser instanceof Response)) {
    auditAsync(makeActor(logoutUser, request), {
      workspaceId: logoutUser.workspaceId,
      action: "logout",
      entityType: "user",
      entityId: logoutUser.id,
      entityLabel: logoutUser.email,
    })
  }
  return clearAuthCookies(jsonResponse({ success: true }))
})

route("POST", "/auth/refresh", async (request) => {
  const refreshToken = getCookieValue(request, "refresh_token")
  if (!refreshToken) return jsonResponse({ error: "Unauthorized" }, 401)

  const hash = sha256(refreshToken)

  interface TokenRow {
    id: string
    user_id: string
    expires_at: string
  }
  const tokens = await dbQuery<(TokenRow & import("mysql2").RowDataPacket)[]>(
    "SELECT * FROM erp_refresh_tokens WHERE token_hash = ? AND expires_at > NOW() LIMIT 1",
    [hash]
  )

  if (tokens.length === 0) return jsonResponse({ error: "Unauthorized" }, 401)
  const tokenRow = tokens[0]!

  interface UserRow {
    id: string
    workspace_id: string
    employee_id: string
    email: string
    role: string
    is_active: number
  }
  const users = await dbQuery<(UserRow & import("mysql2").RowDataPacket)[]>(
    "SELECT * FROM erp_users WHERE id = ? AND is_active = 1 LIMIT 1",
    [tokenRow.user_id]
  )
  if (users.length === 0) return jsonResponse({ error: "Unauthorized" }, 401)
  const user = users[0]!

  // Delete old refresh token (rotation)
  await dbExecute("DELETE FROM erp_refresh_tokens WHERE id = ?", [tokenRow.id])

  const jwtSecret = requireEnv("JWT_SECRET")
  const isProd = process.env.NODE_ENV === "production"

  const newAccessToken = signJwt(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      workspaceId: user.workspace_id,
      employeeId: user.employee_id
    },
    jwtSecret,
    28800
  )

  const newRefreshToken = generateSecureToken()
  const newRefreshHash = sha256(newRefreshToken)
  const newExpiry = toMysqlDateTime(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
  const newRefreshId = `rt_${crypto.randomUUID()}`

  await dbExecute(
    "INSERT INTO erp_refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
    [newRefreshId, user.id, newRefreshHash, newExpiry]
  )

  return setAuthCookies(jsonResponse({ success: true }), newAccessToken, newRefreshToken, isProd)
})

route("POST", "/auth/forgot-password", async (request) => {
  // Always return 200 immediately — no timing info leak
  const body = await readJson(request)
  const email = String(body.email ?? "")

  // Fire and forget
  void (async () => {
    interface UserRow { id: string; email: string }
    const rows = await dbQuery<(UserRow & import("mysql2").RowDataPacket)[]>(
      "SELECT id, email FROM erp_users WHERE email = ? AND is_active = 1 LIMIT 1",
      [email]
    )
    if (rows.length === 0) return

    const user = rows[0]!
    const token = generateSecureToken()
    const tokenHash = sha256(token)
    const expiresAt = toMysqlDateTime(new Date(Date.now() + 60 * 60 * 1000))
    const resetId = `rst_${crypto.randomUUID()}`

    await dbExecute(
      "INSERT INTO erp_password_resets (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
      [resetId, user.id, tokenHash, expiresAt]
    )

    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000"
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`
    await sendPasswordResetEmail(user.email, resetUrl).catch((err) => {
      console.error("[Auth] Failed to send reset email:", err)
    })
  })()

  return jsonResponse({ message: "If this email exists, a reset link has been sent." })
})

route("POST", "/auth/reset-password", async (request) => {
  const body = await readJson(request)
  const token = String(body.token ?? "")
  const newPassword = String(body.newPassword ?? "")

  if (!token || !newPassword) {
    return jsonResponse({ error: "token and newPassword are required" }, 400)
  }

  const tokenHash = sha256(token)

  interface ResetRow { id: string; user_id: string }
  const resets = await dbQuery<(ResetRow & import("mysql2").RowDataPacket)[]>(
    "SELECT * FROM erp_password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1",
    [tokenHash]
  )

  if (resets.length === 0) {
    return jsonResponse({ error: "Invalid or expired token" }, 400)
  }

  const resetRow = resets[0]!
  const passwordHash = await hashPassword(newPassword)

  await dbExecute("UPDATE erp_users SET password_hash = ? WHERE id = ?", [
    passwordHash,
    resetRow.user_id
  ])
  await dbExecute(
    "UPDATE erp_password_resets SET used_at = NOW() WHERE id = ?",
    [resetRow.id]
  )
  await dbExecute("DELETE FROM erp_refresh_tokens WHERE user_id = ?", [resetRow.user_id])

  return jsonResponse({ success: true })
})

route("GET", "/auth/ping", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  return jsonResponse({ ok: true, userId: user.id, role: user.role })
})

route("GET", "/auth/me", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user

  interface UserRow {
    id: string
    workspace_id: string
    employee_id: string
    email: string
    role: string
  }
  const rows = await dbQuery<(UserRow & import("mysql2").RowDataPacket)[]>(
    `SELECT u.id, u.workspace_id, u.employee_id, u.email, u.role, e.name as employee_name
     FROM erp_users u
     LEFT JOIN erp_employees e ON e.id = u.employee_id
     WHERE u.id = ? AND u.is_active = 1 LIMIT 1`,
    [user.id]
  )
  if (rows.length === 0) return jsonResponse({ error: "Unauthorized" }, 401)

  const u = rows[0]!
  const permissions = await getPermissionsForRole(u.workspace_id, u.role)

  return jsonResponse({
    id: u.id,
    email: u.email,
    role: u.role,
    workspaceId: u.workspace_id,
    employeeId: u.employee_id,
    name: (u as any).employee_name ?? u.email,
    permissions
  })
})

// ─── Phase 2: User management (admin only) ────────────────────────────────

route("GET", "/users", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const workspaceId = url.searchParams.get("workspaceId") ?? user.workspaceId
  const denied = await requirePermission(user, workspaceId, "users.manage")
  if (denied) return denied

  interface UserListRow {
    id: string
    workspace_id: string
    employee_id: string
    email: string
    role: string
    is_active: number
    last_login_at: string | null
    employee_name: string | null
  }
  const rows = await dbQuery<(UserListRow & import("mysql2").RowDataPacket)[]>(
    `SELECT u.id, u.workspace_id, u.employee_id, u.email, u.role, u.is_active, u.last_login_at,
            e.name as employee_name
     FROM erp_users u
     LEFT JOIN erp_employees e ON e.id = u.employee_id
     WHERE u.workspace_id = ?
     ORDER BY e.name ASC`,
    [workspaceId]
  )
  return jsonResponse(rows)
})

route("POST", "/users", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const body = await readJson(request)
  const workspaceId = String(body.workspaceId ?? user.workspaceId)
  const denied = await requirePermission(user, workspaceId, "users.manage")
  if (denied) return denied

  const email = String(body.email ?? "")
  const role = String(body.role ?? "consultant")
  const name = String(body.name ?? email)

  // Find or create employee
  let employeeId = String(body.employeeId ?? "")
  if (!employeeId) {
    const existingEmps = await dbQuery<import("mysql2").RowDataPacket[]>(
      "SELECT id FROM erp_employees WHERE email = ? AND workspace_id = ? LIMIT 1",
      [email, workspaceId]
    )
    if (existingEmps.length > 0) {
      employeeId = (existingEmps[0]! as { id: string }).id
    } else {
      employeeId = `emp_${crypto.randomUUID()}`
      await dbExecute(
        "INSERT INTO erp_employees (id, workspace_id, name, email, status, synced_at) VALUES (?, ?, ?, ?, 'active', NOW())",
        [employeeId, workspaceId, name, email]
      )
    }
  }

  // Create user with random temp password
  const tempPassword = generateSecureToken()
  const passwordHash = await hashPassword(tempPassword)
  const userId = `usr_${crypto.randomUUID()}`

  await dbExecute(
    "INSERT INTO erp_users (id, workspace_id, employee_id, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, workspaceId, employeeId, email, passwordHash, role]
  )

  // Generate reset token for invite
  const inviteToken = generateSecureToken()
  const inviteHash = sha256(inviteToken)
  const expiresAt = toMysqlDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000)) // 24h invite
  const resetId = `rst_${crypto.randomUUID()}`

  await dbExecute(
    "INSERT INTO erp_password_resets (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
    [resetId, userId, inviteHash, expiresAt]
  )

  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000"
  const inviteUrl = `${frontendUrl}/reset-password?token=${inviteToken}`

  await sendPasswordResetEmail(email, inviteUrl).catch((err) => {
    console.error("[Auth] Failed to send invite email:", err)
  })

  auditAsync(makeActor(user, request), {
    workspaceId,
    action: "create",
    entityType: "user",
    entityId: userId,
    entityLabel: email,
    metadata: { role, name }
  })

  return jsonResponse({ id: userId, inviteUrl })
})

route("POST", "/users/:userId/role", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "users.manage")
  if (denied) return denied

  const body = await readJson(request)
  const role = String(body.role ?? "")
  const validRoles = ["admin", "manager", "consultant", "accountant"]
  if (!validRoles.includes(role)) {
    return jsonResponse({ error: "Invalid role" }, 400)
  }

  const [oldUserRow] = await dbQuery<import("mysql2").RowDataPacket[]>(
    "SELECT role FROM erp_users WHERE id = ? LIMIT 1",
    [params.userId]
  )

  await dbExecute("UPDATE erp_users SET role = ? WHERE id = ?", [role, params.userId])

  auditAsync(makeActor(user, request), {
    workspaceId: user.workspaceId,
    action: "role_change",
    entityType: "user",
    entityId: params.userId!,
    changedFields: { role: { from: oldUserRow?.role, to: role } },
    metadata: { old_role: oldUserRow?.role, new_role: role }
  })

  return jsonResponse({ success: true })
})

route("POST", "/users/:userId/deactivate", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "users.manage")
  if (denied) return denied

  await dbExecute("UPDATE erp_users SET is_active = 0 WHERE id = ?", [params.userId])
  await dbExecute("DELETE FROM erp_refresh_tokens WHERE user_id = ?", [params.userId])
  return jsonResponse({ success: true })
})

route("POST", "/users/:userId/activate", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "users.manage")
  if (denied) return denied

  await dbExecute("UPDATE erp_users SET is_active = 1 WHERE id = ?", [params.userId])
  return jsonResponse({ success: true })
})

// ─── Phase 2: Permission management (admin only) ──────────────────────────

route("GET", "/permissions", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const workspaceId = url.searchParams.get("workspaceId") ?? user.workspaceId
  const denied = await requirePermission(user, workspaceId, "rbac.manage")
  if (denied) return denied

  const rows = await dbQuery<import("mysql2").RowDataPacket[]>(
    "SELECT * FROM erp_role_permissions WHERE workspace_id = ? ORDER BY permission, role",
    [workspaceId]
  )
  return jsonResponse(rows)
})

route("POST", "/permissions", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const body = await readJson(request)
  const workspaceId = String(body.workspaceId ?? user.workspaceId)
  const denied = await requirePermission(user, workspaceId, "rbac.manage")
  if (denied) return denied

  const role = String(body.role ?? "")
  const permission = String(body.permission ?? "")
  const granted = body.granted === true || body.granted === 1 ? 1 : 0
  const id = `perm_${crypto.randomUUID()}`

  await dbExecute(
    `INSERT INTO erp_role_permissions (id, workspace_id, role, permission, granted)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE granted = VALUES(granted)`,
    [id, workspaceId, role, permission, granted]
  )

  invalidatePermissionCache(workspaceId, role)

  auditAsync(makeActor(user, request), {
    workspaceId,
    action: "permission_change",
    entityType: "role_permission",
    entityId: id,
    metadata: { role, permission, granted: granted === 1 }
  })

  return jsonResponse({ success: true })
})

route("POST", "/permissions/reset", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const body = await readJson(request)
  const workspaceId = String(body.workspaceId ?? user.workspaceId)
  const denied = await requirePermission(user, workspaceId, "rbac.manage")
  if (denied) return denied

  await dbExecute(
    "DELETE FROM erp_role_permissions WHERE workspace_id = ?",
    [workspaceId]
  )

  // Invalidate all role caches for this workspace
  for (const role of ["admin", "manager", "consultant", "accountant"]) {
    invalidatePermissionCache(workspaceId, role)
  }

  await seedDefaultPermissions(workspaceId)
  return jsonResponse({ success: true })
})

// ─── Phase 2: Internal Clockify import (bearer token auth preserved) ──────

route("POST", "/internal/clockify/import", async (request) =>
  jsonResponse(await importClockifyPayload((await readJson(request)) as never))
)

route("POST", "/imports/excel/preview", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const body = await readJson(request)
  const fileName = typeof body.fileName === "string" ? body.fileName : "import.xlsx"
  const contentBase64 = typeof body.contentBase64 === "string" ? body.contentBase64 : ""
  return jsonResponse(await previewExcelImport(fileName, contentBase64))
})

route("POST", "/imports/excel/commit", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const body = await readJson(request)
  return jsonResponse(await commitExcelImport((body.rows ?? []) as never))
})

// ─── PDF Report ───────────────────────────────────────────────────────────────
route("GET", "/time-entries/reports/pdf", async (_request, _params, url) => {
  // Accept token as query param for browser download
  const tokenParam = url.searchParams.get("token")
  if (tokenParam !== internalToken) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
  }

  const workspaceId = url.searchParams.get("workspaceId") ?? ""
  const from = url.searchParams.get("from") ?? ""
  const to = url.searchParams.get("to") ?? ""
  const employeeId = url.searchParams.get("employeeId") ?? undefined
  const lang = url.searchParams.get("lang") ?? "pl"
  const isEn = lang === "en"

  const { entries } = await getTimeDetailedReport(workspaceId, { from, to, employeeId })
  const employee = employeeId ? await getEmployeeProfile(employeeId) : null

  // Build PDF content as plain-text layout embedded in a minimal PDF
  const lines: string[] = []
  lines.push(isEn ? "TIMESHEET" : "KARTA CZASU PRACY")
  lines.push(`${isEn ? "Employee" : "Pracownik"}: ${employee?.name ?? employeeId ?? "All employees"}`)
  lines.push(`${isEn ? "Period" : "Okres"}: ${from} - ${to}`)
  if (employee?.contractType) lines.push(`${isEn ? "Contract type" : "Rodzaj umowy"}: ${employee.contractType}`)
  lines.push("")
  lines.push("-".repeat(70))
  lines.push(isEn ? "Date       | Project                      | Task                       | Hours" : "Data        | Projekt                     | Zadanie                    | Godz.")
  lines.push("-".repeat(70))

  let totalSeconds = 0
  for (const e of entries) {
    const date = e.startAt?.slice(0, 10) ?? ""
    const project = (e.projectName ?? "-").slice(0, 26).padEnd(26)
    const task = (e.description ?? "-").slice(0, 26).padEnd(26)
    const hours = ((e.durationSeconds ?? 0) / 3600).toFixed(2).padStart(5)
    totalSeconds += e.durationSeconds ?? 0
    lines.push(`${date} | ${project} | ${task} | ${hours}`)
  }
  lines.push("-".repeat(70))
  lines.push(`${isEn ? "Total hours" : "Lacznie godzin"}: ${(totalSeconds / 3600).toFixed(2)}`)

  const text = lines.join("\n")

  // Build minimal valid PDF with the text
  const pdf = buildSimplePdf(text)

  const month = from.slice(0, 7).replace("-", "_")
  const empName = (employee?.name ?? "all").replace(/\s+/g, "_")

  return new Response(pdf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="timecard_${empName}_${month}.pdf"`
    }
  })
})

function buildSimplePdf(text: string): Uint8Array {
  // Minimal valid PDF with embedded plain text using standard fonts
  const escapedLines = text
    .split("\n")
    .map((line) => line.replace(/[\\()]/g, (c) => `\\${c}`))

  const pageWidth = 595
  const pageHeight = 842
  const fontSize = 9
  const marginLeft = 40
  const marginTop = 780

  const stream =
    `BT\n/F1 ${fontSize} Tf\n${marginLeft} ${marginTop} Td\n` +
    escapedLines.map((line) => `(${line}) Tj\nT*`).join("\n") +
    "\nET"

  const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`
  const streamBytes = new TextEncoder().encode(stream)
  const obj4 = `4 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream\nendobj\n`
  const obj5 = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n`

  const header = `%PDF-1.4\n`
  const body = obj1 + obj2 + obj3 + obj4 + obj5

  const offsets: number[] = []
  let pos = header.length
  offsets.push(pos); pos += obj1.length
  offsets.push(pos); pos += obj2.length
  offsets.push(pos); pos += obj3.length
  offsets.push(pos); pos += obj4.length
  offsets.push(pos); pos += obj5.length

  const xrefOffset = header.length + body.length
  const xref =
    `xref\n0 6\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  const fullPdf = header + body + xref
  return new TextEncoder().encode(fullPdf)
}

// ─── Employee profiles — Phase 1A ────────────────────────────────────────────
route("GET", "/employees/:employeeId/profile", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  // Allow own profile OR employees.view_all
  const perms = await getPermissionsForRole(user.workspaceId, user.role)
  const canViewAll = perms.includes("employees.view_all")
  const isOwnProfile = params.employeeId === user.employeeId
  if (!canViewAll && !isOwnProfile) {
    return jsonResponse({ error: "Forbidden" }, 403)
  }
  const profile = await getEmployeeProfile(params.employeeId!)
  if (!profile) return jsonResponse({ error: "Not found" }, 404)
  const stripped = stripSensitiveFields(profile, user)
  // Log access to internal_rate for non-consultant roles (who can see it)
  if (user.role !== "consultant") {
    auditAsync(makeActor(user, request), {
      workspaceId: user.workspaceId,
      action: "view",
      entityType: "employee",
      entityId: params.employeeId!,
      entityLabel: (profile as any).name as string | undefined,
      metadata: { field: "internal_rate" }
    })
  }
  return jsonResponse(stripped)
})

route("POST", "/employees/:employeeId/profile", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const perms = await getPermissionsForRole(user.workspaceId, user.role)
  const canEditAll = perms.includes("employees.edit_all")
  const isOwnProfile = params.employeeId === user.employeeId
  const canEditOwn = perms.includes("employees.edit_own") && isOwnProfile

  if (!canEditAll && !canEditOwn) {
    return jsonResponse({ error: "Forbidden" }, 403)
  }

  const body = await readJson(request)

  // Consultant editing own profile: restrict to allowed fields only
  if (user.role === "consultant" && isOwnProfile && !canEditAll) {
    const allowedFields = ["name", "email", "profile_picture"]
    for (const key of Object.keys(body)) {
      if (!allowedFields.includes(key)) {
        return jsonResponse(
          { error: `Forbidden: consultants cannot update field '${key}'` },
          403
        )
      }
    }
  }

  const oldProfile = await getEmployeeProfile(params.employeeId!)
  const result = await updateEmployeeProfile({ employeeId: params.employeeId!, ...(body as Record<string, unknown>) })

  const updatableKeys = Object.keys(body)
  const oldFields: Record<string, unknown> = {}
  const newFields: Record<string, unknown> = {}
  for (const k of updatableKeys) {
    oldFields[k] = (oldProfile as any)?.[k]
    newFields[k] = (body as any)[k]
  }
  const changed = diffFields(oldFields, newFields)
  if (Object.keys(changed).length > 0) {
    auditAsync(makeActor(user, request), {
      workspaceId: user.workspaceId,
      action: "update",
      entityType: "employee",
      entityId: params.employeeId!,
      entityLabel: (oldProfile as any)?.name as string | undefined,
      changedFields: changed
    })
    if ("hourlyRate" in changed || "hourly_rate" in changed) {
      auditAsync(makeActor(user, request), {
        workspaceId: user.workspaceId,
        action: "view",
        entityType: "employee",
        entityId: params.employeeId!,
        metadata: { field: "internal_rate" }
      })
    }
  }

  return jsonResponse(result)
})

// ─── Reset avatar — clears manual_avatar_override so Clockify can sync ───────
route("POST", "/employees/:employeeId/reset-avatar", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const perms = await getPermissionsForRole(user.workspaceId, user.role)
  const canEditAll = perms.includes("employees.edit_all")
  const isOwnProfile = params.employeeId === user.employeeId
  const canEditOwn = perms.includes("employees.edit_own") && isOwnProfile
  if (!canEditAll && !canEditOwn) return jsonResponse({ error: "Forbidden" }, 403)

  await updateEmployeeProfile({ employeeId: params.employeeId!, manualAvatarOverride: false })
  auditAsync(makeActor(user, request), {
    workspaceId: user.workspaceId,
    action: "update",
    entityType: "employee",
    entityId: params.employeeId!,
    metadata: { field: "manual_avatar_override", value: false }
  })
  return jsonResponse({ ok: true })
})

// ─── Employee projects ────────────────────────────────────────────────────────
route("GET", "/employees/:employeeId/projects", async (request, params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const employeeId = params.employeeId!
  const workspaceId = url.searchParams.get("workspaceId") ?? user.workspaceId

  // Consultants can only see their own projects
  const perms = await getPermissionsForRole(user.workspaceId, user.role)
  const canViewAll = perms.includes("employees.view_all") || perms.includes("employees.view_internal_rate")
  if (!canViewAll && user.employeeId !== employeeId) {
    return jsonResponse({ error: "Forbidden" }, 403)
  }

  const rows = await dbQuery<Array<{
    project_id: string
    project_name: string
    client_name: string | null
    billing_type: string
    project_archived: number
    first_entry: string | null
  }>>(
    `SELECT
       p.id           AS project_id,
       p.name         AS project_name,
       c.name         AS client_name,
       p.billing_type AS billing_type,
       p.archived     AS project_archived,
       MIN(e.work_date) AS first_entry
     FROM erp_time_entries e
     JOIN erp_projects p ON p.id = e.project_id
     LEFT JOIN erp_clients c ON c.id = p.client_id
     WHERE e.employee_id = ? AND e.workspace_id = ?
     GROUP BY p.id, p.name, c.name, p.billing_type, p.archived
     ORDER BY first_entry DESC`,
    [employeeId, workspaceId]
  )

  const projects = rows.map((r) => ({
    projectId: r.project_id,
    projectName: r.project_name,
    clientName: r.client_name,
    billingType: r.billing_type,
    status: r.project_archived ? "archived" : "active",
    assignedSince: r.first_entry
  }))

  return jsonResponse({ projects })
})

// ─── Client profiles — Phase 1B ──────────────────────────────────────────────
route("GET", "/clients/:clientId/profile", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "clients.view")
  if (denied) return denied
  const profile = await getClientProfile(params.clientId!)
  if (!profile) return jsonResponse({ error: "Not found" }, 404)
  return jsonResponse(profile)
})

route("POST", "/clients/:clientId/profile", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "clients.edit")
  if (denied) return denied
  const body = await readJson(request)
  const result = await updateClientProfile({ clientId: params.clientId!, ...(body as Record<string, unknown>) })
  auditAsync(makeActor(user, request), {
    workspaceId: user.workspaceId,
    action: "update",
    entityType: "client",
    entityId: params.clientId!,
  })
  return jsonResponse(result)
})

route("GET", "/clients", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "clients.view")
  if (denied) return denied
  const workspaceId = url.searchParams.get("workspaceId") ?? ""
  return jsonResponse(await listClientsWithProjects(workspaceId))
})

// ─── Phase 3: Accounting Reports ─────────────────────────────────────────────

// Helper: normalise a month param to YYYY-MM
// Accepts: "2026-05", "2026-5", "5", "05"
function normalizeMonth(raw: string): string {
  if (/^\d{4}-\d{2}$/.test(raw)) return raw                                         // already YYYY-MM
  if (/^\d{4}-\d$/.test(raw)) return raw.replace(/(\d{4})-(\d)$/, "$1-0$2")        // YYYY-M → YYYY-0M
  const n = parseInt(raw, 10)
  if (n >= 1 && n <= 12) {
    return `${new Date().getFullYear()}-${String(n).padStart(2, "0")}`              // M or MM → current-year-0M
  }
  return raw // pass through; SQL will surface a clear error
}

// Helper: days in a month for a YYYY-MM string
function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number)
  return new Date(y!, m!, 0).getDate()
}

// Helper: first and last day of a YYYY-MM month
function monthBounds(month: string): { from: string; to: string } {
  const dim = daysInMonth(month)
  return { from: `${month}-01`, to: `${month}-${String(dim).padStart(2, "0")}` }
}

// Helper: localId
function localId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`
}

// Helper: check if an accounting period is open
async function isPeriodOpen(workspaceId: string, dateString: string): Promise<boolean> {
  const period = String(dateString).slice(0, 7) // YYYY-MM
  const rows = await dbQuery<import("mysql2").RowDataPacket[]>(
    `SELECT status FROM erp_accounting_periods WHERE workspace_id = ? AND period = ? LIMIT 1`,
    [workspaceId, period]
  )
  if (rows.length === 0) return true // No row = open by default
  return rows[0]!.status !== 'closed'
}

// Billing calculation for a set of entries belonging to one project in a period
function calcBilledForProject(
  entries: Array<{ hours: number; billable: boolean }>,
  project: {
    billing_type: string | null
    billing_rate: number | null
    fixed_amount: number | null
    subscription_min_hours: number | null
    subscription_overage_rate: number | null
  }
): number | null {
  const billableHours = entries.filter((e) => e.billable).reduce((s, e) => s + e.hours, 0)
  const totalHours = entries.reduce((s, e) => s + e.hours, 0)
  const hasBillableEntries = billableHours > 0

  if (!hasBillableEntries) return 0

  const type = project.billing_type ?? "hourly"
  if (type === "hourly") {
    const rate = project.billing_rate
    if (rate == null) return null
    return billableHours * rate
  }
  if (type === "fixed") {
    // Show full fixed_amount for the month when any billable work was done.
    // We do NOT prorate by calendar days — the accountant negotiates per-month lump sums.
    const amt = project.fixed_amount
    if (amt == null) return null
    return amt
  }
  if (type === "subscription") {
    const base = project.fixed_amount
    if (base == null) return null
    const minHours = project.subscription_min_hours ?? 0
    const overageRate = project.subscription_overage_rate ?? 0
    const overage = Math.max(0, totalHours - minHours) * overageRate
    return base + overage
  }
  return null
}

type AccountingEntryRow = {
  employee_id: string
  employee_name: string
  contract_type: string | null
  internal_rate: number | null
  project_id: string | null
  project_name: string | null
  client_id: string | null
  client_name: string | null
  billing_type: string | null
  billing_rate: number | null
  fixed_amount: number | null
  subscription_min_hours: number | null
  subscription_overage_rate: number | null
  task: string | null
  work_date: Date | string
  hours: number
  billable: number | boolean
}

async function fetchAccountingEntries(
  workspaceId: string,
  from: string,
  to: string,
  employeeId?: string,
  contractType?: string
): Promise<AccountingEntryRow[]> {
  const conditions: string[] = [
    "te.workspace_id = ?",
    "te.end_at IS NOT NULL",
    "te.work_date >= ?",
    "te.work_date <= ?"
  ]
  const params: unknown[] = [workspaceId, from, to]

  if (employeeId) {
    conditions.push("te.employee_id = ?")
    params.push(employeeId)
  }
  if (contractType) {
    if (contractType === "unset") {
      conditions.push("e.contract_type IS NULL")
    } else {
      conditions.push("e.contract_type = ?")
      params.push(contractType)
    }
  }

  const sql = `
    SELECT
      te.employee_id,
      e.name         AS employee_name,
      e.contract_type,
      e.hourly_rate  AS internal_rate,
      te.project_id,
      p.name         AS project_name,
      p.client_id,
      c.name         AS client_name,
      p.billing_type,
      p.billing_rate,
      p.fixed_amount,
      p.subscription_min_hours,
      p.subscription_overage_rate,
      te.description AS task,
      te.work_date,
      ROUND(COALESCE(te.duration_seconds, 0) / 3600.0, 4) AS hours,
      te.billable
    FROM erp_time_entries te
    JOIN erp_employees e ON te.employee_id = e.id
    LEFT JOIN erp_projects p ON te.project_id = p.id
    LEFT JOIN erp_clients c ON p.client_id = c.id
    WHERE ${conditions.join(" AND ")}
    ORDER BY te.employee_id, te.work_date, te.start_at
  `

  return dbQuery<AccountingEntryRow[]>(sql, params)
}

route("GET", "/accounting/monthly", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "reports.accounting")
  if (denied) return denied

  const q = query(url)
  const workspaceId = q.workspaceId ?? user.workspaceId
  const month = normalizeMonth(q.month ?? new Date().toISOString().slice(0, 7))
  const { from, to } = monthBounds(month)

  const rows = await fetchAccountingEntries(
    workspaceId,
    from,
    to,
    q.employeeId || undefined,
    q.contractType || undefined
  )

  // Group by employee
  const byEmployee = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = row.employee_id
    if (!byEmployee.has(key)) byEmployee.set(key, [])
    byEmployee.get(key)!.push(row)
  }

  const employees = [...byEmployee.entries()].map(([employeeId, entries]) => {
    const first = entries[0]!
    const totalHours = entries.reduce((s, e) => s + Number(e.hours), 0)
    const billableHours = entries.filter((e) => e.billable == 1 || e.billable === true).reduce((s, e) => s + Number(e.hours), 0)
    const rate = first.internal_rate != null ? Number(first.internal_rate) : null
    const totalCost = rate != null ? Math.round(totalHours * rate * 100) / 100 : null

    return {
      employeeId,
      name: first.employee_name,
      contractType: first.contract_type,
      totalHours: Math.round(totalHours * 100) / 100,
      billableHours: Math.round(billableHours * 100) / 100,
      internalRate: rate,
      totalCost,
      entries: entries.map((e) => ({
        date: typeof e.work_date === "string" ? e.work_date.slice(0, 10) : (e.work_date as Date).toISOString().slice(0, 10),
        project: e.project_name ?? "-",
        client: e.client_name ?? "-",
        task: e.task ?? "-",
        hours: Math.round(Number(e.hours) * 100) / 100,
        billable: e.billable == 1 || e.billable === true
      }))
    }
  })

  return jsonResponse({ month, employees })
})

route("GET", "/accounting/cost-vs-billed", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "reports.accounting")
  if (denied) return denied

  const q = query(url)
  const workspaceId = q.workspaceId ?? user.workspaceId
  const from = q.from ?? new Date().toISOString().slice(0, 7) + "-01"
  const to = q.to ?? from
  const groupBy = (q.groupBy as string) ?? "employee"

  const rows = await fetchAccountingEntries(workspaceId, from, to)

  // Build grouping key per row
  function rowKey(row: AccountingEntryRow): string {
    if (groupBy === "project") return row.project_id ?? "__no_project__"
    if (groupBy === "client") return row.client_id ?? "__no_client__"
    return row.employee_id
  }
  function rowLabel(row: AccountingEntryRow): string {
    if (groupBy === "project") return row.project_name ?? "(No project)"
    if (groupBy === "client") return row.client_name ?? "(No client)"
    return row.employee_name
  }

  // Aggregate per group
  const groups = new Map<string, {
    label: string
    totalHours: number
    billableHours: number
    costParts: Array<{ hours: number; rate: number | null }>
    projectBilledParts: Map<string, { entries: Array<{ hours: number; billable: boolean }>; project: AccountingEntryRow }>
  }>()

  for (const row of rows) {
    const key = rowKey(row)
    if (!groups.has(key)) {
      groups.set(key, {
        label: rowLabel(row),
        totalHours: 0,
        billableHours: 0,
        costParts: [],
        projectBilledParts: new Map()
      })
    }
    const g = groups.get(key)!
    const hours = Number(row.hours)
    g.totalHours += hours
    if (row.billable == 1 || row.billable === true) g.billableHours += hours
    g.costParts.push({ hours, rate: row.internal_rate != null ? Number(row.internal_rate) : null })

    // Track per project for billed calc
    const pKey = row.project_id ?? "__no_project__"
    if (!g.projectBilledParts.has(pKey)) {
      g.projectBilledParts.set(pKey, { entries: [], project: row })
    }
    g.projectBilledParts.get(pKey)!.entries.push({ hours, billable: row.billable == 1 || row.billable === true })
  }

  const resultEntries = [...groups.entries()]
  const result = resultEntries.map(([, g]) => {
    const hasAllRates = g.costParts.every((p) => p.rate != null)
    const cost = hasAllRates
      ? Math.round(g.costParts.reduce((s, p) => s + p.hours * (p.rate ?? 0), 0) * 100) / 100
      : null

    let billed: number | null = 0
    let billedOk = true
    for (const { entries, project } of g.projectBilledParts.values()) {
      const b = calcBilledForProject(entries, project)
      if (b == null) { billedOk = false; break }
      billed = (billed ?? 0) + b
    }
    if (!billedOk) billed = null
    if (billed != null) billed = Math.round(billed * 100) / 100

    const margin = cost != null && billed != null ? Math.round((billed - cost) * 100) / 100 : null
    const marginPercent = margin != null && billed != null && billed > 0
      ? Math.round((margin / billed) * 1000) / 10
      : null

    return {
      key: g.label,
      totalHours: Math.round(g.totalHours * 100) / 100,
      billableHours: Math.round(g.billableHours * 100) / 100,
      cost,
      personnelCost: cost,
      materialsCost: 0 as number | null,
      totalCost: cost,
      billed,
      margin,
      marginPercent
    }
  })

  // Add materials cost for project groupBy
  if (groupBy === 'project') {
    type MatRow = {
      project_id: string; materials_cost: number
    }
    const matRows = await dbQuery<MatRow[]>(`
      SELECT wd.project_id, SUM(wi.unit_price * wi.quantity) AS materials_cost
      FROM erp_warehouse_documents wd
      JOIN erp_warehouse_document_items wi ON wi.warehouse_document_id = wd.id
      WHERE wd.workspace_id = ?
        AND wd.doc_type = 'PZ'
        AND wd.status = 'confirmed'
        AND wd.project_id IS NOT NULL
        AND wd.doc_date >= ?
        AND wd.doc_date <= ?
      GROUP BY wd.project_id
    `, [workspaceId, from, to])

    const matByProject = new Map(matRows.map((r) => [r.project_id, Number(r.materials_cost ?? 0)]))

    result.forEach((row, i) => {
      const projectId = resultEntries[i]![0]
      const mat = matByProject.get(projectId ?? "") ?? 0
      const personnelCost = row.personnelCost
      const totalCost = personnelCost != null ? Math.round((personnelCost + mat) * 100) / 100 : (mat > 0 ? mat : null)
      row.materialsCost = mat
      row.totalCost = totalCost
      const billed = row.billed
      const margin = totalCost != null && billed != null ? Math.round((billed - totalCost) * 100) / 100 : null
      const marginPercent = margin != null && billed != null && billed > 0 ? Math.round((margin / billed) * 1000) / 10 : null
      row.margin = margin
      row.marginPercent = marginPercent
    })
  }

  return jsonResponse({ from, to, groupBy, rows: result })
})

route("GET", "/accounting/by-contract-type", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "reports.accounting")
  if (denied) return denied

  const q = query(url)
  const workspaceId = q.workspaceId ?? user.workspaceId
  const month = normalizeMonth(q.month ?? new Date().toISOString().slice(0, 7))
  const { from, to } = monthBounds(month)

  const rows = await fetchAccountingEntries(workspaceId, from, to)

  const byEmployee = new Map<string, AccountingEntryRow[]>()
  for (const row of rows) {
    if (!byEmployee.has(row.employee_id)) byEmployee.set(row.employee_id, [])
    byEmployee.get(row.employee_id)!.push(row)
  }

  const byContractType = new Map<string, typeof byEmployee>()
  for (const [empId, empRows] of byEmployee) {
    const ct = empRows[0]!.contract_type ?? "unset"
    if (!byContractType.has(ct)) byContractType.set(ct, new Map())
    byContractType.get(ct)!.set(empId, empRows)
  }

  const ORDER = ["uop", "zlecenie", "b2b", "staz", "other", "unset"]
  const groups = ORDER.filter((ct) => byContractType.has(ct)).map((ct) => {
    const empMap = byContractType.get(ct)!
    const employees = [...empMap.entries()].map(([employeeId, entries]) => {
      const first = entries[0]!
      const totalHours = entries.reduce((s, e) => s + Number(e.hours), 0)
      const billableHours = entries.filter((e) => e.billable == 1 || e.billable === true).reduce((s, e) => s + Number(e.hours), 0)
      const rate = first.internal_rate != null ? Number(first.internal_rate) : null
      const totalCost = rate != null ? Math.round(totalHours * rate * 100) / 100 : null
      return {
        employeeId,
        name: first.employee_name,
        contractType: first.contract_type,
        totalHours: Math.round(totalHours * 100) / 100,
        billableHours: Math.round(billableHours * 100) / 100,
        internalRate: rate,
        totalCost,
        entries: entries.map((e) => ({
          date: typeof e.work_date === "string" ? e.work_date.slice(0, 10) : (e.work_date as Date).toISOString().slice(0, 10),
          project: e.project_name ?? "-",
          client: e.client_name ?? "-",
          task: e.task ?? "-",
          hours: Math.round(Number(e.hours) * 100) / 100,
          billable: e.billable == 1 || e.billable === true
        }))
      }
    })

    const totalHours = employees.reduce((s, e) => s + e.totalHours, 0)
    const costRows = employees.map((e) => e.totalCost)
    const totalCost = costRows.every((c) => c != null) ? Math.round(costRows.reduce((s, c) => s + (c ?? 0), 0) * 100) / 100 : null

    return {
      contractType: ct as "uop" | "zlecenie" | "b2b" | "staz" | "other" | "unset",
      totalEmployees: employees.length,
      totalHours: Math.round(totalHours * 100) / 100,
      totalCost,
      employees
    }
  })

  return jsonResponse({ month, groups })
})

async function handleAccountingExport(request: Request, url: URL): Promise<Response> {
  // Support both cookie-auth (normal) and ?token= param (browser GET download for PDF)
  const tokenParam = url.searchParams.get("token")
  let user: AuthUser
  let body: Record<string, unknown>

  if (tokenParam) {
    if (tokenParam !== internalToken) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }
    user = { id: "system", workspaceId: url.searchParams.get("workspaceId") ?? "", role: "admin", employeeId: "", email: "" }
    body = Object.fromEntries(url.searchParams.entries())
  } else {
    const authResult = requireAuth(request)
    if (authResult instanceof Response) return authResult
    user = authResult
    const denied = await requirePermission(user, user.workspaceId, "reports.accounting")
    if (denied) return denied
    body = request.method === "GET" ? Object.fromEntries(url.searchParams.entries()) : await readJson(request)
  }

  const workspaceId = (typeof body.workspaceId === "string" ? body.workspaceId : user.workspaceId)
  const exportType = typeof body.type === "string" ? body.type : "monthly_csv"
  const month = typeof body.month === "string" && body.month ? body.month : undefined
  const from = typeof body.from === "string" && body.from ? body.from : undefined
  const to = typeof body.to === "string" && body.to ? body.to : undefined
  const employeeId = typeof body.employeeId === "string" && body.employeeId ? body.employeeId : undefined
  const contractType = typeof body.contractType === "string" && body.contractType ? body.contractType : undefined

  // Log export (skip for system/token auth since we don't have a real user id)
  if (user.id !== "system") {
    const logId = localId("exp")
    await dbExecute(
      `INSERT INTO erp_export_log (id, workspace_id, exported_by, export_type, params)
       VALUES (?, ?, ?, ?, ?)`,
      [logId, workspaceId, user.id, exportType, JSON.stringify({ month, from, to, employeeId, contractType })]
    )
    auditAsync(makeActor(user, request), {
      workspaceId,
      action: "export",
      entityType: "accounting_report",
      entityId: logId,
      metadata: { exportType, month, from, to, employeeId, contractType }
    })
  }

  if (exportType === "monthly_pdf" || exportType === "monthly_csv") {
    const targetMonth = month ?? new Date().toISOString().slice(0, 7)
    const { from: mFrom, to: mTo } = monthBounds(targetMonth)
    const rows = await fetchAccountingEntries(workspaceId, mFrom, mTo, employeeId, contractType)

    if (exportType === "monthly_csv") {
      const csv = buildAccountingCsv(rows, targetMonth)
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="accounting_${targetMonth}.csv"`
        }
      })
    }

    // monthly_pdf — multi-employee
    const pdf = buildAccountingPdf(rows, targetMonth)
    return new Response(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="accounting_${targetMonth}.pdf"`
      }
    })
  }

  if (exportType === "cost_billed_csv") {
    const rangeFrom = from ?? new Date().toISOString().slice(0, 7) + "-01"
    const rangeTo = to ?? rangeFrom
    const rows = await fetchAccountingEntries(workspaceId, rangeFrom, rangeTo)

    const byEmployee = new Map<string, { name: string; rows: AccountingEntryRow[] }>()
    for (const row of rows) {
      if (!byEmployee.has(row.employee_id)) byEmployee.set(row.employee_id, { name: row.employee_name, rows: [] })
      byEmployee.get(row.employee_id)!.rows.push(row)
    }

    const BOM = "\uFEFF"
    const csvHeader = "Employee,Total Hours,Billable Hours,Cost (PLN),Billed (PLN),Margin (PLN),Margin %\r\n"
    const dataLines = [...byEmployee.values()].map(({ name, rows: empRows }) => {
      const totalHours = empRows.reduce((s, e) => s + Number(e.hours), 0)
      const billableHours = empRows.filter((e) => e.billable == 1 || e.billable === true).reduce((s, e) => s + Number(e.hours), 0)
      const rate = empRows[0]!.internal_rate != null ? Number(empRows[0]!.internal_rate) : null
      const cost = rate != null ? Math.round(totalHours * rate * 100) / 100 : null

      const byProject = new Map<string, { entries: Array<{ hours: number; billable: boolean }>; project: AccountingEntryRow }>()
      for (const r of empRows) {
        const pk = r.project_id ?? "__none__"
        if (!byProject.has(pk)) byProject.set(pk, { entries: [], project: r })
        byProject.get(pk)!.entries.push({ hours: Number(r.hours), billable: r.billable == 1 || r.billable === true })
      }

      let billed: number | null = 0
      let billedOk = true
      for (const { entries, project } of byProject.values()) {
        const b = calcBilledForProject(entries, project)
        if (b == null) { billedOk = false; break }
        billed = (billed ?? 0) + b
      }
      if (!billedOk) billed = null

      const margin = cost != null && billed != null ? billed - cost : null
      const marginPct = margin != null && billed != null && billed > 0 ? Math.round(margin / billed * 1000) / 10 : null
      const fmt = (v: number | null) => v != null ? String(Math.round(v * 100) / 100) : ""
      return `"${name}",${fmt(totalHours)},${fmt(billableHours)},${fmt(cost)},${fmt(billed)},${fmt(margin)},${marginPct != null ? marginPct + "%" : ""}\r\n`
    })

    return new Response(BOM + csvHeader + dataLines.join(""), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="cost_billed_${rangeFrom}_${rangeTo}.csv"`
      }
    })
  }

  return jsonResponse({ error: `Unknown export type: ${exportType}` }, 400)
}

route("GET", "/accounting/export", async (request, _params, url) =>
  handleAccountingExport(request, url)
)

route("POST", "/accounting/export", async (request, _params, url) =>
  handleAccountingExport(request, url)
)

route("GET", "/accounting/export-history", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "reports.accounting")
  if (denied) return denied

  const workspaceId = url.searchParams.get("workspaceId") ?? user.workspaceId

  type ExportLogRow = {
    id: string
    workspace_id: string
    exported_by: string
    export_type: string
    params: unknown
    created_at: Date | string
    user_name: string | null
    user_email: string | null
  }

  const rows = await dbQuery<ExportLogRow[]>(`
    SELECT
      el.id,
      el.workspace_id,
      el.exported_by,
      el.export_type,
      el.params,
      el.created_at,
      u.email AS user_email,
      COALESCE(e.name, u.email) AS user_name
    FROM erp_export_log el
    LEFT JOIN erp_users u ON el.exported_by = u.id
    LEFT JOIN erp_employees e ON u.employee_id = e.id
    WHERE el.workspace_id = ?
    ORDER BY el.created_at DESC
    LIMIT 100
  `, [workspaceId])

  return jsonResponse(rows.map((r) => ({
    id: r.id,
    exportType: r.export_type,
    params: typeof r.params === "string" ? JSON.parse(r.params as string) : r.params,
    createdAt: typeof r.created_at === "string" ? r.created_at : (r.created_at as Date).toISOString(),
    exportedBy: r.exported_by,
    exportedByName: r.user_name ?? r.user_email ?? r.exported_by
  })))
})

// ─── Accounting period management ────────────────────────────────────────────

route("GET", "/accounting/periods", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "reports.accounting")
  if (denied) return denied

  const workspaceId = url.searchParams.get("workspaceId") ?? user.workspaceId

  type PeriodRow = {
    id: string; workspace_id: string; period: string; status: string
    closed_by: string | null; closed_at: Date | string | null; notes: string | null
    closed_by_name: string | null
  }

  const periodRows = await dbQuery<PeriodRow[]>(`
    SELECT ap.*, COALESCE(e.name, u.email) AS closed_by_name
    FROM erp_accounting_periods ap
    LEFT JOIN erp_users u ON ap.closed_by = u.id
    LEFT JOIN erp_employees e ON u.employee_id = e.id
    WHERE ap.workspace_id = ?
    ORDER BY ap.period DESC
  `, [workspaceId])

  return jsonResponse(periodRows.map((r) => ({
    id: r.id,
    period: r.period,
    status: r.status,
    closedBy: r.closed_by,
    closedByName: r.closed_by_name,
    closedAt: r.closed_at ? (typeof r.closed_at === "string" ? r.closed_at : (r.closed_at as Date).toISOString()) : null,
    notes: r.notes
  })))
})

route("POST", "/accounting/periods/:period/close", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "accounting.close_period")
  if (denied) return denied

  const period = params.period! // YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(period)) return jsonResponse({ error: "period must be YYYY-MM" }, 400)

  const id = localId("ap")
  await dbExecute(`
    INSERT INTO erp_accounting_periods (id, workspace_id, period, status, closed_by, closed_at)
    VALUES (?, ?, ?, 'closed', ?, NOW())
    ON DUPLICATE KEY UPDATE status = 'closed', closed_by = VALUES(closed_by), closed_at = NOW()
  `, [id, user.workspaceId, period, user.id])

  auditAsync(makeActor(user, request), {
    workspaceId: user.workspaceId,
    action: "update",
    entityType: "accounting_period",
    entityId: period,
    entityLabel: `Period ${period}`,
    metadata: { action: "close" }
  })

  return jsonResponse({ ok: true, period, status: "closed" })
})

route("POST", "/accounting/periods/:period/reopen", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "accounting.close_period")
  if (denied) return denied

  const period = params.period!
  if (!/^\d{4}-\d{2}$/.test(period)) return jsonResponse({ error: "period must be YYYY-MM" }, 400)

  await dbExecute(`
    INSERT INTO erp_accounting_periods (id, workspace_id, period, status)
    VALUES (?, ?, ?, 'open')
    ON DUPLICATE KEY UPDATE status = 'open', closed_by = NULL, closed_at = NULL
  `, [localId("ap"), user.workspaceId, period])

  auditAsync(makeActor(user, request), {
    workspaceId: user.workspaceId,
    action: "update",
    entityType: "accounting_period",
    entityId: period,
    entityLabel: `Period ${period}`,
    metadata: { action: "reopen" }
  })

  return jsonResponse({ ok: true, period, status: "open" })
})

// ─── Accounting PDF builder (multi-employee) ──────────────────────────────────

function buildAccountingPdf(rows: AccountingEntryRow[], month: string): Uint8Array {
  // Group entries by employee
  const byEmployee = new Map<string, AccountingEntryRow[]>()
  for (const row of rows) {
    if (!byEmployee.has(row.employee_id)) byEmployee.set(row.employee_id, [])
    byEmployee.get(row.employee_id)!.push(row)
  }

  const pages: string[] = []

  for (const [, empRows] of byEmployee) {
    const first = empRows[0]!
    const totalHours = empRows.reduce((s, e) => s + Number(e.hours), 0)
    const billableHours = empRows.filter((e) => e.billable == 1 || e.billable === true).reduce((s, e) => s + Number(e.hours), 0)
    const rate = first.internal_rate != null ? Number(first.internal_rate) : null
    const totalCost = rate != null ? Math.round(totalHours * rate * 100) / 100 : null

    const lines: string[] = []
    lines.push("KARTA CZASU PRACY / TIME CARD")
    lines.push(`Pracownik / Employee: ${first.employee_name}`)
    lines.push(`Okres / Period: ${month}-01 - ${month}-${String(daysInMonth(month)).padStart(2, "0")}`)
    if (first.contract_type) lines.push(`Rodzaj umowy / Contract type: ${first.contract_type}`)
    if (rate != null) lines.push(`Stawka wewnetrzna / Internal rate: ${rate} PLN/h`)
    lines.push("")
    lines.push("-".repeat(70))
    lines.push("Data        | Projekt                     | Zadanie                    | Godz.")
    lines.push("-".repeat(70))

    for (const e of empRows) {
      const date = typeof e.work_date === "string" ? e.work_date.slice(0, 10) : (e.work_date as Date).toISOString().slice(0, 10)
      const project = (e.project_name ?? "-").slice(0, 26).padEnd(26)
      const task = (e.task ?? "-").slice(0, 26).padEnd(26)
      const hours = Number(e.hours).toFixed(2).padStart(5)
      lines.push(`${date} | ${project} | ${task} | ${hours}`)
    }

    lines.push("-".repeat(70))
    lines.push(`Lacznie godzin / Total hours: ${totalHours.toFixed(2)}`)
    lines.push(`Godziny rozliczane / Billable hours: ${billableHours.toFixed(2)}`)
    if (totalCost != null) lines.push(`Koszt / Cost: ${totalCost.toFixed(2)} PLN`)
    else lines.push("Koszt / Cost: - (stawka nie ustawiona)")

    pages.push(lines.join("\n"))
  }

  // Summary page
  const sumLines: string[] = []
  sumLines.push("PODSUMOWANIE / SUMMARY")
  sumLines.push(`Okres / Period: ${month}`)
  sumLines.push("")
  sumLines.push("-".repeat(70))
  sumLines.push("Pracownik             | Umowa    | Godz.   | Koszt (PLN)")
  sumLines.push("-".repeat(70))

  let grandTotalHours = 0
  let grandTotalCost = 0
  let anyCostMissing = false

  for (const [, empRows] of byEmployee) {
    const first = empRows[0]!
    const totalHours = empRows.reduce((s, e) => s + Number(e.hours), 0)
    const rate = first.internal_rate != null ? Number(first.internal_rate) : null
    const cost = rate != null ? Math.round(totalHours * rate * 100) / 100 : null
    grandTotalHours += totalHours
    if (cost != null) grandTotalCost += cost
    else anyCostMissing = true
    const name = first.employee_name.slice(0, 20).padEnd(20)
    const ct = (first.contract_type ?? "-").slice(0, 8).padEnd(8)
    const h = totalHours.toFixed(2).padStart(7)
    const c = cost != null ? cost.toFixed(2).padStart(10) : "         -"
    sumLines.push(`${name} | ${ct} | ${h} | ${c}`)
  }

  sumLines.push("-".repeat(70))
  const totalCostStr = anyCostMissing ? `${grandTotalCost.toFixed(2)} + brak stawek` : grandTotalCost.toFixed(2)
  sumLines.push(`RAZEM / TOTAL: ${grandTotalHours.toFixed(2)} h  |  Koszt: ${totalCostStr} PLN`)
  pages.push(sumLines.join("\n"))

  return buildMultiPagePdf(pages)
}

function buildMultiPagePdf(pages: string[]): Uint8Array {
  const fontSize = 9
  const lineHeight = 13
  const marginLeft = 40
  const marginTop = 780
  const pageWidth = 595
  const pageHeight = 842

  // Build content streams per page
  const streams = pages.map((text) => {
    const escapedLines = text
      .split("\n")
      .map((line) => line.replace(/[\\()]/g, (c) => `\\${c}`))
    return (
      `BT\n/F1 ${fontSize} Tf\n${marginLeft} ${marginTop} Td\n${lineHeight} TL\n` +
      escapedLines.map((line) => `(${line}) Tj T*`).join("\n") +
      "\nET"
    )
  })

  // Object allocation:
  // 1 0 R — Catalog
  // 2 0 R — Pages (parent)
  // For each page i:
  //   (3 + i*2) 0 R — Page
  //   (4 + i*2) 0 R — Content stream
  // Last obj — Font

  const n = pages.length
  const fontObjNum = 3 + n * 2

  const objects: string[] = []
  // obj 1: Catalog
  const pageObjNums = pages.map((_, i) => 3 + i * 2)
  const kidsStr = pageObjNums.map((num) => `${num} 0 R`).join(" ")
  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`)
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${n} >>\nendobj\n`)

  for (let i = 0; i < n; i++) {
    const pageObjNum = 3 + i * 2
    const contentObjNum = 4 + i * 2
    objects.push(
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentObjNum} 0 R /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> >>\nendobj\n`
    )
    const streamBytes = new TextEncoder().encode(streams[i]!)
    objects.push(
      `${contentObjNum} 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${streams[i]!}\nendstream\nendobj\n`
    )
  }

  objects.push(
    `${fontObjNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n`
  )

  const header = `%PDF-1.4\n`
  const body = objects.join("")

  const offsets: number[] = []
  let pos = header.length
  for (const obj of objects) {
    offsets.push(pos)
    pos += obj.length
  }

  const totalObjs = objects.length + 1 // +1 for the free entry
  const xrefOffset = header.length + body.length
  const xref =
    `xref\n0 ${totalObjs}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  return new TextEncoder().encode(header + body + xref)
}

// ─── Accounting CSV builder ────────────────────────────────────────────────────

function buildAccountingCsv(rows: AccountingEntryRow[], month: string): string {
  const BOM = "\uFEFF"
  const header = `"Miesiac / Month","Pracownik / Employee","Rodzaj umowy / Contract","Data / Date","Projekt / Project","Klient / Client","Zadanie / Task","Godziny / Hours","Rozliczane / Billable","Stawka wewnetrzna / Internal rate","Koszt / Cost (PLN)"\r\n`

  const lines = rows.map((r) => {
    const date = typeof r.work_date === "string" ? r.work_date.slice(0, 10) : (r.work_date as Date).toISOString().slice(0, 10)
    const hours = Number(r.hours)
    const rate = r.internal_rate != null ? Number(r.internal_rate) : null
    const cost = rate != null ? (hours * rate).toFixed(2) : ""
    const billable = (r.billable == 1 || r.billable === true) ? "TAK" : "NIE"
    const csvStr = (v: string | null | undefined) => `"${(v ?? "").replace(/"/g, '""')}"`
    return [
      csvStr(month),
      csvStr(r.employee_name),
      csvStr(r.contract_type),
      csvStr(date),
      csvStr(r.project_name),
      csvStr(r.client_name),
      csvStr(r.task),
      String(hours.toFixed(2)),
      billable,
      rate != null ? String(rate) : "",
      cost
    ].join(",") + "\r\n"
  })

  return BOM + header + lines.join("")
}

// ─── Phase 4: Document management helpers ─────────────────────────────────────

function getUploadsDir(): string {
  return process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads")
}

function getMaxFileSizeBytes(): number {
  const mb = Number(process.env.MAX_FILE_SIZE_MB ?? 25)
  return mb * 1024 * 1024
}

function getStoragePath(workspaceId: string, docType: string, ext: string): string {
  const now = new Date()
  const yyyyMM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  const uuid = crypto.randomUUID()
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase()
  return path.join(workspaceId, docType, yyyyMM, `${uuid}.${safeExt}`)
}

function mimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }
  return map[ext.toLowerCase()] ?? "application/octet-stream"
}

const ALLOWED_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp", "docx", "xlsx"])

// ─── Phase 4: Document routes ──────────────────────────────────────────────────

route("POST", "/documents/upload", async (request, _params, _url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.upload")
  if (denied) return denied

  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.includes("multipart/form-data")) {
    return jsonResponse({ error: "Content-Type must be multipart/form-data" }, 400)
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return jsonResponse({ error: "Failed to parse multipart form data" }, 400)
  }

  const file = formData.get("file") as File | null
  if (!file || typeof file === "string") {
    return jsonResponse({ error: "file field is required" }, 400)
  }

  const maxBytes = getMaxFileSizeBytes()
  if (file.size > maxBytes) {
    const mb = Math.round(file.size / 1024 / 1024)
    const maxMb = Math.round(maxBytes / 1024 / 1024)
    return jsonResponse({ error: `File too large: ${mb}MB exceeds ${maxMb}MB limit` }, 413)
  }

  const originalName = file.name
  const rawExt = originalName.split(".").pop() ?? ""
  const ext = rawExt.toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return jsonResponse({ error: `File type .${ext} is not allowed` }, 400)
  }

  const docType = (formData.get("docType") as string | null) ?? "other"
  const validDocTypes = ["contract","invoice","receipt","id_document","certificate","nda","amendment","other"]
  if (!validDocTypes.includes(docType)) {
    return jsonResponse({ error: `Invalid docType: ${docType}` }, 400)
  }

  const notes = (formData.get("notes") as string | null) ?? null
  const entityType = formData.get("entityType") as string | null
  const entityId = formData.get("entityId") as string | null

  const containsPersonalData = docType === "id_document"

  // Determine workspaceId: prefer explicit field, fall back to user's workspace
  const workspaceId = (formData.get("workspaceId") as string | null) ?? user.workspaceId

  const relPath = getStoragePath(workspaceId, docType, ext)
  const uploadsDir = getUploadsDir()
  const absPath = path.join(uploadsDir, relPath)

  // Create directories
  fs.mkdirSync(path.dirname(absPath), { recursive: true })

  // Write file
  const bytes = await file.arrayBuffer()
  fs.writeFileSync(absPath, Buffer.from(bytes))

  const mimeType = mimeFromExt(ext)
  const docId = `doc_${crypto.randomUUID()}`

  await dbExecute(
    `INSERT INTO erp_documents
      (id, workspace_id, uploaded_by, doc_type, original_name, storage_path, mime_type, file_size_bytes, contains_personal_data, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [docId, workspaceId, user.id, docType, originalName, relPath, mimeType, file.size, containsPersonalData ? 1 : 0, notes]
  )

  // Optional immediate link
  if (entityType && entityId && ["employee","client","project"].includes(entityType)) {
    const linkId = `dlnk_${crypto.randomUUID()}`
    await dbExecute(
      `INSERT IGNORE INTO erp_document_links (id, document_id, entity_type, entity_id)
       VALUES (?, ?, ?, ?)`,
      [linkId, docId, entityType, entityId]
    )
  }

  auditAsync(makeActor(user, request), {
    workspaceId,
    action: "create",
    entityType: "document",
    entityId: docId,
    entityLabel: originalName,
    metadata: { docType, containsPersonalData }
  })

  // Auto-PZ: when an invoice is uploaded, create a draft PZ warehouse document
  if (docType === "invoice") {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const docDate = now.toISOString().slice(0, 10)
    try {
      const seq = await nextWarehouseSeq(workspaceId, "PZ", year, month)
      const docNumber = generateWarehouseDocNumber("PZ", year, month, seq)
      const whId = localId("wh")
      await dbExecute(
        `INSERT INTO erp_warehouse_documents
         (id, workspace_id, doc_type, doc_number, financial_doc_id, doc_date, status, notes, created_by)
         VALUES (?, ?, 'PZ', ?, ?, ?, 'draft', ?, ?)`,
        [whId, workspaceId, docNumber, docId, docDate, `Auto-created from invoice upload: ${originalName}`, user.id]
      )
    } catch (err) {
      // Non-critical — log and continue (doc upload succeeded)
      console.error("[Auto-PZ failed]", err)
    }
  }

  // Fire-and-forget: Drive + Proxmox sync (do not await — response returned immediately)
  syncDocumentToDrive(docId).catch(err => console.error("[Drive sync failed]", err))
  syncDocumentToProxmox(docId).catch(err => console.error("[Proxmox sync failed]", err))

  const uploadedRows = await dbQuery<import("mysql2").RowDataPacket[]>(
    `SELECT d.*,
            u.email AS uploaded_by_email,
            e.name  AS uploaded_by_name
       FROM erp_documents d
       LEFT JOIN erp_users u ON u.id = d.uploaded_by
       LEFT JOIN erp_employees e ON e.id = u.employee_id
      WHERE d.id = ?`,
    [docId]
  )
  const doc = uploadedRows[0]

  return jsonResponse({ document: doc }, 201)
})

route("GET", "/documents", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const q = query(url)
  const workspaceId = (q.workspaceId as string | undefined) ?? user.workspaceId
  const denied = await requirePermission(user, workspaceId, "documents.view")
  if (denied) return denied

  const { entityType, entityId, docType, q: search } = q as Record<string, string | undefined>
  const page = Math.max(1, Number(q.page ?? 1))
  const limit = Math.min(100, Number(q.limit ?? 50))
  const offset = (page - 1) * limit

  const conditions: string[] = ["d.workspace_id = ?"]
  const params: unknown[] = [workspaceId]

  if (entityType && entityId) {
    conditions.push("EXISTS (SELECT 1 FROM erp_document_links dl WHERE dl.document_id = d.id AND dl.entity_type = ? AND dl.entity_id = ?)")
    params.push(entityType, entityId)
  } else if (entityType) {
    conditions.push("EXISTS (SELECT 1 FROM erp_document_links dl WHERE dl.document_id = d.id AND dl.entity_type = ?)")
    params.push(entityType)
  }

  if (docType) {
    conditions.push("d.doc_type = ?")
    params.push(docType)
  }

  if (search) {
    conditions.push("(d.original_name LIKE ? OR d.notes LIKE ?)")
    params.push(`%${search}%`, `%${search}%`)
  }

  const where = conditions.join(" AND ")

  const rows = await dbQuery<import("mysql2").RowDataPacket[]>(
    `SELECT d.*,
            u.email AS uploaded_by_email,
            e.name  AS uploaded_by_name,
            (SELECT JSON_ARRAYAGG(JSON_OBJECT('entityType', dl.entity_type, 'entityId', dl.entity_id))
               FROM erp_document_links dl WHERE dl.document_id = d.id) AS linked_entities
       FROM erp_documents d
       LEFT JOIN erp_users u ON u.id = d.uploaded_by
       LEFT JOIN erp_employees e ON e.id = u.employee_id
      WHERE ${where}
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  const countRows = await dbQuery<import("mysql2").RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM erp_documents d WHERE ${where}`,
    params
  )
  const total = countRows[0]?.total ?? 0

  return jsonResponse({ documents: rows, total, page, limit })
})

route("GET", "/documents/:id", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.view")
  if (denied) return denied

  const docRows = await dbQuery<import("mysql2").RowDataPacket[]>(
    `SELECT d.*,
            u.email AS uploaded_by_email,
            e.name  AS uploaded_by_name
       FROM erp_documents d
       LEFT JOIN erp_users u ON u.id = d.uploaded_by
       LEFT JOIN erp_employees e ON e.id = u.employee_id
      WHERE d.id = ?`,
    [params.id]
  )
  const doc = docRows[0]
  if (!doc) return jsonResponse({ error: "Document not found" }, 404)

  const links = await dbQuery<import("mysql2").RowDataPacket[]>(
    `SELECT entity_type, entity_id FROM erp_document_links WHERE document_id = ?`,
    [params.id]
  )

  return jsonResponse({ ...doc, linked_entities: links })
})

route("GET", "/documents/:id/file", async (request, params, url) => {
  // Auth: support cookie auth (normal) and ?token= (for browser downloads)
  const tokenParam = url.searchParams.get("token")
  const forceDownload = url.searchParams.get("download") === "1"

  let authorized = false
  let viewUser: AuthUser | null = null
  if (tokenParam) {
    authorized = tokenParam === internalToken
  } else {
    const authResult = requireAuth(request)
    if (!(authResult instanceof Response)) {
      viewUser = authResult
      const denied = await requirePermission(authResult, authResult.workspaceId, "documents.view")
      authorized = !denied
    }
  }
  if (!authorized) return jsonResponse({ error: "Unauthorized" }, 401)

  const fileRows = await dbQuery<import("mysql2").RowDataPacket[]>(
    `SELECT storage_path, mime_type, original_name, contains_personal_data FROM erp_documents WHERE id = ?`,
    [params.id]
  )
  const doc = fileRows[0]
  if (!doc) return new Response("Not found", { status: 404 })

  const absPath = path.join(getUploadsDir(), doc.storage_path as string)
  if (!fs.existsSync(absPath)) {
    return new Response("File not found on disk", { status: 404 })
  }

  const fileBuffer = fs.readFileSync(absPath)
  const mimeType = doc.mime_type as string
  const originalName = doc.original_name as string

  const isPdf = mimeType === "application/pdf"
  const isImage = mimeType.startsWith("image/")
  const inline = (isPdf || isImage) && !forceDownload

  if (doc.contains_personal_data && viewUser) {
    auditAsync(makeActor(viewUser, request), {
      workspaceId: viewUser.workspaceId,
      action: "view",
      entityType: "document",
      entityId: params.id!,
      entityLabel: originalName,
      metadata: { field: "personal_data_file" }
    })
  }

  return new Response(fileBuffer, {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": inline
        ? `inline; filename="${originalName}"`
        : `attachment; filename="${originalName}"`,
      "Content-Length": String(fileBuffer.length),
      "Cache-Control": "private, max-age=3600"
    }
  })
})

route("POST", "/documents/:id/link", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.upload")
  if (denied) return denied

  const body = await readJson(request)
  const entityType = body.entityType as string
  const entityId = body.entityId as string

  if (!entityType || !entityId || !["employee","client","project"].includes(entityType)) {
    return jsonResponse({ error: "entityType and entityId are required" }, 400)
  }

  const linkId = `dlnk_${crypto.randomUUID()}`
  await dbExecute(
    `INSERT IGNORE INTO erp_document_links (id, document_id, entity_type, entity_id)
     VALUES (?, ?, ?, ?)`,
    [linkId, params.id, entityType, entityId]
  )

  auditAsync(makeActor(user, request), {
    workspaceId: user.workspaceId,
    action: "link",
    entityType: "document",
    entityId: params.id!,
    metadata: { entityType, entityId }
  })

  return jsonResponse({ ok: true })
})

route("POST", "/documents/:id/link/delete", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.manage")
  if (denied) return denied

  const body = await readJson(request)
  await dbExecute(
    `DELETE FROM erp_document_links WHERE document_id = ? AND entity_type = ? AND entity_id = ?`,
    [params.id, body.entityType, body.entityId]
  )

  auditAsync(makeActor(user, request), {
    workspaceId: user.workspaceId,
    action: "unlink",
    entityType: "document",
    entityId: params.id!,
    metadata: { entityType: body.entityType, entityId: body.entityId }
  })

  return jsonResponse({ ok: true })
})

route("POST", "/documents/:id/delete", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.manage")
  if (denied) return denied

  const delRows = await dbQuery<import("mysql2").RowDataPacket[]>(
    `SELECT storage_path, original_name FROM erp_documents WHERE id = ?`,
    [params.id]
  )
  const doc = delRows[0]
  if (!doc) return jsonResponse({ error: "Document not found" }, 404)

  // Check if referenced by an employee's contract_document_id
  const refs = await dbQuery<import("mysql2").RowDataPacket[]>(
    `SELECT id FROM erp_employees WHERE contract_document_id = ? LIMIT 1`,
    [params.id]
  )
  if (refs.length > 0) {
    return jsonResponse({
      error: "Document is set as an employee's contract document. Dereference it first."
    }, 409)
  }

  // Remove links
  await dbExecute(`DELETE FROM erp_document_links WHERE document_id = ?`, [params.id])
  // Remove DB record
  await dbExecute(`DELETE FROM erp_documents WHERE id = ?`, [params.id])

  // Remove file from disk
  const absPath = path.join(getUploadsDir(), doc.storage_path as string)
  try { fs.unlinkSync(absPath) } catch { /* file may already be gone */ }

  auditAsync(makeActor(user, request), {
    workspaceId: user.workspaceId,
    action: "delete",
    entityType: "document",
    entityId: params.id!,
    entityLabel: doc.original_name as string | undefined,
    metadata: { snapshot: doc }
  })

  return jsonResponse({ ok: true })
})

// Update notes on a document
route("POST", "/documents/:id/notes", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.upload")
  if (denied) return denied

  const body = await readJson(request)
  await dbExecute(
    `UPDATE erp_documents SET notes = ? WHERE id = ?`,
    [body.notes ?? null, params.id]
  )
  return jsonResponse({ ok: true })
})

// ─── Phase 4: Employee contract_document_id wiring ────────────────────────────

route("POST", "/employees/:employeeId/contract-document", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "employees.edit_all")
  if (denied) return denied

  const body = await readJson(request)
  const documentId = body.documentId as string | null

  await dbExecute(
    `UPDATE erp_employees SET contract_document_id = ? WHERE id = ?`,
    [documentId ?? null, params.employeeId]
  )
  return jsonResponse({ ok: true })
})

// ─── Phase 5: Storage settings routes ─────────────────────────────────────────

route("GET", "/settings/storage/status", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "storage.manage")
  if (denied) return denied

  const driveConfigured = await isDriveConfigured()
  const proxmoxConfigured = isProxmoxConfigured()
  const wid = user.workspaceId

  const [driveStats] = await dbQuery<import("mysql2").RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(drive_file_id IS NOT NULL) AS synced,
       SUM(drive_file_id IS NULL AND drive_sync_error IS NOT NULL) AS errors
     FROM erp_documents WHERE workspace_id = ?`,
    [wid]
  )

  const [proxmoxStats] = await dbQuery<import("mysql2").RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(proxmox_synced_at IS NOT NULL) AS synced,
       SUM(proxmox_synced_at IS NULL AND proxmox_sync_error IS NOT NULL) AS errors,
       MAX(proxmox_synced_at) AS last_synced
     FROM erp_documents WHERE workspace_id = ?`,
    [wid]
  )

  return jsonResponse({
    drive: {
      configured: driveConfigured,
      synced: Number(driveStats?.synced ?? 0),
      total: Number(driveStats?.total ?? 0),
      errors: Number(driveStats?.errors ?? 0)
    },
    proxmox: {
      configured: proxmoxConfigured,
      synced: Number(proxmoxStats?.synced ?? 0),
      total: Number(proxmoxStats?.total ?? 0),
      errors: Number(proxmoxStats?.errors ?? 0),
      lastSynced: proxmoxStats?.last_synced ?? null
    }
  })
})

route("POST", "/settings/storage/retry-drive", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "storage.manage")
  if (denied) return denied

  const result = await retryFailedDriveSyncs(user.workspaceId)
  return jsonResponse(result)
})

route("POST", "/settings/storage/retry-proxmox", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "storage.manage")
  if (denied) return denied

  const result = await retryFailedProxmoxSyncs(user.workspaceId)
  return jsonResponse(result)
})

route("POST", "/settings/storage/resync-document/:documentId", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "storage.manage")
  if (denied) return denied

  const docId = params.documentId!
  const [doc] = await dbQuery<import("mysql2").RowDataPacket[]>(
    "SELECT id FROM erp_documents WHERE id = ? AND workspace_id = ?",
    [docId, user.workspaceId]
  )
  if (!doc) return jsonResponse({ error: "Document not found" }, 404)

  syncDocumentToDrive(docId).catch(err => console.error("[Drive resync failed]", err))
  syncDocumentToProxmox(docId).catch(err => console.error("[Proxmox resync failed]", err))

  return jsonResponse({ ok: true, message: "Re-sync started in background" })
})

// Resync all unsynced documents (Drive)
route("POST", "/settings/storage/resync-all-drive", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "storage.manage")
  if (denied) return denied

  const rows = await dbQuery<import("mysql2").RowDataPacket[]>(
    "SELECT id FROM erp_documents WHERE workspace_id = ? AND drive_file_id IS NULL",
    [user.workspaceId]
  )

  // Fire all in background
  for (const row of rows) {
    syncDocumentToDrive(row.id as string).catch(err =>
      console.error("[Drive resync-all failed]", row.id, err)
    )
  }

  return jsonResponse({ ok: true, queued: rows.length })
})

// ─── Phase 6: Audit log endpoint ──────────────────────────────────────────────

route("GET", "/audit", async (request, _params, url) => {
  // Support cookie auth (normal) or ?token= (for browser CSV download)
  const tokenParam = url.searchParams.get("token")
  let user: AuthUser
  if (tokenParam) {
    if (tokenParam !== internalToken) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }
    user = { id: "system", workspaceId: url.searchParams.get("workspaceId") ?? "", role: "admin", employeeId: "", email: "" }
  } else {
    const authResult = requireAuth(request)
    if (authResult instanceof Response) return authResult
    user = authResult
    const workspaceIdCheck = url.searchParams.get("workspaceId") ?? user.workspaceId
    const denied = await requirePermission(user, workspaceIdCheck, "audit.view")
    if (denied) return denied
  }
  const workspaceId = url.searchParams.get("workspaceId") ?? user.workspaceId

  const q = query(url)
  const entityType = q.entityType as string | undefined
  const entityId = q.entityId as string | undefined
  const actorUserId = q.actorUserId as string | undefined
  const action = q.action as string | undefined
  const from = q.from as string | undefined
  const to = q.to as string | undefined
  const search = q.q as string | undefined
  const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50)))
  const offset = Math.max(0, Number(q.offset ?? 0))
  const format = q.format as string | undefined

  const conditions: string[] = ["workspace_id = ?"]
  const params: unknown[] = [workspaceId]

  if (entityType) { conditions.push("entity_type = ?"); params.push(entityType) }
  if (entityId && entityType) { conditions.push("entity_id = ?"); params.push(entityId) }
  if (actorUserId) { conditions.push("actor_user_id = ?"); params.push(actorUserId) }
  if (action) { conditions.push("action = ?"); params.push(action) }
  if (from) { conditions.push("created_at >= ?"); params.push(from) }
  if (to) { conditions.push("created_at <= ?"); params.push(to) }
  if (search) {
    conditions.push("(entity_label LIKE ? OR actor_name LIKE ?)")
    params.push(`%${search}%`, `%${search}%`)
  }

  const where = conditions.join(" AND ")

  if (format === "csv") {
    const rows = await dbQuery<import("mysql2").RowDataPacket[]>(
      `SELECT created_at, actor_name, actor_role, action, entity_type, entity_id, entity_label, changed_fields, metadata
       FROM erp_audit_log WHERE ${where} ORDER BY created_at DESC LIMIT 5000`,
      params
    )
    const header = "Timestamp,User,Role,Action,Entity Type,Entity ID,Label,Changed Fields,Metadata\n"
    const csvRows = rows.map(r =>
      [
        r.created_at, r.actor_name, r.actor_role, r.action,
        r.entity_type, r.entity_id, r.entity_label ?? "",
        r.changed_fields ? JSON.stringify(r.changed_fields) : "",
        r.metadata ? JSON.stringify(r.metadata) : ""
      ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")
    ).join("\n")
    return new Response(header + csvRows, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="audit_log_${new Date().toISOString().slice(0, 10)}.csv"`
      }
    })
  }

  const [countRow] = await dbQuery<import("mysql2").RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM erp_audit_log WHERE ${where}`,
    params
  )
  const total = Number(countRow?.total ?? 0)

  const rows = await dbQuery<import("mysql2").RowDataPacket[]>(
    `SELECT * FROM erp_audit_log WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  return jsonResponse({ total, rows, limit, offset })
})

// ─── Badge counts endpoint ────────────────────────────────────────────────────

route("GET", "/workspace/badge-counts", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const workspaceId = url.searchParams.get("workspaceId") ?? user.workspaceId

  const [timesheetRow] = await dbQuery<import("mysql2").RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM erp_timesheets WHERE workspace_id = ? AND status = 'submitted'`,
    [workspaceId]
  )
  const [syncErrorRow] = await dbQuery<import("mysql2").RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM erp_documents WHERE workspace_id = ? AND drive_sync_error IS NOT NULL`,
    [workspaceId]
  )
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const [staleWarehouseRow] = await dbQuery<import("mysql2").RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM erp_warehouse_documents WHERE workspace_id = ? AND status = 'draft' AND doc_date <= ?`,
    [workspaceId, threeDaysAgo]
  )

  return jsonResponse({
    pendingTimesheets: Number(timesheetRow?.cnt ?? 0),
    syncErrors: Number(syncErrorRow?.cnt ?? 0),
    staleDraftWarehouse: Number(staleWarehouseRow?.cnt ?? 0)
  })
})

// ─── Phase 7A: OCR — Azure Document Intelligence ─────────────────────────────

route("POST", "/documents/:id/ocr-extract", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.manage")
  if (denied) return denied

  if (!isOcrConfigured()) {
    return jsonResponse({ error: "OCR not configured — set AZURE_DOC_INTEL_ENDPOINT and AZURE_DOC_INTEL_KEY" }, 503)
  }

  type DocRow = { id: string; storage_path: string; mime_type: string; workspace_id: string }
  const rows = await dbQuery<DocRow[]>(
    `SELECT id, storage_path, mime_type, workspace_id FROM erp_documents WHERE id = ?`,
    [params.id]
  )
  const doc = rows[0]
  if (!doc) return jsonResponse({ error: "Document not found" }, 404)
  if (doc.workspace_id !== user.workspaceId) return jsonResponse({ error: "Forbidden" }, 403)
  if (doc.mime_type !== "application/pdf") {
    return jsonResponse({ error: "OCR is only supported for PDF files" }, 400)
  }

  const absPath = path.join(getUploadsDir(), doc.storage_path)
  let fileBuffer: Buffer
  try {
    fileBuffer = fs.readFileSync(absPath)
  } catch {
    return jsonResponse({ error: "File not found on disk" }, 404)
  }

  const fields = await extractInvoiceFields(fileBuffer)

  // Try to match vendor to an employee/consultant in this workspace
  type EmpMatchRow = { id: string; name: string; nip: string | null; date_of_birth: string | null }
  const empRows = await dbQuery<EmpMatchRow[]>(
    `SELECT id, name, nip, date_of_birth FROM erp_employees WHERE workspace_id = ?`,
    [user.workspaceId]
  )
  const matchCandidates = empRows.map((e) => ({
    employeeId: e.id,
    firstName: null,
    lastName: null,
    name: e.name,
    nip: e.nip,
    birthDate: e.date_of_birth
  }))
  const matchResult = matchDocumentToEmployee(
    { contractorName: fields.vendorName ?? null, contractorTaxId: fields.vendorNip ?? null },
    matchCandidates
  )
  const matchedEmpRow = matchResult ? empRows.find((e) => e.id === matchResult.employeeId) : undefined
  const suggestedEmployeeMatch = matchResult
    ? {
        employeeId: matchResult.employeeId,
        employeeName: matchedEmpRow?.name ?? null,
        confidence: matchResult.confidence,
        matchMethod: matchResult.matchMethod
      }
    : null

  await dbExecute(
    `UPDATE erp_financial_documents SET ocr_extracted_at = NOW() WHERE document_id = ?`,
    [params.id]
  )

  auditAsync(makeActor(user, request), {
    workspaceId: user.workspaceId,
    action: "create",
    entityType: "ocr_extraction",
    entityId: params.id!,
    metadata: { confidence: fields.confidence, documentId: params.id, matchMethod: matchResult?.matchMethod ?? null }
  })

  return jsonResponse({ ...fields, suggestedEmployeeMatch })
})

// ─── Phase 7B: Saldeo Smart ────────────────────────────────────────────────────

route("GET", "/saldeo/status", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user

  if (!isSaldeoConfigured()) {
    return jsonResponse({ configured: false })
  }

  const config = getSaldeoConfig()!
  try {
    const status = await getSaldeoStatus(config)
    return jsonResponse({ configured: true, connectedCompany: status.connectedCompany })
  } catch (err) {
    return jsonResponse({
      configured: true,
      connectedCompany: null,
      error: err instanceof Error ? err.message : String(err)
    })
  }
})

route("POST", "/saldeo/export/:documentId", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "documents.manage")
  if (denied) return denied

  if (!isSaldeoConfigured()) {
    return jsonResponse({ error: "Saldeo not configured — set SALDEO_API_KEY and SALDEO_COMPANY_ID" }, 503)
  }

  const docId = params.documentId!

  type FinDocRow = {
    id: string; document_number: string | null; contractor_name: string | null
    contractor_tax_id: string | null; issue_date: string | Date | null
    net_amount: number; vat_amount: number; gross_amount: number
    currency_code: string; description: string | null; document_id: string | null
  }
  const finRows = await dbQuery<FinDocRow[]>(
    `SELECT id, document_number, contractor_name, contractor_tax_id, issue_date,
            net_amount, vat_amount, gross_amount, currency_code, description, document_id
     FROM erp_financial_documents WHERE id = ?`,
    [docId]
  )
  const finDoc = finRows[0]
  if (!finDoc) return jsonResponse({ error: "Financial document not found" }, 404)

  let pdfBase64 = ""
  if (finDoc.document_id) {
    type PhysDocRow = { storage_path: string; mime_type: string }
    const physRows = await dbQuery<PhysDocRow[]>(
      `SELECT storage_path, mime_type FROM erp_documents WHERE id = ?`,
      [finDoc.document_id]
    )
    const physDoc = physRows[0]
    if (physDoc?.mime_type === "application/pdf") {
      const absPath = path.join(getUploadsDir(), physDoc.storage_path)
      try { pdfBase64 = fs.readFileSync(absPath).toString("base64") } catch { /* no file */ }
    }
  }

  const config = getSaldeoConfig()!
  await dbExecute(`UPDATE erp_financial_documents SET saldeo_export_error = NULL WHERE id = ?`, [docId])

  try {
    const issueDateVal = finDoc.issue_date
    const issueDateStr = issueDateVal != null
      ? (issueDateVal instanceof Date ? issueDateVal.toISOString().slice(0, 10) : String(issueDateVal).slice(0, 10))
      : undefined

    const result = await exportDocumentToSaldeo(config, {
      documentId: docId,
      documentNumber: finDoc.document_number ?? undefined,
      contractorName: finDoc.contractor_name ?? undefined,
      contractorNip: finDoc.contractor_tax_id ?? undefined,
      issueDate: issueDateStr,
      netAmount: Number(finDoc.net_amount),
      vatAmount: Number(finDoc.vat_amount),
      grossAmount: Number(finDoc.gross_amount),
      currency: finDoc.currency_code,
      description: finDoc.description ?? undefined,
      pdfBase64
    })

    await dbExecute(
      `UPDATE erp_financial_documents
       SET saldeo_document_id = ?, saldeo_exported_at = NOW(), saldeo_export_error = NULL
       WHERE id = ?`,
      [result.saldeoDocumentId, docId]
    )

    auditAsync(makeActor(user, request), {
      workspaceId: user.workspaceId,
      action: "export",
      entityType: "financial_document",
      entityId: docId,
      metadata: { target: "saldeo", saldeoDocumentId: result.saldeoDocumentId }
    })

    return jsonResponse({ success: true, saldeoDocumentId: result.saldeoDocumentId, exportedAt: result.exportedAt })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    await dbExecute(`UPDATE erp_financial_documents SET saldeo_export_error = ? WHERE id = ?`, [errorMsg, docId])
    return jsonResponse({ error: errorMsg }, 500)
  }
})

// ─── Phase 7C: Warehouse PZ/WZ ────────────────────────────────────────────────

function generateWarehouseDocNumber(type: "PZ" | "WZ", year: number, month: number, seq: number): string {
  return `${type}/${year}/${String(month).padStart(2, "0")}/${String(seq).padStart(3, "0")}`
}

async function nextWarehouseSeq(workspaceId: string, type: "PZ" | "WZ", year: number, month: number): Promise<number> {
  const prefix = `${type}/${year}/${String(month).padStart(2, "0")}/`
  // Use MAX of existing sequence numbers for this prefix to avoid races with COUNT(*)
  type MaxRow = { max_seq: number | null }
  const rows = await dbQuery<MaxRow[]>(
    `SELECT MAX(CAST(SUBSTRING(doc_number, LENGTH(?) + 1) AS UNSIGNED)) AS max_seq
     FROM erp_warehouse_documents
     WHERE workspace_id = ? AND doc_type = ? AND doc_number LIKE ?`,
    [prefix, workspaceId, type, prefix + "%"]
  )
  return (rows[0]?.max_seq ?? 0) + 1
}

route("POST", "/warehouse/documents", async (request) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "warehouse.manage")
  if (denied) return denied

  const body = await readJson(request)
  const { docType, financialDocId, counterpartyId, counterpartyType, docDate, notes, items, projectId } = body as {
    docType: "PZ" | "WZ"
    financialDocId?: string
    counterpartyId?: string
    counterpartyType?: "client" | "supplier"
    docDate: string
    notes?: string
    items?: Array<{ productId?: string; productName: string; quantity: number; unit?: string; unitPrice?: number }>
    projectId?: string
  }

  if (!docType || !["PZ", "WZ"].includes(docType)) return jsonResponse({ error: "docType must be PZ or WZ" }, 400)
  if (!docDate) return jsonResponse({ error: "docDate is required" }, 400)

  // Period lock check
  if (!(await isPeriodOpen(user.workspaceId, docDate))) {
    return jsonResponse({ error: "period_locked", period: docDate.slice(0, 7) }, 423)
  }

  const date = new Date(docDate)
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const id = localId("wh")

  // Race-safe insert: retry up to 3 times on duplicate doc_number
  let docNumber = ""
  for (let attempt = 0; attempt < 3; attempt++) {
    const seq = await nextWarehouseSeq(user.workspaceId, docType, year, month)
    docNumber = generateWarehouseDocNumber(docType, year, month, seq)
    try {
      await dbExecute(
        `INSERT INTO erp_warehouse_documents
         (id, workspace_id, doc_type, doc_number, financial_doc_id, counterparty_id, counterparty_type, doc_date, status, notes, created_by, project_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
        [id, user.workspaceId, docType, docNumber, financialDocId ?? null, counterpartyId ?? null, counterpartyType ?? null, docDate, notes ?? null, user.id, projectId ?? null]
      )
      break
    } catch (err: unknown) {
      const code = (err as { code?: string }).code
      if (code === "ER_DUP_ENTRY" && attempt < 2) continue
      throw err
    }
  }

  if (Array.isArray(items)) {
    for (const item of items) {
      const itemId = localId("whi")
      await dbExecute(
        `INSERT INTO erp_warehouse_document_items
         (id, warehouse_document_id, product_id, product_name, quantity, unit, unit_price)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [itemId, id, item.productId ?? null, item.productName, item.quantity, item.unit ?? null, item.unitPrice ?? null]
      )
    }
  }

  auditAsync(makeActor(user, request), {
    workspaceId: user.workspaceId,
    action: "create",
    entityType: "warehouse_document",
    entityId: id,
    entityLabel: docNumber
  })

  return jsonResponse({ id, docNumber, status: "draft" })
})

route("GET", "/warehouse/documents", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "warehouse.view")
  if (denied) return denied

  const q = query(url)
  const workspaceId = q.workspaceId ?? user.workspaceId
  const { docType, status: statusFilter, dateFrom, dateTo } = q
  const limit = Math.min(Number(q.limit ?? 50), 200)
  const offset = Number(q.offset ?? 0)

  const conditions: string[] = ["wd.workspace_id = ?"]
  const qParams: unknown[] = [workspaceId]

  if (docType) { conditions.push("wd.doc_type = ?"); qParams.push(docType) }
  if (statusFilter) { conditions.push("wd.status = ?"); qParams.push(statusFilter) }
  if (dateFrom) { conditions.push("wd.doc_date >= ?"); qParams.push(dateFrom) }
  if (dateTo) { conditions.push("wd.doc_date <= ?"); qParams.push(dateTo) }

  const where = conditions.join(" AND ")

  type WDCountRow = { total: number }
  const countRows = await dbQuery<WDCountRow[]>(
    `SELECT COUNT(*) AS total FROM erp_warehouse_documents wd WHERE ${where}`,
    qParams
  )
  const total = (countRows[0]?.total as number) ?? 0

  type WDRow = {
    id: string; doc_type: string; doc_number: string; doc_date: string | Date
    status: string; notes: string | null; financial_doc_id: string | null
    counterparty_id: string | null; counterparty_type: string | null
    created_by: string; created_at: string | Date; item_count: number
    counterparty_name: string | null
  }
  const rows = await dbQuery<WDRow[]>(
    `SELECT wd.*, COUNT(wi.id) AS item_count,
            COALESCE(c.name, NULL) AS counterparty_name
     FROM erp_warehouse_documents wd
     LEFT JOIN erp_warehouse_document_items wi ON wi.warehouse_document_id = wd.id
     LEFT JOIN erp_clients c ON c.id = wd.counterparty_id AND wd.counterparty_type = 'client'
     WHERE ${where}
     GROUP BY wd.id
     ORDER BY wd.created_at DESC
     LIMIT ? OFFSET ?`,
    [...qParams, limit, offset]
  )

  return jsonResponse({ total, rows, limit, offset })
})

route("GET", "/warehouse/documents/:id", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "warehouse.view")
  if (denied) return denied

  type WDDetailRow = {
    id: string; workspace_id: string; doc_type: string; doc_number: string
    doc_date: string | Date; status: string; notes: string | null
    financial_doc_id: string | null; counterparty_id: string | null; counterparty_type: string | null
    created_by: string; created_at: string | Date; updated_at: string | Date
    counterparty_name: string | null
  }
  const rows = await dbQuery<WDDetailRow[]>(
    `SELECT wd.*, COALESCE(c.name, NULL) AS counterparty_name
     FROM erp_warehouse_documents wd
     LEFT JOIN erp_clients c ON c.id = wd.counterparty_id AND wd.counterparty_type = 'client'
     WHERE wd.id = ? AND wd.workspace_id = ?`,
    [params.id, user.workspaceId]
  )
  const doc = rows[0]
  if (!doc) return jsonResponse({ error: "Warehouse document not found" }, 404)

  type ItemRow = {
    id: string; product_id: string | null; product_name: string
    quantity: number; unit: string | null; unit_price: number | null
  }
  const items = await dbQuery<ItemRow[]>(
    `SELECT wi.* FROM erp_warehouse_document_items wi WHERE wi.warehouse_document_id = ?`,
    [params.id]
  )

  return jsonResponse({ ...doc, items })
})

route("POST", "/warehouse/documents/:id/confirm", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "warehouse.manage")
  if (denied) return denied

  type WDStatusRow = { id: string; status: string; doc_number: string; doc_date: string | Date | null }
  const rows = await dbQuery<WDStatusRow[]>(
    `SELECT id, status, doc_number, doc_date FROM erp_warehouse_documents WHERE id = ? AND workspace_id = ?`,
    [params.id, user.workspaceId]
  )
  const doc = rows[0]
  if (!doc) return jsonResponse({ error: "Warehouse document not found" }, 404)
  if (doc.status !== "draft") return jsonResponse({ error: `Cannot confirm — document is already ${doc.status}` }, 409)

  // Period lock check
  const docDateStr = String(doc.doc_date ?? "").slice(0, 10)
  if (docDateStr && !(await isPeriodOpen(user.workspaceId, docDateStr))) {
    return jsonResponse({ error: "period_locked", period: docDateStr.slice(0, 7) }, 423)
  }

  await dbExecute(`UPDATE erp_warehouse_documents SET status = 'confirmed', updated_at = NOW() WHERE id = ?`, [params.id])

  auditAsync(makeActor(user, request), {
    workspaceId: user.workspaceId,
    action: "approve",
    entityType: "warehouse_document",
    entityId: params.id!,
    entityLabel: doc.doc_number
  })

  return jsonResponse({ ok: true, status: "confirmed" })
})

route("POST", "/warehouse/documents/:id/cancel", async (request, params) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "warehouse.manage")
  if (denied) return denied

  const body = await readJson(request)
  const reason = body.reason as string | undefined

  type WDStatusRow = { id: string; status: string; doc_number: string }
  const rows = await dbQuery<WDStatusRow[]>(
    `SELECT id, status, doc_number FROM erp_warehouse_documents WHERE id = ? AND workspace_id = ?`,
    [params.id, user.workspaceId]
  )
  const doc = rows[0]
  if (!doc) return jsonResponse({ error: "Warehouse document not found" }, 404)
  if (doc.status === "cancelled") return jsonResponse({ error: "Document is already cancelled" }, 409)

  const cancelNote = reason ? `\n[CANCELLED] ${reason}` : "\n[CANCELLED]"
  await dbExecute(
    `UPDATE erp_warehouse_documents SET status = 'cancelled', notes = CONCAT(COALESCE(notes,''), ?), updated_at = NOW() WHERE id = ?`,
    [cancelNote, params.id]
  )

  auditAsync(makeActor(user, request), {
    workspaceId: user.workspaceId,
    action: "reject",
    entityType: "warehouse_document",
    entityId: params.id!,
    entityLabel: doc.doc_number,
    metadata: { reason }
  })

  return jsonResponse({ ok: true, status: "cancelled" })
})

// ─── Phase 7D: CIT estimate ───────────────────────────────────────────────────

route("GET", "/accounting/cit-estimate", async (request, _params, url) => {
  const user = requireAuth(request)
  if (user instanceof Response) return user
  const denied = await requirePermission(user, user.workspaceId, "reports.accounting")
  if (denied) return denied

  const q = query(url)
  const workspaceId = q.workspaceId ?? user.workspaceId
  const periodParam = q.month ?? q.year ?? new Date().toISOString().slice(0, 7)

  let periodLabel: string
  let periodFrom: string
  let periodTo: string

  if (/^\d{4}$/.test(periodParam)) {
    periodLabel = periodParam
    periodFrom = `${periodParam}-01-01`
    periodTo = `${periodParam}-12-31`
  } else {
    const match = periodParam.match(/^(\d{4})-(\d{2})$/)
    if (!match) return jsonResponse({ error: "Invalid period format — use YYYY-MM or YYYY" }, 400)
    const [, yr, mo] = match
    periodLabel = periodParam
    const daysInMonth = new Date(Number(yr), Number(mo), 0).getDate()
    periodFrom = `${yr}-${mo}-01`
    periodTo = `${yr}-${mo}-${String(daysInMonth).padStart(2, "0")}`
  }

  const warnings: string[] = []

  // Revenue
  type FinDocRevRow = { id: string; document_number: string | null; net_amount_pln: number; contractor_name: string | null }
  const revenueRows = await dbQuery<FinDocRevRow[]>(
    `SELECT id, document_number, net_amount_pln, contractor_name
     FROM erp_financial_documents
     WHERE accounting_date >= ? AND accounting_date <= ?
       AND document_type IN ('SALES_INVOICE','REVENUE')`,
    [periodFrom, periodTo]
  )
  const revenueTotal = revenueRows.reduce((s, r) => s + Number(r.net_amount_pln), 0)

  // Purchase costs
  type FinDocCostRow = { id: string; document_number: string | null; net_amount_pln: number; contractor_name: string | null }
  const purchaseRows = await dbQuery<FinDocCostRow[]>(
    `SELECT id, document_number, net_amount_pln, contractor_name
     FROM erp_financial_documents
     WHERE accounting_date >= ? AND accounting_date <= ?
       AND document_type IN ('PURCHASE_INVOICE','EXPENSE','GOODS_PURCHASE')`,
    [periodFrom, periodTo]
  )
  const purchasesTotal = purchaseRows.reduce((s, r) => s + Number(r.net_amount_pln), 0)

  // Personnel
  type PersonnelRow = {
    employee_id: string; employee_name: string; contract_type: string | null
    total_hours: number; internal_rate: number | null
  }
  const personnelRows = await dbQuery<PersonnelRow[]>(
    `SELECT te.employee_id, e.name AS employee_name, e.contract_type,
            SUM(te.duration_seconds / 3600.0) AS total_hours,
            e.hourly_rate AS internal_rate
     FROM erp_time_entries te
     JOIN erp_employees e ON e.id = te.employee_id
     WHERE te.workspace_id = ? AND te.work_date >= ? AND te.work_date <= ? AND te.end_at IS NOT NULL
     GROUP BY te.employee_id, e.name, e.contract_type, e.hourly_rate`,
    [workspaceId, periodFrom, periodTo]
  )

  const personnelByType: Record<string, { total: number; employees: unknown[] }> = {
    uop: { total: 0, employees: [] }, zlecenie: { total: 0, employees: [] },
    b2b: { total: 0, employees: [] }, staz: { total: 0, employees: [] }, other: { total: 0, employees: [] }
  }

  let missingRates = 0
  for (const p of personnelRows) {
    const hours = Number(p.total_hours)
    const rate = p.internal_rate != null ? Number(p.internal_rate) : null
    const cost = rate != null ? Math.round(hours * rate * 100) / 100 : null
    if (rate == null) missingRates++

    const ct = p.contract_type ?? "other"
    const groupKey = ["uop", "zlecenie", "b2b", "staz"].includes(ct) ? ct : "other"
    const group = personnelByType[groupKey]!
    if (cost != null) group.total += cost
    group.employees.push({ employeeId: p.employee_id, name: p.employee_name, hours, rate, cost })
  }

  if (missingRates > 0) {
    warnings.push(`${missingRates} employee(s) have no hourly rate — their personnel cost is excluded.`)
  }

  // B2B: do NOT add to deductible costs — already counted in purchase invoices
  const b2bCount = personnelByType.b2b!.employees.length
  personnelByType.b2b!.total = 0
  for (const emp of personnelByType.b2b!.employees as Array<Record<string, unknown>>) {
    emp.cost = null
  }
  if (b2bCount > 0) {
    warnings.push("B2B consultant costs are already captured in purchase invoices — not double-counted here.")
  }
  if ((personnelByType.staz?.employees.length ?? 0) > 0) {
    warnings.push("Stażysta (intern) cost deductibility requires accountant review — special rules apply.")
  }

  const personnelTotal = ["uop", "zlecenie", "staz", "other"].reduce((s, ct) => s + (personnelByType[ct]?.total ?? 0), 0)
  const totalCosts = purchasesTotal + personnelTotal
  const taxBase = revenueTotal - totalCosts
  const estimatedCit9 = taxBase > 0 ? Math.round(taxBase * 0.09 * 100) / 100 : null
  const estimatedCit19 = taxBase > 0 ? Math.round(taxBase * 0.19 * 100) / 100 : null

  auditAsync(makeActor(user, request), {
    workspaceId,
    action: "view",
    entityType: "cit_estimate",
    entityId: workspaceId,
    entityLabel: `CIT estimate ${periodLabel}`,
    metadata: { period: periodLabel, periodFrom, periodTo }
  })

  return jsonResponse({
    period: periodLabel,
    revenue: {
      total: Math.round(revenueTotal * 100) / 100,
      breakdown: revenueRows.map((r) => ({
        invoiceId: r.id,
        amount: Number(r.net_amount_pln),
        counterparty: r.contractor_name ?? "—",
        documentNumber: r.document_number ?? "—"
      }))
    },
    costs: {
      purchases: {
        total: Math.round(purchasesTotal * 100) / 100,
        breakdown: purchaseRows.map((r) => ({
          invoiceId: r.id,
          amount: Number(r.net_amount_pln),
          counterparty: r.contractor_name ?? "—",
          documentNumber: r.document_number ?? "—"
        }))
      },
      personnel: {
        uop: personnelByType.uop,
        zlecenie: personnelByType.zlecenie,
        b2b: { ...personnelByType.b2b, note: "Included in purchase invoices — not double-counted" },
        staz: { ...personnelByType.staz, warning: "Stażysta cost deductibility requires accountant review" },
        other: personnelByType.other,
        total: Math.round(personnelTotal * 100) / 100
      },
      total: Math.round(totalCosts * 100) / 100
    },
    taxBase: Math.round(taxBase * 100) / 100,
    estimatedCit9,
    estimatedCit19,
    warnings
  })
})

const port = Number(process.env.PORT ?? 4001)

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url)
    const requestOrigin = request.headers.get("origin")
    const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
    const origin =
      requestOrigin && allowedOrigins.includes(requestOrigin)
        ? requestOrigin
        : allowedOrigins[0]!

    // CORS: reflect only whitelisted origins (ALLOWED_ORIGINS env, default http://localhost:3000)
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie"
    }

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    // /health is always public; /internal/* still uses the bearer token guard;
    // everything else is protected per-route via requireAuth inside the handler.
    const isPublicPath =
      url.pathname === "/health" ||
      url.pathname.startsWith("/auth/")

    if (!isPublicPath && url.pathname.startsWith("/internal/") && !authorize(request)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...corsHeaders }
      })
    }

    for (const candidate of routes) {
      if (candidate.method !== request.method) continue
      const match = url.pathname.match(candidate.pattern)
      if (!match) continue
      const params = Object.fromEntries(
        candidate.keys.map((key, index) => [key, decodeURIComponent(match[index + 1] ?? "")])
      )
      try {
        const response = await candidate.handler(request, params, url)
        // Attach CORS headers to every response
        for (const [k, v] of Object.entries(corsHeaders)) {
          response.headers.set(k, v)
        }
        return response
      } catch (error) {
        console.error("[Backend API]", error)
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
          status: 500, headers: { "Content-Type": "application/json", ...corsHeaders }
        })
      }
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404, headers: { "Content-Type": "application/json", ...corsHeaders }
    })
  }
})

console.log(`[Backend API] Listening on :${port}`)
