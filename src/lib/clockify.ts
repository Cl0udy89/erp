import z from "zod"

import { env } from "#/env"

const CLOCKIFY_BASE_URL = env.CLOCKIFY_BASE_URL ?? "https://api.clockify.me/api/v1"

if (env.CLOCKIFY_KEY) {
  console.log("[Clockify] API key configured")
}
console.log(`[Clockify] Base URL: ${CLOCKIFY_BASE_URL}`)

export class ClockifyError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: unknown
  ) {
    super(message)
    this.name = "ClockifyError"
  }
}

function getClockifyApiKey() {
  if (!env.CLOCKIFY_KEY) {
    throw new ClockifyError("CLOCKIFY_KEY is required for the Clockify sync service", 500)
  }
  return env.CLOCKIFY_KEY
}

function clockifyErrorMessage(status: number, statusText: string, body: unknown) {
  if (
    status === 401 &&
    typeof body === "object" &&
    body !== null &&
    "code" in body &&
    body.code === 4003
  ) {
    return [
      "Clockify rejected CLOCKIFY_KEY: API key does not exist.",
      "Generate a new API key in Clockify Profile Settings and update .env.",
      "If this workspace uses a subdomain or regional server, generate the key for that workspace and set CLOCKIFY_BASE_URL."
    ].join(" ")
  }

  return `Clockify API error: ${status} ${statusText}`
}

async function clockifyFetchRaw<T>(
  path: string,
  options?: RequestInit,
  schema?: z.ZodSchema<T>
): Promise<T> {
  const url = `${CLOCKIFY_BASE_URL}${path}`

  console.log(`[Clockify] ${options?.method ?? "GET"} ${url}`)

  const headers = new Headers(options?.headers)
  headers.set("X-Api-Key", getClockifyApiKey())
  headers.set("Content-Type", "application/json")

  try {
    const res = await fetch(url, {
      ...options,
      headers
    })

    console.log(`[Clockify] Response status: ${res.status} ${res.statusText}`)

    if (!res.ok) {
      let body: unknown
      try {
        body = await res.json()
      } catch {
        body = await res.text()
      }
      console.error(`[Clockify] Error response:`, body)
      throw new ClockifyError(
        clockifyErrorMessage(res.status, res.statusText, body),
        res.status,
        body
      )
    }

    const contentLength = res.headers.get("content-length")
    const hasBody = contentLength !== "0" && res.status !== 204

    if (!hasBody) {
      console.log(`[Clockify] Success: empty body`)
      return undefined as T
    }

    const data = await res.json()
    console.log(`[Clockify] Success:`, Array.isArray(data) ? `Array(${data.length})` : "Object")
    return schema ? schema.parse(data) : data
  } catch (error) {
    if (error instanceof ClockifyError) {
      throw error
    }
    console.error(`[Clockify] Network/fetch error:`, error)
    throw new ClockifyError(
      `Clockify request failed: ${error instanceof Error ? error.message : String(error)}`,
      0,
      error
    )
  }
}

export async function clockifyFetch<T>(
  path: string,
  options?: RequestInit,
  schema?: z.ZodSchema<T>
): Promise<T> {
  return clockifyFetchRaw(path, options, schema)
}

export async function clockifyFetchAll<T>(
  path: string,
  options?: RequestInit,
  schema?: z.ZodSchema<T[]>
): Promise<T[]> {
  const allItems: T[] = []
  let page = 1
  const pageSize = 5000

  console.log(`[Clockify] Starting paginated fetch: ${path}`)

  try {
    while (true) {
      const separator = path.includes("?") ? "&" : "?"
      const paginatedPath = `${path}${separator}page=${page}&page-size=${pageSize}`

      console.log(`[Clockify] Fetching page ${page}: ${paginatedPath}`)

      const headers = new Headers(options?.headers)
      headers.set("X-Api-Key", getClockifyApiKey())
      headers.set("Content-Type", "application/json")

      const res = await fetch(`${CLOCKIFY_BASE_URL}${paginatedPath}`, {
        ...options,
        headers
      })

      console.log(`[Clockify] Page ${page} response: ${res.status}`)

      if (!res.ok) {
        let body: unknown
        try {
          body = await res.json()
        } catch {
          body = await res.text()
        }
        console.error(`[Clockify] Page ${page} error:`, body)
        throw new ClockifyError(
          clockifyErrorMessage(res.status, res.statusText, body),
          res.status,
          body
        )
      }

      const data = await res.json()
      const items = schema ? schema.parse(data) : data

      if (!Array.isArray(items)) {
        console.error(`[Clockify] Expected array but got:`, typeof items, items)
        throw new ClockifyError(`Expected array but got ${typeof items}`, 500, items)
      }

      console.log(`[Clockify] Page ${page}: ${items.length} items`)
      allItems.push(...(items as T[]))

      const lastPage = res.headers.get("Last-Page")
      console.log(`[Clockify] Last-Page header:`, lastPage)

      if (lastPage === "true" || items.length === 0 || items.length < pageSize) {
        break
      }

      page++
    }

    console.log(`[Clockify] Total fetched: ${allItems.length} items`)
    return allItems
  } catch (error) {
    if (error instanceof ClockifyError) {
      throw error
    }
    console.error(`[Clockify] Network/fetch error:`, error)
    throw new ClockifyError(
      `Clockify request failed: ${error instanceof Error ? error.message : String(error)}`,
      0,
      error
    )
  }
}
