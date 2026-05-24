import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { FolderKanban, Plus, Clock, Building2 } from "lucide-react"
import { EmptyState } from "#/components/empty-state"
import { useState, useEffect } from "react"
import { toast } from "sonner"

import { useTranslation } from "#/lib/i18n"

import { useEntityAudit, type AuditListResponse } from "#/api/audit"
import { EntityActivityLog } from "#/components/EntityActivityLog"
import { financeQueries } from "#/api/finance"
import { useCreateProject } from "#/api/mutations"
import { queriesProjects, queriesTimeEntries, queriesClients } from "#/api/queries"
import {
  useClientProfile,
  useUpdateClientProfile,
  type ClientProfile
} from "#/api/time-tracking"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card"
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "#/components/ui/dialog"
import { Input } from "#/components/ui/input"
import { ScrollArea } from "#/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "#/components/ui/select"
import { Separator } from "#/components/ui/separator"
import { Skeleton } from "#/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs"
import { Textarea } from "#/components/ui/textarea"
import { getIntervalDurationMs } from "#/lib/clockify-schemas"
import { getWorkspaceId, workspaceSearchSchema } from "#/lib/search-schema"
import { cn, formatDuration } from "#/lib/utils"

function formatCostPLN(amount: number): string {
  return (
    new Intl.NumberFormat("pl-PL", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount) + " zł"
  )
}

export const Route = createFileRoute("/projects")({
  loader: async ({ context, location }) => {
    const workspaceId = getWorkspaceId(location.search)
    if (workspaceId) {
      await context.queryClient.prefetchQuery({ ...queriesProjects.workspaceProjects(workspaceId) })
      await context.queryClient.prefetchQuery({
        ...queriesTimeEntries.workspaceTimeEntries(workspaceId)
      })
    }
  },
  validateSearch: workspaceSearchSchema,
  component: ProjectsPage
})

// ─── Client Profile Dialog ────────────────────────────────────────────────────

