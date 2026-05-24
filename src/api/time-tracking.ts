import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import z from "zod"

import { backendDelete, backendGet, backendPost } from "#/lib/backend-client"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RunningTimer {
  id: string
  employeeId: string
  workspaceId: string
  projectId?: string
  clientId?: string
  description?: string
  startAt: string
  tags?: string[]
}

export interface TimeEntryFull {
  id: string
  employeeId: string
  workspaceId: string
  projectId?: string
  clientId?: string
  description?: string
  billable?: boolean
  startAt: string
  endAt?: string
  durationSeconds?: number
  tags?: string[]
  source?: string
  timesheetId?: string
  timesheetStatus?: string
}

export interface SummaryReportRow {
  groupId: string
  groupName: string
  groupColor?: string
  totalHours: number
  billableHours: number
  estimatedCost?: number
}

export interface DetailedReportEntry {
  id: string
  employeeId: string
  employeeName?: string
  projectId?: string
  projectName?: string
  taskName?: string
  description?: string
  billable?: boolean
  startAt: string
  endAt?: string
  durationSeconds?: number
  tags?: string[]
}

export interface WeeklyDayCell {
  hours: number
  seconds: number
  entryIds: string[]
}

export interface WeeklyRow {
  projectId?: string
  projectName?: string
  projectColor?: string
  taskName?: string
  timesheetId?: string
  timesheetStatus?: string
  cells: Record<string, WeeklyDayCell>
  totalHours: number
}

export interface WeeklyReport {
  weekStart: string
  weekEnd: string
  days: string[]
  rows: WeeklyRow[]
  totalByDay: Record<string, number>
  grandTotal: number
}

export interface Timesheet {
  id: string
  workspaceId: string
  employeeId: string
  periodStart: string
  periodEnd: string
  periodType?: string
  status: string
  submittedAt?: string
  approvedBy?: string | null
  approvedAt?: string
  rejectionNote?: string
}

export interface TaskSuggestion {
  taskName: string
  usedCount: number
}

// ─── Server Functions — Timer ────────────────────────────────────────────────

const RunningTimerInput = z.object({
  workspaceId: z.string(),
  employeeId: z.string()
})

export const getRunningTimer = createServerFn({ method: "GET" })
  .inputValidator(RunningTimerInput)
  .handler(async ({ data }) =>
    backendGet<RunningTimer | null>("/timer/running", {
      workspaceId: data.workspaceId,
      employeeId: data.employeeId
    })
  )

export const startTimerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ workspaceId: z.string(), employeeId: z.string() }))
  .handler(async ({ data }) =>
    backendPost<{ id: string; startAt: string }>("/timer/start", data)
  )

const StopTimerInput = z.object({
  workspaceId: z.string(),
  employeeId: z.string(),
  description: z.string().optional(),
  projectId: z.string().optional(),
  clientId: z.string().optional(),
  billable: z.boolean().optional(),
  tags: z.array(z.string()).optional()
})

export const stopTimerFn = createServerFn({ method: "POST" })
  .inputValidator(StopTimerInput)
  .handler(async ({ data }) =>
    backendPost<{ id: string; endAt: string; durationSeconds: number }>("/timer/stop", data)
  )

export const discardTimerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ workspaceId: z.string(), employeeId: z.string() }))
  .handler(async ({ data }) =>
    backendPost<{ success: boolean; discardedId: string }>("/timer/discard", data)
  )

// ─── Server Functions — Time Entries ─────────────────────────────────────────

const TimeEntriesFilterInput = z.object({
  workspaceId: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  employeeId: z.string().optional(),
  projectId: z.string().optional(),
  source: z.string().optional(),
  page: z.number().optional(),
  limit: z.number().optional()
})

export const getTimeEntriesFn = createServerFn({ method: "GET" })
  .inputValidator(TimeEntriesFilterInput)
  .handler(async ({ data }) =>
    backendGet<{ entries: TimeEntryFull[]; total: number }>("/time-entries", {
      workspaceId: data.workspaceId,
      from: data.from,
      to: data.to,
      employeeId: data.employeeId,
      projectId: data.projectId,
      source: data.source,
      page: data.page,
      limit: data.limit
    })
  )

