import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import z from "zod"

import { requireEnv } from "#/env"

const clockifySyncUrl = requireEnv("CLOCKIFY_SYNC_URL")

const SyncClockifyWorkspaceSchema = z.object({
  workspaceId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional()
})

export interface DashboardSyncResult {
  workspaces: number
  users: number
  clients: number
  projects: number
  timeEntries: number
}

async function postSyncService(path: string, body: unknown): Promise<DashboardSyncResult> {
  const response = await fetch(`${clockifySyncUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Clockify sync service failed: ${response.status} ${text}`)
  }

  return response.json() as Promise<DashboardSyncResult>
}

export const syncClockifyWorkspace = createServerFn({ method: "POST" })
  .inputValidator(SyncClockifyWorkspaceSchema)
  .handler(async ({ data }): Promise<any> => {
    if (data.workspaceId) {
      return postSyncService("/sync", data)
    }

    return postSyncService("/sync-all", data)
  })

export function useSyncClockifyWorkspace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: z.infer<typeof SyncClockifyWorkspaceSchema>) =>
      syncClockifyWorkspace({ data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["erp"] })
    }
  })
}
