import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle, XCircle, Clock, ChevronDown, ChevronRight, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import {
  useManagerTimesheets,
  useApproveTimesheet,
  useRejectTimesheet,
  type Timesheet
} from "#/api/time-tracking"
import { queriesUsers } from "#/api/queries"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { Card, CardContent } from "#/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "#/components/ui/dialog"
import { Skeleton } from "#/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs"
import { Textarea } from "#/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "#/components/ui/select"
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar"
import { workspaceSearchSchema } from "#/lib/search-schema"
import { useTranslation } from "#/lib/i18n"
import { cn } from "#/lib/utils"

export const Route = createFileRoute("/timesheets")({
  validateSearch: workspaceSearchSchema,
  component: TimesheetsPage
})

function formatPeriod(start: string, end: string) {
  const s = new Date(start)
  const e = new Date(end)
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.getDate()}–${e.getDate()} ${monthNames[s.getMonth()]} ${s.getFullYear()}`
  }
  return `${s.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${e.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
}

function daysAgo(isoStr: string | undefined) {
  if (!isoStr) return ""
  const days = Math.floor((Date.now() - new Date(isoStr).getTime()) / 86400000)
  if (days === 0) return "today"
  if (days === 1) return "1 day ago"
  return `${days} days ago`
}

function TimesheetsPage() {
  const { workspaceId } = Route.useSearch()
  const { t } = useTranslation()

  const { data: allUsers } = useQuery({
    ...queriesUsers.workspaceUsers(workspaceId ?? ""),
    enabled: !!workspaceId
  })

  const { data: pending, isLoading: pendingLoading } = useManagerTimesheets(workspaceId, "submitted")
  const { data: history, isLoading: historyLoading } = useManagerTimesheets(workspaceId)

  const approveTs = useApproveTimesheet()
  const rejectTs = useRejectTimesheet()

  const [rejectModal, setRejectModal] = useState<{ tsId: string; employeeId: string } | null>(null)
  const [rejectNote, setRejectNote] = useState("")
  const [filterEmployee, setFilterEmployee] = useState<string>("all")
  const [filterMonth, setFilterMonth] = useState<string>("all")
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const managerEmployeeId = allUsers?.[0]?.id ?? "manager"

  const userMap = new Map(allUsers?.map((u) => [u.id, u]) ?? [])

  function getUser(employeeId: string) {
    return userMap.get(employeeId)
  }

  function handleApprove(ts: Timesheet) {
    if (!workspaceId) return
    approveTs.mutate(
      { id: ts.id, workspaceId, approvedBy: managerEmployeeId, employeeId: ts.employeeId },
      {
        onSuccess: () => toast.success(t.timesheets.approved),
        onError: () => toast.error(t.common.error)
      }
    )
  }

  function openReject(ts: Timesheet) {
    setRejectNote("")
    setRejectModal({ tsId: ts.id, employeeId: ts.employeeId })
  }

  function handleRejectConfirm() {
    if (!workspaceId || !rejectModal || !rejectNote.trim()) return
    rejectTs.mutate(
      {
        id: rejectModal.tsId,
        workspaceId,
        rejectionNote: rejectNote.trim(),
        employeeId: rejectModal.employeeId
      },
      {
        onSuccess: () => {
          toast.success(t.timesheets.rejected)
          setRejectModal(null)
        },
        onError: () => toast.error(t.common.error)
      }
    )
  }

  const historyFiltered = (history ?? []).filter((ts) => {
    if (ts.status === "submitted") return false // pending handled in other tab
    if (filterEmployee !== "all" && ts.employeeId !== filterEmployee) return false
    if (filterMonth !== "all") {
      const m = ts.periodStart.slice(0, 7)
      if (m !== filterMonth) return false
    }
    return true
  })

  // Build month list from history
  const months = [...new Set((history ?? []).map((ts) => ts.periodStart.slice(0, 7)))].sort().reverse()

  if (!workspaceId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">{t.timesheets.noWorkspace}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold text-zinc-100 leading-none">{t.timesheets.title}</h1>
          <p className="text-xs text-zinc-500 mt-1">Miesięczne zestawienia</p>
        </div>
      </div>
      <div className="p-6 space-y-6">

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">
            {t.timesheets.pending}
            {(pending?.length ?? 0) > 0 && (
              <Badge variant="destructive" className="ml-2 size-5 justify-center p-0 text-xs">
                {pending?.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">{t.timesheets.history}</TabsTrigger>
        </TabsList>

        {/* Pending tab */}
        <TabsContent value="pending" className="mt-4">
          {pendingLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : !pending?.length ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle className="text-muted-foreground mx-auto mb-3 size-10 opacity-40" />
                <p className="text-muted-foreground">{t.timesheets.noPending}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {pending.map((ts) => {
                const user = getUser(ts.employeeId)
                return (
                  <Card key={ts.id}>
                    <CardContent className="flex items-center gap-4 p-4">
                      <Avatar className="size-10 shrink-0">
                        <AvatarImage src={user?.profilePicture ?? undefined} />
                        <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                          {(user?.name ?? "?").split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{user?.name ?? ts.employeeId}</p>
                        <p className="text-muted-foreground text-sm">
                          {formatPeriod(ts.periodStart, ts.periodEnd)}
                          {ts.submittedAt && (
                            <span className="ml-2 opacity-60">· submitted {daysAgo(ts.submittedAt)}</span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleApprove(ts)}
                          disabled={approveTs.isPending}
                        >
                          {approveTs.isPending ? (
                            <RefreshCw className="mr-1.5 size-4 animate-spin" />
                          ) : (
                            <CheckCircle className="mr-1.5 size-4" />
                          )}
                          {t.timesheets.approve}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          onClick={() => openReject(ts)}
                        >
                          <XCircle className="mr-1.5 size-4" />
                          {t.timesheets.reject}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* History tab */}
        <TabsContent value="history" className="mt-4">
          <div className="mb-4 flex flex-wrap gap-3">
            <Select value={filterEmployee} onValueChange={setFilterEmployee}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t.timesheets.allEmployees} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.timesheets.allEmployees}</SelectItem>
                {allUsers?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterMonth} onValueChange={setFilterMonth}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={t.timesheets.allMonths} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.timesheets.allMonths}</SelectItem>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {historyLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : !historyFiltered.length ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Clock className="text-muted-foreground mx-auto mb-3 size-10 opacity-40" />
                <p className="text-muted-foreground">{t.timesheets.noHistory}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {historyFiltered.map((ts) => {
                const user = getUser(ts.employeeId)
                const approver = ts.approvedBy ? getUser(ts.approvedBy) : null
                const isExpanded = expandedId === ts.id
                return (
                  <Card
                    key={ts.id}
                    className={cn("cursor-pointer transition-colors hover:bg-gray-50/50", ts.status === "rejected" && "border-red-200")}
                    onClick={() => setExpandedId(isExpanded ? null : ts.id)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        <Avatar className="size-8 shrink-0">
                          <AvatarImage src={user?.profilePicture ?? undefined} />
                          <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                            {(user?.name ?? "?").split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{user?.name ?? ts.employeeId}</p>
                          <p className="text-muted-foreground text-sm">{formatPeriod(ts.periodStart, ts.periodEnd)}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          {ts.status === "approved" ? (
                            <Badge className="border-green-300 bg-green-50 text-green-700">
                              <CheckCircle className="mr-1 size-3" /> {t.timesheets.approved}
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="border-red-300 bg-red-50 text-red-700">
                              <XCircle className="mr-1 size-3" /> {t.timesheets.rejected}
                            </Badge>
                          )}
                          {approver && (
                            <span className="text-muted-foreground text-xs">{approver.name}</span>
                          )}
                          {ts.approvedAt && (
                            <span className="text-muted-foreground text-xs">{daysAgo(ts.approvedAt)}</span>
                          )}
                          {isExpanded ? <ChevronDown className="size-4 opacity-40" /> : <ChevronRight className="size-4 opacity-40" />}
                        </div>
                      </div>
                      {isExpanded && ts.rejectionNote && (
                        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                          <span className="font-medium">Rejection note: </span>{ts.rejectionNote}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Reject modal */}
      <Dialog open={!!rejectModal} onOpenChange={(open) => { if (!open) setRejectModal(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.timesheets.rejectConfirm}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">{t.timesheets.rejectNote}</p>
            <Textarea
              placeholder={`${t.timesheets.rejectReason}...`}
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectModal(null)}>{t.action.cancel}</Button>
            <Button
              variant="destructive"
              disabled={!rejectNote.trim() || rejectTs.isPending}
              onClick={handleRejectConfirm}
            >
              {rejectTs.isPending ? (
                <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Odrzucam...</>
              ) : (
                t.timesheets.reject
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  )
}
