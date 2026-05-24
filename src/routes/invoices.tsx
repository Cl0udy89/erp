import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { useState } from "react"

import { useCreateInvoice } from "#/api/mutations"
import { queriesInvoices, queriesClients } from "#/api/queries"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { Card, CardContent } from "#/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "#/components/ui/dialog"
import { Input } from "#/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "#/components/ui/select"
import { Skeleton } from "#/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "#/components/ui/table"
import { getWorkspaceId, workspaceSearchSchema } from "#/lib/search-schema"

export const Route = createFileRoute("/invoices")({
  loader: async ({ context, location }) => {
    const workspaceId = getWorkspaceId(location.search)
    if (workspaceId) {
      await context.queryClient.prefetchQuery({ ...queriesInvoices.workspaceInvoices(workspaceId) })
      await context.queryClient.prefetchQuery({ ...queriesClients.workspaceClients(workspaceId) })
    }
  },
  validateSearch: workspaceSearchSchema,
  component: InvoicesPage
})

function formatCurrency(amount: number, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format(amount)
}

function InvoicesPage() {
  const { workspaceId } = Route.useSearch()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [formData, setFormData] = useState({
    number: "",
    clientId: "",
    currency: "USD",
    date: new Date().toISOString().split("T")[0],
    note: ""
  })

  const { data: invoices, isLoading: invoicesLoading } = useQuery({
    ...queriesInvoices.workspaceInvoices(workspaceId ?? ""),
    enabled: !!workspaceId
  })

  const { data: clients } = useQuery({
    ...queriesClients.workspaceClients(workspaceId ?? ""),
    enabled: !!workspaceId
  })

  const createInvoiceMutation = useCreateInvoice()

  const handleSubmit = () => {
    if (!workspaceId || !formData.number || !formData.clientId) return

    createInvoiceMutation.mutate(
      {
        workspaceId,
        number: formData.number,
        clientId: formData.clientId,
        currency: formData.currency,
        date: formData.date,
        note: formData.note || undefined
      },
      {
        onSuccess: () => {
          setFormData({
            number: "",
            clientId: "",
            currency: "USD",
            date: new Date().toISOString().split("T")[0],
            note: ""
          })
          setIsDialogOpen(false)
        }
      }
    )
  }

  const getStatusColor = (status?: string) => {
    switch (status?.toLowerCase()) {
      case "paid":
        return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
      case "sent":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
      case "overdue":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
    }
  }

  if (!workspaceId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="space-y-4 text-center">
          <h2 className="text-2xl font-bold">Select a Workspace</h2>
          <p className="text-muted-foreground">
            Choose a workspace from the sidebar to view invoices.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Invoices</h1>
          <p className="text-muted-foreground mt-1">Manage invoices and billing</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus data-icon="inline-start" />
              New Invoice
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create New Invoice</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label htmlFor="invoice-number" className="mb-1.5 block text-sm font-medium">
                  Invoice Number
                </label>
                <Input
                  id="invoice-number"
                  value={formData.number}
                  onChange={(e) => {
                    setFormData({ ...formData, number: e.target.value })
                  }}
                  placeholder="e.g. INV-001"
                />
              </div>
              <div>
                <label htmlFor="invoice-client" className="mb-1.5 block text-sm font-medium">
                  Client
                </label>
                <Select
                  value={formData.clientId}
                  onValueChange={(v) => {
                    setFormData({ ...formData, clientId: v })
                  }}
                >
                  <SelectTrigger id="invoice-client">
                    <SelectValue placeholder="Select client..." />
                  </SelectTrigger>
                  <SelectContent>
                    {clients?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="invoice-currency" className="mb-1.5 block text-sm font-medium">
                    Currency
                  </label>
                  <Select
                    value={formData.currency}
                    onValueChange={(v) => {
                      setFormData({ ...formData, currency: v })
                    }}
                  >
                    <SelectTrigger id="invoice-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                      <SelectItem value="PLN">PLN</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label htmlFor="invoice-date" className="mb-1.5 block text-sm font-medium">
                    Date
                  </label>
                  <Input
                    id="invoice-date"
                    type="date"
                    value={formData.date}
                    onChange={(e) => {
                      setFormData({ ...formData, date: e.target.value })
                    }}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="invoice-note" className="mb-1.5 block text-sm font-medium">
                  Note
                </label>
                <Input
                  id="invoice-note"
                  value={formData.note}
                  onChange={(e) => {
                    setFormData({ ...formData, note: e.target.value })
                  }}
                  placeholder="Optional note..."
                />
              </div>
              <Button
                onClick={handleSubmit}
                disabled={createInvoiceMutation.isPending || !formData.number || !formData.clientId}
                className="w-full"
              >
                {createInvoiceMutation.isPending ? "Creating..." : "Create Invoice"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          {invoicesLoading ? (
            <div className="space-y-4 p-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices && invoices.length > 0 ? (
                  invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium">{invoice.number ?? "—"}</TableCell>
                      <TableCell>
                        {invoice.clientName ??
                          clients?.find((c) => c.id === invoice.clientId)?.name ??
                          "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {invoice.issuedDate && invoice.issuedDate !== "null"
                          ? new Date(invoice.issuedDate).toLocaleDateString()
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={getStatusColor(invoice.status ?? undefined)}
                        >
                          {invoice.status ?? "Draft"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {invoice.amount !== undefined && invoice.amount !== null
                          ? formatCurrency(invoice.amount, invoice.currency ?? "USD")
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground py-8 text-center">
                      No invoices found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
