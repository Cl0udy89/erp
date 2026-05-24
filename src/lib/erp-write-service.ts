import type { ClockifyProject, ClockifyTimeEntry } from "#/lib/clockify-schemas"
import { dbExecute, dbQuery } from "#/lib/db"
import type { RowDataPacket } from "mysql2/promise"

const localId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`

const toMysqlDateTime = (value: string) =>
  new Date(value).toISOString().slice(0, 23).replace("T", " ")

const nowMysql = () => new Date().toISOString().slice(0, 23).replace("T", " ")

const workDate = (value: string) => new Date(value).toISOString().slice(0, 10)

interface CountRow extends RowDataPacket {
  count: number
}

interface IdRow extends RowDataPacket {
  id: string
}

export async function createErpProject(data: {
  workspaceId: string
  name: string
  clientId?: string
  billable?: boolean
  color?: string
  note?: string
  billingType?: string
  billingRate?: number | null
  fixedAmount?: number | null
  subscriptionMinHours?: number | null
  subscriptionOverageRate?: number | null
}) {
  const project: ClockifyProject = {
    id: localId("project"),
    workspaceId: data.workspaceId,
    name: data.name,
    clientId: data.clientId,
    billable: data.billable ?? true,
    color: data.color ?? "#000000",
    note: data.note,
    archived: false
  }

  await dbExecute(
    `
      INSERT INTO erp_projects (id, workspace_id, client_id, name, billable, color, archived, billing_type, billing_rate, fixed_amount, subscription_min_hours, subscription_overage_rate, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, false, ?, ?, ?, ?, ?, ?)
    `,
    [
      project.id,
      project.workspaceId,
      project.clientId ?? null,
      project.name,
      project.billable ?? true,
      project.color ?? null,
      data.billingType ?? "hourly",
      data.billingRate ?? null,
      data.fixedAmount ?? null,
      data.subscriptionMinHours ?? null,
      data.subscriptionOverageRate ?? null,
      JSON.stringify(project)
    ]
  )

  return project
}

export async function updateErpProject(data: {
  id: string
  workspaceId: string
  name?: string
  clientId?: string | null
  billable?: boolean
  color?: string | null
  billingType?: string | null
  billingRate?: number | null
  fixedAmount?: number | null
  subscriptionMinHours?: number | null
  subscriptionOverageRate?: number | null
}) {
  await dbExecute(
    `UPDATE erp_projects SET
      name = COALESCE(?, name),
      billing_type = COALESCE(?, billing_type),
      billing_rate = ?,
      fixed_amount = ?,
      subscription_min_hours = ?,
      subscription_overage_rate = ?
    WHERE id = ? AND workspace_id = ?`,
    [
      data.name ?? null,
      data.billingType ?? null,
      data.billingRate ?? null,
      data.fixedAmount ?? null,
      data.subscriptionMinHours ?? null,
      data.subscriptionOverageRate ?? null,
      data.id,
      data.workspaceId
    ]
  )
}

export async function createErpTimeEntry(data: {
  workspaceId: string
  userId: string
  projectId?: string
  taskId?: string
  start: string
  end: string
  description: string
  billable?: boolean
}) {
  const durationMs = new Date(data.end).getTime() - new Date(data.start).getTime()
  const entry: ClockifyTimeEntry = {
    id: localId("time"),
    description: data.description,
    projectId: data.projectId,
    taskId: data.taskId,
    userId: data.userId,
    workspaceId: data.workspaceId,
    billable: data.billable ?? true,
    timeInterval: {
      start: data.start,
      end: data.end,
      duration: durationMs
    }
  }

  await dbExecute(
    `
      INSERT INTO erp_time_entries (
        id, workspace_id, employee_id, project_id, task_id, description, billable,
        start_at, end_at, duration_seconds, work_date, raw_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      entry.id,
      data.workspaceId,
      data.userId,
      data.projectId ?? null,
      data.taskId ?? null,
      data.description,
      data.billable ?? true,
      toMysqlDateTime(data.start),
      toMysqlDateTime(data.end),
      Math.round(durationMs / 1000),
      workDate(data.start),
      JSON.stringify(entry)
    ]
  )

  return entry
}

