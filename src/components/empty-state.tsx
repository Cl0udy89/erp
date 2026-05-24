import { Button } from "#/components/ui/button"

interface EmptyStateProps {
  icon: React.ElementType
  title: string
  subtitle?: string
  action?: string
  onAction?: () => void
}

export function EmptyState({ icon: Icon, title, subtitle, action, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Icon className="h-12 w-12 text-muted-foreground/40 mb-4" />
      <p className="text-lg font-medium text-muted-foreground">{title}</p>
      {subtitle && <p className="text-sm text-muted-foreground/70 mt-1">{subtitle}</p>}
      {action && onAction && (
        <Button className="mt-4" onClick={onAction}>{action}</Button>
      )}
    </div>
  )
}
