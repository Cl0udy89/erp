import type { RowDataPacket } from "mysql2/promise"

import type {
  ClockifyClient,
  ClockifyInvoice,
  ClockifyProject,
  ClockifyTask,
  ClockifyTimeEntry,
  ClockifyUser,
  ClockifyWorkspace
} from "#/lib/clockify-schemas"
import { dbQuery } from "#/lib/db"

interface WorkspaceRow extends RowDataPacket {
  id: string
  name: string
  raw_json: unknown
}

interface ClientRow extends RowDataPacket {
  id: string
  workspace_id: string
  name: string
  email: string | null
  archived: number | boolean
  raw_json: unknown
}

interface EmployeeRow extends RowDataPacket {
  id: string
  workspace_id: string
  name: string
  email: string
  status: string | null
  profile_picture: string | null
  raw_json: unknown
}

interface ProjectRow extends RowDataPacket {
  id: string
  workspace_id: string
  client_id: string | null
  name: string
  billable: number | boolean
  color: string | null
  archived: number | boolean
  raw_json: unknown
}

interface TimeEntryRow extends RowDataPacket {
  id: string
  workspace_id: string
  employee_id: string
  project_id: string | null
  task_id: string | null
  description: string
  billable: number | boolean
  start_at: Date | string
  end_at: Date | string | null
  duration_seconds: number | null
  raw_json: unknown
}

function parseRawJson<T>(value: unknown): Partial<T> {
  if (!value) return {}
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Partial<T>
    } catch {
      return {}
    }
  }
  return value as Partial<T>
}

function bool(value: number | boolean | null | undefined) {
  return value === true || value === 1
}