const CreateManualEntryInput = z.object({
  workspaceId: z.string(),
  employeeId: z.string(),
  projectId: z.string().optional(),
  clientId: z.string().optional(),
  description: z.string(),
  billable: z.boolean().optional(),
  startAt: z.string(),
  endAt: z.string(),
  tags: z.array(z.string()).optional(),
  timesheetId: z.string().optional()
})

export const createManualEntryFn = createServerFn({ method: "POST" })
  .inputValidator(CreateManualEntryInput)
  .handler(async ({ data }) =>
    backendPost<{ id: string; durationSeconds: number }>("/time-entries/manual", data)
  )

const UpdateManualEntryInput = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string().optional(),
  clientId: z.string().optional(),
  description: z.string().optional(),
  billable: z.boolean().optional(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  tags: z.array(z.string()).optional()
})

export const updateManualEntryFn = createServerFn({ method: "POST" })
  .inputValidator(UpdateManualEntryInput)
  .handler(async ({ data }) => {
    const { id, ...body } = data
    return backendPost<{ id: string }>(`/time-entries/${id}/manual-update`, body)
  })

const DeleteTimeEntryInput = z.object({
  id: z.string(),
  workspaceId: z.string()
})

export const deleteTimeEntryFn = createServerFn({ method: "POST" })
  .inputValidator(DeleteTimeEntryInput)
  .handler(async ({ data }) =>
    backendDelete<{ success: boolean }>(`/time-entries/${data.id}`, {
      workspaceId: data.workspaceId
    })
  )

const TaskSuggestionsInput = z.object({
  employeeId: z.string(),
  projectId: z.string().optional(),
  q: z.string().optional()
})

export const getTaskSuggestionsFn = createServerFn({ method: "GET" })
  .inputValidator(TaskSuggestionsInput)
  .handler(async ({ data }) =>
    backendGet<TaskSuggestion[]>("/time-entries/suggestions", {
      employeeId: data.employeeId,
      projectId: data.projectId,
      q: data.q
    })
  )

// ─── Server Functions — Reports ───────────────────────────────────────────────

const SummaryReportInput = z.object({
  workspaceId: z.string(),
  from: z.string(),
  to: z.string(),
  groupBy: z.enum(["project", "employee", "client"])
})

export const getTimeSummaryReportFn = createServerFn({ method: "GET" })
  .inputValidator(SummaryReportInput)
  .handler(async ({ data }) =>
    backendGet<SummaryReportRow[]>("/time-entries/reports/summary", {
      workspaceId: data.workspaceId,
      from: data.from,
      to: data.to,
      groupBy: data.groupBy
    })
  )

