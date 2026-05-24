import { createFileRoute, useNavigate, Link } from "@tanstack/react-router"
import { useState, useEffect } from "react"
import { toast } from "sonner"

import { useAuth } from "#/lib/auth-context"
import { useTranslation } from "#/lib/i18n"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"

export const Route = createFileRoute("/login")({
  component: LoginPage
})

function LoginPage() {
  const { login, user } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  // Redirect if already logged in — must be in useEffect to avoid setState-during-render
  useEffect(() => {
    if (user) {
      void navigate({ to: "/" })
    }
  }, [user])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await login(email, password)
      void navigate({ to: "/" })
    } catch {
      toast.error(t.auth.invalidCredentials)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1a1a1f]">
      <div className="w-full max-w-sm rounded-xl border border-[#2e2e35] bg-[#212128] p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <img src="/sparksome-logo.svg" alt="Sparksome ERP" className="mx-auto mb-5 h-10 w-auto" />
          <h1 className="text-xl font-semibold text-zinc-100">{t.auth.login}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t.auth.enterCredentials}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-300">{t.auth.email}</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="border-[#2e2e35] bg-[#17171c] text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-indigo-500"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-300">{t.auth.password}</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="border-[#2e2e35] bg-[#17171c] text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-indigo-500"
            />
            <div className="text-right">
              <Link
                to="/forgot-password"
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                {t.auth.forgotPassword}
              </Link>
            </div>
          </div>
          <Button
            type="submit"
            className="mt-2 w-full bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:ring-indigo-500"
            disabled={loading}
          >
            {loading ? t.auth.signing : t.auth.login}
          </Button>
        </form>
      </div>
    </div>
  )
}
