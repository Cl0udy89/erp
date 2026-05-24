import { createFileRoute } from "@tanstack/react-router"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { createServerFn } from "@tanstack/react-start"
import { RotateCcw, Shield } from "lucide-react"

import { backendGet, backendPost } from "#/lib/backend-client"
import { useAuth } from "#/lib/auth-context"
import { Button } from "#/components/ui/button"

export const Route = createFileRoute("/settings/permissions")({
  component: PermissionsPage
})

// ─── Server functions ──────────────────────────────────────────────────────

const listPermissionsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { workspaceId: string })
  .handler(async ({ data }) =>
    backendGet<PermissionRow[]>("/permissions", { workspaceId: data.workspaceId })
  )

const updatePermissionFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as PermUpdateInput)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .handler(async ({ data }): Promise<any> => backendPost("/permissions", data))

const resetPermissionsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { workspaceId: string })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .handler(async ({ data }): Promise<any> => backendPost("/permissions/reset", data))

// ─── Types ──────────────────────────────────────────────────────────────────

interface PermissionRow {
  id: string
  workspace_id: string
  role: string
  permission: string
  granted: number | boolean
}

interface PermUpdateInput {
  workspaceId: string
  role: string
  permission: string
  granted: boolean
}

const ROLES = ["admin", "manager", "consultant", "accountant"] as const
type Role = (typeof ROLES)[number]

const PERMISSION_GROUPS: Record<string, string[]> = {
  "Dashboard": ["dashboard.view"],
  "Time entries": [
    "time_entries.create_own",
    "time_entries.edit_own",
    "time_entries.delete_own",
    "time_entries.read_all",
    "time_entries.edit_others"
  ],
  "Timesheets": ["timesheets.submit", "timesheets.approve"],
  "Employees": [
    "employees.view_own",
    "employees.edit_own",
    "employees.view_all",
    "employees.edit_all",
    "employees.view_internal_rate"
  ],
  "Clients": ["clients.view", "clients.edit"],
  "Reports": ["reports.view", "reports.export"],
  "Documents": ["documents.view", "documents.upload"],
  "Inventory": ["inventory.view", "inventory.edit"],
  "Administration": ["users.manage", "rbac.manage"]
}

// ─── Component ──────────────────────────────────────────────────────────────

function PermissionsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const workspaceId = user?.workspaceId ?? ""

  const permsQuery = useQuery({
    queryKey: ["permissions", workspaceId],
    queryFn: () => listPermissionsFn({ data: { workspaceId } }),
    enabled: !!workspaceId
  })

  const updateMutation = useMutation({
    mutationFn: (input: PermUpdateInput) => updatePermissionFn({ data: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["permissions", workspaceId] }),
    onError: () => toast.error("Failed to update permission")
  })

  const resetMutation = useMutation({
    mutationFn: () => resetPermissionsFn({ data: { workspaceId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["permissions", workspaceId] })
      toast.success("Permissions reset to defaults")
    },
    onError: () => toast.error("Failed to reset permissions")
  })

  if (!user?.permissions?.includes("rbac.manage")) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <Shield className="text-muted-foreground mx-auto mb-2 size-12" />
          <p className="text-muted-foreground">You don't have permission to manage RBAC.</p>
        </div>
      </div>
    )
  }

  // Build a lookup: permission+role -> granted
  const permLookup = new Map<string, boolean>()
  for (const row of permsQuery.data ?? []) {
    permLookup.set(`${row.permission}:${row.role}`, Boolean(row.granted))
  }

  function isGranted(permission: string, role: Role): boolean {
    return permLookup.get(`${permission}:${role}`) ?? false
  }

  function toggle(permission: string, role: Role, currentValue: boolean) {
    updateMutation.mutate({
      workspaceId,
      role,
      permission,
      granted: !currentValue
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Role Permissions</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Configure which roles can access each feature.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => resetMutation.mutate()}
          disabled={resetMutation.isPending}
        >
          <RotateCcw className="mr-2 size-4" />
          Reset to defaults
        </Button>
      </div>

      {permsQuery.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading permissions...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Permission</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-4 py-3 text-center font-medium capitalize">
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(PERMISSION_GROUPS).map(([group, permissions]) => (
                <>
                  <tr key={`group-${group}`} className="bg-muted/30">
                    <td colSpan={5} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group}
                    </td>
                  </tr>
                  {permissions.map((perm) => (
                    <tr key={perm} className="border-t">
                      <td className="text-muted-foreground px-4 py-2.5 font-mono text-xs">
                        {perm}
                      </td>
                      {ROLES.map((role) => {
                        const granted = isGranted(perm, role)
                        return (
                          <td key={role} className="px-4 py-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => toggle(perm, role, granted)}
                              disabled={updateMutation.isPending}
                              className={`inline-flex size-6 items-center justify-center rounded transition-colors ${
                                granted
                                  ? "bg-green-500 text-white hover:bg-green-600 dark:bg-green-700 dark:hover:bg-green-600"
                                  : "bg-gray-200 text-gray-500 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600"
                              }`}
                              title={granted ? "Revoke" : "Grant"}
                            >
                              {granted ? "✓" : "✗"}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