function iso(value: Date | string | null) {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export async function listDbWorkspaces(): Promise<ClockifyWorkspace[]> {
  const rows = await dbQuery<WorkspaceRow[]>(`
    SELECT id, name, raw_json
    FROM erp_workspaces
    ORDER BY name ASC
  `)

  return rows.map((row) => ({
    ...parseRawJson<ClockifyWorkspace>(row.raw_json),
    id: row.id,
    name: row.name
  }))
}

export async function listDbUsers(workspaceId: string): Promise<ClockifyUser[]> {
  const rows = await dbQuery<EmployeeRow[]>(
    `
      SELECT id, workspace_id, name, email, status, profile_picture, raw_json
      FROM erp_employees
      WHERE workspace_id = ?
      ORDER BY name ASC
    `,
    [workspaceId]
  )

  return rows.map((row) => ({
    ...parseRawJson<ClockifyUser>(row.raw_json),
    id: row.id,
    name: row.name,
    email: row.email,
    status: row.status,
    profilePicture: row.profile_picture,
    activeWorkspace: row.workspace_id
  }))
}

export async function listDbClients(workspaceId: string): Promise<ClockifyClient[]> {
  const rows = await dbQuery<ClientRow[]>(
    `
      SELECT id, workspace_id, name, email, archived, raw_json
      FROM erp_clients
      WHERE workspace_id = ?
      ORDER BY name ASC
    `,
    [workspaceId]
  )

  return rows.map((row) => ({
    ...parseRawJson<ClockifyClient>(row.raw_json),
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    email: row.email,
    archived: bool(row.archived)
  }))
}

export async function listDbProjects(workspaceId: string): Promise<ClockifyProject[]> {
  const rows = await dbQuery<ProjectRow[]>(
    `
      SELECT id, workspace_id, client_id, name, billable, color, archived, raw_json
      FROM erp_projects
      WHERE workspace_id = ?
      ORDER BY name ASC
    `,
    [workspaceId]
  )

  return rows.map((row) => ({
    ...parseRawJson<ClockifyProject>(row.raw_json),
    id: row.id,
    workspaceId: row.workspace_id,
    clientId: row.client_id,
    name: row.name,
    billable: bool(row.billable),
    color: row.color,
    archived: bool(row.archived)
  }))
}

export async function listDbTimeEntries(
  workspaceId: string,
  filters?: { startDate?: string; endDate?: string; projectId?: string; userId?: string }
): Promise<ClockifyTimeEntry[]> {
  const where = ["workspace_id = ?"]
  const values: unknown[] = [workspaceId]

  if (filters?.startDate) {
    where.push("work_date >= ?")
    values.push(filters.startDate.slice(0, 10))
  }
  if (filters?.endDate) {
    where.push("work_date <= ?")
    values.push(filters.endDate.slice(0, 10))
  }
  if (filters?.projectId) {
    where.push("project_id = ?")
    values.push(filters.projectId)
  }
  if (filters?.userId) {
    where.push("employee_id = ?")
    values.push(filters.userId)
  }

  const rows = await dbQuery<TimeEntryRow[]>(
    `
      SELECT
        id,
        workspace_id,
        employee_id,
        project_id,
        task_id,
        description,
        billable,
        start_at,
        end_at,
        duration_seconds,
        raw_json
      FROM erp_time_entries
      WHERE ${where.join(" AND ")}
      ORDER BY start_at DESC
    `,
    values
  )

  return rows.map((row) => ({
    ...parseRawJson<ClockifyTimeEntry>(row.raw_json),
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.employee_id,
    projectId: row.project_id,
    taskId: row.task_id,
    description: row.description,
    billable: bool(row.billable),
    timeInterval: {
      start: iso(row.start_at) ?? new Date().toISOString(),
      end: iso(row.end_at),
      duration: row.duration_seconds == null ? null : row.duration_seconds * 1000
    }
  }))
}

export function listDbInvoices(_workspaceId: string): Promise<ClockifyInvoice[]> {
  return Promise.resolve([])
}

export function listDbTasks(_workspaceId: string, _projectId: string): Promise<ClockifyTask[]> {
  return Promise.resolve([])
}

// ─── Phase 0 — Enhanced time entry types ─────────────────────────────────────

export interface TimeEntryFull {
  id: string
  workspaceId: string
  employeeId: string
  clientId: string | null
  projectId: string | null
  taskId: string | null
  description: string
  billable: boolean
  startAt: string
  endAt: string | null
  durationSeconds: number | null
  workDate: string
  source: string
  timesheetId: string | null
  tags: string[]
  estimatedCost: number | null
  hourlyRateUsed: number | null
}

interface TimeEntryFullRow extends RowDataPacket {
  id: string
  workspace_id: string
  employee_id: string
  client_id: string | null
  project_id: string | null
  task_id: string | null
  description: string
  billable: number | boolean
  start_at: Date | string
  end_at: Date | string | null
  duration_seconds: number | null
  work_date: Date | string
  source: string
  timesheet_id: string | null
  tags: string | null
  estimated_cost: number | null
  hourly_rate_used: number | null
}

function mapTimeEntryFull(row: TimeEntryFullRow): TimeEntryFull {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    employeeId: row.employee_id,
    clientId: row.client_id,
    projectId: row.project_id,
    taskId: row.task_id,
    description: row.description,
    billable: bool(row.billable),
    startAt: iso(row.start_at) ?? "",
    endAt: iso(row.end_at),
    durationSeconds: row.duration_seconds,
    workDate:
      row.work_date instanceof Date
        ? row.work_date.toISOString().slice(0, 10)
        : String(row.work_date).slice(0, 10),
    source: row.source ?? "clockify",
    timesheetId: row.timesheet_id,
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
    estimatedCost: row.estimated_cost,
    hourlyRateUsed: row.hourly_rate_used
  }
}

