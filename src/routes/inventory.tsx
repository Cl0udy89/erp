import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { financeQueries, useCreateProduct, useCreateStockMovement } from "#/api/finance"
import { queriesProjects } from "#/api/queries"
import { Button } from "#/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "#/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs"
import { getWorkspaceId, workspaceSearchSchema } from "#/lib/search-schema"
import { formatDate, formatPLN } from "#/lib/utils"

export const Route = createFileRoute("/inventory")({
  loader: async ({ context, location }) => {
    const workspaceId = getWorkspaceId(location.search)
    await context.queryClient.prefetchQuery({ ...financeQueries.products() })
    await context.queryClient.prefetchQuery({ ...financeQueries.stockSummary() })
    await context.queryClient.prefetchQuery({ ...financeQueries.stockMovements() })
    if (workspaceId) {
      await context.queryClient.prefetchQuery({ ...queriesProjects.workspaceProjects(workspaceId) })
    }
  },
  validateSearch: workspaceSearchSchema,
  component: InventoryPage
})

const movementTypes = [
  "OPENING_BALANCE",
  "PURCHASE",
  "ISSUE_TO_PROJECT",
  "SALE",
  "CORRECTION",
  "RETURN"
]

function today() {
  return new Date().toISOString().slice(0, 10)
}

function InventoryPage() {
  const { workspaceId } = Route.useSearch()
  const [productDialogOpen, setProductDialogOpen] = useState(false)
  const [movementDialogOpen, setMovementDialogOpen] = useState(false)
  const [productForm, setProductForm] = useState({
    name: "",
    sku: "",
    description: "",
    defaultPurchasePrice: 0
  })
  const [movementForm, setMovementForm] = useState({
    productId: "",
    projectId: "",
    movementType: "PURCHASE",
    movementDate: today(),
    quantity: 1,
    unitPrice: 0,
    description: ""
  })

  const { data: products } = useQuery(financeQueries.products())
  const { data: movements } = useQuery(financeQueries.stockMovements())
  const { data: summary } = useQuery(financeQueries.stockSummary())
  const { data: projects } = useQuery({
    ...queriesProjects.workspaceProjects(workspaceId ?? ""),
    enabled: !!workspaceId
  })

  const createProduct = useCreateProduct()
  const createMovement = useCreateStockMovement()

  const handleCreateProduct = () => {
    createProduct.mutate(
      {
        name: productForm.name,
        sku: productForm.sku || undefined,
        description: productForm.description || undefined,
        defaultPurchasePrice: Number(productForm.defaultPurchasePrice)
      },
      {
        onSuccess: () => {
          setProductDialogOpen(false)
          setProductForm({ name: "", sku: "", description: "", defaultPurchasePrice: 0 })
          toast.success("Product created")
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : "Could not create product")
        }
      }
    )
  }

  const handleCreateMovement = () => {
    createMovement.mutate(
      {
        productId: movementForm.productId,
        projectId: movementForm.projectId || undefined,
        movementType: movementForm.movementType as never,
        movementDate: movementForm.movementDate,
        quantity: Number(movementForm.quantity),
        unitPrice: Number(movementForm.unitPrice),
        description: movementForm.description || undefined
      },
      {
        onSuccess: () => {
          setMovementDialogOpen(false)
          toast.success("Stock movement created")
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : "Could not create stock movement")
        }
      }
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inventory</h1>
          <p className="text-muted-foreground mt-1">Products, stock movements and stock value</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Plus data-icon="inline-start" />
                Product
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add product</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-4">
                <Input
                  placeholder="Name"
                  value={productForm.name}
                  onChange={(event) => {
                    setProductForm({ ...productForm, name: event.target.value })
                  }}
                />
                <Input
                  placeholder="SKU"
                  value={productForm.sku}
                  onChange={(event) => {
                    setProductForm({ ...productForm, sku: event.target.value })
                  }}
                />
                <Input
                  type="number"
                  placeholder="Default purchase price"
                  value={productForm.defaultPurchasePrice}
                  onChange={(event) => {
                    setProductForm({
                      ...productForm,
                      defaultPurchasePrice: Number(event.target.value)
                    })
                  }}
                />
                <Input
                  placeholder="Description"
                  value={productForm.description}
                  onChange={(event) => {
                    setProductForm({ ...productForm, description: event.target.value })
                  }}
                />
              </div>
              <Button
                onClick={handleCreateProduct}
                disabled={!productForm.name || createProduct.isPending}
              >
                {createProduct.isPending ? "Saving..." : "Create product"}
              </Button>
            </DialogContent>
          </Dialog>

          <Dialog open={movementDialogOpen} onOpenChange={setMovementDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus data-icon="inline-start" />
                Movement
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add stock movement</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3 py-4">
                <Select
                  value={movementForm.productId}
                  onValueChange={(value) => {
                    setMovementForm({ ...movementForm, productId: value })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Product" />
                  </SelectTrigger>
                  <SelectContent>
                    {products?.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={movementForm.movementType}
                  onValueChange={(value) => {
                    setMovementForm({ ...movementForm, movementType: value })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {movementTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={movementForm.projectId}
                  onValueChange={(value) => {
                    setMovementForm({ ...movementForm, projectId: value })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Project optional" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects?.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="date"
                  value={movementForm.movementDate}
                  onChange={(event) => {
                    setMovementForm({ ...movementForm, movementDate: event.target.value })
                  }}
                />
                <Input
                  type="number"
                  value={movementForm.quantity}
                  onChange={(event) => {
                    setMovementForm({ ...movementForm, quantity: Number(event.target.value) })
                  }}
                />
                <Input
                  type="number"
                  value={movementForm.unitPrice}
                  onChange={(event) => {
                    setMovementForm({ ...movementForm, unitPrice: Number(event.target.value) })
                  }}
                />
                <Input
                  placeholder="Description"
                  value={movementForm.description}
                  onChange={(event) => {
                    setMovementForm({ ...movementForm, description: event.target.value })
                  }}
                />
              </div>
              <Button
                onClick={handleCreateMovement}
                disabled={!movementForm.productId || createMovement.isPending}
              >
                {createMovement.isPending ? "Saving..." : "Create movement"}
              </Button>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Stock summary</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="movements">Movements</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <Card>
            <CardHeader>
              <CardTitle>Stock value</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary?.map((row) => (
                    <TableRow key={row.productId}>
                      <TableCell>{row.productName}</TableCell>
                      <TableCell>{row.sku ?? "-"}</TableCell>
                      <TableCell className="text-right font-mono">{row.quantityOnHand}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(row.stockValue)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="products">
          <Card>
            <CardHeader>
              <CardTitle>Products</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Default price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products?.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell>{product.name}</TableCell>
                      <TableCell>{product.sku ?? "-"}</TableCell>
                      <TableCell>{product.description ?? "-"}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(product.defaultPurchasePrice)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="movements">
          <Card>
            <CardHeader>
              <CardTitle>Stock movements</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements?.map((movement) => (
                    <TableRow key={movement.id}>
                      <TableCell>{formatDate(movement.movementDate)}</TableCell>
                      <TableCell>{movement.movementType}</TableCell>
                      <TableCell>{movement.productName}</TableCell>
                      <TableCell>{movement.projectName ?? "-"}</TableCell>
                      <TableCell className="text-right font-mono">{movement.quantity}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(movement.unitPrice)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPLN(movement.totalValue)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
