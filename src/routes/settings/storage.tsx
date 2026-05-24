import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { toast } from "sonner"
import {
  CheckCircle2,
  AlertCircle,
  Cloud,
  Server,
  RefreshCw,
  RotateCcw
} from "lucide-react"

import {
  useStorageStatus,
  useRetryDriveSync,
  useRetryProxmoxSync,
  useResyncAllDrive,
  type RetryResult
} from "#/api/documents"
import { Button } from "#/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "#/components/ui/card"
import { Badge } from "#/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "#/components/ui/dialog"
import { Skeleton } from "#/components/ui/skeleton"
import { useAuth } from "#/lib/auth-context"
import { useTranslation } from "#/lib/i18n"
import { getWorkspaceId, workspaceSearchSchema } from "#/lib/search-schema"

export const Route = createFileRoute("/settings/storage")({
  validateSearch: workspaceSearchSchema,
  component: StorageSettingsPage
})

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

function RetryResultDisplay({ result, labels }: { result: RetryResult; labels?: { attempted: string; succeeded: string; stillFailing: string } }) {
  return (
    <div className="space-y-1 text-sm">
      <StatRow label={labels?.attempted ?? "Attempted"} value={result.attempted} />
      <StatRow label={labels?.succeeded ?? "Succeeded"} value={result.succeeded} />
      <StatRow label={labels?.stillFailing ?? "Still failing"} value={result.stillFailing} />
    </div>
  )
}

function StorageSettingsPage() {
  const search = Route.useSearch()
  const workspaceId = getWorkspaceId(search)
  const { user } = useAuth()
  const { t } = useTranslation()
  const canManage = user?.permissions?.includes("storage.manage") ?? false

  const { data: status, isLoading, refetch } = useStorageStatus(workspaceId ?? "")

  const retryDrive = useRetryDriveSync()
  const retryProxmox = useRetryProxmoxSync()
  const resyncAll = useResyncAllDrive()

  const [resyncAllConfirmOpen, setResyncAllConfirmOpen] = useState(false)
  const [driveRetryResult, setDriveRetryResult] = useState<RetryResult | null>(null)
  const [proxmoxRetryResult, setProxmoxRetryResult] = useState<RetryResult | null>(null)

  if (!canManage) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">You don't have permission to access storage settings.</p>
      </div>
    )
  }

  if (!workspaceId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Select a workspace from the sidebar.</p>
      </div>
    )
  }

  async function handleRetryDrive() {
    try {
      const result = await retryDrive.mutateAsync()
      setDriveRetryResult(result)
      toast.success(`Drive retry: ${result.succeeded}/${result.attempted} succeeded`)
      void refetch()
    } catch {
      toast.error("Drive retry failed")
    }
  }

  async function handleRetryProxmox() {
    try {
      const result = await retryProxmox.mutateAsync()
      setProxmoxRetryResult(result)
      toast.success(`Proxmox retry: ${result.succeeded}/${result.attempted} succeeded`)
      void refetch()
    } catch {
      toast.error("Proxmox retry failed")
    }
  }

  async function handleResyncAll() {
    setResyncAllConfirmOpen(false)
    try {
      const result = await resyncAll.mutateAsync()
      toast.success(`Re-sync started for ${result.queued} document(s)`)
      void refetch()
    } catch {
      toast.error("Re-sync all failed")
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t.settings.storageTitle}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t.settings.storageDesc}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Google Drive card */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Cloud className="h-5 w-5 text-blue-500" />
              <CardTitle className="text-base">Google Drive</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Service account sync to shared Drive folder
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  {status?.drive.configured ? (
                    <Badge variant="secondary" className="bg-green-100 text-green-800 text-xs">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> {t.settings.connected}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-gray-100 text-gray-600 text-xs">
                      {t.settings.notConfigured}
                    </Badge>
                  )}
                  {(status?.drive.errors ?? 0) > 0 && (
                    <Badge variant="destructive" className="text-xs">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      {status!.drive.errors} error{status!.drive.errors !== 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>

                <div className="divide-y">
                  <StatRow
                    label={t.settings.syncedCount}
                    value={`${status?.drive.synced ?? 0} / ${status?.drive.total ?? 0}`}
                  />
                  <StatRow
                    label={t.settings.syncErrors}
                    value={status?.drive.errors ?? 0}
                  />
                </div>

                {driveRetryResult && (
                  <div className="rounded-md bg-muted p-2">
                    <p className="text-xs font-medium mb-1 text-muted-foreground">{t.settings.lastRetryResult}</p>
                    <RetryResultDisplay result={driveRetryResult} labels={{ attempted: t.settings.attempted, succeeded: t.settings.succeeded, stillFailing: t.settings.stillFailing }} />
                  </div>
                )}

                <div className="flex flex-col gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRetryDrive}
                    disabled={retryDrive.isPending || !status?.drive.configured}
                  >
                    {retryDrive.isPending ? (
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    {t.settings.retryFailed}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setResyncAllConfirmOpen(true)}
                    disabled={resyncAll.isPending || !status?.drive.configured}
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                    {t.settings.resyncAll}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Proxmox card */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5 text-orange-500" />
              <CardTitle className="text-base">Proxmox Backup</CardTitle>
            </div>
            <CardDescription className="text-xs">
              rsync over SSH to office NAS/Proxmox storage
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  {status?.proxmox.configured ? (
                    <Badge variant="secondary" className="bg-green-100 text-green-800 text-xs">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> {t.settings.configured}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-gray-100 text-gray-600 text-xs">
                      {t.settings.notConfigured}
                    </Badge>
                  )}
                  {(status?.proxmox.errors ?? 0) > 0 && (
                    <Badge variant="destructive" className="text-xs">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      {status!.proxmox.errors} error{status!.proxmox.errors !== 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>

                <div className="divide-y">
                  <StatRow
                    label={t.settings.syncedCount}
                    value={`${status?.proxmox.synced ?? 0} / ${status?.proxmox.total ?? 0}`}
                  />
                  <StatRow label={t.settings.syncErrors} value={status?.proxmox.errors ?? 0} />
                  <StatRow
                    label={t.settings.lastSync}
                    value={
                      status?.proxmox.lastSynced
                        ? new Date(status.proxmox.lastSynced).toLocaleString()
                        : "—"
                    }
                  />
                </div>

                {proxmoxRetryResult && (
                  <div className="rounded-md bg-muted p-2">
                    <p className="text-xs font-medium mb-1 text-muted-foreground">{t.settings.lastRetryResult}</p>
                    <RetryResultDisplay result={proxmoxRetryResult} labels={{ attempted: t.settings.attempted, succeeded: t.settings.succeeded, stillFailing: t.settings.stillFailing }} />
                  </div>
                )}

                <div className="pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRetryProxmox}
                    disabled={retryProxmox.isPending || !status?.proxmox.configured}
                  >
                    {retryProxmox.isPending ? (
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    {t.settings.retryFailed}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Re-sync all confirmation */}
      <Dialog open={resyncAllConfirmOpen} onOpenChange={setResyncAllConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.settings.resyncAllConfirm}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t.settings.resyncAllDesc}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResyncAllConfirmOpen(false)}>
              {t.action.cancel}
            </Button>
            <Button onClick={() => void handleResyncAll()} disabled={resyncAll.isPending}>
              {resyncAll.isPending ? "Starting…" : t.settings.resyncAll}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