export async function listTimeEntriesV2(
  workspaceId: string,
  filters: {
    employeeId?: string
    projectId?: string
    from?: string
    to?: string
    source?: string
    page?: number
    limit?: number
  } = {}
): Promise<{ entries: TimeEntryFull[]; total: number }> {
  const where = ["te.workspace_id = ?"]
  const values: unknown[] = [workspaceId]

  if (filters.employeeId) {
    where.push("te.employee_id = ?")
    values.push(filters.employeeId)
  }
  if (filters.projectId) {
    where.push("te.project_id = ?")
    values.push(filters.projectId)
  }
  if (filters.from) {
    where.push("te.work_date >= ?")
    values.push(filters.from.slice(0, 10))
  }
  if (filters.to) {
    where.push("te.work_date <= ?")
    values.push(filters.to.slice(0, 10))
  }
  if (filters.source) {
    where.push("te.source = ?")
    values.push(filters.source)
  }

  const whereClause = where.join(" AND ")
  const limit = Math.min(filters.limit ?? 100, 500)
  const offset = ((filters.page ?? 1) - 1) * limit

  const [rows, countRows] = await Promise.all([
    dbQuery<TimeEntryFullRow[]>(
      `SELECT te.id, te.workspace_id, te.employee_id, te.client_id, te.project_id, te.task_id,
              te.description, te.billable, te.start_at, te.end_at, te.duration_seconds,
              te.work_date, te.source, te.timesheet_id, te.tags, te.estimated_cost,
              te.hourly_rate_used
       FROM erp_time_entries te
       WHERE ${whereClause}
       ORDER BY te.start_at DESC
       LIMIT ? OFFSET ?`,
      [...values, limit, offset]
    ),
    dbQuery<(RowDataPacket & { total: number })[]>(
      `SELECT COUNT(*) AS total FROM erp_time_entries te WHERE ${whereClause}`,
      values
    )
  ])

  return {
    entries: rows.map(mapTimeEntryFull),
    total: countRows[0]?.total ?? 0
  }
}

export async function canDeleteTimeEntry(entryId: string): Promise<boolean> {
  const rows = await dbQuery<(RowDataPacket & { ts_status: string | null })[]>(
    `SELECT ts.status AS ts_status
     FROM erp_time_entries te
     LEFT JOIN erp_timesheets ts ON ts.id = te.timesheet_id
     WHERE te.id = ?`,
    [entryId]
  )
  const status = rows[0]?.ts_status
  return status !== "submitted" && status !== "approved"
}

// ─── Phase 0 — Report: summary ────────────────────────────────────────────────

interface SummaryRow extends RowDataPacket {
  group_id: string
  group_name: string
  group_color: string | null
  total_seconds: number
  billable_seconds: number
  estimated_cost: number
}

export async function getTimeSummaryReport(
  workspaceId: string,
  params: { from: string; to: string; groupBy: "project" | "employee" | "client" }
) {
  let sql: string
  const values: unknown[] = [workspaceId, params.from.slice(0, 10), params.to.slice(0, 10)]

  if (params.groupBy === "project") {
    sql = `
      SELECT
        COALESCE(te.project_id, '__no_project__') AS group_id,
        COALESCE(p.name, 'No project') AS group_name,
        p.color AS group_color,
        SUM(te.duration_seconds) AS total_seconds,
        SUM(CASE WHEN te.billable = 1 THEN te.duration_seconds ELSE 0 END) AS billable_seconds,
        SUM(COALESCE(te.estimated_cost, 0)) AS estimated_cost
      FROM erp_time_entries te
      LEFT JOIN erp_projects p ON p.id = te.project_id
      WHERE te.workspace_id = ? AND te.work_date >= ? AND te.work_date <= ? AND te.end_at IS NOT NULL
      GROUP BY te.project_id, p.name, p.color
      ORDER BY total_seconds DESC
    `
  } else if (params.groupBy === "employee") {
    sql = `
      SELECT
        te.employee_id AS group_id,
        COALESCE(e.name, te.employee_id) AS group_name,
        NULL AS group_color,
        SUM(te.duration_seconds) AS total_seconds,
        SUM(CASE WHEN te.billable = 1 THEN te.duration_seconds ELSE 0 END) AS billable_seconds,
        SUM(COALESCE(te.estimated_cost, 0)) AS estimated_cost
      FROM erp_time_entries te
      LEFT JOIN erp_employees e ON e.id = te.employee_id
      WHERE te.workspace_id = ? AND te.work_date >= ? AND te.work_date <= ? AND te.end_at IS NOT NULL
      GROUP BY te.employee_id, e.name
      ORDER BY total_seconds DESC
    `
  } else {
    sql = `
      SELECT
        COALESCE(te.client_id, '__no_client__') AS group_id,
        COALESCE(c.name, 'No client') AS group_name,
        NULL AS group_color,
        SUM(te.duration_seconds) AS total_seconds,
        SUM(CASE WHEN te.billable = 1 THEN te.duration_seconds ELSE 0 END) AS billable_seconds,
        SUM(COALESCE(te.estimated_cost, 0)) AS estimated_cost
      FROM erp_time_entries te
      LEFT JOIN erp_clients c ON c.id = te.client_id
      WHERE te.workspace_id = ? AND te.work_date >= ? AND te.work_date <= ? AND te.end_at IS NOT NULL
      GROUP BY te.client_id, c.name
      ORDER BY total_seconds DESC
    `
  }

  const rows = await dbQuery<SummaryRow[]>(sql, values)
  return rows.map((r) => ({
    groupId: r.group_id,
    groupName: r.group_name,
    groupColor: r.group_color ?? null,
    totalHours: Math.round(((r.total_seconds ?? 0) / 3600) * 100) / 100,
    billableHours: Math.round(((r.billable_seconds ?? 0) / 3600) * 100) / 100,
    estimatedCost: r.estimated_cost ?? 0
  }))
}

