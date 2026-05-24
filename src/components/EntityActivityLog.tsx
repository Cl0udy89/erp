import type { AuditListResponse } from "#/api/audit"
import { useTranslation } from "#/lib/i18n"

interface Props {
  data: AuditListResponse | undefined
  compact?: boolean
}

export function EntityActivityLog({ data, compact }: Props) {
  const { t } = useTranslation()
  const textSize = compact ? "text-xs" : "text-sm"
  const gap = compact ? "space-y-1" : "space-y-2"

  if (!data?.rows?.length) {
    return <p className={`${textSize} text-muted-foreground`}>{t.audit.noActivity}</p>
  }

  return (
    <div className={gap}>
      {data.rows.map((row) => (
        <div key={row.id} className={`flex items-start gap-2 ${textSize}`}>
          <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
            {row.action}
          </span>
          <div className="min-w-0 flex-1">
            <span className="font-medium">{row.actor_name}</span>
            <span className="text-muted-foreground">
              {" · "}
              {new Date(row.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
