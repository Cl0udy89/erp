import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"

import { financeQueries, useUpdateEmployeeHourlyRate } from "#/api/finance"
import { queriesTimeEntries, queriesUsers } from "#/api/queries"
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card"
import { Input } from "#/components/ui/input"
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

function formatHours(seconds: number): string {
  const hours = seconds / 3600
  return hours.toFixed(1) + "h"
}

export const Route = createFileRoute("/reports")({
  loader: async ({ context, location }) => {
    const workspaceId = getWorkspaceId(location.search)
    if (workspaceId) {
      await context.queryClient.prefetchQuery({ ...queriesUsers.workspaceUsers(workspaceId) })
      await context.queryClient.prefetchQuery({
        ...queriesTimeEntries.workspaceTimeEntries(workspaceId)
      })
      await context.queryClient.prefetchQuery({
        ...financeQueries.employeeHourlyRates(workspaceId)
      })
    }
  },
  validateSearch: workspaceSearchSchema,
  component: ReportsPage
})

interface UserReport {
  userId: string
  userName: string
  totalMs: number
  hourlyRate: number | null
}

function ReportsPage() {
  const { workspaceId } = Route.useSearch()
  const [startDate, setStartDate] = useState<string>("")
  const [endDate, setEndDate] = useState<string>("")
  const queryClient = useQueryClient()

  const { data: timeEntries, isLoading: entriesLoading } = useQuery({
    ...queriesTimeEntries.workspaceTimeEntries(workspaceId ?? "", { startDate, endDate }),
    enabled: !!workspaceId
  })

  const { data: users } = useQuery({
    ...queriesUsers.workspaceUsers(workspaceId ?? ""),
    enabled: !!workspaceId
  })

  const { data: hourlyRates } = useQuery({
    ...financeQueries.employeeHourlyRates(workspaceId ?? ""),
    enabled: !!workspaceId
  })

  const { data: projectCosts } = useQuery({
    ...financeQueries.timeCostsByProject(workspaceId ?? "", {
      startDate: startDate || undefined,
      endDate: endDate || undefined
    }),
    enabled: !!workspaceId
  })

  const { data: clientCosts } = useQuery({
    ...financeQueries.timeCostsByClient(workspaceId ?? "", {
      startDate: startDate || undefined,
      endDate: endDate || undefined
    }),
    enabled: !!workspaceId
  })

  const updateRateMutation = useUpdateEmployeeHourlyRate()

  const rateMap = new Map(hourlyRates?.map((r) => [r.employeeId, r.hourlyRate]) ?? [])

  if (!workspaceId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="space-y-4 text-center">
          <h2 className="text-2xl font-bold">Select a Workspace</h2>
          <p className="text-muted-foreground">
            Choose a workspace from the sidebar to view reports.
          </p>
        </div>
      </div>
    )
  }

  const defaultRate = 200

  const reports: UserReport[] =
    users?.map((user) => {
      const userEntries = timeEntries?.filter((e) => e.userId === user.id) ?? []
      const totalMs = userEntries.reduce((sum, e) => {
        return sum + (getIntervalDurationMs(e.timeInterval) ?? 0)
      }, 0)
      const rate = rateMap.get(user.id) ?? null
      return { userId: user.id, userName: user.name, totalMs, hourlyRate: rate }
    }) ?? []

  const grandTotalMs = reports.reduce((s, r) => s + r.totalMs, 0)
  const grandTotalCost = reports.reduce(
    (s, r) => s + (r.totalMs / 3600000) * (r.hourlyRate ?? defaultRate),
    0
  )

  const handleRateChange = (employeeId: string, value: string) => {
    const rate = value === "" ? null : Number(value)
    if (rate !== null && (isNaN(rate) || rate < 0)) return
    updateRateMutation.mutate(
      { employeeId, hourlyRate: rate },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["erp", "time-costs"] })
        }
      }
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground mt-1">
            Hours worked and cost per person, project, and client
          </p>
        </div>
      </div>

      <Card className="py-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-4">
            <span>Date Range</span>
            <div className="flex gap-2">
              <Input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value)
                }}
                className="w-[160px]"
              />
              <span className="text-muted-foreground self-center">to</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value)
                }}
                className="w-[160px]"
              />
            </div>
          </CardTitle>
        </CardHeader>
      </Card>

      <Card className="py-0">
        <CardHeader>
          <CardTitle>Cost per Person</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="p-4 text-left font-medium">Person</th>
                <th className="p-4 text-right font-medium">Hours</th>
                <th className="p-4 text-right font-medium">Hourly Rate</th>
                <th className="p-4 text-right font-medium">Total Cost</th>
              </tr>
            </thead>
            <tbody>
              {entriesLoading ? (
                <tr>
                  <td colSpan={4} className="text-muted-foreground p-8 text-center">
                    Loading...
                  </td>
                </tr>
              ) : reports.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-muted-foreground p-8 text-center">
                    No data for this period
                  </td>
                </tr>
              ) : (
                reports.map((report) => {
                  const hours = report.totalMs / 3600000
                  const effectiveRate = report.hourlyRate ?? defaultRate
                  const cost = hours * effectiveRate
                  return (
                    <tr key={report.userId} className="border-b">
                      <td className="p-4">
                        <span className="font-medium">{report.userName}</span>
                      </td>
                      <td className="p-4 text-right font-mono">{formatDuration(report.totalMs)}</td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Input
                            type="number"
                            min={0}
                            step={10}
                            value={report.hourlyRate ?? ""}
                            placeholder={String(defaultRate)}
                            onChange={(e) => {
                              handleRateChange(report.userId, e.target.value)
                            }}
                            className="w-[80px] text-right"
                          />
                          <span className="text-muted-foreground text-sm">PLN/h</span>
                        </div>
                      </td>
                      <td className="p-4 text-right font-mono font-semibold">
                        {formatCostPLN(cost)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
            {reports.length > 0 && (
              <tfoot>
                <tr className="bg-muted/50 border-t font-semibold">
                  <td className="p-4">Total</td>
                  <td className="p-4 text-right font-mono">{formatDuration(grandTotalMs)}</td>
                  <td className="p-4 text-right"></td>
                  <td className="p-4 text-right font-mono">{formatCostPLN(grandTotalCost)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>

      {projectCosts && projectCosts.length > 0 && (
        <Card className="py-0">
          <CardHeader>
            <CardTitle>Cost per Project</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="p-4 text-left font-medium">Project</th>
                  <th className="p-4 text-left font-medium">Client</th>
                  <th className="p-4 text-right font-medium">Hours</th>
                  <th className="p-4 text-right font-medium">Estimated Cost</th>
                </tr>
              </thead>
              <tbody>
                {projectCosts.map((project) => (
                  <tr key={project.projectId} className="border-b">
                    <td className="p-4 font-medium">{project.projectName}</td>
                    <td className="text-muted-foreground p-4">{project.clientName ?? "—"}</td>
                    <td className="p-4 text-right font-mono">
                      {formatHours(project.totalSeconds)}
                    </td>
                    <td className="p-4 text-right font-mono font-semibold">
                      {formatCostPLN(project.estimatedCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/50 border-t font-semibold">
                  <td className="p-4" colSpan={2}>
                    Total
                  </td>
                  <td className="p-4 text-right font-mono">
                    {formatHours(projectCosts.reduce((s, p) => s + p.totalSeconds, 0))}
                  </td>
                  <td className="p-4 text-right font-mono">
                    {formatCostPLN(projectCosts.reduce((s, p) => s + p.estimatedCost, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>
      )}

      {clientCosts && clientCosts.length > 0 && (
        <Card className="py-0">
          <CardHeader>
            <CardTitle>Cost per Client</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="p-4 text-left font-medium">Client</th>
                  <th className="p-4 text-right font-medium">Hours</th>
                  <th className="p-4 text-right font-medium">Estimated Cost</th>
                </tr>
              </thead>
              <tbody>
                {clientCosts.map((client) => (
                  <tr key={client.clientId ?? "no-client"} className="border-b">
                    <td className="p-4 font-medium">{client.clientName ?? "No client"}</td>
                    <td className="p-4 text-right font-mono">{formatHours(client.totalSeconds)}</td>
                    <td className="p-4 text-right font-mono font-semibold">
                      {formatCostPLN(client.estimatedCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/50 border-t font-semibold">
                  <td className="p-4">Total</td>
                  <td className="p-4 text-right font-mono">
                    {formatHours(clientCosts.reduce((s, c) => s + c.totalSeconds, 0))}
                  </td>
                  <td className="p-4 text-right font-mono">
                    {formatCostPLN(clientCosts.reduce((s, c) => s + c.estimatedCost, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
