import type { UseQueryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import z from "zod"

import { backendGet } from "#/lib/backend-client"
import type {
  ClockifyClient,
  ClockifyInvoice,
  ClockifyProject,
  ClockifyTask,
  ClockifyTimeEntry,
  ClockifyUser,
  ClockifyWorkspace
} from "#/lib/clockify-schemas"

function createQueryOpts<T, TOption extends UseQueryOptions<T> = UseQueryOptions<T>>(
  key: string[],
  queryFn: () => Promise<T>,
  opts?: TOption
): TOption {
  return {
    queryKey: key,
    queryFn,
    ...opts
  } as TOption
}

const WorkspaceIdParam = z.object({ workspaceId: z.string() })

export const workspacesList = createServerFn({ method: "GET" }).handler(async () =>
  backendGet<ClockifyWorkspace[]>("/workspaces")
)

export const queries = {
  workspacesList: createQueryOpts<ClockifyWorkspace[]>(["erp", "workspaces"], () =>
    workspacesList()
  )
}

export const workspaceUsers = createServerFn({ method: "GET" })
  .inputValidator(WorkspaceIdParam)
  .handler(async ({ data }) => backendGet<ClockifyUser[]>(`/workspaces/${data.workspaceId}/users`))

export const queriesUsers = {
  workspaceUsers: (workspaceId: string) =>
    createQueryOpts<ClockifyUser[]>(["erp", "workspaces", workspaceId, "users"], () =>
      workspaceUsers({ data: { workspaceId } })
    )
}

export const workspaceProjects = createServerFn({ method: "GET" })
  .inputValidator(WorkspaceIdParam)
  .handler(async ({ data }) =>
    backendGet<ClockifyProject[]>(`/workspaces/${data.workspaceId}/projects`)
  )

export const queriesProjects = {
  workspaceProjects: (workspaceId: string) =>
    createQueryOpts<ClockifyProject[]>(["erp", "workspaces", workspaceId, "projects"], () =>
      workspaceProjects({ data: { workspaceId } })
    )
}

export const workspaceClients = createServerFn({ method: "GET" })
  .inputValidator(WorkspaceIdParam)
  .handler(async ({ data }) =>
    backendGet<ClockifyClient[]>(`/workspaces/${data.workspaceId}/clients`)
  )

export const queriesClients = {
  workspaceClients: (workspaceId: string) =>
    createQueryOpts<ClockifyClient[]>(["erp", "workspaces", workspaceId, "clients"], () =>
      workspaceClients({ data: { workspaceId } })
    )
}

const UserTimeEntriesFilterSchema = z.object({
  workspaceId: z.string(),
  userId: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  projectId: z.string().optional()
})

export const userTimeEntries = createServerFn({ method: "GET" })
  .inputValidator(UserTimeEntriesFilterSchema)
  .handler(async ({ data }) =>
    backendGet<ClockifyTimeEntry[]>(`/workspaces/${data.workspaceId}/time-entries`, {
      userId: data.userId,
      startDate: data.startDate,
      endDate: data.endDate,
      projectId: data.projectId
    })
  )

export const workspaceTimeEntries = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      workspaceId: z.string(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      projectId: z.string().optional()
    })
  )
  .handler(async ({ data }) =>
    backendGet<ClockifyTimeEntry[]>(`/workspaces/${data.workspaceId}/time-entries`, {
      startDate: data.startDate,
      endDate: data.endDate,
      projectId: data.projectId
    })
  )

export const queriesTimeEntries = {
  workspaceTimeEntries: (
    workspaceId: string,
    filters?: { startDate?: string; endDate?: string; projectId?: string }
  ) =>
    createQueryOpts<ClockifyTimeEntry[]>(
      ["erp", "workspaces", workspaceId, "time-entries", JSON.stringify(filters ?? {})],
      () => workspaceTimeEntries({ data: { workspaceId, ...filters } })
    ),
  userTimeEntries: (
    workspaceId: string,
    userId: string,
    filters?: { startDate?: string; endDate?: string }
  ) =>
    createQueryOpts<ClockifyTimeEntry[]>(
      [
        "erp",
        "workspaces",
        workspaceId,
        "users",
        userId,
        "time-entries",
        JSON.stringify(filters ?? {})
      ],
      () => userTimeEntries({ data: { workspaceId, userId, ...filters } })
    )
}

export const workspaceInvoices = createServerFn({ method: "GET" })
  .inputValidator(WorkspaceIdParam)
  .handler(async ({ data }) =>
    backendGet<ClockifyInvoice[]>(`/workspaces/${data.workspaceId}/invoices`)
  )

export const queriesInvoices = {
  workspaceInvoices: (workspaceId: string) =>
    createQueryOpts<ClockifyInvoice[]>(["erp", "workspaces", workspaceId, "invoices"], () =>
      workspaceInvoices({ data: { workspaceId } })
    )
}

export const dashboardData = createServerFn({ method: "GET" })
  .inputValidator(WorkspaceIdParam)
  .handler(async ({ data }) =>
    backendGet<{
      users: ClockifyUser[]
      projects: ClockifyProject[]
      timeEntries: ClockifyTimeEntry[]
      invoices: ClockifyInvoice[]
    }>(`/workspaces/${data.workspaceId}/dashboard`)
  )

export const queriesDashboard = {
  dashboardData: (workspaceId: string) =>
    createQueryOpts<{
      users: ClockifyUser[]
      projects: ClockifyProject[]
      timeEntries: ClockifyTimeEntry[]
      invoices: ClockifyInvoice[]
    }>(["erp", "workspaces", workspaceId, "dashboard"], () =>
      dashboardData({ data: { workspaceId } })
    )
}

const ProjectIdParam = z.object({
  workspaceId: z.string(),
  projectId: z.string()
})

export const projectTasks = createServerFn({ method: "GET" })
  .inputValidator(ProjectIdParam)
  .handler(async ({ data }) =>
    backendGet<ClockifyTask[]>(`/workspaces/${data.workspaceId}/projects/${data.projectId}/tasks`)
  )

export const queriesTasks = {
  projectTasks: (workspaceId: string, projectId: string) =>
    createQueryOpts<ClockifyTask[]>(
      ["erp", "workspaces", workspaceId, "projects", projectId, "tasks"],
      () => projectTasks({ data: { workspaceId, projectId } })
    )
}