const DetailedReportInput = z.object({
  workspaceId: z.string(),
  from: z.string(),
  to: z.string(),
  employeeId: z.string().optional(),
  projectId: z.string().optional(),
  sortBy: z.enum(["date", "duration"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional()
})

export const getTimeDetailedReportFn = createServerFn({ method: "GET" })
  .inputValidator(DetailedReportInput)
  .handler(async ({ data }) =>
    backendGet<{ entries: DetailedReportEntry[]; total: number }>(
      "/time-entries/reports/detailed",
      {
        workspaceId: data.workspaceId,
        from: data.from,
        to: data.to,
        employeeId: data.employeeId,
        projectId: data.projectId,
        sortBy: data.sortBy,
        sortDir: data.sortDir
      }
    )
  )

const WeeklyReportInput = z.object({
  workspaceId: z.string(),
  employeeId: z.string(),
  weekStart: z.string()
})

export const getTimeWeeklyReportFn = createServerFn({ method: "GET" })
  .inputValidator(WeeklyReportInput)
  .handler(async ({ data }) =>
    backendGet<WeeklyReport>("/time-entries/reports/weekly", {
      workspaceId: data.workspaceId,
      employeeId: data.employeeId,
      weekStart: data.weekStart
    })
  )

// ─── Server Functions — Timesheets ────────────────────────────────────────────

const TimesheetsInput = z.object({
  workspaceId: z.string(),
  employeeId: z.string(),
  status: z.string().optional()
})

export const getTimesheetsFn = createServerFn({ method: "GET" })
  .inputValidator(TimesheetsInput)
  .handler(async ({ data }) =>
    backendGet<Timesheet[]>("/timesheets", {
      workspaceId: data.workspaceId,
      employeeId: data.employeeId,
      status: data.status
    })
  )

const CreateTimesheetInput = z.object({
  workspaceId: z.string(),
  employeeId: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  periodType: z.string().optional()
})

export const createTimesheetFn = createServerFn({ method: "POST" })
  .inputValidator(CreateTimesheetInput)
  .handler(async ({ data }) => backendPost<{ id: string }>("/timesheets", data))

const TimesheetActionInput = z.object({
  id: z.string(),
  workspaceId: z.string()
})

export const submitTimesheetFn = createServerFn({ method: "POST" })
  .inputValidator(TimesheetActionInput)
  .handler(async ({ data }) =>
    backendPost<{ id: string; status: string }>(`/timesheets/${data.id}/submit`, {
      workspaceId: data.workspaceId
    })
  )

const ApproveTimesheetInput = z.object({
  id: z.string(),
  workspaceId: z.string(),
  approvedBy: z.string()
})

export const approveTimesheetFn = createServerFn({ method: "POST" })
  .inputValidator(ApproveTimesheetInput)
  .handler(async ({ data }) =>
    backendPost<{ id: string; status: string }>(`/timesheets/${data.id}/approve`, {
      workspaceId: data.workspaceId,
      approvedBy: data.approvedBy
    })
  )

const RejectTimesheetInput = z.object({
  id: z.string(),
  workspaceId: z.string(),
  rejectionNote: z.string()
})

export const rejectTimesheetFn = createServerFn({ method: "POST" })
  .inputValidator(RejectTimesheetInput)
  .handler(async ({ data }) =>
    backendPost<{ id: string; status: string }>(`/timesheets/${data.id}/reject`, {
      workspaceId: data.workspaceId,
      rejectionNote: data.rejectionNote
    })
  )

// ─── React Query Hooks ────────────────────────────────────────────────────────

export function useRunningTimer(workspaceId: string | undefined, employeeId: string | undefined) {
  return useQuery({
    queryKey: ["timer", "running", workspaceId, employeeId],
    queryFn: () =>
      getRunningTimer({ data: { workspaceId: workspaceId!, employeeId: employeeId! } }),
    enabled: !!workspaceId && !!employeeId,
    refetchInterval: 30000
  })
}

export function useStartTimer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { workspaceId: string; employeeId: string }) =>
      startTimerFn({ data }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["timer", "running", variables.workspaceId, variables.employeeId]
      })
    }
  })
}

export function useStopTimer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: z.infer<typeof StopTimerInput>) => stopTimerFn({ data }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["timer", "running", variables.workspaceId, variables.employeeId]
      })
      void queryClient.invalidateQueries({ queryKey: ["time-entries"] })
    }
  })
}

export function useDiscardTimer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { workspaceId: string; employeeId: string }) =>
      discardTimerFn({ data }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["timer", "running", variables.workspaceId, variables.employeeId]
      })
    }
  })
}

export function useTimeEntries(
  workspaceId: string | undefined,
  filters?: {
    from?: string
    to?: string
    employeeId?: string
    projectId?: string
    source?: string
    page?: number
    limit?: number
  }
) {
  return useQuery({
    queryKey: ["time-entries", workspaceId, filters],
    queryFn: () =>
      getTimeEntriesFn({ data: { workspaceId: workspaceId!, ...filters } }),
    enabled: !!workspaceId
  })
}

export function useCreateManualEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: z.infer<typeof CreateManualEntryInput>) =>
      createManualEntryFn({ data }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["time-entries", variables.workspaceId] })
    }
  })
}

