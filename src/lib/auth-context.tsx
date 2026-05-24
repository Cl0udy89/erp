import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
import z from "zod"
import { createServerFn } from "@tanstack/react-start"
import { getEvent, appendResponseHeader } from "vinxi/http"
import { backendGet } from "#/lib/backend-client"

export interface AuthUser {
  id: string
  email: string
  role: "admin" | "manager" | "consultant" | "accountant"
  workspaceId: string
  employeeId: string
  name: string
  permissions: string[]
}

interface AuthContextValue {
  user: AuthUser | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  hasPermission: (permission: string) => boolean
  refetch: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export const getMeFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return await backendGet<AuthUser>("/auth/me")
  } catch {
    return null
  }
})

/**
 * Forward Set-Cookie headers from a backend response to the browser response.
 * Must be called inside a TanStack Start server function (H3/Vinxi context).
 *
 * Uses getSetCookie() (WHATWG spec) to get each Set-Cookie header as a
 * separate string — headers.forEach() in Bun combines them into one
 * comma-joined string which breaks multi-cookie responses.
 */
function forwardSetCookies(response: Response): void {
  try {
    const event = getEvent()
    // getSetCookie() returns each Set-Cookie value as a separate array entry
    const cookies: string[] =
      typeof (response.headers as any).getSetCookie === "function"
        ? (response.headers as any).getSetCookie()
        : []
    if (cookies.length > 0) {
      for (const cookie of cookies) {
        appendResponseHeader(event, "set-cookie", cookie)
      }
    } else {
      // Fallback for runtimes without getSetCookie()
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === "set-cookie") {
          appendResponseHeader(event, "set-cookie", value)
        }
      })
    }
  } catch {
    // Not running in server context (unit tests, etc.) — ignore
  }
}

export const loginFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: z.string(), password: z.string() }))
  .handler(async ({ data }) => {
    const backendApiUrl = process.env.BACKEND_API_URL ?? "http://localhost:4001"
    const internalToken = process.env.API_INTERNAL_TOKEN
    const response = await fetch(new URL("/auth/login", backendApiUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${internalToken}`
      },
      body: JSON.stringify(data)
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Login failed: ${response.status} ${text}`)
    }
    // Forward the Set-Cookie headers so the browser actually receives the auth cookies
    forwardSetCookies(response)
    return response.json() as Promise<{ user: AuthUser }>
  })

export const logoutFn = createServerFn({ method: "POST" }).handler(async () => {
  const backendApiUrl = process.env.BACKEND_API_URL ?? "http://localhost:4001"
  const internalToken = process.env.API_INTERNAL_TOKEN

  // Get the forwarded cookie header so the backend can revoke the refresh token
  let cookieHeader: string | undefined
  try {
    const event = getEvent()
    cookieHeader = (event.node.req.headers["cookie"] as string) ?? undefined
  } catch {
    // ignore
  }

  const response = await fetch(new URL("/auth/logout", backendApiUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(internalToken ? { Authorization: `Bearer ${internalToken}` } : {}),
      ...(cookieHeader ? { Cookie: cookieHeader } : {})
    },
    body: JSON.stringify({})
  })
  // Forward the cookie-clearing Set-Cookie headers to the browser
  forwardSetCookies(response)
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  async function fetchMe() {
    try {
      const result = await getMeFn()
      setUser(result ?? null)
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void fetchMe()
  }, [])

  async function login(email: string, password: string) {
    const result = await loginFn({ data: { email, password } })
    setUser(result.user)
  }

  async function logout() {
    await logoutFn()
    setUser(null)
  }

  function hasPermission(permission: string): boolean {
    return user?.permissions?.includes(permission) ?? false
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, hasPermission, refetch: fetchMe }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider")
  return ctx
}

export function usePermission(permission: string): boolean {
  const { hasPermission } = useAuth()
  return hasPermission(permission)
}
