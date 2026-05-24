import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Play, Square, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import {
  useDiscardTimer,
  useRunningTimer,
  useStartTimer
} from "#/api/time-tracking"
import { queriesProjects, queriesUsers } from "#/api/queries"
import { Button } from "#/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "#/components/ui/select"
import { Input } from "#/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip"
import { useTranslation } from "#/lib/i18n"

interface TimerWidgetProps {
  workspaceId: string | undefined
  onStopTimer?: (data: { description?: string; projectId?: string; tags?: string[] }) => void
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export function TimerWidget({ workspaceId, onStopTimer }: TimerWidgetProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [isPopoverOpen, setIsPopoverOpen] = useState(false)
  const [popoverProject, setPopoverProject] = useState<string>("")
  const [popoverTask, setPopoverTask] = useState<string>("")
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Get the first user in the workspace as the employee
  const { data: users } = useQuery({
    ...queriesUsers.workspaceUsers(workspaceId ?? ""),
    enabled: !!workspaceId
  })
  const employeeId = users?.[0]?.id

  const { data: projects } = useQuery({
    ...queriesProjects.workspaceProjects(workspaceId ?? ""),
    enabled: !!workspaceId
  })

  const { data: runningTimer } = useRunningTimer(workspaceId, employeeId)
  const startTimer = useStartTimer()
  const discardTimer = useDiscardTimer()

  const isRunning = !!runningTimer

  // Tick the elapsed counter
  useEffect(() => {
    if (!isRunning || !runningTimer?.startAt) {
      setElapsedSeconds(0)
      return
    }
    const startMs = new Date(runningTimer.startAt).getTime()
    const tick = () => {
      setElapsedSeconds(Math.floor((Date.now() - startMs) / 1000))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [isRunning, runningTimer?.startAt])

  // Close popover on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsPopoverOpen(false)
      }
    }
    if (isPopoverOpen) {
      document.addEventListener("mousedown", handleOutside)
    }
    return () => document.removeEventListener("mousedown", handleOutside)
  }, [isPopoverOpen])

  // Keyboard shortcut: T to toggle timer (when not in an input)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if (e.key === "t" || e.key === "T") {
        if (isRunning) {
          handleStop()
        } else {
          handleStartClick()
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, workspaceId, employeeId])

  function handleStartClick() {
    if (!workspaceId) return
    setIsPopoverOpen(true)
  }

  function handleStart() {
    if (!workspaceId || !employeeId) return
    startTimer.mutate(
      { workspaceId, employeeId },
      {
        onSuccess: () => {
          setIsPopoverOpen(false)
          setPopoverTask("")
          setPopoverProject("")
          void queryClient.invalidateQueries({
            queryKey: ["timer", "running", workspaceId, employeeId]
          })
        },
        onError: (err) => {
          toast.error("Failed to start timer", {
            description: err instanceof Error ? err.message : "Unknown error"
          })
        }
      }
    )
  }

  function handleStop() {
    if (!workspaceId || !employeeId || !runningTimer) return
    // Delegate to parent (which opens TimeEntryForm in complete-timer mode)
    if (onStopTimer) {
      onStopTimer({
        description: runningTimer.description,
        projectId: runningTimer.projectId,
        tags: runningTimer.tags
      })
    }
  }

  function handleDiscard() {
    if (!workspaceId || !employeeId) return
    if (!window.confirm(t.tracker.discardConfirm)) return
    discardTimer.mutate(
      { workspaceId, employeeId },
      {
        onSuccess: () => {
          toast.success(t.tracker.discardTimer)
        },
        onError: (err) => {
          toast.error("Failed to discard timer", {
            description: err instanceof Error ? err.message : "Unknown error"
          })
        }
      }
    )
  }

  const runningProject = projects?.find((p) => p.id === runningTimer?.projectId)

  if (!workspaceId) return null

  return (
    <div className="relative flex items-center gap-2" ref={popoverRef}>
      {isRunning ? (
        // Running state
        <div className="flex items-center gap-2 rounded-lg border bg-red-50 px-3 py-1.5">
          {/* Pulsing red dot */}
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-red-500" />
          </span>

          {/* Project name */}
          {runningProject && (
            <span
              className="max-w-[120px] truncate text-sm font-medium"
              style={{ color: runningProject.color ?? undefined }}
            >
              {runningProject.name}
            </span>
          )}

          {/* Elapsed counter */}
          <span className="font-mono text-sm font-semibold tabular-nums text-red-700">
            {formatElapsed(elapsedSeconds)}
          </span>

          {/* Stop button */}
          <Button
            size="sm"
            variant="destructive"
            className="h-7 px-2 text-xs"
            onClick={handleStop}
          >
            <Square className="size-3" />
            {t.tracker.stopTimer}
          </Button>

          {/* Discard button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 text-red-600 hover:bg-red-100 hover:text-red-700"
                onClick={handleDiscard}
                disabled={discardTimer.isPending}
              >
                <X className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.tracker.discardTimer}</TooltipContent>
          </Tooltip>
        </div>
      ) : (
        // Idle state
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={handleStartClick}
          disabled={startTimer.isPending}
        >
          <Play className="size-3.5" />
          {t.tracker.startTimer}
        </Button>
      )}

      {/* Start popover */}
      {isPopoverOpen && !isRunning && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border bg-white p-4 shadow-lg">
          <p className="mb-3 text-sm font-medium text-gray-700">
            {t.tracker.startTimer}
          </p>

          {/* Project selector */}
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              {t.tracker.project}
            </label>
            <Select value={popoverProject} onValueChange={setPopoverProject}>
              <SelectTrigger className="w-full">
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

          {/* Task name input */}
          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              {t.tracker.task}
            </label>
            <Input
              placeholder={t.tracker.whatAreYouWorkingOn}
              value={popoverTask}
              onChange={(e) => setPopoverTask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleStart()
              }}
              autoFocus
            />
          </div>

          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={handleStart}
              disabled={startTimer.isPending}
            >
              <Play className="size-3.5" />
              {t.tracker.start}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setIsPopoverOpen(false)}
            >
              {t.tracker.cancel}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