// ─── Phase 0 — Report: detailed ──────────────────────────────────────────────

interface DetailedRow extends RowDataPacket {
  id: string
  workspace_id: string
  employee_id: string
  client_id: string | null
  project_id: string | null
  task_id: string | null
  description: string
  billable: number | boolean
  start_at: Date | string
  end_at: Date | string | null
  duration_seconds: number | null
  work_date: Date | string
  source: string
  timesheet_id: string | null
  tags: string | null
  estimated_cost: number | null
  hourly_rate_used: number | null
  project_name: string | null
  project_color: string | null
  employee_name: string | null
  client_name: string | null
}

export async function getTimeDetailedReport(
  workspaceId: string,
  params: {
    from: string
    to: string
    employeeId?: string
    projectId?: string
    sortBy?: string
    sortDir?: string
  }
): Promise<{ entries: (TimeEntryFull & { projectName: string | null; employeeName: string | null; clientName: string | null })[]; total: number }> {
  const where = [
    "te.workspace_id = ?",
    "te.work_date >= ?",
    "te.work_date <= ?",
    "te.end_at IS NOT NULL"
  ]
  const values: unknown[] = [workspaceId, params.from.slice(0, 10), params.to.slice(0, 10)]

  if (params.employeeId) {
    where.push("te.employee_id = ?")
    values.push(params.employeeId)
  }
  if (params.projectId) {
    where.push("te.project_id = ?")
    values.push(params.projectId)
  }

  const allowedSortCols: Record<string, string> = {
    date: "te.work_date",
    start: "te.start_at",
    duration: "te.duration_seconds",
    project: "p.name",
    employee: "e.name",
    description: "te.description"
  }
  const sortCol = allowedSortCols[params.sortBy ?? ""] ?? "te.work_date"
  const sortDir = params.sortDir === "asc" ? "ASC" : "DESC"
  const whereClause = where.join(" AND ")

  const rows = await dbQuery<DetailedRow[]>(
    `SELECT
       te.id, te.workspace_id, te.employee_id, te.client_id, te.project_id, te.task_id,
       te.description, te.billable, te.start_at, te.end_at, te.duration_seconds,
       te.work_date, te.source, te.timesheet_id, te.tags, te.estimated_cost, te.hourly_rate_used,
       p.name AS project_name, p.color AS project_color,
       e.name AS employee_name,
       c.name AS client_name
     FROM erp_time_entries te
     LEFT JOIN erp_projects p ON p.id = te.project_id
     LEFT JOIN erp_employees e ON e.id = te.employee_id
     LEFT JOIN erp_clients c ON c.id = te.client_id
     WHERE ${whereClause}
     ORDER BY ${sortCol} ${sortDir}, te.start_at DESC`,
    values
  )

  const entries = rows.map((r) => ({
    ...mapTimeEntryFull(r as unknown as TimeEntryFullRow),
    projectName: r.project_name,
    projectColor: r.project_color,
    employeeName: r.employee_name,
    clientName: r.client_name
  }))

  return { entries, total: entries.length }
}