export async function updateErpTimeEntry(data: {
  workspaceId: string
  entryId: string
  description?: string
  projectId?: string
  start?: string
  end?: string
  billable?: boolean
}) {
  await dbExecute(
    `
      UPDATE erp_time_entries
      SET
        description = COALESCE(?, description),
        project_id = ?,
        start_at = COALESCE(?, start_at),
        end_at = COALESCE(?, end_at),
        work_date = COALESCE(?, work_date),
        billable = COALESCE(?, billable)
      WHERE workspace_id = ? AND id = ?
    `,
    [
      data.description ?? null,
      data.projectId ?? null,
      data.start ? toMysqlDateTime(data.start) : null,
      data.end ? toMysqlDateTime(data.end) : null,
      data.start ? workDate(data.start) : null,
      data.billable ?? null,
      data.workspaceId,
      data.entryId
    ]
  )

  return { id: data.entryId }
}

export async function deleteErpTimeEntry(data: { workspaceId: string; entryId: string }) {
  await dbExecute("DELETE FROM erp_time_entries WHERE workspace_id = ? AND id = ?", [
    data.workspaceId,
    data.entryId
  ])
  return { success: true, entryId: data.entryId }
}

// ─── Timer ────────────────────────────────────────────────────────────────────

export async function startTimer(data: { workspaceId: string; employeeId: string }) {
  // Enforce single running timer per employee
  const [existing] = await dbQuery<CountRow[]>(
    `SELECT COUNT(*) AS count FROM erp_time_entries
     WHERE employee_id = ? AND source = 'timer' AND end_at IS NULL`,
    [data.employeeId]
  )
  if ((existing?.count ?? 0) > 0) {
    return { conflict: true }
  }

  const id = localId("timer")
  const now = nowMysql()
  const today = now.slice(0, 10)

  await dbExecute(
    `INSERT INTO erp_time_entries
       (id, workspace_id, employee_id, description, billable, start_at, end_at, work_date, source)
     VALUES (?, ?, ?, '', false, ?, NULL, ?, 'timer')`,
    [id, data.workspaceId, data.employeeId, now, today]
  )

  return { id, startAt: now }
}

export async function stopTimer(data: {
  workspaceId: string
  employeeId: string
  description?: string
  projectId?: string
  clientId?: string
  billable?: boolean
  tags?: string[]
}) {
  const now = nowMysql()

  // Fetch the running timer first
  const [row] = await dbQuery<(RowDataPacket & { id: string; start_at: Date })[]>(
    `SELECT id, start_at FROM erp_time_entries
     WHERE employee_id = ? AND source = 'timer' AND end_at IS NULL
     LIMIT 1`,
    [data.employeeId]
  )
  if (!row) return { notFound: true }

  const startMs = new Date(row.start_at).getTime()
  const endMs = new Date(now).getTime()
  const durationSeconds = Math.round((endMs - startMs) / 1000)

  await dbExecute(
    `UPDATE erp_time_entries
     SET end_at = ?,
         duration_seconds = ?,
         source = 'manual',
         description = COALESCE(?, description),
         project_id = ?,
         client_id = ?,
         billable = COALESCE(?, billable),
         tags = ?
     WHERE id = ? AND workspace_id = ?`,
    [
      now,
      durationSeconds,
      data.description ?? null,
      data.projectId ?? null,
      data.clientId ?? null,
      data.billable ?? null,
      data.tags ? JSON.stringify(data.tags) : null,
      row.id,
      data.workspaceId
    ]
  )

  return { id: row.id, endAt: now, durationSeconds }
}

export async function discardTimer(data: { workspaceId: string; employeeId: string }) {
  const [row] = await dbQuery<IdRow[]>(
    `SELECT id FROM erp_time_entries
     WHERE employee_id = ? AND source = 'timer' AND end_at IS NULL
     LIMIT 1`,
    [data.employeeId]
  )
  if (!row) return { notFound: true }

  await dbExecute("DELETE FROM erp_time_entries WHERE id = ? AND workspace_id = ?", [
    row.id,
    data.workspaceId
  ])

  return { success: true, discardedId: row.id }
}

// ─── Manual time entry ────────────────────────────────────────────────────────

