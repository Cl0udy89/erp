import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  FolderKanban,
  Timer,
  Clock,
  TrendingUp,
  CheckSquare,
  CloudOff,
  Play,
  CheckCircle
} from "lucide-react"
import { useEffect, useState } from "react"
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  AreaChart,
  Area,
  Line,
  ReferenceLine
} from "recharts"

import { financeQueries } from "#/api/finance"
import { queriesDashboard, queriesUsers } from "#/api/queries"
import {
  useRunningTimer,
  useManagerTimesheets,
  useApproveTimesheet
} from "#/api/time-tracking"
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card"
import { Input } from "#/components/ui/input"
import { Skeleton } from "#/components/ui/skeleton"
import { Button } from "#/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar"
import { getIntervalDurationMs } from "#/lib/clockify-schemas"
import { useTranslation } from "#/lib/i18n"
import { getWorkspaceId, workspaceSearchSchema } from "#/lib/search-schema"
import { cn, formatDuration, formatPLN } from "#/lib/utils"
import { useAuth } from "#/lib/auth-context"
import { backendGet } from "#/lib/backend-client"
import { createServerFn } from "@tanstack/react-start"

export const Route = createFileRoute("/")({
  loader: async ({ context, location }) => {
    const workspaceId = getWorkspaceId(location.search)
    const year = new Date().getFullYear()
    if (workspaceId) {
      await context.queryClient.prefetchQuery({ ...queriesDashboard.dashboardData(workspaceId) })
      await context.queryClient.prefetchQuery({
        ...financeQueries.flowSummary(`${year}-01-01`, `${year}-12-31`)
      })
      await context.queryClient.prefetchQuery({
        ...financeQueries.projectProfitability(year, workspaceId)
      })
    }
  },
  validateSearch: workspaceSearchSchema,
  component: DashboardPage
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatHours(ms: number): string {
  const h = Math.floor(ms / 3600000)
  return `${h}h`
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function formatPeriod(start: string, end: string) {
  const s = new Date(start)
  const e = new Date(end)
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.getDate()}–${e.getDate()} ${monthNames[s.getMonth()]} ${s.getFullYear()}`
  }
  return `${s.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${e.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
}

// ─── Server function for badge counts ─────────────────────────────────────────

const fetchBadgeCountsFn = createServerFn({ method: "GET" })
  .inputValidator((workspaceId: string) => workspaceId)
  .handler(async ({ data: workspaceId }) =>
    backendGet<{ pendingTimesheets: number; syncErrors: number; staleDraftWarehouse: number }>(
      `/workspace/badge-counts?workspaceId=${workspaceId}`
    )
  )

// ─── Server function for audit log ────────────────────────────────────────────

const fetchAuditLogFn = createServerFn({ method: "GET" })
  .inputValidator((workspaceId: string) => workspaceId)
  .handler(async ({ data: workspaceId }) =>
    backendGet<{ rows: Array<{ id: string; created_at: string; actor_name: string; action: string; entity_type: string; entity_label?: string }> }>(
      `/audit?workspaceId=${workspaceId}&limit=5`
    )
  )

// ─── Active Timer Panel ────────────────────────────────────────────────────────

function ActiveTimerPanel({ workspaceId, employeeId }: { workspaceId: string; employeeId: string | undefined }) {
  const { t } = useTranslation()
  const { data: runningTimer, isLoading } = useRunningTimer(workspaceId, employeeId)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!runningTimer?.startAt) {
      setElapsed(0)
      return
    }
    const startMs = new Date(runningTimer.startAt).getTime()
    const tick = () => setElapsed(Date.now() - startMs)
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [runningTimer?.startAt])

  return (
    <Card className="border-l-4 border-l-green-500">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
          <span>{t.dashboard.activeTimer}</span>
          <Timer className="h-4 w-4 text-muted-foreground" />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-32" />
        ) : runningTimer ? (
          <div>
            <div className="text-3xl font-bold font-mono text-green-600">{formatElapsed(elapsed)}</div>
            {runningTimer.description && (
              <p className="text-xs text-muted-foreground mt-1 truncate">{runningTimer.description}</p>
            )}
            <div className="flex items-center gap-1 mt-1">
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-green-600">{t.dashboard.recording}</span>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-muted-foreground text-sm">{t.dashboard.noActiveTimer}</p>
            <Link to="/time-entries">
              <Button size="sm" variant="outline" className="mt-2 gap-1">
                <Play className="h-3 w-3" />
                {t.dashboard.startTimerBtn}
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Pending Approvals Panel ───────────────────────────────────────────────────

function PendingApprovalsPanel({ workspaceId, allUsers }: {
  workspaceId: string
  allUsers: Array<{ id: string; name: string; profilePicture?: string | null }> | undefined
}) {
  const { t } = useTranslation()
  const { data: pending, isLoading } = useManagerTimesheets(workspaceId, "submitted")
  const approveTs = useApproveTimesheet()
  const userMap = new Map(allUsers?.map((u) => [u.id, u]) ?? [])
  const managerEmployeeId = allUsers?.[0]?.id ?? "manager"

  return (
    <Card className="border-l-4 border-l-amber-500">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
          <span>{t.dashboard.pendingApprovals}</span>
          <CheckSquare className="h-4 w-4 text-muted-foreground" />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : !pending?.length ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span className="text-sm">{t.dashboard.noPendingTimesheets}</span>
          </div>
        ) : (
          <div className="space-y-2">
            {pending.slice(0, 3).map((ts) => {
              const user = userMap.get(ts.employeeId)
              return (
                <div key={ts.id} className="flex items-center gap-2">
                  <Avatar className="h-6 w-6 shrink-0">
                    <AvatarImage src={user?.profilePicture ?? undefined} />
                    <AvatarFallback className="text-[10px]">
                      {(user?.name ?? "?").split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{user?.name ?? ts.employeeId}</p>
                    <p className="text-[10px] text-muted-foreground">{formatPeriod(ts.periodStart, ts.periodEnd)}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs shrink-0"
                    disabled={approveTs.isPending}
                    onClick={() => {
                      approveTs.mutate({ id: ts.id, workspaceId, approvedBy: managerEmployeeId, employeeId: ts.employeeId }, {
                        onSuccess: () => {},
                        onError: () => {}
                      })
                    }}
                  >
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Zatwierdź
                  </Button>
                </div>
              )
            })}
            {pending.length > 3 && (
              <Link to="/timesheets">
                <p className="text-xs text-muted-foreground hover:text-foreground cursor-pointer">
                  +{pending.length - 3} {t.dashboard.pendingApprovals}
                </p>
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Dashboard Page ────────────────────────────────────────────────────────────

function DashboardPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { workspaceId } = Route.useSearch()
  const [year, setYear] = useState(new Date().getFullYear())

  const { data, isLoading } = useQuery({
    ...queriesDashboard.dashboardData(workspaceId ?? ""),
    enabled: !!workspaceId
  })

  const { data: allUsers } = useQuery({
    ...queriesUsers.workspaceUsers(workspaceId ?? ""),
    enabled: !!workspaceId
  })
  const employeeId = allUsers?.[0]?.id

  const fromDate = `${year}-01-01`
  const toDate = `${year}-12-31`
  const { data: flowData, isLoading: flowLoading } = useQuery({
    ...financeQueries.flowSummary(fromDate, toDate),
    enabled: !!workspaceId
  })

  const { data: profitability, isLoading: profLoading } = useQuery({
    ...financeQueries.projectProfitability(year, workspaceId ?? ""),
    enabled: !!workspaceId
  })

  // Badge counts for KPI cards
  const { data: badgeCounts, isLoading: badgeLoading } = useQuery({
    queryKey: ["badge-counts", workspaceId],
    queryFn: async () => fetchBadgeCountsFn({ data: workspaceId! }),
    enabled: !!workspaceId,
    refetchInterval: 60000
  })

  // Audit log for recent activity (admins)
  const isAdmin = user?.role === "admin"
  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ["audit-recent", workspaceId],
    queryFn: async () => fetchAuditLogFn({ data: workspaceId! }),
    enabled: !!workspaceId && isAdmin,
    refetchInterval: 60000
  })

  const projects = data?.projects ?? []
  const timeEntries = data?.timeEntries ?? []

  // Hours this month
  const now = new Date()
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  const thisMonthEntries = timeEntries.filter((e) => {
    const start = e.timeInterval?.start
    if (!start) return false
    return start.slice(0, 7) === currentMonthStr
  })
  const totalHoursMs = thisMonthEntries.reduce(
    (sum, entry) => sum + (getIntervalDurationMs(entry.timeInterval) ?? 0),
    0
  )

  // Revenue this month
  const currentMonthRevenue = flowData?.find((r) => r.period === currentMonthStr)?.revenue ?? 0

  const perms = user?.permissions ?? []
  const canApprove = perms.includes("timesheets.approve")

  if (!workspaceId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="space-y-4 text-center">
          <h2 className="text-2xl font-bold">{t.dashboard.selectWorkspace}</h2>
          <p className="text-muted-foreground">{t.dashboard.selectWorkspaceDesc}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold text-zinc-100 leading-none">{t.dashboard.title}</h1>
          <p className="text-xs text-zinc-500 mt-1">{t.dashboard.description}</p>
        </div>
      </div>
      <div className="p-6 space-y-8">

      {/* ── Row 1: KPI Cards ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Hours this month */}
        <Link to="/time-entries" search={{ workspaceId }}>
          <Card className="border-l-4 border-l-blue-500 hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                <span>{t.dashboard.hoursThisMonth}</span>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className="text-3xl font-bold">{formatHours(totalHoursMs)}</div>
              )}
              <p className="text-xs text-muted-foreground mt-1">{currentMonthStr}</p>
            </CardContent>
          </Card>
        </Link>

        {/* Revenue this month */}
        <Link to="/accounting" search={{ workspaceId }}>
          <Card className="border-l-4 border-l-green-500 hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                <span>{t.dashboard.revenueThisMonth}</span>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {flowLoading ? (
                <Skeleton className="h-8 w-28" />
              ) : (
                <div className="text-3xl font-bold">{formatPLN(currentMonthRevenue)}</div>
              )}
              <p className="text-xs text-muted-foreground mt-1">{currentMonthStr}</p>
            </CardContent>
          </Card>
        </Link>

        {/* Pending timesheets */}
        <Link to="/timesheets" search={{ workspaceId }}>
          <Card className={cn(
            "border-l-4 hover:shadow-md transition-shadow cursor-pointer",
            (badgeCounts?.pendingTimesheets ?? 0) > 0 ? "border-l-amber-500" : "border-l-gray-300"
          )}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                <span>{t.dashboard.pendingTimesheets}</span>
                <CheckSquare className="h-4 w-4 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {badgeLoading ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                <div className={cn(
                  "text-3xl font-bold",
                  (badgeCounts?.pendingTimesheets ?? 0) > 0 ? "text-amber-600" : ""
                )}>
                  {badgeCounts?.pendingTimesheets ?? 0}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1">{t.dashboard.pendingForApproval}</p>
            </CardContent>
          </Card>
        </Link>

        {/* Drive sync errors */}
        <Link to="/settings/storage" search={{ workspaceId }}>
          <Card className={cn(
            "border-l-4 hover:shadow-md transition-shadow cursor-pointer",
            (badgeCounts?.syncErrors ?? 0) > 0 ? "border-l-red-500" : "border-l-gray-300"
          )}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                <span>{t.dashboard.syncErrors}</span>
                <CloudOff className="h-4 w-4 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {badgeLoading ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                <div className={cn(
                  "text-3xl font-bold",
                  (badgeCounts?.syncErrors ?? 0) > 0 ? "text-red-600" : ""
                )}>
                  {badgeCounts?.syncErrors ?? 0}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1">{t.dashboard.docsWithoutSync}</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* ── Row 2: Timer + Approvals ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ActiveTimerPanel workspaceId={workspaceId} employeeId={employeeId} />
        {canApprove ? (
          <PendingApprovalsPanel workspaceId={workspaceId} allUsers={allUsers} />
        ) : (
          <Card className="border-l-4 border-l-blue-300">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                <span>{t.dashboard.myProjects}</span>
                <FolderKanban className="h-4 w-4 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
                </div>
              ) : projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.dashboard.noProjects}</p>
              ) : (
                <div className="space-y-1">
                  {projects.slice(0, 5).map((p) => (
                    <div key={p.id} className="flex items-center gap-2 text-sm">
                      <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: p.color ?? "#6b7280" }} />
                      <span className="truncate">{p.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Row 3: Recent Activity ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{isAdmin ? t.dashboard.recentActivityAudit : t.dashboard.activity}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isAdmin ? (
              auditLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : !auditData?.rows?.length ? (
                <p className="text-sm text-muted-foreground">{t.dashboard.noAuditEntries}</p>
              ) : (
                auditData.rows.map((row) => (
                  <div key={row.id} className="flex items-center justify-between border-b py-2 last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {row.actor_name} — <span className="text-muted-foreground">{row.action}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">{row.entity_type}{row.entity_label ? `: ${row.entity_label}` : ""}</p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">
                      {new Date(row.created_at).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))
              )
            ) : (
              isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : thisMonthEntries.length > 0 ? (
                thisMonthEntries.slice(0, 5).map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between border-b py-2 last:border-0">
                    <div>
                      <p className="font-medium text-sm">{entry.description || "—"}</p>
                      <p className="text-muted-foreground text-xs">
                        {projects.find((p) => p.id === entry.projectId)?.name ?? t.dashboard.noProjectLabel}
                      </p>
                    </div>
                    <span className="text-muted-foreground font-mono text-sm">
                      {formatDuration(getIntervalDurationMs(entry.timeInterval))}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground text-sm">{t.dashboard.noEntries}</p>
              )
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.dashboard.topProjects}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : projects.length > 0 ? (
              projects
                .map((project) => ({
                  ...project,
                  hours: timeEntries
                    .filter((entry) => entry.projectId === project.id)
                    .reduce(
                      (sum, entry) => sum + (getIntervalDurationMs(entry.timeInterval) ?? 0),
                      0
                    )
                }))
                .sort((a, b) => b.hours - a.hours)
                .slice(0, 5)
                .map((project) => (
                  <div
                    key={project.id}
                    className="flex items-center justify-between border-b py-2 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="size-3 rounded-full"
                        style={{ backgroundColor: project.color ?? "#000" }}
                      />
                      <span className="font-medium">{project.name}</span>
                    </div>
                    <span className="text-muted-foreground font-mono text-sm">
                      {formatDuration(project.hours)}
                    </span>
                  </div>
                ))
            ) : (
              <p className="text-muted-foreground">{t.dashboard.noProjects}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Financial Charts Section (existing) ── */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{t.dashboard.financialFlow}</h2>
            <p className="text-muted-foreground mt-1">{t.dashboard.description}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">{t.dashboard.year}</span>
            <Input
              type="number"
              className="w-24"
              value={year}
              onChange={(event) => {
                setYear(Number(event.target.value))
              }}
            />
          </div>
        </div>

        {(() => {
          const totalRevenue = flowData?.reduce((sum, row) => sum + row.revenue, 0) ?? 0
          const totalCosts =
            flowData?.reduce(
              (sum, row) =>
                sum + row.serviceCostNet + row.realizedGoodsCost + row.otherOperatingCost,
              0
            ) ?? 0
          const totalIncome = totalRevenue - totalCosts
          const allMonths = Array.from({ length: 12 }, (_, i) => {
            const m = String(i + 1).padStart(2, "0")
            return `${year}-${m}`
          })
          const dataByPeriod = new Map(flowData?.map((r) => [r.period, r]) ?? [])

          const chartRows = allMonths.map((period) => {
            const row = dataByPeriod.get(period)
            const revenue = row?.revenue ?? 0
            const costs =
              (row?.serviceCostNet ?? 0) +
              (row?.realizedGoodsCost ?? 0) +
              (row?.otherOperatingCost ?? 0)
            const profit = revenue - costs
            return {
              period,
              revenue,
              costs,
              income: row?.profit ?? 0,
              profit: Math.max(0, profit),
              loss: Math.min(0, profit)
            }
          })

          return (
            <>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">{t.dashboard.revenue}</CardTitle>
                  </CardHeader>
                  <CardContent className="font-mono text-2xl font-bold">
                    {flowLoading ? <Skeleton className="h-8 w-28" /> : formatPLN(totalRevenue)}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">{t.dashboard.cost}</CardTitle>
                  </CardHeader>
                  <CardContent className="font-mono text-2xl font-bold">
                    {flowLoading ? <Skeleton className="h-8 w-28" /> : formatPLN(totalCosts)}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">{t.dashboard.income}</CardTitle>
                  </CardHeader>
                  <CardContent
                    className={cn(
                      "font-mono text-2xl font-bold",
                      totalIncome < 0 && "text-destructive"
                    )}
                  >
                    {flowLoading ? <Skeleton className="h-8 w-28" /> : formatPLN(totalIncome)}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">
                      {totalIncome >= 0 ? t.dashboard.profit : t.dashboard.loss}
                    </CardTitle>
                  </CardHeader>
                  <CardContent
                    className={cn(
                      "font-mono text-2xl font-bold",
                      totalIncome < 0 && "text-destructive"
                    )}
                  >
                    {flowLoading ? (
                      <Skeleton className="h-8 w-28" />
                    ) : (
                      formatPLN(Math.abs(totalIncome))
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>{t.dashboard.monthlyOverview}</CardTitle>
                </CardHeader>
                <CardContent className="h-[350px]">
                  {flowLoading ? (
                    <Skeleton className="h-full w-full" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartRows} barGap={4}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                        <YAxis
                          tickFormatter={(value) => formatPLN(Number(value))}
                          tick={{ fontSize: 11 }}
                        />
                        <Tooltip
                          formatter={(value) => [formatPLN(Number(value)), ""]}
                          labelFormatter={(label) => String(label)}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="revenue" name={t.dashboard.revenue} fill="#3b82f6" />
                        <Bar dataKey="costs" name={t.dashboard.cost} fill="#ef4444" />
                        <Bar dataKey="income" name={t.dashboard.income} fill="#10b981" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>{t.dashboard.revenueVsCost}</CardTitle>
                  </CardHeader>
                  <CardContent className="h-[320px]">
                    {flowLoading ? (
                      <Skeleton className="h-full w-full" />
                    ) : chartRows.length === 0 ? (
                      <div className="text-muted-foreground flex h-full items-center justify-center">
                        {t.dashboard.noData}
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartRows}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                          <YAxis
                            tickFormatter={(value) => formatPLN(Number(value))}
                            tick={{ fontSize: 11 }}
                          />
                          <Tooltip
                            formatter={(value) => [formatPLN(Number(value)), ""]}
                            labelFormatter={(label) => String(label)}
                          />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                          <Bar dataKey="revenue" name={t.dashboard.revenue} fill="#3b82f6" />
                          <Bar dataKey="costs" name={t.dashboard.cost} fill="#ef4444" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t.dashboard.profitOverTime}</CardTitle>
                  </CardHeader>
                  <CardContent className="h-[320px]">
                    {flowLoading ? (
                      <Skeleton className="h-full w-full" />
                    ) : chartRows.length === 0 ? (
                      <div className="text-muted-foreground flex h-full items-center justify-center">
                        {t.dashboard.noData}
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartRows}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                          <YAxis
                            tickFormatter={(value) => formatPLN(Number(value))}
                            tick={{ fontSize: 11 }}
                          />
                          <Tooltip
                            formatter={(value) => [formatPLN(Number(value)), t.dashboard.income]}
                            labelFormatter={(label) => String(label)}
                          />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                          <ReferenceLine y={0} stroke="#9ca3af" />
                          <Area
                            type="monotone"
                            dataKey="income"
                            name={t.dashboard.income}
                            stroke="#10b981"
                            fill="#10b981"
                            fillOpacity={0.3}
                          />
                          <Line
                            type="monotone"
                            dataKey="income"
                            name={t.dashboard.income}
                            stroke="#059669"
                            strokeWidth={2}
                            dot={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>{t.dashboard.profitLoss}</CardTitle>
                </CardHeader>
                <CardContent className="h-[320px]">
                  {flowLoading ? (
                    <Skeleton className="h-full w-full" />
                  ) : chartRows.length === 0 ? (
                    <div className="text-muted-foreground flex h-full items-center justify-center">
                      {t.dashboard.noData}
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartRows}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                        <YAxis
                          tickFormatter={(value) => formatPLN(Number(value))}
                          tick={{ fontSize: 11 }}
                        />
                        <Tooltip
                          formatter={(value) => [formatPLN(Number(value)), ""]}
                          labelFormatter={(label) => String(label)}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <ReferenceLine y={0} stroke="#9ca3af" />
                        <Bar dataKey="profit" name={t.dashboard.profit} fill="#22c55e" />
                        <Bar dataKey="loss" name={t.dashboard.loss} fill="#dc2626" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              {(() => {
                const sorted = [...(profitability ?? [])].sort((a, b) => b.profit - a.profit)
                const top5 = sorted.slice(0, 5)
                const bottom5 = sorted.slice(-5).reverse()

                return (
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle>{t.dashboard.topProfitableProjects}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {profLoading ? (
                          <div className="space-y-2">
                            <Skeleton className="h-8 w-full" />
                            <Skeleton className="h-8 w-full" />
                            <Skeleton className="h-8 w-full" />
                          </div>
                        ) : top5.length === 0 ? (
                          <p className="text-muted-foreground">{t.dashboard.noProjects}</p>
                        ) : (
                          top5.map((p, i) => (
                            <div key={p.projectId} className="flex items-center justify-between">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="text-muted-foreground w-5 font-mono text-xs">
                                  {i + 1}.
                                </span>
                                <span className="truncate font-medium">{p.projectName}</span>
                              </div>
                              <span
                                className={cn(
                                  "font-mono text-sm font-semibold",
                                  p.profit >= 0 ? "text-emerald-600" : "text-destructive"
                                )}
                              >
                                {formatPLN(p.profit)}
                              </span>
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>{t.dashboard.bottomProjects}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {profLoading ? (
                          <div className="space-y-2">
                            <Skeleton className="h-8 w-full" />
                            <Skeleton className="h-8 w-full" />
                            <Skeleton className="h-8 w-full" />
                          </div>
                        ) : bottom5.length === 0 ? (
                          <p className="text-muted-foreground">{t.dashboard.noProjects}</p>
                        ) : (
                          bottom5.map((p, i) => (
                            <div key={p.projectId} className="flex items-center justify-between">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="text-muted-foreground w-5 font-mono text-xs">
                                  {i + 1}.
                                </span>
                                <span className="truncate font-medium">{p.projectName}</span>
                              </div>
                              <span
                                className={cn(
                                  "font-mono text-sm font-semibold",
                                  p.profit >= 0 ? "text-emerald-600" : "text-destructive"
                                )}
                              >
                                {formatPLN(p.profit)}
                              </span>
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>
                  </div>
                )
              })()}
            </>
          )
        })()}
      </div>
      </div>
    </div>
  )
}
