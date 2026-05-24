import type { ResultSetHeader } from "mysql2/promise"

import {
  getIntervalDurationMs,
  type ClockifyClient,
  type ClockifyProject,
  type ClockifyTimeEntry,
  type ClockifyUser,
  type ClockifyWorkspace
} from "#/lib/clockify-schemas"
import { ensureDatabase, getDbPool } from "#/lib/db"
import { recalculateAllTimeEntryCosts } from "#/lib/finance-service"

export interface ClockifyImportPayload {
  workspace: ClockifyWorkspace
  users: ClockifyUser[]
  clients: ClockifyClient[]
  projects: ClockifyProject[]
  timeEntries: ClockifyTimeEntry[]
}

export interface ClockifyImportResult {
  workspaceId: string
  users: number
  clients: number
  projects: number
  timeEntries: number
}

const json = (value: unknown) => JSON.stringify(value)

function toMysqlDateTime(value: string | null | undefined) {
  if (!value) return null
  return new Date(value).toISOString().slice(0, 23).replace("T", " ")
}

function toWorkDate(value: string) {
  return new Date(value).toISOString().slice(0, 10)
}

function durationSeconds(entry: ClockifyTimeEntry) {
  const durationMs = getIntervalDurationMs(entry.timeInterval)
  return durationMs == null ? null : Math.round(durationMs / 1000)
}

async function createSyncRun(workspaceId: string) {
  const [result] = await getDbPool().execute<ResultSetHeader>(
    "INSERT INTO erp_sync_runs (workspace_id, status) VALUES (?, 'running')",
    [workspaceId]
  )
  return result.insertId
}

async function finishSyncRun(runId: number, result: ClockifyImportResult) {
  await getDbPool().execute(
    `
      UPDATE erp_sync_runs
      SET status = 'success',
        users_count = ?,
        clients_count = ?,
        projects_count = ?,
        time_entries_count = ?,
        finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [result.users, result.clients, result.projects, result.timeEntries, runId]
  )
}

async function failSyncRun(runId: number, error: unknown) {
  await getDbPool().execute(
    "UPDATE erp_sync_runs SET status = 'failed', error_message = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?",
    [error instanceof Error ? error.message : String(error), runId]
  )
}

async function upsertWorkspace(workspace: ClockifyWorkspace) {
  await getDbPool().execute(
    `
      INSERT INTO erp_workspaces (id, name, raw_json)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE name = VALUES(name), raw_json = VALUES(raw_json), synced_at = CURRENT_TIMESTAMP
    `,
    [workspace.id, workspace.name, json(workspace)]
  )
}

async function upsertClients(clients: ClockifyClient[]) {
  for (const client of clients) {
    await getDbPool().execute(
      `
        INSERT INTO erp_clients (id, workspace_id, name, email, archived, raw_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          workspace_id = VALUES(workspace_id),
          name = VALUES(name),
          email = VALUES(email),
          archived = VALUES(archived),
          raw_json = VALUES(raw_json),
          synced_at = CURRENT_TIMESTAMP
      `,
      [
        client.id,
        client.workspaceId,
        client.name,
        client.email ?? null,
        client.archived ?? false,
        json(client)
      ]
    )
  }
}

async function upsertUsers(workspaceId: string, users: ClockifyUser[]) {
  for (const user of users) {
    await getDbPool().execute(
      `
        INSERT INTO erp_employees (id, workspace_id, name, email, status, profile_picture, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          workspace_id = VALUES(workspace_id),
          name = VALUES(name),
          email = VALUES(email),
          status = VALUES(status),
          profile_picture = IF(manual_avatar_override = 1, profile_picture, VALUES(profile_picture)),
          raw_json = VALUES(raw_json),
          synced_at = CURRENT_TIMESTAMP
      `,
      [
        user.id,
        workspaceId,
        user.name,
        user.email,
        user.status ?? null,
        user.profilePicture ?? null,
        json(user)
      ]
    )
  }
}

async function upsertProjects(workspaceId: string, projects: ClockifyProject[]) {
  for (const project of projects) {
    await getDbPool().execute(
      `
        INSERT INTO erp_projects (id, workspace_id, client_id, name, billable, color, archived, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          workspace_id = VALUES(workspace_id),
          client_id = VALUES(client_id),
          name = VALUES(name),
          billable = VALUES(billable),
          color = VALUES(color),
          archived = VALUES(archived),
          raw_json = VALUES(raw_json),
          synced_at = CURRENT_TIMESTAMP
      `,
      [
        project.id,
        workspaceId,
        project.clientId ?? null,
        project.name,
        project.billable ?? true,
        project.color ?? null,
        project.archived ?? false,
        json(project)
      ]
    )
  }
}

async function upsertTimeEntries(
  workspaceId: string,
  entries: ClockifyTimeEntry[],
  projects: ClockifyProject[]
) {
  const clientIdByProjectId = new Map(projects.map((project) => [project.id, project.clientId]))
  for (const entry of entries) {
    const clientId = entry.projectId ? clientIdByProjectId.get(entry.projectId) : null
    await getDbPool().execute(
      `
        INSERT INTO erp_time_entries (
          id, workspace_id, employee_id, client_id, project_id, task_id, description,
          billable, start_at, end_at, duration_seconds, work_date, raw_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          workspace_id = VALUES(workspace_id),
          employee_id = VALUES(employee_id),
          client_id = VALUES(client_id),
          project_id = VALUES(project_id),
          task_id = VALUES(task_id),
          description = VALUES(description),
          billable = VALUES(billable),
          start_at = VALUES(start_at),
          end_at = VALUES(end_at),
          duration_seconds = VALUES(duration_seconds),
          work_date = VALUES(work_date),
          raw_json = VALUES(raw_json),
          synced_at = CURRENT_TIMESTAMP
      `,
      [
        entry.id,
        workspaceId,
        entry.userId,
        clientId ?? null,
        entry.projectId ?? null,
        entry.taskId ?? null,
        entry.description,
        entry.billable ?? false,
        toMysqlDateTime(entry.timeInterval.start),
        toMysqlDateTime(entry.timeInterval.end),
        durationSeconds(entry),
        toWorkDate(entry.timeInterval.start),
        json(entry)
      ]
    )
  }
}

export async function importClockifyPayload(payload: ClockifyImportPayload) {
  await ensureDatabase()
  await upsertWorkspace(payload.workspace)
  const runId = await createSyncRun(payload.workspace.id)

  try {
    await upsertUsers(payload.workspace.id, payload.users)
    await upsertClients(payload.clients)
    await upsertProjects(payload.workspace.id, payload.projects)
    await upsertTimeEntries(payload.workspace.id, payload.timeEntries, payload.projects)
    await recalculateAllTimeEntryCosts()

    const result = {
      workspaceId: payload.workspace.id,
      users: payload.users.length,
      clients: payload.clients.length,
      projects: payload.projects.length,
      timeEntries: payload.timeEntries.length
    }
    await finishSyncRun(runId, result)
    return result
  } catch (error) {
    await failSyncRun(runId, error)
    throw error
  }
}
