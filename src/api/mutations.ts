import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import z from "zod"

import { backendPost } from "#/lib/backend-client"
import type { ClockifyProject, ClockifyTimeEntry } from "#/lib/clockify-schemas"

const CreateProjectSchema = z.object({
  workspaceId: z.string(),
  name: z.string().min(1),
  clientId: z.string().optional(),
  billable: z.boolean().optional(),
  color: z.string().optional(),
  note: z.string().optional(),
  billingType: z.enum(["hourly", "fixed", "subscription"]).optional(),
  billingRate: z.number().optional(),
  fixedAmount: z.number().optional(),
  subscriptionMinHours: z.number().optional(),
  subscriptionOverageRate: z.number().optional()
})

export const createProject = createServerFn({ method: "POST" })
  .inputValidator(CreateProjectSchema)
  .handler(async ({ data }) => backendPost<ClockifyProject>("/projects", data))

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: z.infer<typeof CreateProjectSchema>) => createProject({ data }),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["erp", "workspaces", variables.workspaceId, "projects"]
      })
    }
  })
}

const CreateTimeEntrySchema = z.object({
  workspaceId: z.string(),
  userId: z.string(),
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  start: z.string(),
  end: z.string(),
  description: z.string(),
  billable: z.boolean().optional()
})

export const createTimeEntry = createServerFn({ method: "POST" })
  .inputValidator(CreateTimeEntrySchema)
  .handler(async ({ data }) => backendPost<ClockifyTimeEntry>("/time-entries", data))

export function useCreateTimeEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: z.infer<typeof CreateTimeEntrySchema>) => createTimeEntry({ data }),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["erp", "workspaces", variables.workspaceId, "time-entries"]
      })
    }
  })
}

const UpdateTimeEntrySchema = z.object({
  workspaceId: z.string(),
  entryId: z.string(),
  description: z.string().optional(),
  projectId: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  billable: z.boolean().optional()
})

export const updateTimeEntry = createServerFn({ method: "POST" })
  .inputValidator(UpdateTimeEntrySchema)
  .handler(async ({ data }) =>
    backendPost<ClockifyTimeEntry>(`/time-entries/${data.entryId}/update`, data)
  )

export function useUpdateTimeEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: z.infer<typeof UpdateTimeEntrySchema>) => updateTimeEntry({ data }),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["erp", "workspaces", variables.workspaceId, "time-entries"]
      })
    }
  })
}

const DeleteTimeEntrySchema = z.object({
  workspaceId: z.string(),
  entryId: z.string()
})

export const deleteTimeEntry = createServerFn({ method: "POST" })
  .inputValidator(DeleteTimeEntrySchema)
  .handler(async ({ data }) =>
    backendPost<{ success: boolean; entryId: string }>(`/time-entries/${data.entryId}/delete`, data)
  )

export function useDeleteTimeEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: z.infer<typeof DeleteTimeEntrySchema>) => deleteTimeEntry({ data }),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["erp", "workspaces", variables.workspaceId, "time-entries"]
      })
    }
  })
}

const CreateInvoiceSchema = z.object({
  workspaceId: z.string(),
  clientId: z.string(),
  number: z.string(),
  currency: z.string(),
  date: z.string(),
  note: z.string().optional()
})

export const createInvoice = createServerFn({ method: "POST" })
  .inputValidator(CreateInvoiceSchema)
  .handler(() => {
    throw new Error("Invoices are not stored in the local ERP database yet")
  })

export function useCreateInvoice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: z.infer<typeof CreateInvoiceSchema>) => createInvoice({ data }),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["erp", "workspaces", variables.workspaceId, "invoices"]
      })
    }
  })
}

const ImportToInvoiceSchema = z.object({
  workspaceId: z.string(),
  invoiceId: z.string(),
  timeEntryIds: z.array(z.string())
})

export const importTimeEntriesToInvoice = createServerFn({ method: "POST" })
  .inputValidator(ImportToInvoiceSchema)
  .handler(() => {
    throw new Error("Invoice imports are not stored in the local ERP database yet")
  })

export function useImportTimeEntriesToInvoice() {
  return useMutation({
    mutationFn: (data: z.infer<typeof ImportToInvoiceSchema>) =>
      importTimeEntriesToInvoice({ data })
  })
}
