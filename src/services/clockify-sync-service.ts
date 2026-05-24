import z from "zod"

import { requireEnv } from "#/env"
import { ClockifyError, clockifyFetch, clockifyFetchAll } from "#/lib/clockify"
import {
  ClockifyClientSchema,
  ClockifyProjectSchema,
  ClockifyTimeEntrySchema,
  ClockifyUserSchema,
  ClockifyWorkspaceSchema,
  type ClockifyTimeEntry,
  type ClockifyUser,
  type ClockifyWorkspace
} from "#/lib/clockify-schemas"

declare const Bun: {
  serve(options: { port: number; fetch(request: Request): Response | Promise<Response> }): unknown
}

interface SyncInput {
  workspaceId?: string
  startDate?: string
  endDate?: string
}

const backendApiUrl = requireEnv("BACKEND_API_URL")
const internalToken = requireEnv("API_INTERNAL_TOKEN")

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
  return request.json().catch(() => ({})) as Promise<SyncInput>
}

async function postBackendImport(payload: unknown) {
  const response = await fetch(`${backendApiUrl}/internal/clockify/import`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${internalToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Backend import failed: ${response.status} ${text}`)
  }

  return response.json() as Promise<{
    workspaceId: string
    users: number
    clients: number
    projects: number
    timeEntries: number
  }>
}

async function fetchTimeEntries(
  input: Required<Pick<SyncInput, "workspaceId">> & SyncInput,
  users: ClockifyUser[]
) {
  const entries: ClockifyTimeEntry[] = []

  for (const user of users) {
    const params = new URLSearchParams()
    params.set("page-size", "5000")
    if (input.startDate) params.set("start", input.startDate)
    if (input.endDate) params.set("end", input.endDate)

    const userEntries = await clockifyFetchAll(
      `/workspaces/${input.workspaceId}/user/${user.id}/time-entries?${params.toString()}`,
      undefined,
      z.array(ClockifyTimeEntrySchema)
    )
    entries.push(...userEntries)
  }

  return entries
}

async function syncWorkspace(workspace: ClockifyWorkspace, input: SyncInput) {
  const [users, clients, projects] = await Promise.all([
    clockifyFetchAll(
      `/workspaces/${workspace.id}/users?page-size=5000`,
      undefined,
      z.array(ClockifyUserSchema)
    ),
    clockifyFetchAll(
      `/workspaces/${workspace.id}/clients?page-size=5000`,
      undefined,
      z.array(ClockifyClientSchema)
    ),
    clockifyFetchAll(
      `/workspaces/${workspace.id}/projects?page-size=5000`,
      undefined,
      z.array(ClockifyProjectSchema)
    )
  ])
  const timeEntries = await fetchTimeEntries({ ...input, workspaceId: workspace.id }, users)

  return postBackendImport({
    workspace,
    users,
    clients,
    projects,
    timeEntries
  })
}

interface SyncImportResult {
  users: number
  clients: number
  projects: number
  timeEntries: number
}

interface SyncSummary extends SyncImportResult {
  workspaces: number
}

function flatten(results: SyncImportResult[]) {
  return results.reduce<SyncSummary>(
    (acc, item) => ({
      workspaces: acc.workspaces + 1,
      users: acc.users + item.users,
      clients: acc.clients + item.clients,
      projects: acc.projects + item.projects,
      timeEntries: acc.timeEntries + item.timeEntries
    }),
    { workspaces: 0, users: 0, clients: 0, projects: 0, timeEntries: 0 } satisfies SyncSummary
  )
}

const port = Number(process.env.PORT ?? 4000)

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url)

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true, service: "clockify-sync" })
      }

      if (request.method === "POST" && url.pathname === "/sync") {
        const body = await readJson(request)
        if (!body.workspaceId) return jsonResponse({ error: "workspaceId is required" }, 400)
        const workspace = await clockifyFetch(
          `/workspaces/${body.workspaceId}`,
          undefined,
          ClockifyWorkspaceSchema
        )
        return jsonResponse(flatten([await syncWorkspace(workspace, body)]))
      }

      if (request.method === "POST" && url.pathname === "/sync-all") {
        const body = await readJson(request)
        const workspaces = await clockifyFetch(
          "/workspaces",
          undefined,
          z.array(ClockifyWorkspaceSchema)
        )
        const results = []
        for (const workspace of workspaces) {
          results.push(await syncWorkspace(workspace, body))
        }
        return jsonResponse(flatten(results))
      }

      return jsonResponse({ error: "Not found" }, 404)
    } catch (error) {
      if (error instanceof ClockifyError) {
        console.warn("[Clockify Sync Service]", error.message)
        return jsonResponse(
          {
            error: error.message,
            status: error.status,
            response: error.response
          },
          error.status === 401 ? 401 : 502
        )
      }

      console.error("[Clockify Sync Service]", error)
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500)
    }
  }
})

console.log(`[Clockify Sync Service] Listening on :${port}`)
