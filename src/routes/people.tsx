import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Users, RefreshCw } from "lucide-react"
import { useState, useEffect } from "react"
import { toast } from "sonner"

import { useTranslation } from "#/lib/i18n"
import { EmptyState } from "#/components/empty-state"

import { useEntityAudit, type AuditListResponse } from "#/api/audit"
import { financeQueries, useUpdateEmployeeHourlyRate } from "#/api/finance"
import { queriesUsers, queriesTimeEntries } from "#/api/queries"
import {
  useEmployeeProfile,
  useUpdateEmployeeProfile,
  useResetEmployeeAvatar,
  useEmployeeProjects,
  type EmployeeProfile
} from "#/api/time-tracking"
import { EntityActivityLog } from "#/components/EntityActivityLog"
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "#/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "#/components/ui/dialog"
import { Input } from "#/components/ui/input"
import { Progress } from "#/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "#/components/ui/select"
import { Skeleton } from "#/components/ui/skeleton"
import { Separator } from "#/components/ui/separator"
import { getIntervalDurationMs } from "#/lib/clockify-schemas"
import { getWorkspaceId, workspaceSearchSchema } from "#/lib/search-schema"
import { formatDuration } from "#/lib/utils"

function formatCostPLN(amount: number): string {
  return (
    new Intl.NumberFormat("pl-PL", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount) + " zł"
  )
}

export const Route = createFileRoute("/people")({
  loader: async ({ context, location }) => {
    const workspaceId = getWorkspaceId(location.search)
    if (workspaceId) {
      await context.queryClient.prefetchQuery({ ...queriesUsers.workspaceUsers(workspaceId) })
      await context.queryClient.prefetchQuery({
        ...queriesTimeEntries.workspaceTimeEntries(workspaceId)
      })
    }
  },
  validateSearch: workspaceSearchSchema,
  component: PeoplePage
})

// ─── Profile Dialog ───────────────────────────────────────────────────────────