// ─── Phase 0 — Report: weekly grid ───────────────────────────────────────────

interface WeeklyEntryRow extends RowDataPacket {
  id: string
  project_id: string | null
  project_name: string | null
  project_color: string | null
  description: string
  work_date: Date | string
  duration_seconds: number | null
  timesheet_id: string | null
  timesheet_status: string | null
}

export interface WeeklyReportRow {
  projectId: string | null
  projectName: string
  projectColor: string | null
  taskName: string
  timesheetId: string | null
  timesheetStatus: string | null
  cells: Record<string, { hours: number; seconds: number; entryIds: string[] }>
  totalHours: number
}

export interface WeeklyReport {
  weekStart: string
  weekEnd: string
  days: string[]
  rows: WeeklyReportRow[]
  totalByDay: Record<string, number>
  grandTotal: number
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export async function getTimeWeeklyReport(
  workspaceId: string,
  params: { employeeId: string; weekStart: string }
): Promise<WeeklyReport> {
  const weekEnd = addDays(params.weekStart, 6)
  const days = Array.from({ length: 7 }, (_, i) => addDays(params.weekStart, i))

  const rows = await dbQuery<WeeklyEntryRow[]>(
    `SELECT
       te.id, te.project_id, te.description, te.work_date, te.duration_seconds,
       te.timesheet_id,
       p.name AS project_name, p.color AS project_color,
       ts.status AS timesheet_status
     FROM erp_time_entries te
     LEFT JOIN erp_projects p ON p.id = te.project_id
     LEFT JOIN erp_timesheets ts ON ts.id = te.timesheet_id
     WHERE te.workspace_id = ?
       AND te.employee_id = ?
       AND te.work_date >= ?
       AND te.work_date <= ?
       AND te.end_at IS NOT NULL
     ORDER BY p.name, te.description, te.work_date`,
    [workspaceId, params.employeeId, params.weekStart, weekEnd]
  )

  // Group by (projectId, description)
  const rowMap = new Map<string, WeeklyReportRow>()
  const totalByDay: Record<string, number> = {}
  let grandTotal = 0

  for (const day of days) {
    totalByDay[day] = 0
  }

  for (const r of rows) {
    const key = `${r.project_id ?? "__"}::${r.description}`
    const dateStr =
      r.work_date instanceof Date
        ? r.work_date.toISOString().slice(0, 10)
        : String(r.work_date).slice(0, 10)
    const secs = r.duration_seconds ?? 0
    const hours = Math.round((secs / 3600) * 100) / 100

    if (!rowMap.has(key)) {
      const cells: Record<string, { hours: number; seconds: number; entryIds: string[] }> = {}
      for (const day of days) {
        cells[day] = { hours: 0, seconds: 0, entryIds: [] }
      }
      rowMap.set(key, {
        projectId: r.project_id,
        projectName: r.project_name ?? "No project",
        projectColor: r.project_color,
        taskName: r.description,
        timesheetId: r.timesheet_id,
        timesheetStatus: r.timesheet_status,
        cells,
        totalHours: 0
      })
    }

    const rowEntry = rowMap.get(key)!
    if (rowEntry.cells[dateStr]) {
      rowEntry.cells[dateStr]!.seconds += secs
      rowEntry.cells[dateStr]!.hours = Math.round((rowEntry.cells[dateStr]!.seconds / 3600) * 100) / 100
      rowEntry.cells[dateStr]!.entryIds.push(r.id)
    }
    rowEntry.totalHours = Math.round((rowEntry.totalHours + hours) * 100) / 100
    // Prefer the most restrictive timesheet status for the row
    if (r.timesheet_status === "approved") rowEntry.timesheetStatus = "approved"
    else if (r.timesheet_status === "submitted" && rowEntry.timesheetStatus !== "approved") rowEntry.timesheetStatus = "submitted"

    if (totalByDay[dateStr] !== undefined) {
      totalByDay[dateStr] = Math.round((totalByDay[dateStr]! + hours) * 100) / 100
    }
    grandTotal = Math.round((grandTotal + hours) * 100) / 100
  }

  return {
    weekStart: params.weekStart,
    weekEnd,
    days,
    rows: [...rowMap.values()],
    totalByDay,
    grandTotal
  }
}

// ─── Phase 0 ──────────────────────────────────────────────────────────────────

interface RunningTimerRow extends RowDataPacket {
  id: string
  employee_id: string
  workspace_id: string
  project_id: string | null
  client_id: string | null
  description: string
  start_at: Date | string
  tags: string | null
}

export async function getRunningTimer(workspaceId: string, employeeId: string) {
  const rows = await dbQuery<RunningTimerRow[]>(
    `SELECT id, employee_id, workspace_id, project_id, client_id, description, start_at, tags
     FROM erp_time_entries
     WHERE workspace_id = ? AND employee_id = ? AND source = 'timer' AND end_at IS NULL
     LIMIT 1`,
    [workspaceId, employeeId]
  )
  if (!rows[0]) return null
  const row = rows[0]
  return {
    id: row.id,
    employeeId: row.employee_id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    clientId: row.client_id,
    description: row.description,
    startAt: iso(row.start_at),
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : []
  }
}

interface TimesheetRow extends RowDataPacket {
  id: string
  workspace_id: string
  employee_id: string
  period_start: Date | string
  period_end: Date | string
  period_type: string
  status: string
  submitted_at: Date | string | null
  approved_by: string | null
  approved_at: Date | string | null
  rejection_note: string | null
  created_at: Date | string
  updated_at: Date | string
}

function mapTimesheet(row: TimesheetRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    employeeId: row.employee_id,
    periodStart: typeof row.period_start === "string" ? row.period_start : row.period_start.toISOString().slice(0, 10),
    periodEnd: typeof row.period_end === "string" ? row.period_end : row.period_end.toISOString().slice(0, 10),
    periodType: row.period_type,
    status: row.status,
    submittedAt: iso(row.submitted_at),
    approvedBy: row.approved_by,
    approvedAt: iso(row.approved_at),
    rejectionNote: row.rejection_note,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  }
}

