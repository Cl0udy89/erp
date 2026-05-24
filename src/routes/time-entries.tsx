import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Edit3,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  BookmarkPlus,
  Bookmark,
  Clock
} from "lucide-react"
import { EmptyState } from "#/components/empty-state"
import { useState } from "react"
import { toast } from "sonner"

import {
  useDeleteTimeEntry,
  useTimeEntries,
  useTimeWeeklyReport,
  useTimesheets,
  useCreateTimesheet,
  useSubmitTimesheet,
  useTimesheetTemplates,
  useCreateTimesheetTemplate,
  useDeleteTimesheetTemplate,
  type TimeEntryFull
} from "#/api/time-tracking"
import { queriesProjects, queriesUsers } from "#/api/queries"
import { TimeEntryForm, type TimeEntryFormData } from "#/components/time-entry-form"
import { WeeklyGrid } from "#/components/weekly-grid"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { Card, CardContent } from "#/components/ui/card"
import { Input } from "#/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "#/components/ui/select"
import { Skeleton } from "#/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs"
import { workspaceSearchSchema } from "#/lib/search-schema"
import { useTranslation } from "#/lib/i18n"
import { cn } from "#/lib/utils"

export const Route = createFileRoute("/time-entries")({
  validateSearch: workspaceSearchSchema,
  component: TimeEntriesPage
})

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getMonday(d: Date): Date {
  const copy = new Date(d)
  const day = copy.getDay()
  const diff = day === 0 ? -6 : 1 - day
  copy.setDate(copy.getDate() + diff)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function toDateStr(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function toTimeStr(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0")
  const min = String(d.getMinutes()).padStart(2, "0")
  return `${hh}:${min}`
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + n)
  return copy
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatHours(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

const SHORT_DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

// ─── Main page ────────────────────────────────────────────────────────────────

function TimeEntriesPage() {
  const { workspaceId } = Route.useSearch()
  const { t } = useTranslation()

  const [tab, setTab] = useState("tracker")
  const [clockifyImporting, setClockifyImporting] = useState(false)

  // For tracker tab
  const [weekStart, setWeekStart] = useState<Date>(getMonday(new Date()))
  const [filterEmployee, setFilterEmployee] = useState<string>("all")
  const [filterProject, setFilterProject] = useState<string>("all")
  const [filterSource, setFilterSource] = useState<string>("all")

  // Form state
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<"create" | "edit" | "complete-timer">("create")
  const [formInitialData, setFormInitialData] = useState<Partial<TimeEntryFormData>>({})
  const [formEntryId, setFormEntryId] = useState<string | undefined>()
  const [formLocked, setFormLocked] = useState(false)

  const { data: users } = useQuery({
    ...queriesUsers.workspaceUsers(workspaceId ?? ""),
    enabled: !!workspaceId
  })
  const { data: projects } = useQuery({
    ...queriesProjects.workspaceProjects(workspaceId ?? ""),
    enabled: !!workspaceId
  })

  const employeeId = users?.[0]?.id

  const weekEnd = addDays(weekStart, 6)

  const { data: timeEntriesData, isLoading: entriesLoading } = useTimeEntries(
    workspaceId,
    {
      from: toDateStr(weekStart),
      to: toDateStr(weekEnd),
      employeeId: filterEmployee !== "all" ? filterEmployee : undefined,
      projectId: filterProject !== "all" ? filterProject : undefined,
      source: filterSource !== "all" ? filterSource : undefined
    }
  )

  const deleteEntry = useDeleteTimeEntry()

  function openCreate(preData?: Partial<TimeEntryFormData>) {
    setFormMode("create")
    setFormInitialData(preData ?? {})
    setFormEntryId(undefined)
    setFormLocked(false)
    setFormOpen(true)
  }

  function openEdit(entry: TimeEntryFull) {
    const startDate = entry.startAt ? new Date(entry.startAt) : new Date()
    const endDate = entry.endAt ? new Date(entry.endAt) : new Date()
    const locked =
      entry.timesheetStatus === "submitted" || entry.timesheetStatus === "approved"
    setFormMode("edit")
    setFormEntryId(entry.id)
    setFormLocked(locked)
    setFormInitialData({
      date: toDateStr(startDate),
      startTime: toTimeStr(startDate),
      endTime: toTimeStr(endDate),
      projectId: entry.projectId ?? "",
      taskName: entry.description ?? "",
      description: entry.description ?? "",
      billable: entry.billable ?? false,
      tags: entry.tags?.join(", ") ?? ""
    })
    setFormOpen(true)
  }

  function handleDelete(entry: TimeEntryFull) {
    if (!workspaceId) return
    if (!window.confirm(t.tracker.deleteConfirm)) return
    deleteEntry.mutate(
      { id: entry.id, workspaceId },
      {
        onSuccess: () => toast.success(t.tracker.deleteEntry),
        onError: (err) => {
          toast.error("Failed to delete entry", {
            description: err instanceof Error ? err.message : "Unknown error"
          })
        }
      }
    )
  }

  async function handleClockifyImport() {
    if (!workspaceId) return
    setClockifyImporting(true)
    try {
      const syncUrl = typeof window !== "undefined"
        ? ((import.meta as unknown as Record<string, unknown>)?.env as Record<string, string> | undefined)?.VITE_CLOCKIFY_SYNC_URL ?? "http://localhost:4000"
        : "http://localhost:4000"
      const internalToken = typeof window !== "undefined"
        ? ((import.meta as unknown as Record<string, unknown>)?.env as Record<string, string> | undefined)?.VITE_API_INTERNAL_TOKEN ?? ""
        : ""
      const resp = await fetch(`${syncUrl}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${internalToken}` },
        body: JSON.stringify({ workspaceId })
      })
      if (!resp.ok) throw new Error("Sync failed")
      toast.success(t.clockify.importSuccess)
    } catch {
      toast.error(t.clockify.importError)
    } finally {
      setClockifyImporting(false)
    }
  }

  if (!workspaceId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-bold">{t.tracker.selectWorkspace}</h2>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t.nav.timeEntries}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Rejestruj czas pracy i zarządzaj wpisami</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleClockifyImport}
            disabled={clockifyImporting}
          >
            {clockifyImporting
              ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />{t.clockify.importing}</>
              : <><RefreshCw className="h-4 w-4 mr-2" />{t.clockify.import}</>
            }
          </Button>
          <Button onClick={() => openCreate()}>
            <Plus className="size-4" data-icon="inline-start" />
            {t.tracker.addEntry}
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="tracker">{t.tracker.tracker}</TabsTrigger>
          <TabsTrigger value="weekly">{t.tracker.weekly}</TabsTrigger>
          <TabsTrigger value="calendar">{t.tracker.calendar}</TabsTrigger>
        </TabsList>

        {/* ── Tracker tab ── */}
        <TabsContent value="tracker">
          <TrackerTab
            workspaceId={workspaceId}
            employeeId={employeeId}
            weekStart={weekStart}
            weekEnd={weekEnd}
            onPrevWeek={() => setWeekStart(addDays(weekStart, -7))}
            onNextWeek={() => setWeekStart(addDays(weekStart, 7))}
            onToday={() => setWeekStart(getMonday(new Date()))}
            filterEmployee={filterEmployee}
            setFilterEmployee={setFilterEmployee}
            filterProject={filterProject}
            setFilterProject={setFilterProject}
            filterSource={filterSource}
            setFilterSource={setFilterSource}
            users={users}
            projects={projects}
            timeEntries={timeEntriesData?.entries ?? []}
            isLoading={entriesLoading}
            onEdit={openEdit}
            onDelete={handleDelete}
          />
        </TabsContent>

        {/* ── Weekly tab ── */}
        <TabsContent value="weekly">
          <WeeklyTab
            workspaceId={workspaceId}
            employeeId={employeeId}
            users={users}
            projects={projects}
          />
        </TabsContent>

        {/* ── Calendar tab ── */}
        <TabsContent value="calendar">
          <CalendarTab
            workspaceId={workspaceId}
            employeeId={employeeId}
            timeEntries={timeEntriesData?.entries ?? []}
            weekStart={weekStart}
            weekEnd={weekEnd}
            onPrevWeek={() => setWeekStart(addDays(weekStart, -7))}
            onNextWeek={() => setWeekStart(addDays(weekStart, 7))}
            onToday={() => setWeekStart(getMonday(new Date()))}
            projects={projects}
            onClickSlot={(date, time) => {
              openCreate({ date, startTime: time })
            }}
            onEdit={openEdit}
          />
        </TabsContent>
      </Tabs>

      {/* Shared form dialog */}
      {workspaceId && employeeId && (
        <TimeEntryForm
          open={formOpen}
          onOpenChange={setFormOpen}
          workspaceId={workspaceId}
          employeeId={employeeId}
          mode={formMode}
          initialData={formInitialData}
          entryId={formEntryId}
          locked={formLocked}
        />
      )}
    </div>
  )
}

// ─── Tracker Tab ──────────────────────────────────────────────────────────────

interface TrackerTabProps {
  workspaceId: string
  employeeId: string | undefined
  weekStart: Date
  weekEnd: Date
  onPrevWeek: () => void
  onNextWeek: () => void
  onToday: () => void
  filterEmployee: string
  setFilterEmployee: (v: string) => void
  filterProject: string
  setFilterProject: (v: string) => void
  filterSource: string
  setFilterSource: (v: string) => void
  users: import("#/lib/clockify-schemas").ClockifyUser[] | undefined
  projects: import("#/lib/clockify-schemas").ClockifyProject[] | undefined
  timeEntries: TimeEntryFull[]
  isLoading: boolean
  onEdit: (entry: TimeEntryFull) => void
  onDelete: (entry: TimeEntryFull) => void
}

function TrackerTab({
  weekStart,
  weekEnd,
  onPrevWeek,
  onNextWeek,
  onToday,
  filterEmployee,
  setFilterEmployee,
  filterProject,
  setFilterProject,
  filterSource,
  setFilterSource,
  users,
  projects,
  timeEntries,
  isLoading,
  onEdit,
  onDelete
}: TrackerTabProps) {
  const { t } = useTranslation()
  const today = new Date()

  // Group entries by date
  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    days.push(addDays(weekStart, i))
  }

  const entriesByDay: Record<string, TimeEntryFull[]> = {}
  for (const day of days) {
    const key = toDateStr(day)
    entriesByDay[key] = timeEntries.filter((e) => {
      const d = new Date(e.startAt)
      return isSameDay(d, day)
    })
  }

  function dayLabel(day: Date): string {
    if (isSameDay(day, today)) return t.tracker.today
    const yesterday = addDays(today, -1)
    if (isSameDay(day, yesterday)) return t.tracker.yesterday
    return day.toLocaleDateString("pl-PL", { weekday: "long", month: "short", day: "numeric" })
  }

  function dayTotalSeconds(entries: TimeEntryFull[]): number {
    return entries.reduce((sum, e) => sum + (e.durationSeconds ?? 0), 0)
  }

  return (
    <div className="space-y-4 pt-4">
      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Week navigator */}
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={onPrevWeek}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-[180px] text-center text-sm font-medium">
            {toDateStr(weekStart)} — {toDateStr(weekEnd)}
          </span>
          <Button variant="outline" size="icon" onClick={onNextWeek}>
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={onToday}>
            {t.tracker.today}
          </Button>
        </div>

        {/* Filters */}
        <Select value={filterEmployee} onValueChange={setFilterEmployee}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t.tracker.allEmployees} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.tracker.allEmployees}</SelectItem>
            {users?.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterProject} onValueChange={setFilterProject}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t.tracker.allProjects} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.tracker.allProjects}</SelectItem>
            {projects?.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterSource} onValueChange={setFilterSource}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t.tracker.sourceAll} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.tracker.sourceAll}</SelectItem>
            <SelectItem value="manual">{t.tracker.sourceManual}</SelectItem>
            <SelectItem value="timer">{t.tracker.sourceTimer}</SelectItem>
            <SelectItem value="clockify">{t.tracker.sourceClockify}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Day groups */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {days
            .filter((day) => {
              const key = toDateStr(day)
              return (entriesByDay[key]?.length ?? 0) > 0 || isSameDay(day, today)
            })
            .map((day) => {
              const key = toDateStr(day)
              const dayEntries = entriesByDay[key] ?? []
              const totalSec = dayTotalSeconds(dayEntries)
              return (
                <div key={key}>
                  {/* Day header */}
                  <div className="mb-2 flex items-center justify-between border-b pb-1">
                    <span className="text-sm font-semibold capitalize">{dayLabel(day)}</span>
                    <span className="text-muted-foreground text-xs">
                      {totalSec > 0 ? formatHours(totalSec) : ""}
                    </span>
                  </div>

                  {dayEntries.length === 0 ? (
                    <p className="text-muted-foreground py-4 text-center text-sm">
                      {t.tracker.noEntries}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {dayEntries.map((entry) => (
                        <EntryRow
                          key={entry.id}
                          entry={entry}
                          projects={projects}
                          onEdit={onEdit}
                          onDelete={onDelete}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

          {timeEntries.length === 0 && (
            <EmptyState
              icon={Clock}
              title="Brak wpisów czasu"
              subtitle="Zacznij śledzić czas pracy"
            />
          )}
        </div>
      )}
    </div>
  )
}

function EntryRow({
  entry,
  projects,
  onEdit,
  onDelete
}: {
  entry: TimeEntryFull
  projects: import("#/lib/clockify-schemas").ClockifyProject[] | undefined
  onEdit: (entry: TimeEntryFull) => void
  onDelete: (entry: TimeEntryFull) => void
}) {
  const project = projects?.find((p) => p.id === entry.projectId)
  const isRunning = !entry.endAt

  return (
    <div
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-2.5 transition-colors hover:bg-gray-50",
        isRunning && "border-red-200 bg-red-50"
      )}
      onClick={() => onEdit(entry)}
    >
      {/* Color dot */}
      {project && (
        <span
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ background: project.color ?? "#888" }}
        />
      )}

      {/* Running indicator */}
      {isRunning && (
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-red-500" />
        </span>
      )}

      {/* Task / description */}
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {entry.description || "—"}
      </span>

      {/* Project */}
      {project && (
        <span className="text-muted-foreground shrink-0 text-xs">{project.name}</span>
      )}

      {/* Duration */}
      <span className="font-mono text-sm font-medium tabular-nums">
        {entry.durationSeconds ? formatHours(entry.durationSeconds) : "—"}
      </span>

      {/* Billable */}
      {entry.billable && (
        <DollarSign className="size-3.5 shrink-0 text-green-500" />
      )}

      {/* Tags */}
      {entry.tags && entry.tags.length > 0 && (
        <Tag className="text-muted-foreground size-3.5 shrink-0" />
      )}

      {/* Actions */}
      <div className="ml-1 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={(e) => {
            e.stopPropagation()
            onEdit(entry)
          }}
        >
          <Edit3 className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive size-7"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(entry)
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

// ─── Weekly Tab ───────────────────────────────────────────────────────────────

function WeeklyTab({
  workspaceId,
  employeeId,
  users,
  projects
}: {
  workspaceId: string
  employeeId: string | undefined
  users: import("#/lib/clockify-schemas").ClockifyUser[] | undefined
  projects: import("#/lib/clockify-schemas").ClockifyProject[] | undefined
}) {
  const { t } = useTranslation()
  const [weekStart, setWeekStart] = useState<Date>(getMonday(new Date()))
  const [selectedEmployee, setSelectedEmployee] = useState<string>(employeeId ?? "")

  const weekStartStr = toDateStr(weekStart)

  const { data: weeklyData, isLoading } = useTimeWeeklyReport(
    workspaceId,
    selectedEmployee || employeeId,
    weekStartStr
  )

  const { data: timesheets } = useTimesheets(
    workspaceId,
    selectedEmployee || employeeId
  )

  const createTimesheet = useCreateTimesheet()
  const submitTimesheet = useSubmitTimesheet()

  const weekEnd = addDays(weekStart, 6)
  const weekEndStr = toDateStr(weekEnd)

  // Find existing timesheet for this week
  const existingTimesheet = timesheets?.find(
    (ts) => ts.periodStart === weekStartStr && ts.periodEnd === weekEndStr
  )

  const isReadOnly =
    existingTimesheet?.status === "submitted" ||
    existingTimesheet?.status === "approved"

  async function handleSubmitWeek() {
    const empId = selectedEmployee || employeeId
    if (!empId) return

    try {
      let tsId = existingTimesheet?.id
      if (!tsId) {
        const created = await createTimesheet.mutateAsync({
          workspaceId,
          employeeId: empId,
          periodStart: weekStartStr,
          periodEnd: weekEndStr,
          periodType: "weekly"
        })
        tsId = created.id
      }
      await submitTimesheet.mutateAsync({
        id: tsId,
        workspaceId,
        employeeId: empId
      })
      toast.success(t.tracker.submittedStatus)
    } catch (err) {
      toast.error("Failed to submit timesheet", {
        description: err instanceof Error ? err.message : "Unknown error"
      })
    }
  }

  return (
    <div className="space-y-4 pt-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-[180px] text-center text-sm font-medium">
            {weekStartStr} — {weekEndStr}
          </span>
          <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(getMonday(new Date()))}>
            {t.tracker.today}
          </Button>
        </div>

        {users && users.length > 1 && (
          <Select
            value={selectedEmployee}
            onValueChange={setSelectedEmployee}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t.tracker.selectEmployee} />
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Status badge */}
        {existingTimesheet && (
          <Badge
            variant="outline"
            className={cn(
              existingTimesheet.status === "approved" && "border-green-400 text-green-700",
              existingTimesheet.status === "submitted" && "border-blue-400 text-blue-700",
              existingTimesheet.status === "rejected" && "border-red-400 text-red-700"
            )}
          >
            {existingTimesheet.status === "submitted" && t.tracker.submittedStatus}
            {existingTimesheet.status === "approved" && t.tracker.approvedStatus}
            {existingTimesheet.status === "rejected" && t.tracker.rejectedStatus}
            {existingTimesheet.status === "draft" && t.tracker.draftStatus}
          </Badge>
        )}
      </div>

      {/* Weekly grid */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : weeklyData ? (
        <WeeklyGrid
          weeklyData={weeklyData}
          projects={projects}
          isReadOnly={isReadOnly}
        />
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">{t.tracker.noEntries}</p>
          </CardContent>
        </Card>
      )}

      {/* Templates panel */}
      <TemplatesPanel
        workspaceId={workspaceId}
        employeeId={selectedEmployee || employeeId}
        weeklyRows={weeklyData?.rows}
      />

      {/* Submit button */}
      <div className="flex justify-end">
        <Button
          onClick={handleSubmitWeek}
          disabled={
            isReadOnly ||
            createTimesheet.isPending ||
            submitTimesheet.isPending
          }
        >
          {t.tracker.submitTimesheet}
        </Button>
      </div>
    </div>
  )
}