export async function createManualTimeEntry(data: {
  workspaceId: string
  employeeId: string
  projectId?: string
  clientId?: string
  description: string
  billable?: boolean
  startAt: string
  endAt: string
  tags?: string[]
  timesheetId?: string
}) {
  const id = localId("time")
  const start = toMysqlDateTime(data.startAt)
  const end = toMysqlDateTime(data.endAt)
  const durationSeconds = Math.round(
    (new Date(data.endAt).getTime() - new Date(data.startAt).getTime()) / 1000
  )
  const date = workDate(data.startAt)

  await dbExecute(
    `INSERT INTO erp_time_entries
       (id, workspace_id, employee_id, project_id, client_id, description, billable,
        start_at, end_at, duration_seconds, work_date, source, tags, timesheet_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
    [
      id,
      data.workspaceId,
      data.employeeId,
      data.projectId ?? null,
      data.clientId ?? null,
      data.description,
      data.billable ?? false,
      start,
      end,
      durationSeconds,
      date,
      data.tags ? JSON.stringify(data.tags) : null,
      data.timesheetId ?? null
    ]
  )

  return { id, durationSeconds }
}

export async function updateManualTimeEntry(data: {
  workspaceId: string
  entryId: string
  description?: string
  projectId?: string
  clientId?: string
  billable?: boolean
  startAt?: string
  endAt?: string
  tags?: string[]
  timesheetId?: string
}) {
  const durationSeconds =
    data.startAt && data.endAt
      ? Math.round(
          (new Date(data.endAt).getTime() - new Date(data.startAt).getTime()) / 1000
        )
      : null

  await dbExecute(
    `UPDATE erp_time_entries SET
       description    = COALESCE(?, description),
       project_id     = ?,
       client_id      = ?,
       billable       = COALESCE(?, billable),
       start_at       = COALESCE(?, start_at),
       end_at         = COALESCE(?, end_at),
       duration_seconds = COALESCE(?, duration_seconds),
       work_date      = COALESCE(?, work_date),
       tags           = ?,
       timesheet_id   = ?
     WHERE id = ? AND workspace_id = ?`,
    [
      data.description ?? null,
      data.projectId ?? null,
      data.clientId ?? null,
      data.billable ?? null,
      data.startAt ? toMysqlDateTime(data.startAt) : null,
      data.endAt ? toMysqlDateTime(data.endAt) : null,
      durationSeconds,
      data.startAt ? workDate(data.startAt) : null,
      data.tags !== undefined ? JSON.stringify(data.tags) : null,
      data.timesheetId !== undefined ? (data.timesheetId ?? null) : null,
      data.entryId,
      data.workspaceId
    ]
  )

  return { id: data.entryId }
}

// ─── Timesheets ───────────────────────────────────────────────────────────────

export async function createTimesheet(data: {
  workspaceId: string
  employeeId: string
  periodStart: string
  periodEnd: string
  periodType?: "weekly" | "monthly"
}) {
  const id = localId("ts")

  await dbExecute(
    `INSERT INTO erp_timesheets
       (id, workspace_id, employee_id, period_start, period_end, period_type)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.workspaceId,
      data.employeeId,
      data.periodStart,
      data.periodEnd,
      data.periodType ?? "weekly"
    ]
  )

  return { id }
}

export async function submitTimesheet(data: { timesheetId: string; workspaceId: string }) {
  const now = nowMysql()
  await dbExecute(
    `UPDATE erp_timesheets SET status = 'submitted', submitted_at = ?
     WHERE id = ? AND workspace_id = ? AND status = 'draft'`,
    [now, data.timesheetId, data.workspaceId]
  )
  return { id: data.timesheetId, status: "submitted" }
}

export async function approveTimesheet(data: {
  timesheetId: string
  workspaceId: string
  approvedBy: string
}) {
  const now = nowMysql()
  await dbExecute(
    `UPDATE erp_timesheets SET status = 'approved', approved_by = ?, approved_at = ?
     WHERE id = ? AND workspace_id = ? AND status = 'submitted'`,
    [data.approvedBy, now, data.timesheetId, data.workspaceId]
  )
  return { id: data.timesheetId, status: "approved" }
}

export async function rejectTimesheet(data: {
  timesheetId: string
  workspaceId: string
  rejectionNote: string
}) {
  await dbExecute(
    `UPDATE erp_timesheets SET status = 'rejected', rejection_note = ?
     WHERE id = ? AND workspace_id = ? AND status = 'submitted'`,
    [data.rejectionNote, data.timesheetId, data.workspaceId]
  )
  return { id: data.timesheetId, status: "rejected" }
}

export async function deleteTimesheet(data: { timesheetId: string; workspaceId: string }) {
  await dbExecute(
    "DELETE FROM erp_timesheets WHERE id = ? AND workspace_id = ? AND status = 'draft'",
    [data.timesheetId, data.workspaceId]
  )
  return { success: true }
}

// ─── Timesheet templates ──────────────────────────────────────────────────────

