import z from "zod"

export const ClockifyWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  imageUrl: z.string().nullable().optional(),
  featureSubscriptionType: z.string().nullable().optional(),
  hourlyRate: z
    .object({
      amount: z.number().nullable().optional(),
      currency: z.string().nullable().optional()
    })
    .nullable()
    .optional(),
  costRate: z
    .object({
      amount: z.number().nullable().optional(),
      currency: z.string().nullable().optional()
    })
    .nullable()
    .optional(),
  memberships: z.array(z.any()).nullable().optional()
})

export type ClockifyWorkspace = z.infer<typeof ClockifyWorkspaceSchema>

export const ClockifyUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  profilePicture: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  defaultWorkspace: z.string().nullable().optional(),
  activeWorkspace: z.string().nullable().optional(),
  memberships: z.array(z.any()).nullable().optional(),
  settings: z.record(z.string(), z.any()).nullable().optional()
})

export type ClockifyUser = z.infer<typeof ClockifyUserSchema>

export const ClockifyClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspaceId: z.string(),
  address: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  archived: z.boolean().nullable().optional(),
  email: z.string().nullable().optional(),
  ccEmails: z.array(z.string()).nullable().optional(),
  currencyId: z.string().nullable().optional()
})

export type ClockifyClient = z.infer<typeof ClockifyClientSchema>

export const ClockifyProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspaceId: z.string(),
  clientId: z.string().nullable().optional(),
  clientName: z.string().nullable().optional(),
  billable: z.boolean().nullable().optional(),
  color: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  public: z.boolean().nullable().optional(),
  archived: z.boolean().nullable().optional(),
  duration: z.string().nullable().optional(),
  estimate: z
    .object({
      estimate: z.string().nullable().optional(),
      type: z.string().nullable().optional()
    })
    .nullable()
    .optional(),
  memberships: z.array(z.any()).nullable().optional()
})

export type ClockifyProject = z.infer<typeof ClockifyProjectSchema>

export const ClockifyTimeIntervalSchema = z.object({
  start: z.string(),
  end: z.string().nullable().optional(),
  duration: z.union([z.string(), z.number()]).nullable().optional()
})

export type ClockifyTimeInterval = z.infer<typeof ClockifyTimeIntervalSchema>

export function getIntervalDurationMs(interval: ClockifyTimeInterval): number | undefined {
  const start = interval.start
  const end = interval.end
  if (!start) return undefined
  const startMs = new Date(start).getTime()
  const endMs = end ? new Date(end).getTime() : Date.now()
  return endMs - startMs
}

export const ClockifyTimeEntrySchema = z.object({
  id: z.string(),
  description: z.string(),
  projectId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  userId: z.string(),
  workspaceId: z.string().nullable().optional(),
  billable: z.boolean().nullable().optional(),
  tagIds: z.array(z.string()).nullable().optional(),
  isLocked: z.boolean().nullable().optional(),
  type: z.string().nullable().optional(),
  customFieldValues: z.array(z.any()).nullable().optional(),
  timeInterval: ClockifyTimeIntervalSchema
})

export type ClockifyTimeEntry = z.infer<typeof ClockifyTimeEntrySchema>

export const ClockifyInvoiceSchema = z.object({
  id: z.string(),
  number: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  amount: z.number().nullable().optional(),
  paid: z.number().nullable().optional(),
  balance: z.number().nullable().optional(),
  status: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  clientName: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  issuedDate: z.string().nullable().optional()
})

export type ClockifyInvoice = z.infer<typeof ClockifyInvoiceSchema>

export const ClockifyTaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string(),
  assigneeIds: z.array(z.string()).nullable().optional(),
  estimate: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  billable: z.boolean().nullable().optional()
})

export type ClockifyTask = z.infer<typeof ClockifyTaskSchema>