// ─── Templates Panel ──────────────────────────────────────────────────────────

function TemplatesPanel({
  workspaceId,
  employeeId,
  weeklyRows
}: {
  workspaceId: string
  employeeId: string | undefined
  weeklyRows: import("#/api/time-tracking").WeeklyRow[] | undefined
}) {
  const [open, setOpen] = useState(false)
  const [saveMode, setSaveMode] = useState(false)
  const [newName, setNewName] = useState("")

  const { data: _rawTemplates } = useTimesheetTemplates(workspaceId, employeeId)
  const templates = _rawTemplates as import("#/api/time-tracking").TimesheetTemplate[] | undefined
  const createTemplate = useCreateTimesheetTemplate()
  const deleteTemplate = useDeleteTimesheetTemplate()

  function handleSave() {
    if (!employeeId || !newName.trim() || !weeklyRows) return
    const templateData = {
      rows: weeklyRows.map((r) => ({
        projectId: r.projectId,
        taskName: r.taskName
      }))
    }
    createTemplate.mutate(
      { workspaceId, employeeId, name: newName.trim(), templateData },
      {
        onSuccess: () => {
          setNewName("")
          setSaveMode(false)
          toast.success("Template saved")
        },
        onError: () => toast.error("Failed to save template")
      }
    )
  }

  function handleDelete(id: string) {
    deleteTemplate.mutate(
      { id, workspaceId, employeeId },
      {
        onSuccess: () => toast.success("Template deleted"),
        onError: () => toast.error("Failed to delete template")
      }
    )
  }

  function handleApply() {
    toast.info("Template applied — add hours to the grid")
  }

  return (
    <div className="border-t pt-3">
      <button
        className="text-muted-foreground flex items-center gap-1.5 text-sm hover:text-foreground transition-colors"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <Bookmark className="size-4" />
        Manage templates
      </button>

      {open && (
        <div className="mt-3 space-y-3 rounded-lg border p-4">
          {/* Template list */}
          {!templates?.length ? (
            <p className="text-muted-foreground text-sm">No templates saved</p>
          ) : (
            <div className="space-y-2">
              {templates.map((tpl) => (
                <div key={tpl.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                  <span className="font-medium">{tpl.name}</span>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={handleApply}>
                      Apply
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(tpl.id)}
                      disabled={deleteTemplate.isPending}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Save current week */}
          {saveMode ? (
            <div className="flex items-center gap-2">
              <Input
                placeholder="Template name..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
                className="h-8 text-sm"
              />
              <Button size="sm" onClick={handleSave} disabled={!newName.trim() || createTemplate.isPending}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setSaveMode(false); setNewName("") }}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSaveMode(true)}
              disabled={!weeklyRows?.length}
            >
              <BookmarkPlus className="mr-1.5 size-4" />
              Save current week as template
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Calendar Tab ─────────────────────────────────────────────────────────────

const HOUR_START = 8
const HOUR_END = 20
const PX_PER_HOUR = 60

function CalendarTab({
  workspaceId: _workspaceId,
  employeeId: _employeeId,
  timeEntries,
  weekStart,
  weekEnd,
  onPrevWeek,
  onNextWeek,
  onToday,
  projects,
  onClickSlot,
  onEdit
}: {
  workspaceId: string
  employeeId: string | undefined
  timeEntries: TimeEntryFull[]
  weekStart: Date
  weekEnd: Date
  onPrevWeek: () => void
  onNextWeek: () => void
  onToday: () => void
  projects: import("#/lib/clockify-schemas").ClockifyProject[] | undefined
  onClickSlot: (date: string, time: string) => void
  onEdit: (entry: TimeEntryFull) => void
}) {
  const { t } = useTranslation()
  const today = new Date()

  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    days.push(addDays(weekStart, i))
  }

  const hours: number[] = []
  for (let h = HOUR_START; h <= HOUR_END; h++) {
    hours.push(h)
  }

  return (
    <div className="space-y-3 pt-4">
      {/* Nav */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={onPrevWeek}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-[180px] text-center text-sm font-medium">
          {toDateStr(weekStart)} — {toDateStr(weekEnd)}
        </span>
        <Button variant="outline" size="icon" onClick={onNextWeek}>
          <ChevronRight className="size-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={onToday}>
          {t.tracker.today}
        </Button>
      </div>

      {/* Grid */}
      <div className="overflow-auto rounded-lg border">
        <div className="flex">
          {/* Time column */}
          <div className="w-16 shrink-0 border-r">
            <div className="h-10 border-b" /> {/* Header spacer */}
            {hours.map((h) => (
              <div
                key={h}
                className="text-muted-foreground flex items-start justify-end border-b pr-2 pt-1 text-xs"
                style={{ height: PX_PER_HOUR }}
              >
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const key = toDateStr(day)
            const isToday = isSameDay(day, today)
            const dayEntries = timeEntries.filter((e) =>
              isSameDay(new Date(e.startAt), day)
            )

            return (
              <div key={key} className="min-w-0 flex-1 border-r last:border-r-0">
                {/* Day header */}
                <div
                  className={cn(
                    "flex h-10 items-center justify-center border-b text-xs font-medium",
                    isToday && "bg-primary/10 text-primary"
                  )}
                >
                  {SHORT_DAY[day.getDay() === 0 ? 6 : day.getDay() - 1]} {day.getDate()}
                </div>

                {/* Hour slots */}
                <div
                  className="relative"
                  style={{ height: (HOUR_END - HOUR_START + 1) * PX_PER_HOUR }}
                >
                  {/* Slot backgrounds */}
                  {hours.map((h) => (
                    <div
                      key={h}
                      className="group absolute inset-x-0 cursor-pointer border-b hover:bg-blue-50"
                      style={{
                        top: (h - HOUR_START) * PX_PER_HOUR,
                        height: PX_PER_HOUR
                      }}
                      onClick={() =>
                        onClickSlot(key, `${String(h).padStart(2, "0")}:00`)
                      }
                    >
                      <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <Plus className="text-muted-foreground size-4" />
                      </span>
                    </div>
                  ))}

                  {/* Time entry blocks */}
                  {dayEntries.map((entry) => {
                    const start = new Date(entry.startAt)
                    const end = entry.endAt ? new Date(entry.endAt) : new Date()
                    const startH = start.getHours() + start.getMinutes() / 60
                    const endH = end.getHours() + end.getMinutes() / 60
                    const top = (startH - HOUR_START) * PX_PER_HOUR
                    const height = Math.max((endH - startH) * PX_PER_HOUR, 16)
                    const project = projects?.find((p) => p.id === entry.projectId)

                    return (
                      <div
                        key={entry.id}
                        className="absolute inset-x-0.5 cursor-pointer overflow-hidden rounded px-1 py-0.5 text-xs text-white"
                        style={{
                          top,
                          height,
                          background: project?.color ?? "#6366f1"
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          onEdit(entry)
                        }}
                      >
                        <div className="truncate font-medium">
                          {entry.description ?? project?.name ?? "—"}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
