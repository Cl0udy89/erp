import { TanStackDevtools } from "@tanstack/react-devtools"
import type { QueryClient } from "@tanstack/react-query"
import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
  Outlet,
  retainSearchParams,
  useNavigate,
  useLocation
} from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { useEffect } from "react"

import { DashboardLayout } from "#/components/dashboard-layout"
import { Toaster } from "#/components/ui/sonner"
import { TooltipProvider } from "#/components/ui/tooltip"
import { AuthProvider, useAuth } from "#/lib/auth-context"
import { LanguageProvider } from "#/lib/i18n"
import { workspaceSearchSchema } from "#/lib/search-schema"

import TanStackQueryDevtools from "../integrations/tanstack-query/devtools"

import appCss from "../styles.css?url"

interface MyRouterContext {
  queryClient: QueryClient
}

const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"]

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8"
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1"
      },
      {
        title: "SparkSome ERP"
      }
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss
      }
    ]
  }),
  validateSearch: workspaceSearchSchema,
  search: {
    middlewares: [retainSearchParams(["workspaceId"])]
  },
  component: RootComponent,
  shellComponent: RootDocument
})

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const pathname = location.pathname

  useEffect(() => {
    if (!isLoading && !user && !PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
      void navigate({ to: "/login" })
    }
  }, [isLoading, user, pathname, navigate])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
      </div>
    )
  }

  // On public paths, render without DashboardLayout
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return <>{children}</>
  }

  if (!user) {
    // Redirecting...
    return null
  }

  return (
    <DashboardLayout>
      {children}
    </DashboardLayout>
  )
}

function RootComponent() {
  return (
    <AuthProvider>
      <LanguageProvider>
        <TooltipProvider>
          <AuthGate>
            <Outlet />
          </AuthGate>
          <Toaster />
        </TooltipProvider>
      </LanguageProvider>
    </AuthProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <TanStackDevtools
          config={{
            position: "bottom-right"
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />
            },
            TanStackQueryDevtools
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
