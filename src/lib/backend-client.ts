import { getWebRequest } from "vinxi/http"

type QueryValue = string | number | boolean | null | undefined

/**
 * Resolve backend URL lazily:
 * - Server-side (TanStack Start SSR / server functions): process.env.BACKEND_API_URL
 * - Client-side (browser): import.meta.env.VITE_BACKEND_API_URL
 * Falls back to localhost:4001 for local dev.
 */
function getBackendApiUrl(): string {
  if (typeof process !== "undefined" && process.env?.BACKEND_API_URL) {
    return process.env.BACKEND_API_URL
  }
  return (import.meta.env?.VITE_BACKEND_API_URL as string | undefined) ?? "http://localhost:4001"
}

/**
 * Internal token is server-only — never sent from the browser.
 * On the client, auth is handled via session cookies forwarded by the server.
 */
function getInternalToken(): string | undefined {
  if (typeof process !== "undefined") {
    return process.env?.API_INTERNAL_TOKEN
  }
  return undefined
}

function url(path: string, query?: Record<string, QueryValue>) {
  const target = new URL(path, getBackendApiUrl())
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      target.searchParams.set(key, String(value))
    }
  }
  return target
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Backend API failed: ${response.status} ${text}`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

/**
 * Get the Cookie header from the current TanStack Start server function context
 * and forward it to the backend so session cookies are passed through.
 */
function getForwardedCookieHeader(): string | undefined {
  try {
    const req = getWebRequest()
    return req.headers.get("cookie") ?? undefined
  } catch {
    return undefined
  }
}

function authHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  const forwardedCookie = getForwardedCookieHeader()
  const token = getInternalToken()
  const headers: Record<string, string> = {
    ...extraHeaders
  }
  // Add internal token only when running server-side (it's a secret)
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }
  // Forward session cookie so the backend can authenticate the user
  if (forwardedCookie) {
    headers["Cookie"] = forwardedCookie
  }
  return headers
}

export async function backendGet<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
  const response = await fetch(url(path, query), {
    headers: authHeaders()
  })
  return parseResponse<T>(response)
}

export async function backendPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(url(path), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body ?? {})
  })
  return parseResponse<T>(response)
}

export async function backendDelete<T>(
  path: string,
  query?: Record<string, QueryValue>
): Promise<T> {
  const response = await fetch(url(path, query), {
    method: "DELETE",
    headers: authHeaders()
  })
  return parseResponse<T>(response)
}