export function useUpdateManualEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: z.infer<typeof UpdateManualEntryInput>) =>
      updateManualEntryFn({ data }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["time-entries", variables.workspaceId] })
    }
  })
}

export function useDeleteTimeEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { id: string; workspaceId: string }) =>
      deleteTimeEntryFn({ data }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["time-entries", variables.workspaceId] })
    }
  })
}

export function useTaskSuggestions(
  employeeId: string | undefined,
  projectId: string | undefined,
  q: string
) {
  return useQuery({
    queryKey: ["task-suggestions", employeeId, projectId, q],
    queryFn: () =>
      getTaskSuggestionsFn({ data: { employeeId: employeeId!, projectId, q } }),
    enabled: !!employeeId && q.length >= 1,
    staleTime: 60000
  })
}

export function useTimeSummaryReport(
  workspaceId: string | undefined,
  from: string,
  to: string,
  groupBy: "project" | "employee" | "client"
) {
  return useQuery({
    queryKey: ["reports", "summary", workspaceId, from, to, groupBy],
    queryFn: () =>
      getTimeSummaryReportFn({ data: { workspaceId: workspaceId!, from, to, groupBy } }),
    enabled: !!workspaceId && !!from && !!to
  })
}

export function useTimeDetailedReport(
  workspaceId: string | undefined,
  from: string,
  to: string,
  filters?: {
    employeeId?: string
    projectId?: string
    sortBy?: "date" | "duration"
    sortDir?: "asc" | "desc"
  }
) {
  return useQuery({
    queryKey: ["reports", "detailed", workspaceId, from, to, filters],
    queryFn: () =>
      getTimeDetailedReportFn({
        data: { workspaceId: workspaceId!, from, to, ...filters }
      }),
    enabled: !!workspaceId && !!from && !!to
  })
}

export function useTimeWeeklyReport(
  workspaceId: string | undefined,
  employeeId: string | undefined,
  weekStart: string
) {
  return useQuery({
    queryKey: ["reports", "weekly", workspaceId, employeeId, weekStart],
    queryFn: () =>
      getTimeWeeklyReportFn({
        data: { workspaceId: workspaceId!, employeeId: employeeId!, weekStart }
      }),
    enabled: !!workspaceId && !!employeeId && !!weekStart
  })
}

export function useTimesheets(
  workspaceId: string | undefined,
  employeeId: string | undefined,
  status?: string
) {
  return useQuery({
    queryKey: ["timesheets", workspaceId, employeeId, status],
    queryFn: () =>
      getTimesheetsFn({ data: { workspaceId: workspaceId!, employeeId: employeeId!, status } }),
    enabled: !!workspaceId && !!employeeId
  })
}

export function useCreateTimesheet() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: z.infer<typeof CreateTimesheetInput>) =>
      createTimesheetFn({ data }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["timesheets", variables.workspaceId, variables.employeeId]
      })
    }
  })
}

export function useSubmitTimesheet() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { id: string; workspaceId: string; employeeId: string }) =>
      submitTimesheetFn({ data: { id: data.id, workspaceId: data.workspaceId } }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["timesheets", variables.workspaceId, variables.employeeId]
      })
    }
  })
}

export function useApproveTimesheet() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { id: string; workspaceId: string; approvedBy: string; employeeId: string }) =>
      approveTimesheetFn({
        data: { id: data.id, workspaceId: data.workspaceId, approvedBy: data.approvedBy }
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["timesheets", variables.workspaceId, variables.employeeId]
      })
      void queryClient.invalidateQueries({
        queryKey: ["timesheets", "manager", variables.workspaceId]
      })
    }
  })
}

export function useRejectTimesheet() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      id: string
      workspaceId: string
      rejectionNote: string
      employeeId: string
    }) =>
      rejectTimesheetFn({
        data: {
          id: data.id,
          workspaceId: data.workspaceId,
          rejectionNote: data.rejectionNote
        }
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["timesheets", variables.workspaceId, variables.employeeId]
      })
      void queryClient.invalidateQueries({
        queryKey: ["timesheets", "manager", variables.workspaceId]
      })
    }
  })
}

