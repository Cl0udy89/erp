import type { WeeklyReport } from "#/api/time-tracking"
import type { ClockifyProject } from "#/lib/clockify-schemas"
import { useTranslation } from "#/lib/i18n"

const SHORT_DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function formatHoursDecimal(h: number): string {
  return `${h.toFixed(1)}h`
}

export function WeeklyGrid({
  weeklyData,
  projects,
  isReadOnly: _isReadOnly
}: {
  weeklyData: WeeklyReport
  projects: ClockifyProject[] | undefined
  isReadOnly: boolean
}) {
  const { t } = useTranslation()
  const days = weeklyData.days ?? []

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-4 py-2 text-left font-medium">
              {t.tracker.project} / {t.tracker.task}
            </th>
            {days.map((day) => {
              const d = new Date(day)
              return (
                <th key={day} className="px-3 py-2 text-center font-medium">
                  <div>{SHORT_DAY[d.getDay() === 0 ? 6 : d.getDay() - 1]}</div>
                  <div className="text-muted-foreground text-xs">{d.getDate()}</div>
                </th>
              )
            })}
            <th className="px-3 py-2 text-right font-medium">{t.tracker.totalHours}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {weeklyData.rows.map((row, idx) => {
            const project = projects?.find((p) => p.id === row.projectId)
            return (
              <tr key={idx} className="hover:bg-gray-50">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    {project && (
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ background: project.color ?? "#888" }}
                      />
                    )}
                    <div>
                      <div className="font-medium">{row.projectName ?? t.tracker.noProject}</div>
                      {row.taskName && (
                        <div className="text-muted-foreground text-xs">{row.taskName}</div>
                      )}
                    </div>
                  </div>
                </td>
                {days.map((day) => {
                  const cell = row.cells[day]
                  return (
                    <td key={day} className="px-3 py-2 text-center">
                      {cell?.hours ? (
                        <span className="font-mono">{formatHoursDecimal(cell.hours)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  )
                })}
                <td className="px-3 py-2 text-right font-mono font-medium">
                  {formatHoursDecimal(row.totalHours)}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="bg-gray-50 font-semibold">
            <td className="px-4 py-2">{t.tracker.totalHours}</td>
            {days.map((day) => (
              <td key={day} className="px-3 py-2 text-center font-mono">
                {weeklyData.totalByDay[day]
                  ? formatHoursDecimal(weeklyData.totalByDay[day])
                  : "—"}
              </td>
            ))}
            <td className="px-3 py-2 text-right font-mono">
              {formatHoursDecimal(weeklyData.grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
