import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import {
  useCreateManualEntry,
  useStopTimer,
  useTaskSuggestions,
  useUpdateManualEntry
} from "#/api/time-tracking"
import { queriesProjects } from "#/api/queries"
import { Button } from "#/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "#/components/ui/dialog"
import { Input } from "#/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "#/components/ui/select"
import { useTranslation } from "#/lib/i18n"
import { cn } from "#/lib/utils"

export interface TimeEntryFormData {
  date: string
  startTime: string
  endTime: string
  durationHhmm: string
  projectId: string
  taskName: string
  description: string
  billable: boolean
  tags: string
}

export interface TimeEntryFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  employeeId: string
  mode: "create" | "edit" | "complete-timer"
  initialData?: Partial<TimeEntryFormData>
  entryId?: string
  locked?: boolean
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

function hhmmToSeconds(hhmm: string): number {
  const parts = hhmm.split(":")
  const h = parseInt(parts[0] ?? "0", 10) || 0
  const m = parseInt(parts[1] ?? "0", 10) || 0
  return h * 3600 + m * 60
}


const MODE_LS_KEY = "time-entry-mode"

export function TimeEntryForm({
  open,
  onOpenChange,
  workspaceId,
  employeeId,
  mode,
  initialData,
  entryId,
  locked = false
}: TimeEntryFormProps) {
  const { t } = useTranslation()

  const now = new Date()
  const defaultDate = toDateStr(now)
  const defaultStart = toTimeStr(now)
  const defaultEnd = toTimeStr(new Date(now.getTime() + 3600000))

  const [inputMode, setInputMode] = useState<"start-end" | "duration">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(MODE_LS_KEY)
      if (saved === "start-end" || saved === "duration") return saved
    }
    return "start-end"
  })

  const [date, setDate] = useState(initialData?.date ?? defaultDate)
  const [startTime, setStartTime] = useState(initialData?.startTime ?? defaultStart)
  const [endTime, setEndTime] = useState(initialData?.endTime ?? defaultEnd)
  const [durationHhmm, setDurationHhmm] = useState(initialData?.durationHhmm ?? "01:00")
  const [projectId, setProjectId] = useState(initialData?.projectId ?? "")
  const [taskName, setTaskName] = useState(initialData?.taskName ?? "")
  const [description, setDescription] = useState(initialData?.description ?? "")
  const [billable, setBillable] = useState(initialData?.billable ?? false)
  const [tags, setTags] = useState(initialData?.tags ?? "")
  const [taskQuery, setTaskQuery] = useState("")
  const [showSuggestions, setShowSuggestions] = useState(false)
  const taskInputRef = useRef<HTMLInputElement>(null)

  const { data: projects } = useQuery({
    ...queriesProjects.workspaceProjects(workspaceId),
    enabled: !!workspaceId
  })

  const { data: suggestions } = useTaskSuggestions(
    employeeId,
    projectId || undefined,
    taskQuery
  )

  const createEntry = useCreateManualEntry()
  const updateEntry = useUpdateManualEntry()
  const stopTimer = useStopTimer()

  // Sync billable with selected project default
  useEffect(() => {
    if (projectId && mode === "create") {
      const proj = projects?.find((p) => p.id === projectId)
      if (proj?.billable !== undefined) {
        setBillable(proj.billable ?? false)
      }
    }
  }, [projectId, projects, mode])

  // Sync initialData when it changes (e.g. opening from running timer)
  useEffect(() => {
    if (!open) return
    setDate(initialData?.date ?? defaultDate)
    setStartTime(initialData?.startTime ?? defaultStart)
    setEndTime(initialData?.endTime ?? defaultEnd)
    setDurationHhmm(initialData?.durationHhmm ?? "01:00")
    setProjectId(initialData?.projectId ?? "")
    setTaskName(initialData?.taskName ?? "")
    setDescription(initialData?.description ?? "")
    setBillable(initialData?.billable ?? false)
    setTags(initialData?.tags ?? "")
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, JSON.stringify(initialData)])

  function switchMode(m: "start-end" | "duration") {
    setInputMode(m)
    localStorage.setItem(MODE_LS_KEY, m)
  }

  function buildStartEndIso(): { startAt: string; endAt: string } | null {
    if (inputMode === "start-end") {
      const startAt = new Date(`${date}T${startTime}`).toISOString()
      const endAt = new Date(`${date}T${endTime}`).toISOString()
      if (new Date(endAt) <= new Date(startAt)) return null
      return { startAt, endAt }
    } else {
      const secs = hhmmToSeconds(durationHhmm)
      if (secs <= 0) return null
      const startAt = new Date(`${date}T${startTime}`).toISOString()
      const endAt = new Date(new Date(startAt).getTime() + secs * 1000).toISOString()
      return { startAt, endAt }
    }
  }

  function isValid(): boolean {
    if (!projectId) return false
    if (inputMode === "start-end") {
      return !!(date && startTime && endTime)
    }
    return !!(date && startTime && hhmmToSeconds(durationHhmm) > 0)
  }

  function handleSubmit() {
    if (!isValid()) return

    const tagList = tags
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)

    if (mode === "complete-timer") {
      stopTimer.mutate(
        {
          workspaceId,
          employeeId,
          description: description || taskName || undefined,
          projectId: projectId || undefined,
          billable,
          tags: tagList.length > 0 ? tagList : undefined
        },
        {
          onSuccess: () => {
            toast.success(t.tracker.stopTimer)
            onOpenChange(false)
          },
          onError: (err) => {
            toast.error("Failed to stop timer", {
              description: err instanceof Error ? err.message : "Unknown error"
            })
          }
        }
      )
      return
    }

    const times = buildStartEndIso()
    if (!times) return

    if (mode === "edit" && entryId) {
      updateEntry.mutate(
        {
          id: entryId,
          workspaceId,
          projectId: projectId || undefined,
          description: description || taskName || undefined,
          billable,
          startAt: times.startAt,
          endAt: times.endAt,
          tags: tagList.length > 0 ? tagList : undefined
        },
        {
          onSuccess: () => {
            toast.success(t.tracker.editEntry)
            onOpenChange(false)
          },
          onError: (err) => {
            toast.error("Failed to update entry", {
              description: err instanceof Error ? err.message : "Unknown error"
            })
          }
        }
      )
    } else {
      createEntry.mutate(
        {
          workspaceId,
          employeeId,
          projectId: projectId || undefined,
          description: description || taskName || "",
          billable,
          startAt: times.startAt,
          endAt: times.endAt,
          tags: tagList.length > 0 ? tagList : undefined
        },
        {
          onSuccess: () => {
            toast.success(t.tracker.addEntry)
            onOpenChange(false)
          },
          onError: (err) => {
            toast.error("Failed to create entry", {
              description: err instanceof Error ? err.message : "Unknown error"
            })
          }
        }
      )
    }
  }

  const isPending = createEntry.isPending || updateEntry.isPending || stopTimer.isPending

  const titleMap = {
    create: t.tracker.addEntry,
    edit: t.tracker.editEntry,
    "complete-timer": t.tracker.stopTimer
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{titleMap[mode]}</DialogTitle>
        </DialogHeader>

        {/* Locked banner */}
        {locked && (
          <div className="rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
            {t.tracker.lockedEntry}
          </div>
        )}

        <div className="space-y-4">
          {/* Date */}
          <div>
            <label className="mb-1 block text-sm font-medium">{t.tracker.date}</label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={locked}
            />
          </div>

          {/* Mode toggle — only for create/edit */}
          {mode !== "complete-timer" && (
            <div>
              <label className="mb-1 block text-sm font-medium">{t.tracker.duration}</label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={inputMode === "start-end" ? "default" : "outline"}
                  onClick={() => switchMode("start-end")}
                  disabled={locked}
                  type="button"
                >
                  {t.tracker.startEndMode}
                </Button>
                <Button
                  size="sm"
                  variant={inputMode === "duration" ? "default" : "outline"}
                  onClick={() => switchMode("duration")}
                  disabled={locked}
                  type="button"
                >
                  {t.tracker.durationMode}
                </Button>
              </div>
            </div>
          )}

          {/* Time inputs */}
          {mode !== "complete-timer" && inputMode === "start-end" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">{t.tracker.startTime}</label>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  disabled={locked}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t.tracker.endTime}</label>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  disabled={locked}
                />
              </div>
            </div>
          )}

          {mode !== "complete-timer" && inputMode === "duration" && (
            <div>
              <label className="mb-1 block text-sm font-medium">{t.tracker.durationMode}</label>
              <Input
                placeholder="hh:mm"
                value={durationHhmm}
                onChange={(e) => setDurationHhmm(e.target.value)}
                disabled={locked}
              />
            </div>
          )}

          {/* Project */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t.tracker.project} <span className="text-red-500">*</span>
            </label>
            <Select value={projectId} onValueChange={setProjectId} disabled={locked}>
              <SelectTrigger>
                <SelectValue placeholder={t.tracker.selectProject} />
              </SelectTrigger>
              <SelectContent>
                {projects?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ background: p.color ?? "#888" }}
                      />
                      {p.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Task name with autocomplete */}
          <div className="relative">
            <label className="mb-1 block text-sm font-medium">{t.tracker.task}</label>
            <Input
              ref={taskInputRef}
              placeholder={t.tracker.whatAreYouWorkingOn}
              value={taskName}
              onChange={(e) => {
                setTaskName(e.target.value)
                setTaskQuery(e.target.value)
                setShowSuggestions(true)
              }}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onFocus={() => setShowSuggestions(true)}
              disabled={locked}
            />
            {showSuggestions && suggestions && suggestions.length > 0 && (
              <ul className="absolute z-50 mt-1 max-h-40 w-full overflow-auto rounded-md border bg-white shadow-lg">
                {suggestions.map((s) => (
                  <li
                    key={s.taskName}
                    className="cursor-pointer px-3 py-2 text-sm hover:bg-gray-100"
                    onMouseDown={() => {
                      setTaskName(s.taskName)
                      setShowSuggestions(false)
                    }}
                  >
                    {s.taskName}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-sm font-medium">{t.tracker.description}</label>
            <textarea
              className={cn(
                "border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[80px] w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50"
              )}
              placeholder={t.tracker.description}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={locked}
            />
          </div>

          {/* Billable */}
          <div className="flex items-center gap-2">
            <input
              id="billable-check"
              type="checkbox"
              checked={billable}
              onChange={(e) => setBillable(e.target.checked)}
              disabled={locked}
              className="size-4 rounded border-gray-300"
            />
            <label htmlFor="billable-check" className="text-sm font-medium">
              {t.tracker.billable}
            </label>
          </div>

          {/* Tags */}
          <div>
            <label className="mb-1 block text-sm font-medium">{t.tracker.tags}</label>
            <Input
              placeholder="tag1, tag2"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              disabled={locked}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 flex gap-2">
          {!locked && (
            <Button
              className="flex-1"
              onClick={handleSubmit}
              disabled={isPending || !isValid()}
            >
              {isPending ? t.common.loading : t.tracker.save}
            </Button>
          )}
          <Button
            variant={locked ? "default" : "outline"}
            className={locked ? "flex-1" : ""}
            onClick={() => onOpenChange(false)}
          >
            {locked ? t.tracker.cancel : t.tracker.cancel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