function ProfileDialog({
  employeeId,
  open,
  onClose,
  allUsers,
  workspaceId
}: {
  employeeId: string | null
  open: boolean
  onClose: () => void
  allUsers: import("#/lib/clockify-schemas").ClockifyUser[] | undefined
  workspaceId: string | undefined
}) {
  const { t } = useTranslation()
  const { data: profile, isLoading } = useEmployeeProfile(employeeId ?? undefined)
  const { data: _rawActivityData } = useEntityAudit(workspaceId, "employee", employeeId ?? undefined)
  const activityData = _rawActivityData as AuditListResponse | undefined
  const { data: projectsData, isLoading: projectsLoading } = useEmployeeProjects(employeeId ?? undefined, workspaceId, open)
  const updateProfile = useUpdateEmployeeProfile()
  const resetAvatar = useResetEmployeeAvatar()

  const [form, setForm] = useState<Partial<EmployeeProfile>>({})
  const [editing, setEditing] = useState(false)
  const [docUploaderOpen, setDocUploaderOpen] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Sync form when profile loads
  const displayProfile = editing ? { ...profile, ...form } : profile

  useEffect(() => {
    if (!editing) return
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault()
        if (!updateProfile.isPending) handleSave()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [editing, form, updateProfile.isPending])

  function startEdit() {
    setForm({ ...profile })
    setEditing(true)
  }

  function cancelEdit() {
    setForm({})
    setEditing(false)
    setErrors({})
  }

  function handleSave() {
    if (!employeeId) return
    const newErrors: Record<string, string> = {}
    if (!form.name?.trim()) newErrors.name = t.validation.required
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return }
    setErrors({})
    updateProfile.mutate(
      {
        employeeId,
        name: form.name,
        email: form.email,
        dateOfBirth: form.dateOfBirth,
        contractType: form.contractType,
        contractNumber: form.contractNumber,
        contractDate: form.contractDate,
        supervisorId: form.supervisorId,
        firstCollaborationDate: form.firstCollaborationDate,
        position: form.position,
        hourlyRate: form.hourlyRate
      },
      {
        onSuccess: () => {
          toast.success(t.people.saveProfile)
          setEditing(false)
          setForm({})
        },
        onError: () => toast.error(t.common.error)
      }
    )
  }

  const contractTypeOptions = [
    { value: "uop", label: t.accounting.uop },
    { value: "zlecenie", label: t.accounting.zlecenie },
    { value: "b2b", label: t.accounting.b2b },
    { value: "staz", label: t.accounting.staz },
    { value: "other", label: t.accounting.other }
  ]

  const supervisorOptions = allUsers?.filter((u) => u.id !== employeeId) ?? []

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); cancelEdit() } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.people.profileTitle}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : !displayProfile ? (
          <p className="text-muted-foreground py-8 text-center text-sm">Profile not found</p>
        ) : (
          <div className="space-y-6 py-2">
            {/* Personal info */}
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t.people.personalInfo}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.people.name}</label>
                  {editing ? (
                    <>
                      <Input
                        value={form.name ?? ""}
                        onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); if (errors.name) setErrors((p) => ({ ...p, name: undefined as any })) }}
                        className={errors.name ? "border-destructive focus-visible:ring-destructive" : ""}
                      />
                      {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
                    </>
                  ) : (
                    <p className="text-sm font-medium">{displayProfile.name}</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.people.email}</label>
                  {editing ? (
                    <Input
                      value={form.email ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    />
                  ) : (
                    <p className="text-sm">{displayProfile.email || "—"}</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.people.dateOfBirth}</label>
                  {editing ? (
                    <Input
                      type="date"
                      value={form.dateOfBirth ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value || null }))}
                    />
                  ) : (
                    <p className="text-sm">{displayProfile.dateOfBirth || "—"}</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.people.position}</label>
                  {editing ? (
                    <Input
                      value={form.position ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, position: e.target.value || null }))}
                    />
                  ) : (
                    <p className="text-sm">{displayProfile.position || "—"}</p>
                  )}
                </div>
                {/* Avatar override indicator */}
                {displayProfile.manualAvatarOverride && (
                  <div className="col-span-2">
                    <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                      <div>
                        <p className="text-xs font-medium">{t.people.manualAvatarOverride}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={resetAvatar.isPending}
                        onClick={() => {
                          if (!employeeId) return
                          resetAvatar.mutate(employeeId, {
                            onSuccess: () => toast.success(t.people.resetToClockify),
                            onError: () => toast.error(t.common.error)
                          })
                        }}
                      >
                        {t.people.resetToClockify}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* Contract */}
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t.people.contractInfo}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.people.contractType}</label>
                  {editing ? (
                    <Select
                      value={form.contractType ?? ""}
                      onValueChange={(v) => setForm((f) => ({ ...f, contractType: v || null }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {contractTypeOptions.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm">
                      {displayProfile.contractType
                        ? contractTypeOptions.find((o) => o.value === displayProfile.contractType)?.label ?? displayProfile.contractType
                        : "—"}
                    </p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.people.contractNumber}</label>
                  {editing ? (
                    <Input
                      value={form.contractNumber ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, contractNumber: e.target.value || null }))}
                    />
                  ) : (
                    <p className="text-sm">{displayProfile.contractNumber || "—"}</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.people.contractDate}</label>
                  {editing ? (
                    <Input
                      type="date"
                      value={form.contractDate ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, contractDate: e.target.value || null }))}
                    />
                  ) : (
                    <p className="text-sm">{displayProfile.contractDate || "—"}</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Contract Document</label>
                  {profile?.contractDocumentId ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground truncate max-w-[120px]">
                        {profile.contractDocumentId.slice(0, 16)}…
                      </span>
                      <Button size="sm" variant="outline" onClick={() => setDocUploaderOpen(true)}>
                        Change
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setDocUploaderOpen(true)}>
                      Link document
                    </Button>
                  )}
                  {docUploaderOpen && employeeId && (
                    <Dialog open={docUploaderOpen} onOpenChange={setDocUploaderOpen}>
                      <DialogContent className="max-w-sm">
                        <DialogHeader>
                          <DialogTitle>Link contract document</DialogTitle>
                        </DialogHeader>
                        <p className="text-sm text-muted-foreground">
                          Go to <strong>Documents</strong> in the sidebar to upload or select a document,
                          then link it to this employee from the document detail panel.
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Employee ID: <span className="font-mono">{employeeId}</span>
                        </p>
                        <Button onClick={() => setDocUploaderOpen(false)}>Close</Button>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              </div>
            </div>

            <Separator />

            {/* Work */}
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t.people.workInfo}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.people.supervisor}</label>
                  {editing ? (
                    <Select
                      value={form.supervisorId ?? ""}
                      onValueChange={(v) => setForm((f) => ({ ...f, supervisorId: v || null }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {supervisorOptions.map((u) => (
                          <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm">
                      {displayProfile.supervisorId
                        ? allUsers?.find((u) => u.id === displayProfile.supervisorId)?.name ?? displayProfile.supervisorId
                        : "—"}
                    </p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.people.firstCollaboration}</label>
                  {editing ? (
                    <Input
                      type="date"
                      value={form.firstCollaborationDate ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, firstCollaborationDate: e.target.value || null }))}
                    />
                  ) : (
                    <p className="text-sm">{displayProfile.firstCollaborationDate || "—"}</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.people.internalRate}</label>
                  {editing ? (
                    <Input
                      type="number"
                      min={0}
                      step={10}
                      value={form.hourlyRate ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, hourlyRate: e.target.value ? Number(e.target.value) : null }))}
                    />
                  ) : (
                    <p className="text-sm">{displayProfile.hourlyRate != null ? `${displayProfile.hourlyRate} PLN/h` : "—"}</p>
                  )}
                </div>
              </div>
            </div>

            <Separator />

            {/* Assigned projects */}
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t.people.assignedProjects}</h3>
              {projectsLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : !projectsData?.projects?.length ? (
                <p className="text-sm text-muted-foreground">{t.people.noProjects}</p>
              ) : (
                <div className="space-y-2">
                  {projectsData.projects.map((p) => (
                    <div key={p.projectId} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div>
                        <p className="text-sm font-medium">{p.projectName}</p>
                        <p className="text-xs text-muted-foreground">{p.clientName ?? t.projects.noClient}</p>
                      </div>
                      <Badge variant={p.status === "active" ? "default" : "secondary"}>
                        {p.status === "active" ? t.projects.statusActive : t.projects.statusArchived}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Recent activity */}
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t.audit.recentActivity}</h3>
              <EntityActivityLog data={activityData} />
            </div>
          </div>
        )}

        <DialogFooter>
          {editing ? (
            <>
              <span className="text-xs text-muted-foreground mr-auto">{t.dialog.submitHint}</span>
              <Button variant="outline" onClick={cancelEdit}>{t.action.cancel}</Button>
              <Button onClick={handleSave} disabled={updateProfile.isPending}>
                {updateProfile.isPending ? (
                  <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />{t.people.saving}</>
                ) : (
                  t.people.saveProfile
                )}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>{t.action.close}</Button>
              <Button onClick={startEdit}>{t.people.editProfile}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

function PeoplePage() {
  const { workspaceId } = Route.useSearch()
  const { t } = useTranslation()
  const [profileEmployeeId, setProfileEmployeeId] = useState<string | null>(null)

  const { data: users, isLoading: usersLoading } = useQuery({
    ...queriesUsers.workspaceUsers(workspaceId ?? ""),
    enabled: !!workspaceId
  })

  const { data: timeEntries, isLoading: entriesLoading } = useQuery({
    ...queriesTimeEntries.workspaceTimeEntries(workspaceId ?? ""),
    enabled: !!workspaceId
  })

  const { data: hourlyRates } = useQuery({
    ...financeQueries.employeeHourlyRates(workspaceId ?? ""),
    enabled: !!workspaceId
  })

  const updateRateMutation = useUpdateEmployeeHourlyRate()

  const rateMap = new Map(hourlyRates?.map((r) => [r.employeeId, r.hourlyRate]) ?? [])

  const handleRateChange = (employeeId: string, value: string) => {
    const rate = value === "" ? null : Number(value)
    if (rate !== null && (isNaN(rate) || rate < 0)) return
    updateRateMutation.mutate({ employeeId, hourlyRate: rate })
  }

  const userHours =
    users?.map((user) => {
      const userEntries = timeEntries?.filter((e) => e.userId === user.id) ?? []
      const totalMs = userEntries.reduce(
        (sum, e) => sum + (getIntervalDurationMs(e.timeInterval) ?? 0),
        0
      )
      const hourlyRate = rateMap.get(user.id) ?? null
      const estimatedCost = hourlyRate ? (totalMs / 3600000) * hourlyRate : 0
      return {
        user,
        hours: totalMs,
        entries: userEntries.length,
        hourlyRate,
        estimatedCost
      }
    }) ?? []

  const maxHours = Math.max(...userHours.map((u) => u.hours), 1)

  if (!workspaceId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="space-y-4 text-center">
          <h2 className="text-2xl font-bold">Select a Workspace</h2>
          <p className="text-muted-foreground">
            Choose a workspace from the sidebar to view people.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold text-zinc-100 leading-none">{t.people.title}</h1>
          <p className="text-xs text-zinc-500 mt-1">{t.people.subtitle}</p>
        </div>
      </div>
      <div className="p-6 space-y-6">

      {usersLoading || entriesLoading ? (
        <div className="rounded-md border border-zinc-800 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="pl-4 text-xs text-zinc-500 uppercase tracking-wider font-medium w-[280px]">{t.people.name}</TableHead>
                <TableHead className="text-xs text-zinc-500 uppercase tracking-wider font-medium">Godziny</TableHead>
                <TableHead className="text-xs text-zinc-500 uppercase tracking-wider font-medium text-right">Wpisy</TableHead>
                <TableHead className="text-xs text-zinc-500 uppercase tracking-wider font-medium text-right">Stawka</TableHead>
                <TableHead className="text-xs text-zinc-500 uppercase tracking-wider font-medium text-right">Koszt</TableHead>
                <TableHead className="pr-4 w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i} className="border-zinc-800">
                  <TableCell className="pl-4 py-3"><Skeleton className="h-8 w-48" /></TableCell>
                  <TableCell className="py-3"><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell className="py-3 text-right"><Skeleton className="h-4 w-6 ml-auto" /></TableCell>
                  <TableCell className="py-3"><Skeleton className="h-7 w-24 ml-auto" /></TableCell>
                  <TableCell className="py-3"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                  <TableCell className="pr-4 py-3"><Skeleton className="h-7 w-20 ml-auto" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : userHours.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Brak pracowników"
          subtitle="Dodaj pierwszego pracownika do systemu"
        />
      ) : (
        <div className="rounded-md border border-zinc-800 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="pl-4 text-xs text-zinc-500 uppercase tracking-wider font-medium w-[280px]">{t.people.name}</TableHead>
                <TableHead className="text-xs text-zinc-500 uppercase tracking-wider font-medium">Godziny</TableHead>
                <TableHead className="text-xs text-zinc-500 uppercase tracking-wider font-medium text-right">Wpisy</TableHead>
                <TableHead className="text-xs text-zinc-500 uppercase tracking-wider font-medium text-right">Stawka</TableHead>
                <TableHead className="text-xs text-zinc-500 uppercase tracking-wider font-medium text-right">Koszt</TableHead>
                <TableHead className="pr-4 w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {userHours.map(({ user, hours, entries, hourlyRate, estimatedCost }) => (
                <TableRow
                  key={user.id}
                  className="border-zinc-800 hover:bg-zinc-800/40 transition-colors"
                >
                  <TableCell className="pl-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8 shrink-0">
                        <AvatarImage src={user.profilePicture ?? undefined} />
                        <AvatarFallback className="bg-indigo-600 text-white text-xs font-semibold">
                          {user.name.split(" ").map((n) => n[0]).join("").toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-100 truncate">{user.name}</p>
                        <p className="text-xs text-zinc-500 truncate">{user.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="space-y-1">
                      <p className="font-mono text-sm font-semibold text-zinc-100">{formatDuration(hours)}</p>
                      <Progress value={(hours / maxHours) * 100} className="h-1 w-28" />
                    </div>
                  </TableCell>
                  <TableCell className="py-3 text-right text-sm text-zinc-400">{entries}</TableCell>
                  <TableCell className="py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Input
                        type="number"
                        min={0}
                        step={10}
                        value={hourlyRate ?? ""}
                        placeholder="—"
                        onChange={(e) => handleRateChange(user.id, e.target.value)}
                        className="w-[68px] text-right text-xs h-7 bg-zinc-900 border-zinc-700 px-2"
                      />
                      <span className="text-xs text-zinc-500">PLN/h</span>
                    </div>
                  </TableCell>
                  <TableCell className="py-3 text-right">
                    {estimatedCost > 0 ? (
                      <span className="font-mono text-sm font-semibold text-zinc-100">{formatCostPLN(estimatedCost)}</span>
                    ) : (
                      <span className="text-zinc-600 text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => setProfileEmployeeId(user.id)}
                    >
                      {t.people.editProfile}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ProfileDialog
        employeeId={profileEmployeeId}
        open={!!profileEmployeeId}
        onClose={() => setProfileEmployeeId(null)}
        allUsers={users}
        workspaceId={workspaceId ?? undefined}
      />
      </div>
    </div>
  )
}
