import z from "zod"

export const workspaceSearchSchema = z.object({
  workspaceId: z.string().optional().catch(undefined),
  tab: z.string().optional().catch(undefined)
})

export type WorkspaceSearch = z.infer<typeof workspaceSearchSchema>

export function getWorkspaceId(search: Record<string, unknown>): string | undefined {
  return typeof search.workspaceId === "string" ? search.workspaceId : undefined
}