// ─── Manager timesheets ───────────────────────────────────────────────────────

const ManagerTimesheetsInput = z.object({
  workspaceId: z.string(),
  status: z.string().optional()
})

export const getManagerTimesheetsFn = createServerFn({ method: "GET" })
  .inputValidator(ManagerTimesheetsInput)
  .handler(async ({ data }) =>
    backendGet<Timesheet[]>("/timesheets", {
      workspaceId: data.workspaceId,
      status: data.status
    })
  )

export function useManagerTimesheets(workspaceId: string | undefined, status?: string) {
  return useQuery({
    queryKey: ["timesheets", "manager", workspaceId, status],
    queryFn: () =>
      getManagerTimesheetsFn({ data: { workspaceId: workspaceId!, status } }),
    enabled: !!workspaceId
  })
}

// ─── Timesheet templates ──────────────────────────────────────────────────────

export interface TimesheetTemplate {
  id: string
  workspaceId: string
  employeeId: string
  name: string
  templateData: unknown
  createdAt?: string
}

const TimesheetTemplatesInput = z.object({
  workspaceId: z.string(),
  employeeId: z.string().optional()
})

export const getTimesheetTemplatesFn = createServerFn({ method: "GET" })
  .inputValidator(TimesheetTemplatesInput)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .handler(async ({ data }): Promise<any> =>
    backendGet<TimesheetTemplate[]>("/timesheet-templates", {
      workspaceId: data.workspaceId,
      employeeId: data.employeeId
    })
  )

const CreateTemplateInput = z.object({
  workspaceId: z.string(),
  employeeId: z.string(),
  name: z.string(),
  templateData: z.unknown()
})

export const createTimesheetTemplateFn = createServerFn({ method: "POST" })
  .inputValidator(CreateTemplateInput)
  .handler(async ({ data }) =>
    backendPost<{ id: string }>("/timesheet-templates", data)
  )

const DeleteTemplateInput = z.object({
  id: z.string(),
  workspaceId: z.string()
})

export const deleteTimesheetTemplateFn = createServerFn({ method: "POST" })
  .inputValidator(DeleteTemplateInput)
  .handler(async ({ data }) =>
    backendPost<{ success: boolean }>(`/timesheet-templates/${data.id}/delete`, {
      workspaceId: data.workspaceId
    })
  )

export function useTimesheetTemplates(workspaceId: string | undefined, employeeId?: string) {
  return useQuery({
    queryKey: ["timesheet-templates", workspaceId, employeeId],
    queryFn: () =>
      getTimesheetTemplatesFn({ data: { workspaceId: workspaceId!, employeeId } }),
    enabled: !!workspaceId
  })
}

export function useCreateTimesheetTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { workspaceId: string; employeeId: string; name: string; templateData: unknown }) =>
      createTimesheetTemplateFn({ data }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["timesheet-templates", variables.workspaceId, variables.employeeId]
      })
    }
  })
}

export function useDeleteTimesheetTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { id: string; workspaceId: string; employeeId?: string }) =>
      deleteTimesheetTemplateFn({ data: { id: data.id, workspaceId: data.workspaceId } }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["timesheet-templates", variables.workspaceId]
      })
    }
  })
}

// ─── Employee profiles — Phase 1A ─────────────────────────────────────────────

export interface EmployeeProfile {
  id: string
  name: string
  email: string
  status?: string | null
  profilePicture?: string | null
  hourlyRate?: number | null
  dateOfBirth?: string | null
  contractType?: string | null
  contractNumber?: string | null
  contractDate?: string | null
  contractDocumentId?: string | null
  supervisorId?: string | null
  firstCollaborationDate?: string | null
  position?: string | null
  manualAvatarOverride?: boolean
}

const EmployeeProfileInput = z.object({ employeeId: z.string() })

export const getEmployeeProfileFn = createServerFn({ method: "GET" })
  .inputValidator(EmployeeProfileInput)
  .handler(async ({ data }) =>
    backendGet<EmployeeProfile>(`/employees/${data.employeeId}/profile`, {})
  )