export async function listTimesheets(
  workspaceId: string,
  filters?: { employeeId?: string; status?: string; periodStart?: string; periodEnd?: string }
) {
  const where = ["workspace_id = ?"]
  const values: unknown[] = [workspaceId]

  if (filters?.employeeId) {
    where.push("employee_id = ?")
    values.push(filters.employeeId)
  }
  if (filters?.status) {
    where.push("status = ?")
    values.push(filters.status)
  }
  if (filters?.periodStart) {
    where.push("period_end >= ?")
    values.push(filters.periodStart)
  }
  if (filters?.periodEnd) {
    where.push("period_start <= ?")
    values.push(filters.periodEnd)
  }

  const rows = await dbQuery<TimesheetRow[]>(
    `SELECT * FROM erp_timesheets WHERE ${where.join(" AND ")} ORDER BY period_start DESC`,
    values
  )
  return rows.map(mapTimesheet)
}

export async function getTimesheet(id: string) {
  const rows = await dbQuery<TimesheetRow[]>(
    "SELECT * FROM erp_timesheets WHERE id = ?",
    [id]
  )
  return rows[0] ? mapTimesheet(rows[0]) : null
}

interface TemplateRow extends RowDataPacket {
  id: string
  workspace_id: string
  employee_id: string
  name: string
  template_data: unknown
  created_at: Date | string
}

export async function listTimesheetTemplates(workspaceId: string, employeeId?: string) {
  const where = ["workspace_id = ?"]
  const values: unknown[] = [workspaceId]
  if (employeeId) {
    where.push("employee_id = ?")
    values.push(employeeId)
  }
  const rows = await dbQuery<TemplateRow[]>(
    `SELECT * FROM erp_timesheet_templates WHERE ${where.join(" AND ")} ORDER BY name ASC`,
    values
  )
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    employeeId: row.employee_id,
    name: row.name,
    templateData:
      typeof row.template_data === "string"
        ? JSON.parse(row.template_data)
        : row.template_data,
    createdAt: iso(row.created_at)
  }))
}