function ClientProfileDialog({
  clientId,
  open,
  onClose,
  workspaceId
}: {
  clientId: string | null
  open: boolean
  onClose: () => void
  workspaceId: string | undefined
}) {
  const { t } = useTranslation()
  const { data: profile, isLoading } = useClientProfile(clientId ?? undefined)
  const updateProfile = useUpdateClientProfile()
  const { data: _rawActivityData } = useEntityAudit(workspaceId, "client", clientId ?? undefined)
  const activityData = _rawActivityData as AuditListResponse | undefined
  const [form, setForm] = useState<Partial<ClientProfile>>({})
  const [editing, setEditing] = useState(false)

  const displayProfile = editing ? { ...profile, ...form } : profile

  const cooperationTypeOptions = [
    { value: "time_material", label: "Time & Material" },
    { value: "subscription", label: "Subscription" },
    { value: "other", label: "Other" }
  ]

  function startEdit() {
    setForm({ ...profile })
    setEditing(true)
  }

  function cancelEdit() {
    setForm({})
    setEditing(false)
  }

  function handleSave() {
    if (!clientId) return
    updateProfile.mutate(
      {
        clientId,
        name: form.name,
        email: form.email,
        nip: form.nip,
        address: form.address,
        cooperationType: form.cooperationType,
        notes: form.notes
      },
      {
        onSuccess: () => {
          toast.success(t.action.save)
          setEditing(false)
          setForm({})
        },
        onError: () => toast.error(t.common.error)
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); cancelEdit() } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.projects.clientProfileTitle}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : !displayProfile ? (
          <p className="text-muted-foreground py-8 text-center text-sm">Client not found</p>
        ) : (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.common.name}</label>
                {editing ? (
                  <Input value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                ) : (
                  <p className="text-sm font-medium">{displayProfile.name}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.people.email}</label>
                {editing ? (
                  <Input value={form.email ?? ""} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value || null }))} />
                ) : (
                  <p className="text-sm">{displayProfile.email || "—"}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.projects.nip}</label>
                {editing ? (
                  <Input value={form.nip ?? ""} onChange={(e) => setForm((f) => ({ ...f, nip: e.target.value || null }))} maxLength={10} />
                ) : (
                  <p className="text-sm">{displayProfile.nip || "—"}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.projects.cooperationType}</label>
                {editing ? (
                  <Select
                    value={form.cooperationType ?? ""}
                    onValueChange={(v) => setForm((f) => ({ ...f, cooperationType: v || null }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {cooperationTypeOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm">
                    {displayProfile.cooperationType
                      ? cooperationTypeOptions.find((o) => o.value === displayProfile.cooperationType)?.label ?? displayProfile.cooperationType
                      : "—"}
                  </p>
                )}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.projects.address}</label>
              {editing ? (
                <Textarea
                  value={form.address ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value || null }))}
                  rows={2}
                />
              ) : (
                <p className="text-sm whitespace-pre-wrap">{displayProfile.address || "—"}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.projects.notes}</label>
              {editing ? (
                <Textarea
                  value={form.notes ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value || null }))}
                  rows={3}
                />
              ) : (
                <p className="text-sm whitespace-pre-wrap">{displayProfile.notes || "—"}</p>
              )}
            </div>
            {/* Recent activity */}
            <div className="border-t pt-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.audit.recentActivity}</h3>
              <EntityActivityLog data={activityData} />
            </div>
          </div>
        )}

        <DialogFooter>
          {editing ? (
            <>
              <Button variant="outline" onClick={cancelEdit}>{t.action.cancel}</Button>
              <Button onClick={handleSave} disabled={updateProfile.isPending}>{t.action.save}</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>{t.action.close}</Button>
              <Button onClick={startEdit}>{t.action.edit}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProjectsPage() {
  const { workspaceId } = Route.useSearch()
  const { t } = useTranslation()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState("")
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [clientProfileId, setClientProfileId] = useState<string | null>(null)
  const [billingType, setBillingType] = useState<"hourly" | "fixed" | "subscription">("hourly")
  const [billingRate, setBillingRate] = useState<string>("")
  const [fixedAmount, setFixedAmount] = useState<string>("")
  const [subscriptionMinHours, setSubscriptionMinHours] = useState<string>("")
  const [subscriptionOverageRate, setSubscriptionOverageRate] = useState<string>("")

  const { data: projects, isLoading: projectsLoading } = useQuery({
    ...queriesProjects.workspaceProjects(workspaceId ?? ""),
    enabled: !!workspaceId
  })

  const { data: timeEntries, isLoading: entriesLoading } = useQuery({
    ...queriesTimeEntries.workspaceTimeEntries(workspaceId ?? ""),
    enabled: !!workspaceId
  })

  const { data: projectCosts } = useQuery({
    ...financeQueries.timeCostsByProject(workspaceId ?? ""),
    enabled: !!workspaceId
  })

  const { data: clients, isLoading: clientsLoading } = useQuery({
    ...queriesClients.workspaceClients(workspaceId ?? ""),
    enabled: !!workspaceId
  })

  const createProjectMutation = useCreateProject()

  const handleCreateProject = () => {
    if (!workspaceId || !newProjectName.trim()) return
    createProjectMutation.mutate(
      {
        workspaceId,
        name: newProjectName.trim(),
        billingType,
        billingRate: billingRate ? Number(billingRate) : undefined,
        fixedAmount: fixedAmount ? Number(fixedAmount) : undefined,
        subscriptionMinHours: subscriptionMinHours ? Number(subscriptionMinHours) : undefined,
        subscriptionOverageRate: subscriptionOverageRate ? Number(subscriptionOverageRate) : undefined
      },
      {
        onSuccess: () => {
          toast.success(t.toast.saveSuccess)
          setNewProjectName("")
          setBillingType("hourly")
          setBillingRate("")
          setFixedAmount("")
          setSubscriptionMinHours("")
          setSubscriptionOverageRate("")
          setIsDialogOpen(false)
        },
        onError: () => toast.error(t.toast.saveError)
      }
    )
  }

  useEffect(() => {
    if (!isDialogOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault()
        if (!createProjectMutation.isPending) handleCreateProject()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isDialogOpen, newProjectName, createProjectMutation.isPending])

  const projectHours =
    projects?.map((project) => {
      const projectEntries = timeEntries?.filter((e) => e.projectId === project.id) ?? []
      const totalMs = projectEntries.reduce(
        (sum, e) => sum + (getIntervalDurationMs(e.timeInterval) ?? 0),
        0
      )
      const projectCost = projectCosts?.find((pc) => pc.projectId === project.id)
      return {
        project,
        hours: totalMs,
        entries: projectEntries.length,
        entryList: projectEntries,
        estimatedCost: projectCost?.estimatedCost ?? 0
      }
    }) ?? []

  const selectedProject = projectHours.find((p) => p.project.id === selectedProjectId)

  if (!workspaceId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="space-y-4 text-center">
          <h2 className="text-2xl font-bold">Select a Workspace</h2>
          <p className="text-muted-foreground">
            Choose a workspace from the sidebar to view projects.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold">{t.projects.title}</h1>
          <p className="text-xs text-zinc-500 mt-1">Zarządzanie projektami</p>
        </div>
        <div className="flex items-center gap-2">
        <Dialog open={isDialogOpen} onOpenChange={(o) => {
          setIsDialogOpen(o)
          if (!o) {
            setNewProjectName("")
            setBillingType("hourly")
            setBillingRate("")
            setFixedAmount("")
            setSubscriptionMinHours("")
            setSubscriptionOverageRate("")
          }
        }}>
          <DialogTrigger asChild>
            <Button>
              <Plus data-icon="inline-start" />
              {t.projects.addProject}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t.projects.projectTitle}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label htmlFor="project-name" className="mb-1.5 block text-sm font-medium">
                  {t.projects.projectName}
                </label>
                <Input
                  id="project-name"
                  value={newProjectName}
                  onChange={(e) => {
                    setNewProjectName(e.target.value)
                  }}
                  placeholder="Enter project name..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateProject()
                  }}
                />
              </div>

              {/* Billing settings */}
              <div className="border-t pt-4 mt-2">
                <div className="flex items-center gap-2 mb-3">
                  <label className="text-sm font-semibold">{t.billing.section}</label>
                </div>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="billing-type" className="mb-1.5 block text-sm font-medium">
                      {t.billing.type}
                    </label>
                    <Select value={billingType} onValueChange={(v) => setBillingType(v as typeof billingType)}>
                      <SelectTrigger id="billing-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hourly">{t.billing.hourly}</SelectItem>
                        <SelectItem value="fixed">{t.billing.fixed}</SelectItem>
                        <SelectItem value="subscription">{t.billing.subscription}</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      {billingType === "hourly" ? t.billing.tooltipHourly
                        : billingType === "fixed" ? t.billing.tooltipFixed
                        : t.billing.tooltipSubscription}
                    </p>
                  </div>

                  {billingType === "hourly" && (
                    <div>
                      <label className="mb-1.5 block text-sm font-medium">{t.billing.rate}</label>
                      <Input type="number" min={0} step={10} value={billingRate} onChange={(e) => setBillingRate(e.target.value)} placeholder="—" />
                    </div>
                  )}

                  {billingType === "fixed" && (
                    <div>
                      <label className="mb-1.5 block text-sm font-medium">{t.billing.fixedAmount}</label>
                      <Input type="number" min={0} step={100} value={fixedAmount} onChange={(e) => setFixedAmount(e.target.value)} placeholder="—" />
                    </div>
                  )}

                  {billingType === "subscription" && (
                    <>
                      <div>
                        <label className="mb-1.5 block text-sm font-medium">{t.billing.minHours}</label>
                        <Input type="number" min={0} value={subscriptionMinHours} onChange={(e) => setSubscriptionMinHours(e.target.value)} placeholder="—" />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-sm font-medium">{t.billing.overageRate}</label>
                        <Input type="number" min={0} step={10} value={subscriptionOverageRate} onChange={(e) => setSubscriptionOverageRate(e.target.value)} placeholder="—" />
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{t.dialog.submitHint}</span>
                <Button
                  onClick={handleCreateProject}
                  disabled={createProjectMutation.isPending || !newProjectName.trim()}
                  className="flex-1"
                >
                  {createProjectMutation.isPending ? t.projects.creating : t.projects.createProject}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>
      <div className="p-6 space-y-6">

      <Tabs defaultValue="projects">
        <TabsList>
          <TabsTrigger value="projects">{t.projects.title}</TabsTrigger>
          <TabsTrigger value="clients">{t.projects.clients}</TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="mt-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              {projectsLoading || entriesLoading ? (
                <div className="rounded-md border border-zinc-800 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800 hover:bg-transparent">
                        <TableHead className="pl-4 text-xs text-zinc-500 uppercase tracking-wider font-medium">Projekt</TableHead>
                        <TableHead className="text-xs text-zinc-500 uppercase tracking-wider font-medium text-right">Godziny</TableHead>
                        <TableHead className="text-xs text-zinc-500 uppercase tracking-wider font-medium text-right">Wpisy</TableHead>
                        <TableHead className="text-xs text-zinc-500 uppercase tracking-wider font-medium text-right pr-4">Koszt</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i} className="border-zinc-800">
                          <TableCell className="pl-4 py-3"><Skeleton className="h-8 w-40" /></TableCell>
                          <TableCell className="py-3 text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                          <TableCell className="py-3 text-right"><Skeleton className="h-4 w-6 ml-auto" /></TableCell>
                          <TableCell className="py-3 pr-4 text-right"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : projectHours.length === 0 ? (
                <EmptyState
                  icon={FolderKanban}
                  title={t.projects.noProjects}
                  subtitle="Dodaj pierwszy projekt"
                  action={t.projects.addProject}
                  onAction={() => setIsDialogOpen(true)}
                />
              ) : (
                <div className="rounded-md border border-zinc-800 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800 hover:bg-transparent">
                        <TableHead className="pl-4 text-xs text-zinc-500 uppercase tracking-wider font-medium">Projekt</TableHead>
                        <TableHead className="text-xs text-zinc-500 uppercase tracking-wider font-medium text-right">Godziny</TableHead>
                        <TableHead className="text-xs text-zinc-500 uppercase tracking-wider font-medium text-right">Wpisy</TableHead>
                        <TableHead className="text-xs text-zinc-500 uppercase tracking-wider font-medium text-right pr-4">Koszt</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {projectHours.map(({ project, hours, entries, estimatedCost }) => (
                        <TableRow
                          key={project.id}
                          onClick={() => setSelectedProjectId(project.id)}
                          className={cn(
                            "border-zinc-800 cursor-pointer transition-colors",
                            selectedProjectId === project.id
                              ? "bg-indigo-950/40 hover:bg-indigo-950/50"
                              : "hover:bg-zinc-800/40"
                          )}
                        >
                          <TableCell className="pl-4 py-3">
                            <div className="flex items-center gap-3">
                              <div
                                className="size-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: project.color ?? "#6366f1" }}
                              />
                              <div>
                                <p className="text-sm font-medium text-zinc-100">{project.name}</p>
                                <p className="text-xs text-zinc-500">{project.clientName ?? t.projects.noClient}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-3 text-right font-mono text-sm text-zinc-100">{formatDuration(hours)}</TableCell>
                          <TableCell className="py-3 text-right text-sm text-zinc-400">{entries}</TableCell>
                          <TableCell className="py-3 text-right pr-4">
                            {estimatedCost > 0 ? (
                              <span className="font-mono text-sm text-zinc-100">{formatCostPLN(estimatedCost)}</span>
                            ) : (
                              <span className="text-zinc-600 text-sm">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <div>
              <Card className="sticky top-6">
                <CardHeader>
                  <CardTitle>
                    {selectedProject ? selectedProject.project.name : "Select a Project"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {selectedProject ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-sm">{t.projects.totalHours}</span>
                        <span className="font-mono font-bold">
                          {formatDuration(selectedProject.hours)}
                        </span>
                      </div>
                      {selectedProject.estimatedCost > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground text-sm">{t.projects.estimatedCost}</span>
                          <span className="font-mono font-bold">
                            {formatCostPLN(selectedProject.estimatedCost)}
                          </span>
                        </div>
                      )}
                      <Separator />
                      <ScrollArea className="h-[400px]">
                        <div className="space-y-3">
                          {selectedProject.entryList.map((entry) => (
                            <div key={entry.id} className="bg-muted/50 rounded-lg p-3">
                              <p className="text-sm font-medium">{entry.description}</p>
                              <div className="mt-1 flex items-center justify-between">
                                <Badge variant="secondary" className="text-xs">
                                  {formatDuration(getIntervalDurationMs(entry.timeInterval))}
                                </Badge>
                                <span className="text-muted-foreground text-xs">
                                  {new Date(entry.timeInterval.start).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  ) : (
                    <div className="text-muted-foreground py-8 text-center">
                      <Clock className="mx-auto mb-2 size-8 opacity-50" />
                      <p>Click on a project to see its time entries</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="clients" className="mt-4">
          {clientsLoading ? (
            <div className="rounded-md border border-zinc-800 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="pl-4 text-xs text-zinc-500 uppercase tracking-wider font-medium">Klient</TableHead>
                    <TableHead className="text-xs text-zinc-500 uppercase tracking-wider font-medium">Status</TableHead>
                    <TableHead className="pr-4 w-[120px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="border-zinc-800">
                      <TableCell className="pl-4 py-3"><Skeleton className="h-8 w-48" /></TableCell>
                      <TableCell className="py-3"><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell className="pr-4 py-3"><Skeleton className="h-7 w-20 ml-auto" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : !clients?.length ? (
            <EmptyState
              icon={Building2}
              title={t.projects.noClients}
              subtitle="Klienci pojawią się tutaj po synchronizacji z Clockify"
            />
          ) : (
            <div className="rounded-md border border-zinc-800 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="pl-4 text-xs text-zinc-500 uppercase tracking-wider font-medium">Klient</TableHead>
                    <TableHead className="text-xs text-zinc-500 uppercase tracking-wider font-medium">Status</TableHead>
                    <TableHead className="pr-4 w-[120px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((client) => (
                    <TableRow
                      key={client.id}
                      className="border-zinc-800 hover:bg-zinc-800/40 cursor-pointer transition-colors"
                      onClick={() => setClientProfileId(client.id)}
                    >
                      <TableCell className="pl-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-zinc-800">
                            <Building2 className="size-4 text-zinc-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-zinc-100">{client.name}</p>
                            {client.email && (
                              <p className="text-xs text-zinc-500">{client.email}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        {client.archived ? (
                          <Badge variant="secondary" className="text-xs">Archived</Badge>
                        ) : (
                          <span className="text-xs text-emerald-500">Aktywny</span>
                        )}
                      </TableCell>
                      <TableCell className="pr-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={(e) => { e.stopPropagation(); setClientProfileId(client.id) }}
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
        </TabsContent>
      </Tabs>

      <ClientProfileDialog
        clientId={clientProfileId}
        open={!!clientProfileId}
        onClose={() => setClientProfileId(null)}
        workspaceId={workspaceId ?? undefined}
      />
      </div>
    </div>
  )
}