const UpdateEmployeeProfileInput = z.object({
  employeeId: z.string(),
  name: z.string().optional(),
  email: z.string().optional(),
  dateOfBirth: z.string().nullish(),
  contractType: z.string().nullish(),
  contractNumber: z.string().nullish(),
  contractDate: z.string().nullish(),
  supervisorId: z.string().nullish(),
  firstCollaborationDate: z.string().nullish(),
  position: z.string().nullish(),
  hourlyRate: z.number().nullish()
})

export const updateEmployeeProfileFn = createServerFn({ method: "POST" })
  .inputValidator(UpdateEmployeeProfileInput)
  .handler(async ({ data }) => {
    const { employeeId, ...body } = data
    return backendPost<{ success: boolean }>(`/employees/${employeeId}/profile`, body)
  })

export function useEmployeeProfile(employeeId: string | undefined) {
  return useQuery({
    queryKey: ["employee-profile", employeeId],
    queryFn: () => getEmployeeProfileFn({ data: { employeeId: employeeId! } }),
    enabled: !!employeeId
  })
}

export function useUpdateEmployeeProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: z.infer<typeof UpdateEmployeeProfileInput>) =>
      updateEmployeeProfileFn({ data }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["employee-profile", variables.employeeId] })
    }
  })
}

const resetAvatarFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ employeeId: z.string() }))
  .handler(async ({ data }) =>
    backendPost<{ ok: boolean }>(`/employees/${data.employeeId}/reset-avatar`, {})
  )

export function useResetEmployeeAvatar() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (employeeId: string) => resetAvatarFn({ data: { employeeId } }),
    onSuccess: (_data, employeeId) => {
      void queryClient.invalidateQueries({ queryKey: ["employee-profile", employeeId] })
    }
  })
}

// ─── Employee projects ────────────────────────────────────────────────────────

export interface EmployeeProject {
  projectId: string
  projectName: string
  clientName: string | null
  billingType: string | null
  status: "active" | "archived"
  assignedSince: string | null
}

const getEmployeeProjectsFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ employeeId: z.string(), workspaceId: z.string() }))
  .handler(async ({ data }) =>
    backendGet<{ projects: EmployeeProject[] }>(
      `/employees/${data.employeeId}/projects`,
      { workspaceId: data.workspaceId }
    )
  )

export function useEmployeeProjects(
  employeeId: string | undefined,
  workspaceId: string | undefined,
  enabled = true
) {
  return useQuery({
    queryKey: ["employee-projects", employeeId, workspaceId],
    queryFn: () => getEmployeeProjectsFn({ data: { employeeId: employeeId!, workspaceId: workspaceId! } }),
    enabled: !!employeeId && !!workspaceId && enabled
  })
}

// ─── Client profiles — Phase 1B ───────────────────────────────────────────────

export interface ClientProfile {
  id: string
  name: string
  email?: string | null
  archived?: boolean
  nip?: string | null
  address?: string | null
  cooperationType?: string | null
  notes?: string | null
}

export const getClientProfileFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ clientId: z.string() }))
  .handler(async ({ data }) =>
    backendGet<ClientProfile>(`/clients/${data.clientId}/profile`, {})
  )

export const updateClientProfileFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    clientId: z.string(),
    name: z.string().optional(),
    email: z.string().nullish(),
    nip: z.string().nullish(),
    address: z.string().nullish(),
    cooperationType: z.string().nullish(),
    notes: z.string().nullish()
  }))
  .handler(async ({ data }) => {
    const { clientId, ...body } = data
    return backendPost<{ success: boolean }>(`/clients/${clientId}/profile`, body)
  })

export function useClientProfile(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client-profile", clientId],
    queryFn: () => getClientProfileFn({ data: { clientId: clientId! } }),
    enabled: !!clientId
  })
}

export function useUpdateClientProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { clientId: string; name?: string; email?: string | null; nip?: string | null; address?: string | null; cooperationType?: string | null; notes?: string | null }) =>
      updateClientProfileFn({ data }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["client-profile", variables.clientId] })
    }
  })
}
