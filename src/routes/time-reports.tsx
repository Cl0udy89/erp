import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Download, FileText } from "lucide-react"
import { useState } from "react"

import {
  useTimeSummaryReport,
  useTimeDetailedReport,
  useTimeWeeklyReport
} from "#/api/time-tracking"
import { queriesProjects, queriesUsers } from "#/api/queries"
import { WeeklyGrid } from "#/components/weekly-grid"
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

export const Route = createFileRoute("/time-reports")({
  validateSearch: workspaceSearchSchema,
  component: TimeReportsPage
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

function addDays(d: Date, n: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + n)
  return copy
}

function toDateStr(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function getFirstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function getLastOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

type DatePreset = "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "custom"

interface DateRange {
  from: string
  to: string
}

function presetToRange(preset: DatePreset): DateRange {
  const today = new Date()
  switch (preset) {
    case "thisWeek": {
      const mon = getMonday(today)
      return { from: toDateStr(mon), to: toDateStr(addDays(mon, 6)) }
    }
    case "lastWeek": {
      const mon = getMonday(addDays(today, -7))
      return { from: toDateStr(mon), to: toDateStr(addDays(mon, 6)) }
    }
    case "thisMonth": {
      return {
        from: toDateStr(getFirstOfMonth(today)),
        to: toDateStr(getLastOfMonth(today))
      }
    }
    case "lastMonth": {
      const last = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      return {
        from: toDateStr(getFirstOfMonth(last)),
        to: toDateStr(getLastOfMonth(last))
      }
    }
    default:
      return {
        from: toDateStr(getMonday(today)),
        to: toDateStr(addDays(getMonday(today), 6))
      }
  }
}

// ─── CSV export helper ────────────────────────────────────────────────────────

function downloadCsv(filename: string, rows: string[][]): void {
  const content = rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n")
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Date range controls ──────────────────────────────────────────────────────

function DateRangeControls({
  preset,
  setPreset,
  customFrom,
  setCustomFrom,
  customTo,
  setCustomTo,
  range
}: {
  preset: DatePreset
  setPreset: (p: DatePreset) => void
  customFrom: string
  setCustomFrom: (s: string) => void
  customTo: string
  setCustomTo: (s: string) => void
  range: DateRange
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-1">
        {(["thisWeek", "lastWeek", "thisMonth", "lastMonth", "custom"] as DatePreset[]).map(
          (p) => (
            <Button
              key={p}
              size="sm"
              variant={preset === p ? "default" : "outline"}
              onClick={() => setPreset(p)}
            >
              {t.reports[p as keyof typeof t.reports] ?? p}
            </Button>
          )
        )}
      </div>
      {preset === "custom" && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="w-[150px]"
          />
          <span className="text-muted-foreground text-sm">—</span>
          <Input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="w-[150px]"
          />
        </div>
      )}
      {preset !== "custom" && (
        <span className="text-muted-foreground text-sm">
          {range.from} — {range.to}
        </span>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function TimeReportsPage() {
  const { workspaceId } = Route.useSearch()
  const { t } = useTranslation()
  const [tab, setTab] = useState("summary")

  const [preset, setPreset] = useState<DatePreset>("thisWeek")
  const [customFrom, setCustomFrom] = useState(toDateStr(getMonday(new Date())))
  const [customTo, setCustomTo] = useState(toDateStr(addDays(getMonday(new Date()), 6)))

  const range: DateRange =
    preset === "custom"
      ? { from: customFrom, to: customTo }
      : presetToRange(preset)

  if (!workspaceId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-bold">{t.reports.selectWorkspace}</h2>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t.reports.title}</h1>
        <p className="text-muted-foreground mt-1">{t.reports.description}</p>
      </div>

      <DateRangeControls
        preset={preset}
        setPreset={setPreset}
        customFrom={customFrom}
        setCustomFrom={setCustomFrom}
        customTo={customTo}
        setCustomTo={setCustomTo}
        range={range}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="summary">{t.reports.summary}</TabsTrigger>
          <TabsTrigger value="detailed">{t.reports.detailed}</TabsTrigger>
          <TabsTrigger value="weekly">{t.reports.weekly}</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <SummaryTab workspaceId={workspaceId} range={range} />
        </TabsContent>

        <TabsContent value="detailed">
          <DetailedTab workspaceId={workspaceId} range={range} />
        </TabsContent>

        <TabsContent value="weekly">
          <WeeklyReportTab workspaceId={workspaceId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Summary Tab ──────────────────────────────────────────────────────────────

function SummaryTab({
  workspaceId,
  range
}: {
  workspaceId: string
  range: DateRange
}) {
  const { t } = useTranslation()
  const [groupBy, setGroupBy] = useState<"project" | "employee" | "client">("project")

  const { data, isLoading } = useTimeSummaryReport(workspaceId, range.from, range.to, groupBy)

  function exportCsv() {
    if (!data) return
    const headers = [t.reports.name, t.reports.totalHours, t.reports.billableHours, t.reports.estimatedCost]
    const rows = data.map((row) => [
      row.groupName,
      String(row.totalHours.toFixed(2)),
      String(row.billableHours.toFixed(2)),
      String(row.estimatedCost?.toFixed(2) ?? "")
    ])
    downloadCsv("summary-report.csv", [headers, ...rows])
  }

  const totalHours = data?.reduce((sum, r) => sum + r.totalHours, 0) ?? 0
  const totalBillable = data?.reduce((sum, r) => sum + r.billableHours, 0) ?? 0

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between">
        {/* Group by toggle */}
        <div className="flex gap-1">
          {(["project", "employee", "client"] as const).map((g) => (
            <Button
              key={g}
              size="sm"
              variant={groupBy === g ? "default" : "outline"}
              onClick={() => setGroupBy(g)}
            >
              {t.reports[g]}
            </Button>
          ))}
        </div>

        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data?.length}>
          <Download className="size-4" data-icon="inline-start" />
          {t.reports.exportCsv}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !data?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">{t.reports.noData}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-2 text-left font-medium">{t.reports.name}</th>
                <th className="px-4 py-2 text-right font-medium">{t.reports.totalHours}</th>
                <th className="px-4 py-2 text-right font-medium">{t.reports.billableHours}</th>
                <th className="px-4 py-2 text-right font-medium">{t.reports.estimatedCost}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.map((row) => (
                <tr key={row.groupId} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      {row.groupColor && (
                        <span
                          className="inline-block size-2 rounded-full"
                          style={{ background: row.groupColor }}
                        />
                      )}
                      {row.groupName}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {row.totalHours.toFixed(2)}h
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {row.billableHours.toFixed(2)}h
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {row.estimatedCost != null ? `${row.estimatedCost.toFixed(2)} PLN` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-semibold">
                <td className="px-4 py-2">{t.tracker.totalHours}</td>
                <td className="px-4 py-2 text-right font-mono">{totalHours.toFixed(2)}h</td>
                <td className="px-4 py-2 text-right font-mono">{totalBillable.toFixed(2)}h</td>
                <td className="px-4 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Detailed Tab ─────────────────────────────────────────────────────────────

const BACKEND_PDF_URL = (typeof window !== "undefined"
  ? (import.meta as any)?.env?.VITE_BACKEND_API_URL ?? "http://localhost:4001"
  : "http://localhost:4001")

const BACKEND_TOKEN = (typeof window !== "undefined"
  ? (import.meta as any)?.env?.VITE_API_INTERNAL_TOKEN ?? ""
  : "")

function DetailedTab({
  workspaceId,
  range
}: {
  workspaceId: string
  range: DateRange
}) {
  const { t } = useTranslation()
  const [filterEmployee, setFilterEmployee] = useState<string>("all")
  const [filterProject, setFilterProject] = useState<string>("all")
  const [sortBy, setSortBy] = useState<"date" | "duration">("date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [pdfLang, setPdfLang] = useState<"pl" | "en">(() => {
    if (typeof window !== "undefined") return (localStorage.getItem("erp_pdf_lang") as "pl" | "en") ?? "pl"
    return "pl"
  })

  const { data: users } = useQuery({
    ...queriesUsers.workspaceUsers(workspaceId),
    enabled: !!workspaceId
  })
  const { data: projects } = useQuery({
    ...queriesProjects.workspaceProjects(workspaceId),
    enabled: !!workspaceId
  })

  const { data, isLoading } = useTimeDetailedReport(workspaceId, range.from, range.to, {
    employeeId: filterEmployee !== "all" ? filterEmployee : undefined,
    projectId: filterProject !== "all" ? filterProject : undefined,
    sortBy,
    sortDir
  })

  function exportCsv() {
    if (!data?.entries) return
    const headers = [
      t.reports.date,
      t.tracker.employee,
      t.reports.project,
      t.reports.task,
      t.reports.description,
      t.reports.duration,
      t.reports.billable,
      t.reports.tags
    ]
    const rows = data.entries.map((e) => [
      e.startAt ? new Date(e.startAt).toLocaleDateString("pl-PL") : "",
      e.employeeName ?? e.employeeId ?? "",
      e.projectName ?? "",
      e.taskName ?? "",
      e.description ?? "",
      e.durationSeconds ? `${(e.durationSeconds / 3600).toFixed(2)}h` : "",
      e.billable ? "Yes" : "No",
      e.tags?.join(", ") ?? ""
    ])
    downloadCsv("detailed-report.csv", [headers, ...rows])
  }

  function toggleSort(col: "date" | "duration") {
    if (sortBy === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortBy(col)
      setSortDir("desc")
    }
  }

  function handlePdfDownload() {
    const params = new URLSearchParams({
      workspaceId: workspaceId,
      from: range.from,
      to: range.to,
      token: BACKEND_TOKEN,
      lang: pdfLang
    })
    if (filterEmployee !== "all") params.set("employeeId", filterEmployee)
    window.open(`${BACKEND_PDF_URL}/time-entries/reports/pdf?${params.toString()}`, "_blank")
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
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
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data?.entries?.length}>
            <Download className="size-4" data-icon="inline-start" />
            {t.reports.exportCsv}
          </Button>
          <div className="flex items-center gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">{t.pdf.language}</label>
            <select
              value={pdfLang}
              onChange={(e) => {
                setPdfLang(e.target.value as "pl" | "en")
                if (typeof window !== "undefined") localStorage.setItem("erp_pdf_lang", e.target.value)
              }}
              className="text-sm border rounded px-2 py-1 bg-background"
            >
              <option value="pl">{t.pdf.polish}</option>
              <option value="en">{t.pdf.english}</option>
            </select>
          </div>
          <Button variant="outline" size="sm" onClick={handlePdfDownload} disabled={!data?.entries?.length}>
            <FileText className="size-4" data-icon="inline-start" />
            PDF
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !data?.entries?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">{t.reports.noData}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th
                  className="cursor-pointer px-4 py-2 text-left font-medium hover:bg-gray-100"
                  onClick={() => toggleSort("date")}
                >
                  {t.reports.date}{" "}
                  {sortBy === "date" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
                <th className="px-4 py-2 text-left font-medium">{t.tracker.employee}</th>
                <th className="px-4 py-2 text-left font-medium">{t.reports.project}</th>
                <th className="px-4 py-2 text-left font-medium">{t.reports.task}</th>
                <th className="px-4 py-2 text-left font-medium">{t.reports.description}</th>
                <th
                  className="cursor-pointer px-4 py-2 text-right font-medium hover:bg-gray-100"
                  onClick={() => toggleSort("duration")}
                >
                  {t.reports.duration}{" "}
                  {sortBy === "duration" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
                <th className="px-4 py-2 text-center font-medium">{t.reports.billable}</th>
                <th className="px-4 py-2 text-left font-medium">{t.reports.tags}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-50">
                  <td className="text-muted-foreground px-4 py-2">
                    {entry.startAt
                      ? new Date(entry.startAt).toLocaleDateString("pl-PL")
                      : "—"}
                  </td>
                  <td className="px-4 py-2">{entry.employeeName ?? "—"}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      {entry.projectName && (
                        <span
                          className="inline-block size-2 rounded-full bg-gray-400"
                        />
                      )}
                      {entry.projectName ?? "—"}
                    </div>
                  </td>
                  <td className="px-4 py-2">{entry.taskName ?? "—"}</td>
                  <td className="max-w-[200px] truncate px-4 py-2">
                    {entry.description ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {entry.durationSeconds
                      ? `${(entry.durationSeconds / 3600).toFixed(2)}h`
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {entry.billable ? "✓" : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {entry.tags?.join(", ") ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Weekly report tab ────────────────────────────────────────────────────────

function WeeklyReportTab({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const [weekStart, setWeekStart] = useState<Date>(getMonday(new Date()))

  const { data: users } = useQuery({
    ...queriesUsers.workspaceUsers(workspaceId),
    enabled: !!workspaceId
  })
  const { data: projects } = useQuery({
    ...queriesProjects.workspaceProjects(workspaceId),
    enabled: !!workspaceId
  })

  const [selectedEmployee, setSelectedEmployee] = useState<string>(users?.[0]?.id ?? "")
  const weekStartStr = toDateStr(weekStart)
  const weekEndStr = toDateStr(addDays(weekStart, 6))

  const { data: weeklyData, isLoading } = useTimeWeeklyReport(
    workspaceId,
    selectedEmployee || users?.[0]?.id,
    weekStartStr
  )

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
          >
            &#8592;
          </Button>
          <span className="min-w-[180px] text-center text-sm font-medium">
            {weekStartStr} — {weekEndStr}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
          >
            &#8594;
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekStart(getMonday(new Date()))}
          >
            {t.tracker.today}
          </Button>
        </div>

        {users && users.length > 1 && (
          <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
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
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : weeklyData ? (
        <WeeklyGrid weeklyData={weeklyData} projects={projects} isReadOnly={true} />
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">{t.reports.noData}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
