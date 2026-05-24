import { useQuery } from "@tanstack/react-query"
import { Link, useLocation, useNavigate, useSearch } from "@tanstack/react-router"
import {
  Users,
  FolderKanban,
  Timer,
  LayoutDashboard,
  RefreshCw,
  Package,
  FileSpreadsheet,
  CheckSquare,
  Settings,
  LogOut,
  Calculator,
  FolderOpen,
  Shield,
  ChevronLeft,
  ChevronRight,
  ChevronDown
} from "lucide-react"
import { useState, useEffect } from "react"
import { toast } from "sonner"
import { createServerFn } from "@tanstack/react-start"

import { queries, queriesUsers } from "#/api/queries"
import { useSyncClockifyWorkspace } from "#/api/sync"
import { TimerWidget } from "#/components/timer-widget"
import { TimeEntryForm } from "#/components/time-entry-form"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "#/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#/components/ui/tooltip"
import { useTranslation, type Language } from "#/lib/i18n"
import { useAuth } from "#/lib/auth-context"
import { backendGet } from "#/lib/backend-client"
import { cn } from "#/lib/utils"

interface BadgeCounts {
  pendingTimesheets: number
  syncErrors: number
  staleDraftWarehouse: number
}

const fetchBadgeCountsFn = createServerFn({ method: "GET" })
  .inputValidator((workspaceId: string) => workspaceId)
  .handler(async ({ data: workspaceId }) =>
    backendGet<BadgeCounts>(`/workspace/badge-counts?workspaceId=${workspaceId}`)
  )

type NavItem = {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  show: boolean
  badge?: number
}

