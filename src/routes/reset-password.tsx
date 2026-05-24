import { createFileRoute, useNavigate, Link } from "@tanstack/react-router"
import { useState } from "react"
import { z } from "zod"
import { createServerFn } from "@tanstack/react-start"
import { toast } from "sonner"

import { backendPost } from "#/lib/backend-client"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "#/components/ui/card"

export const Route = createFileRoute("/reset-password")({
  validateSearch: z.object({ token: z.string().optional() }),
  component: ResetPasswordPage
})

const resetPasswordFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { token: string; newPassword: string })
  .handler(async ({ data }) =>
    backendPost<{ success: boolean }>("/auth/reset-password", data)
  )

function ResetPasswordPage() {
  const { token } = Route.useSearch()
  const navigate = useNavigate()
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Invalid link</CardTitle>
            <CardDescription>This reset link is invalid or has expired.</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Link to="/forgot-password" className="text-muted-foreground text-xs hover:underline">
              Request a new reset link
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match")
      return
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters")
      return
    }
    setLoading(true)
    try {
      await resetPasswordFn({ data: { token: token!, newPassword } })
      toast.success("Password reset successfully. Please sign in.")
      void navigate({ to: "/login" })
    } catch {
      toast.error("Invalid or expired reset link. Please request a new one.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <img src="/sparksome-logo.svg" alt="Sparksome ERP" className="mx-auto mb-4 h-10 w-auto" />
          <CardTitle className="text-2xl">Set new password</CardTitle>
          <CardDescription>Enter your new password below.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">New password</label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Confirm password</label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Resetting\u2026" : "Reset password"}
            </Button>
            <div className="text-center">
              <Link to="/login" className="text-muted-foreground text-xs hover:underline">
                Back to sign in
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
