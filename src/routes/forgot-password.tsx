import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { createServerFn } from "@tanstack/react-start"
import { toast } from "sonner"

import { backendPost } from "#/lib/backend-client"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "#/components/ui/card"

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage
})

const forgotPasswordFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { email: string })
  .handler(async ({ data }) =>
    backendPost<{ message: string }>("/auth/forgot-password", data)
  )

function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await forgotPasswordFn({ data: { email } })
      setSent(true)
    } catch {
      toast.error("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <img src="/sparksome-logo.svg" alt="Sparksome ERP" className="mx-auto mb-4 h-10 w-auto" />
          <CardTitle className="text-2xl">Forgot password</CardTitle>
          <CardDescription>
            {sent
              ? "Check your email for a reset link."
              : "Enter your email address and we'll send you a reset link."}
          </CardDescription>
        </CardHeader>
        {!sent && (
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Sending\u2026" : "Send reset link"}
              </Button>
              <div className="text-center">
                <Link to="/login" className="text-muted-foreground text-xs hover:underline">
                  Back to sign in
                </Link>
              </div>
            </form>
          </CardContent>
        )}
        {sent && (
          <CardContent>
            <div className="text-center">
              <Link to="/login" className="text-muted-foreground text-xs hover:underline">
                Back to sign in
              </Link>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