interface SuggestionRow extends RowDataPacket {
  task_name: string
  used_count: number
}

export async function getTaskSuggestions(
  employeeId: string,
  projectId: string,
  q?: string
) {
  const where = ["employee_id = ?", "project_id = ?"]
  const values: unknown[] = [employeeId, projectId]
  if (q && q.trim()) {
    where.push("task_name LIKE ?")
    values.push(`${q.trim()}%`)
  }
  const rows = await dbQuery<SuggestionRow[]>(
    `SELECT task_name, used_count FROM erp_task_suggestions
     WHERE ${where.join(" AND ")}
     ORDER BY used_count DESC
     LIMIT 5`,
    values
  )
  return rows.map((r) => ({ taskName: r.task_name, usedCount: r.used_count }))
}

// ─── Phase 1A — Employee profile ─────────────────────────────────────────────

interface EmployeeProfileRow extends RowDataPacket {
  id: string
  workspace_id: string
  name: string
  email: string
  status: string | null
  profile_picture: string | null
  hourly_rate: number | null
  date_of_birth: string | null
  contract_type: string | null
  contract_number: string | null
  contract_date: string | null
  contract_document_id: string | null
  supervisor_id: string | null
  first_collaboration_date: string | null
  position: string | null
  manual_avatar_override: number | null
}

export async function getEmployeeProfile(employeeId: string) {
  const rows = await dbQuery<EmployeeProfileRow[]>(
    `SELECT id, workspace_id, name, email, status, profile_picture, hourly_rate,
     date_of_birth, contract_type, contract_number, contract_date, contract_document_id,
     supervisor_id, first_collaboration_date, position, manual_avatar_override
     FROM erp_employees WHERE id = ?`,
    [employeeId]
  )
  if (!rows[0]) return null
  const r = rows[0]
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    email: r.email,
    status: r.status,
    profilePicture: r.profile_picture,
    hourlyRate: r.hourly_rate,
    dateOfBirth: r.date_of_birth ?? null,
    contractType: r.contract_type ?? null,
    contractNumber: r.contract_number ?? null,
    contractDate: r.contract_date ?? null,
    contractDocumentId: r.contract_document_id ?? null,
    supervisorId: r.supervisor_id ?? null,
    firstCollaborationDate: r.first_collaboration_date ?? null,
    position: r.position ?? null,
    manualAvatarOverride: (r.manual_avatar_override ?? 0) === 1
  }
}

// ─── Phase 1B — Client profile ────────────────────────────────────────────────

interface ClientProfileRow extends RowDataPacket {
  id: string
  workspace_id: string
  name: string
  email: string | null
  archived: number
  nip: string | null
  address: string | null
  cooperation_type: string | null
  notes: string | null
}

export async function getClientProfile(clientId: string) {
  const rows = await dbQuery<ClientProfileRow[]>(
    `SELECT id, workspace_id, name, email, archived, nip, address, cooperation_type, notes
     FROM erp_clients WHERE id = ?`,
    [clientId]
  )
  if (!rows[0]) return null
  const r = rows[0]
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    email: r.email,
    archived: bool(r.archived),
    nip: r.nip,
    address: r.address,
    cooperationType: r.cooperation_type,
    notes: r.notes
  }
}

export async function listClientsWithProjects(workspaceId: string) {
  const rows = await dbQuery<ClientProfileRow[]>(
    `SELECT id, workspace_id, name, email, archived, nip, address, cooperation_type, notes
     FROM erp_clients WHERE workspace_id = ? ORDER BY name ASC`,
    [workspaceId]
  )
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    email: r.email,
    archived: bool(r.archived),
    nip: r.nip,
    address: r.address,
    cooperationType: r.cooperation_type,
    notes: r.notes
  }))
}
