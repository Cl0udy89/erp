import type { ClassValue } from "clsx"
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

type Success<T> = [T, null]
type Failure<E> = [null, E]
type Result<T, E = Error> = Success<T> | Failure<E>

export async function tryCatch<T, E = Error>(promise: Promise<T>): Promise<Result<T, E>> {
  try {
    const data = await promise
    return [data, null]
  } catch (error) {
    return [null, error as E]
  }
}

export function tryCatchSync<T, E = Error>(func: () => T): Result<T, E> {
  try {
    const data = func()
    return [data, null]
  } catch (error) {
    return [null, error as E]
  }
}

export function formatDuration(ms: number | string | null | undefined): string {
  if (ms == null) return "—"

  let num: number
  if (typeof ms === "string") {
    num = Number(ms)
    if (!Number.isFinite(num)) {
      const match = ms.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/)
      if (match) {
        const h = Number(match[1] || 0)
        const m = Number(match[2] || 0)
        const s = Number(match[3] || 0)
        num = ((h * 60 + m) * 60 + s) * 1000
      } else {
        return "—"
      }
    }
  } else if (typeof ms === "number") {
    num = ms
  } else {
    return "—"
  }

  const absNum = Math.abs(num)
  const hours = Math.floor(absNum / 3600000)
  const minutes = Math.floor((absNum % 3600000) / 60000)
  const seconds = Math.floor((absNum % 60000) / 1000)
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  if (seconds > 0) return `${seconds}s`
  return `0h 0m`
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—"
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  })
}

export function formatPLN(amount: number | null | undefined): string {
  const value = Number(amount ?? 0)
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0)
}