type NavGroup = {
  label: string | null
  show?: boolean
  items: NavItem[]
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { t, language, setLanguage } = useTranslation()
  const { user, isLoading: authLoading, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate({ from: "/" })
  const search = useSearch({ strict: false })
  const workspaceId = search.workspaceId

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("erp_sidebar_collapsed") === "true"
    } catch {
      return false
    }
  })

  const toggleCollapse = () => {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem("erp_sidebar_collapsed", String(next))
    } catch {
      // ignore
    }
  }

  const { data: workspaces, isLoading, error: workspacesError } = useQuery({
    ...queries.workspacesList,
    enabled: !!user
  })
  const syncMutation = useSyncClockifyWorkspace()

  // Auto-select workspace when there's exactly one (or first load with no selection)
  useEffect(() => {
    if (!workspaceId && workspaces && workspaces.length > 0) {
      void navigate({
        search: (prev) => ({ ...prev, workspaceId: workspaces[0]!.id }),
        replace: true
      })
    }
  }, [workspaceId, workspaces, navigate])

  const [stopFormOpen, setStopFormOpen] = useState(false)
  const [stopFormInitial, setStopFormInitial] = useState<Record<string, string | boolean | undefined>>({})

  const { data: users } = useQuery({
    ...queriesUsers.workspaceUsers(workspaceId ?? ""),
    enabled: !!workspaceId
  })
  const employeeId = users?.[0]?.id

  const { data: badgeCounts } = useQuery({
    queryKey: ["badge-counts", workspaceId],
    queryFn: async () => fetchBadgeCountsFn({ data: workspaceId! }),
    enabled: !!workspaceId,
    refetchInterval: 120000
  })

  function handleTimerStop(data: { description?: string; projectId?: string; tags?: string[] }) {
    setStopFormInitial({
      description: data.description,
      projectId: data.projectId,
      tags: data.tags?.join(", ")
    })
    setStopFormOpen(true)
  }

  const setWorkspaceId = (id: string | undefined) => {
    void navigate({
      search: (prev) => ({ ...prev, workspaceId: id }),
      replace: true
    })
  }

  const perms = user?.permissions ?? []
  const showAll = perms.length === 0
  const isAdmin = user?.role === "admin"

  const currentWorkspace = workspaces?.find((ws) => ws.id === workspaceId)
  const workspaceName = currentWorkspace?.name ?? (isLoading ? "…" : workspacesError ? t.common.workspaceLoadError : t.common.selectWorkspace)
  const workspaceInitial = workspaceName.charAt(0).toUpperCase()

  const nameInitials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?"

  const sectionSales = language === "en" ? "SALES" : "SPRZEDAŻ"
  const sectionResources = language === "en" ? "RESOURCES" : "ZASOBY"
  const sectionFinance = language === "en" ? "FINANCE" : "FINANSE"

  const navGroups: NavGroup[] = [
    {
      label: null,
      items: [
        { to: "/", label: t.nav.dashboard, icon: LayoutDashboard, show: true },
        { to: "/time-entries", label: t.nav.timeEntries, icon: Timer, show: true },
        {
          to: "/timesheets",
          label: t.nav.approvals,
          icon: CheckSquare,
          show: showAll || perms.includes("timesheets.approve") || perms.includes("timesheets.submit"),
          badge: perms.includes("timesheets.approve") ? badgeCounts?.pendingTimesheets : undefined
        }
      ]
    },
    {
      label: sectionSales,
      items: [
        { to: "/projects", label: t.nav.projects, icon: FolderKanban, show: true },
        {
          to: "/financials",
          label: t.nav.financials,
          icon: FileSpreadsheet,
          show: showAll || perms.includes("documents.view")
        }
      ]
    },
    {
      label: sectionResources,
      items: [
        {
          to: "/people",
          label: t.nav.people,
          icon: Users,
          show: showAll || perms.includes("employees.view_all")
        },
        {
          to: "/documents",
          label: t.nav.documents,
          icon: FolderOpen,
          show: showAll || perms.includes("documents.view")
        },
        {
          to: "/warehouse",
          label: t.nav.warehouse,
          icon: Package,
          show: showAll || perms.includes("warehouse.view"),
          badge: perms.includes("warehouse.manage") ? badgeCounts?.staleDraftWarehouse : undefined
        }
      ]
    },
    {
      label: sectionFinance,
      items: [
        {
          to: "/accounting",
          label: t.nav.accounting,
          icon: Calculator,
          show: showAll || perms.includes("reports.accounting")
        }
      ]
    },
    {
      label: "SYSTEM",
      show: isAdmin || showAll,
      items: [
        {
          to: "/audit",
          label: t.nav.audit,
          icon: Shield,
          show: showAll || perms.includes("audit.view")
        },
        {
          to: "/settings/users",
          label: t.nav.settings,
          icon: Settings,
          show: showAll || perms.includes("users.manage")
        }
      ]
    }
  ]

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#09090b]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-[#09090b]">
      {/* ── Sidebar ── */}
      <aside
        className={cn(
          "flex flex-col border-r border-[#1f1f23] bg-[#0f0f11] transition-all duration-200 ease-in-out shrink-0",
          collapsed ? "w-[52px]" : "w-[220px]"
        )}
      >
        {/* Workspace switcher */}
        <div
          className={cn(
            "flex h-11 shrink-0 items-center border-b border-[#1f1f23]",
            collapsed ? "justify-center px-2" : "gap-1.5 px-2"
          )}
        >
          {collapsed ? (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleCollapse}
                    className="flex h-7 w-7 items-center justify-center rounded border border-[#27272a] bg-[#18181b] text-xs font-bold text-[#f4f4f5]"
                  >
                    {workspaceInitial}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{workspaceName}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[#27272a] bg-[#18181b] px-3 text-left">
                    <span className="flex-1 truncate text-sm font-medium text-[#f4f4f5]">
                      {workspaceName}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#52525b]" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="start" className="w-48">
                  {workspaces?.map((ws) => (
                    <DropdownMenuItem key={ws.id} onClick={() => setWorkspaceId(ws.id)}>
                      {ws.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#52525b] transition-colors hover:bg-[#18181b] hover:text-[#a1a1aa] disabled:opacity-40"
                      disabled={syncMutation.isPending}
                      onClick={() => {
                        syncMutation.mutate(
                          { workspaceId },
                          {
                            onSuccess: (result: any) => {
                              toast.success("Clockify sync finished", {
                                description: `${result.workspaces} workspaces, ${result.users} people, ${result.clients} clients, ${result.projects} projects, ${result.timeEntries} time entries`
                              })
                            },
                            onError: (syncError) => {
                              toast.error("Clockify sync failed", {
                                description:
                                  syncError instanceof Error
                                    ? syncError.message
                                    : "Unknown sync error"
                              })
                            }
                          }
                        )
                      }}
                    >
                      <RefreshCw
                        className={cn("h-3.5 w-3.5", syncMutation.isPending && "animate-spin")}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{t.common.sync}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          )}
        </div>

        {/* Navigation */}
        <TooltipProvider delayDuration={300}>
          <nav className="flex-1 overflow-y-auto py-2">
            {navGroups.map((group, gi) => {
              if (group.show === false) return null
              const visibleItems = group.items.filter((item) => item.show)
              if (visibleItems.length === 0) return null

              return (
                <div key={gi}>
                  {group.label && !collapsed && (
                    <div className="mb-1 mt-5 px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#52525b]">
                      {group.label}
                    </div>
                  )}
                  {visibleItems.map((item) => {
                    const Icon = item.icon
                    const isActive =
                      item.to === "/"
                        ? location.pathname === "/"
                        : location.pathname === item.to ||
                          location.pathname.startsWith(item.to + "/") ||
                          (item.to === "/settings/users" &&
                            location.pathname.startsWith("/settings"))

                    const linkEl = (
                      <Link
                        key={item.to}
                        to={item.to as any}
                        className={cn(
                          "flex h-8 w-full items-center gap-2.5 pr-3 transition-colors duration-150",
                          collapsed ? "justify-center pl-0" : isActive ? "pl-[10px]" : "pl-3",
                          isActive
                            ? "border-l-2 border-indigo-500 bg-[#18181b] text-[#f4f4f5]"
                            : "text-[#a1a1aa] hover:bg-[#18181b] hover:text-[#d4d4d8]"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {!collapsed && (
                          <>
                            <span className="flex-1 truncate text-sm font-medium">
                              {item.label}
                            </span>
                            {item.badge != null && item.badge > 0 && (
                              <span className="ml-auto rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-400">
                                {item.badge}
                              </span>
                            )}
                          </>
                        )}
                      </Link>
                    )

                    if (collapsed) {
                      return (
                        <Tooltip key={item.to}>
                          <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
                          <TooltipContent side="right">
                            <span>{item.label}</span>
                            {item.badge != null && item.badge > 0 && (
                              <span className="ml-1 text-xs">({item.badge})</span>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      )
                    }
                    return linkEl
                  })}
                </div>
              )
            })}
          </nav>
        </TooltipProvider>

        {/* Collapse toggle */}
        <div
          className={cn(
            "flex shrink-0 py-2",
            collapsed ? "justify-center px-2" : "justify-end px-2"
          )}
        >
          <button
            onClick={toggleCollapse}
            className="flex h-6 w-6 items-center justify-center text-[#52525b] transition-colors hover:text-[#a1a1aa]"
          >
            {collapsed ? (
              <ChevronRight className="h-5 w-5" />
            ) : (
              <ChevronLeft className="h-5 w-5" />
            )}
          </button>
        </div>

        {/* Language switcher */}
        {!collapsed && (
          <div className="flex h-8 shrink-0 items-center gap-1 px-3">
            <button
              onClick={() => setLanguage("pl" as Language)}
              className={cn(
                "text-xs transition-colors",
                language === "pl"
                  ? "font-semibold text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              PL
            </button>
            <span className="text-xs text-zinc-700">/</span>
            <button
              onClick={() => setLanguage("en" as Language)}
              className={cn(
                "text-xs transition-colors",
                language === "en"
                  ? "font-semibold text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              EN
            </button>
          </div>
        )}

        {/* User section */}
        {user && (
          <div className="shrink-0 border-t border-[#1f1f23]">
            <div
              className={cn(
                "flex h-12 items-center gap-2.5 px-3",
                collapsed && "justify-center"
              )}
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
                {nameInitials}
              </div>
              {!collapsed && (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-200">{user.name}</p>
                    <p className="truncate text-[11px] text-zinc-500">{user.email}</p>
                  </div>
                  <button
                    onClick={() => void logout()}
                    className="shrink-0 text-zinc-500 transition-colors hover:text-zinc-200"
                    title={t.common.signOut}
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </>
              )}
              {collapsed && (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => void logout()}
                        className="sr-only"
                      >
                        {t.common.signOut}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{t.common.signOut}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* ── Main content ── */}
      <main className="flex flex-1 flex-col overflow-hidden bg-[#09090b]">
        {/* Thin timer bar */}
        <div className="flex h-10 shrink-0 items-center border-b border-zinc-800 px-6">
          <TimerWidget workspaceId={workspaceId} onStopTimer={handleTimerStop} />
        </div>
        {/* Page content — routes own their padding */}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>

      {/* Timer stop form */}
      {workspaceId && employeeId && (
        <TimeEntryForm
          open={stopFormOpen}
          onOpenChange={setStopFormOpen}
          workspaceId={workspaceId}
          employeeId={employeeId}
          mode="complete-timer"
          initialData={{
            taskName:
              typeof stopFormInitial.description === "string"
                ? stopFormInitial.description
                : undefined,
            description:
              typeof stopFormInitial.description === "string"
                ? stopFormInitial.description
                : undefined,
            projectId:
              typeof stopFormInitial.projectId === "string"
                ? stopFormInitial.projectId
                : undefined,
            tags:
              typeof stopFormInitial.tags === "string" ? stopFormInitial.tags : undefined
          }}
        />
      )}
    </div>
  )
}
