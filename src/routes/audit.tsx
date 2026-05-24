import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Download, ChevronDown, ChevronRight, Shield } from "lucide-react"
import { EmptyState } from "#/components/empty-state"

import { useAuditLog, type AuditListResponse, type AuditRow } from "#/api/audit"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "#/components/ui/select"
import { Badge } from "#/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card"
import { Skeleton } from "#/components/ui/skeleton"
import { workspaceSearchSchema } from "#/lib/search-schema"
import { useTranslation } from "#/lib/i18n"

export const Route = createFileRoute("/audit")({
  validateSearch: workspaceSearchSchema,
  component: AuditPage
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ENTITY_TYPES = [
  "time_entry",
  "timesheet",
  "employee",
  "client",
  "document",
  "user",
  "role_permission",
  "accounting_report"
]

const ACTIONS = [
  "create",
  "update",
  "delete",
  "view",
  "submit",
  "approve",
  "reject",
  "link",
  "unlink",
  "login",
  "logout",
  "export",
  "role_change",
  "permission_change"
]

function actionBadgeVariant(action: string): "default" | "secondary" | "destructive" | "outline" {
  if (["delete", "reject", "unlink", "logout"].includes(action)) return "destructive"
  if (["create", "approve", "login", "submit"].includes(action)) return "default"
  if (["update", "role_change", "permission_change", "export"].includes(action)) return "secondary"
  return "outline"
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString("pl-PL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
  } catch {
    return ts
  }
}

// ─── Expandable Row ────────────────────────────────────────────────────────────

function AuditTableRow({ row }: { row: AuditRow }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = !!(row.changed_fields || row.metadata)

  return (
    <>
      <tr
        className="hover:bg-muted/50 border-b transition-colors"
        onClick={() => hasDetails && setExpanded((v) => !v)}
        style={{ cursor: hasDetails ? "pointer" : "default" }}
      >
        <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
          {hasDetails ? (
            expanded ? (
              <ChevronDown className="inline size-3 mr-1" />
            ) : (
              <ChevronRight className="inline size-3 mr-1" />
            )
          ) : (
            <span className="inline-block w-4 mr-1" />
          )}
          {formatTimestamp(row.created_at)}
        </td>
        <td className="px-4 py-2 text-sm">
          <div className="font-medium">{row.actor_name || row.actor_user_id}</div>
          <div className="text-xs text-muted-foreground capitalize">{row.actor_role}</div>
        </td>
        <td className="px-4 py-2">
          <Badge variant={actionBadgeVariant(row.action)}>{row.action}</Badge>
        </td>
        <td className="px-4 py-2 text-sm">
          <div className="font-mono text-xs text-muted-foreground">{row.entity_type}</div>
          {row.entity_label && (
            <div className="text-sm">{row.entity_label}</div>
          )}
        </td>
        <td className="px-4 py-2 text-xs text-muted-foreground font-mono truncate max-w-[160px]">
          {row.entity_id}
        </td>
        <td className="px-4 py-2 text-xs text-muted-foreground">
          {row.ip_address ?? "—"}
        </td>
      </tr>
      {expanded && hasDetails && (
        <tr className="bg-muted/30 border-b">
          <td colSpan={6} className="px-6 py-3">
            {row.changed_fields && (
              <div className="mb-2">
                <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">
                  Changed Fields
                </p>
                <div className="space-y-1">
                  {Object.entries(row.changed_fields).map(([field, diff]) => (
                    <div key={field} className="text-xs flex gap-2">
                      <span className="font-mono font-semibold w-32 shrink-0">{field}</span>
                      <span className="text-red-600 line-through">{JSON.stringify((diff as any).from)}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-green-600">{JSON.stringify((diff as any).to)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {row.metadata && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">
                  Metadata
                </p>
                <pre className="text-xs bg-background rounded border p-2 overflow-auto max-h-40">
                  {JSON.stringify(row.metadata, null, 2)}
                </pre>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

function AuditPage() {
  const { workspaceId } = Route.useSearch()
  const { t } = useTranslation()

  const [entityType, setEntityType] = useState<string>("")
  const [action, setAction] = useState<string>("")
  const [search, setSearch] = useState<string>("")
  const [from, setFrom] = useState<string>("")
  const [to, setTo] = useState<string>("")
  const [offset, setOffset] = useState(0)
  const limit = 50

  const params = {
    workspaceId: workspaceId ?? "",
    entityType: entityType || undefined,
    action: action || undefined,
    q: search || undefined,
    from: from || undefined,
    to: to || undefined,
    limit,
    offset
  }

  const { data: _rawAuditData, isLoading, error } = useAuditLog(params)
  const data = _rawAuditData as AuditListResponse | undefined

  function handleExportCsv() {
    const backendUrl = typeof window !== "undefined"
      ? ((import.meta as unknown as Record<string, unknown>)?.env as Record<string, string> | undefined)?.VITE_BACKEND_API_URL ?? "http://localhost:4001"
      : "http://localhost:4001"
    const token = typeof window !== "undefined"
      ? ((import.meta as unknown as Record<string, unknown>)?.env as Record<string, string> | undefined)?.VITE_API_INTERNAL_TOKEN ?? ""
      : ""
    const p = new URLSearchParams({ workspaceId: workspaceId ?? "", format: "csv", token })
    if (entityType) p.set("entityType", entityType)
    if (action) p.set("action", action)
    if (search) p.set("q", search)
    if (from) p.set("from", from)
    if (to) p.set("to", to)
    window.open(`${backendUrl}/audit?${p.toString()}`, "_blank")
  }

  const totalPages = data ? Math.ceil(data.total / limit) : 0
  const currentPage = Math.floor(offset / limit) + 1

  return (
    <div className="flex flex-col">
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold text-zinc-100 leading-none">{t.audit.title}</h1>
          <p className="text-xs text-zinc-500 mt-1">Historia operacji</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCsv}>
            <Download className="size-4 mr-2" />
            {t.audit.exportCsv}
          </Button>
        </div>
      </div>
      <div className="p-6 space-y-6">

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">{t.action.filter}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Input
              placeholder={`${t.audit.search}`}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setOffset(0) }}
            />
            <Select
              value={entityType || "__all__"}
              onValueChange={(v) => { setEntityType(v === "__all__" ? "" : v); setOffset(0) }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t.audit.entityType} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All entity types</SelectItem>
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={action || "__all__"}
              onValueChange={(v) => { setAction(v === "__all__" ? "" : v); setOffset(0) }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All actions</SelectItem>
                {ACTIONS.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              placeholder="From"
              value={from}
              onChange={(e) => { setFrom(e.target.value); setOffset(0) }}
            />
            <Input
              type="date"
              placeholder="To"
              value={to}
              onChange={(e) => { setTo(e.target.value); setOffset(0) }}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("")
                setEntityType("")
                setAction("")
                setFrom("")
                setTo("")
                setOffset(0)
              }}
            >
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="p-8 text-center text-destructive">
              Failed to load audit log: {error instanceof Error ? error.message : "Unknown error"}
            </div>
          ) : isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !workspaceId ? (
            <div className="p-8 text-center text-muted-foreground">
              Select a workspace to view the audit log.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Timestamp
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        User
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Action
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Entity
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Entity ID
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        IP
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.rows.length === 0 ? (
                      <tr>
                        <td colSpan={6}>
                          <EmptyState
                            icon={Shield}
                            title="Brak wpisów w dzienniku audytu"
                            subtitle="Nie znaleziono żadnych zdarzeń dla podanych filtrów"
                          />
                        </td>
                      </tr>
                    ) : (
                      data?.rows.map((row) => (
                        <AuditTableRow key={row.id} row={row} />
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {data && data.total > limit && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-sm text-muted-foreground">
                    {data.total} total entries — Page {currentPage} of {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - limit))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={offset + limit >= data.total}
                      onClick={() => setOffset(offset + limit)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  )
}
