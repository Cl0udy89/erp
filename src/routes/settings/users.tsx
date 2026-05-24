import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { createServerFn } from "@tanstack/react-start"
import { UserPlus, RefreshCw, Shield } from "lucide-react"

import { backendGet, backendPost } from "#/lib/backend-client"
import { useAuth } from "#/lib/auth-context"
import { useTranslation } from "#/lib/i18n"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "#/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "#/components/ui/dialog"

export const Route = createFileRoute("/settings/users")({
  component: UsersSettingsPage
})

// ─── Server functions ──────────────────────────────────────────────────────

const listUsersFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { workspaceId: string })
  .handler(async ({ data }) =>
    backendGet<UserRow[]>("/users", { workspaceId: data.workspaceId })
  )

const createUserFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as CreateUserInput)
  .handler(async ({ data }) => backendPost<{ id: string; inviteUrl?: string }>("/users", data))

const updateRoleFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { userId: string; role: string })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .handler(async ({ data }): Promise<any> => backendPost(`/users/${data.userId}/role`, { role: data.role }))

const deactivateUserFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { userId: string })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .handler(async ({ data }): Promise<any> => backendPost(`/users/${data.userId}/deactivate`))

const activateUserFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { userId: string })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .handler(async ({ data }): Promise<any> => backendPost(`/users/${data.userId}/activate`))

const sendResetFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { email: string })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .handler(async ({ data }): Promise<any> => backendPost("/auth/forgot-password", data))

// ─── Types ──────────────────────────────────────────────────────────────────

interface UserRow {
  id: string
  workspace_id: string
  employee_id: string
  email: string
  role: string
  is_active: number | boolean
  last_login_at: string | null
  employee_name: string | null
}

interface CreateUserInput {
  workspaceId: string
  email: string
  role: string
  name: string
}

const ROLES = ["admin", "manager", "consultant", "accountant"] as const

// ─── Component ──────────────────────────────────────────────────────────────

function UsersSettingsPage() {
  const { user } = useAuth()
  const { t } = useTranslation()
  const qc = useQueryClient()
  const workspaceId = user?.workspaceId ?? ""

  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [newUserEmail, setNewUserEmail] = useState("")
  const [newUserName, setNewUserName] = useState("")
  const [newUserRole, setNewUserRole] = useState<string>("consultant")
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  const usersQuery = useQuery({
    queryKey: ["users", workspaceId],
    queryFn: () => listUsersFn({ data: { workspaceId } }),
    enabled: !!workspaceId
  })

  const createMutation = useMutation({
    mutationFn: (input: CreateUserInput) => createUserFn({ data: input }),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ["users", workspaceId] })
      if (result.inviteUrl) {
        setInviteLink(result.inviteUrl)
      } else {
        toast.success("User created and invite email sent.")
        setAddDialogOpen(false)
        setNewUserEmail("")
        setNewUserName("")
        setNewUserRole("consultant")
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to create user")
    }
  })

  const roleMutation = useMutation({
    mutationFn: (input: { userId: string; role: string }) => updateRoleFn({ data: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["users", workspaceId] })
      toast.success("Role updated")
    },
    onError: () => toast.error("Failed to update role")
  })

  const deactivateMutation = useMutation({
    mutationFn: (userId: string) => deactivateUserFn({ data: { userId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["users", workspaceId] })
      toast.success("User deactivated")
    }
  })

  const activateMutation = useMutation({
    mutationFn: (userId: string) => activateUserFn({ data: { userId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["users", workspaceId] })
      toast.success("User activated")
    }
  })

  const resetMutation = useMutation({
    mutationFn: (email: string) => sendResetFn({ data: { email } }),
    onSuccess: () => toast.success("Reset link sent (or logged to console if SMTP not configured)")
  })

  if (!user?.permissions?.includes("users.manage")) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <Shield className="text-muted-foreground mx-auto mb-2 size-12" />
          <p className="text-muted-foreground">You don't have permission to manage users.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t.settings.userManagement}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t.settings.manageDesc}
          </p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)}>
          <UserPlus className="mr-2 size-4" />
          Add user
        </Button>
      </div>

      {usersQuery.isLoading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <RefreshCw className="size-4 animate-spin" />
          Loading users...
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left font-medium">{t.common.name}</th>
                <th className="px-4 py-3 text-left font-medium">{t.people.email}</th>
                <th className="px-4 py-3 text-left font-medium">{t.settings.role}</th>
                <th className="px-4 py-3 text-left font-medium">{t.common.status}</th>
                <th className="px-4 py-3 text-left font-medium">{t.settings.lastLogin}</th>
                <th className="px-4 py-3 text-left font-medium">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody>
              {(usersQuery.data ?? []).map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{u.employee_name ?? u.email}</td>
                  <td className="text-muted-foreground px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">
                    <Select
                      value={u.role}
                      onValueChange={(role) =>
                        roleMutation.mutate({ userId: u.id, role })
                      }
                      disabled={u.id === user.id}
                    >
                      <SelectTrigger className="h-8 w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r.charAt(0).toUpperCase() + r.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.is_active
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {u.is_active ? t.people.active : t.people.inactive}
                    </span>
                  </td>
                  <td className="text-muted-foreground px-4 py-3 text-xs">
                    {u.last_login_at
                      ? new Date(u.last_login_at).toLocaleDateString()
                      : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => resetMutation.mutate(u.email)}
                        disabled={resetMutation.isPending}
                      >
                        {t.settings.resetPassword}
                      </Button>
                      {u.id !== user.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            u.is_active
                              ? deactivateMutation.mutate(u.id)
                              : activateMutation.mutate(u.id)
                          }
                        >
                          {u.is_active ? t.settings.deactivate : t.settings.activate}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add user dialog */}
      <Dialog
        open={addDialogOpen}
        onOpenChange={(open) => {
          setAddDialogOpen(open)
          if (!open) {
            setInviteLink(null)
            setNewUserEmail("")
            setNewUserName("")
            setNewUserRole("consultant")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.settings.addUser}</DialogTitle>
          </DialogHeader>
          {inviteLink ? (
            <div className="space-y-4">
              <p className="text-sm">
                {t.settings.inviteLink}
              </p>
              <div className="rounded-md bg-gray-100 p-3 font-mono text-xs break-all">
                {inviteLink}
              </div>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                createMutation.mutate({
                  workspaceId,
                  email: newUserEmail,
                  name: newUserName,
                  role: newUserRole
                })
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label className="text-sm font-medium">{t.settings.fullName}</label>
                <Input
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">{t.people.email}</label>
                <Input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">{t.settings.role}</label>
                <Select value={newUserRole} onValueChange={setNewUserRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r.charAt(0).toUpperCase() + r.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)}>
                  {t.action.cancel}
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? t.settings.creating : t.settings.createUser}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