export async function createTimesheetTemplate(data: {
  workspaceId: string
  employeeId: string
  name: string
  templateData: unknown
}) {
  const id = localId("tpl")
  await dbExecute(
    `INSERT INTO erp_timesheet_templates (id, workspace_id, employee_id, name, template_data)
     VALUES (?, ?, ?, ?, ?)`,
    [id, data.workspaceId, data.employeeId, data.name, JSON.stringify(data.templateData)]
  )
  return { id }
}

export async function deleteTimesheetTemplate(data: { templateId: string; workspaceId: string }) {
  await dbExecute(
    "DELETE FROM erp_timesheet_templates WHERE id = ? AND workspace_id = ?",
    [data.templateId, data.workspaceId]
  )
  return { success: true }
}

// ─── Task suggestions ─────────────────────────────────────────────────────────

export async function upsertTaskSuggestion(data: {
  workspaceId: string
  employeeId: string
  projectId: string
  taskName: string
}) {
  if (!data.taskName.trim()) return

  const id = localId("sug")
  await dbExecute(
    `INSERT INTO erp_task_suggestions (id, workspace_id, employee_id, project_id, task_name)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE used_count = used_count + 1`,
    [id, data.workspaceId, data.employeeId, data.projectId, data.taskName.trim()]
  )
}

// ─── Phase 1A — Employee profile update ──────────────────────────────────────

export async function updateEmployeeProfile(data: {
  employeeId: string
  name?: string
  email?: string
  dateOfBirth?: string | null
  contractType?: string | null
  contractNumber?: string | null
  contractDate?: string | null
  supervisorId?: string | null
  firstCollaborationDate?: string | null
  position?: string | null
  hourlyRate?: number | null
  profilePicture?: string | null
  manualAvatarOverride?: boolean
}) {
  const sets: string[] = []
  const values: unknown[] = []

  if (data.name !== undefined) { sets.push("name = ?"); values.push(data.name) }
  if (data.email !== undefined) { sets.push("email = ?"); values.push(data.email) }
  if ("dateOfBirth" in data) { sets.push("date_of_birth = ?"); values.push(data.dateOfBirth ?? null) }
  if ("contractType" in data) { sets.push("contract_type = ?"); values.push(data.contractType ?? null) }
  if ("contractNumber" in data) { sets.push("contract_number = ?"); values.push(data.contractNumber ?? null) }
  if ("contractDate" in data) { sets.push("contract_date = ?"); values.push(data.contractDate ?? null) }
  if ("supervisorId" in data) { sets.push("supervisor_id = ?"); values.push(data.supervisorId ?? null) }
  if ("firstCollaborationDate" in data) { sets.push("first_collaboration_date = ?"); values.push(data.firstCollaborationDate ?? null) }
  if ("position" in data) { sets.push("position = ?"); values.push(data.position ?? null) }
  if ("hourlyRate" in data) { sets.push("hourly_rate = ?"); values.push(data.hourlyRate ?? null) }
  if ("profilePicture" in data) {
    sets.push("profile_picture = ?")
    values.push(data.profilePicture ?? null)
    // Setting a profile picture manually → enable override flag automatically
    sets.push("manual_avatar_override = 1")
  }
  if ("manualAvatarOverride" in data) {
    sets.push("manual_avatar_override = ?")
    values.push(data.manualAvatarOverride ? 1 : 0)
  }

  if (sets.length === 0) return { success: true }

  values.push(data.employeeId)
  await dbExecute(
    `UPDATE erp_employees SET ${sets.join(", ")} WHERE id = ?`,
    values
  )
  return { success: true }
}

// ─── Phase 1B — Client profile update ────────────────────────────────────────

export async function updateClientProfile(data: {
  clientId: string
  name?: string
  email?: string | null
  nip?: string | null
  address?: string | null
  cooperationType?: string | null
  notes?: string | null
}) {
  const sets: string[] = []
  const values: unknown[] = []

  if (data.name !== undefined) { sets.push("name = ?"); values.push(data.name) }
  if ("email" in data) { sets.push("email = ?"); values.push(data.email ?? null) }
  if ("nip" in data) { sets.push("nip = ?"); values.push(data.nip ?? null) }
  if ("address" in data) { sets.push("address = ?"); values.push(data.address ?? null) }
  if ("cooperationType" in data) { sets.push("cooperation_type = ?"); values.push(data.cooperationType ?? null) }
  if ("notes" in data) { sets.push("notes = ?"); values.push(data.notes ?? null) }

  if (sets.length === 0) return { success: true }

  values.push(data.clientId)
  await dbExecute(
    `UPDATE erp_clients SET ${sets.join(", ")} WHERE id = ?`,
    values
  )
  return { success: true }
}
