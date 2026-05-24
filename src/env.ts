import { createEnv } from "@t3-oss/env-core"
import z from "zod"
export const env = createEnv({
  server: {
    CLOCKIFY_KEY: z.string().optional(),
    CLOCKIFY_BASE_URL: z.string().url().optional(),
    DATABASE_URL: z.string().optional(),
    BACKEND_API_URL: z.string().url().optional(),
    CLOCKIFY_SYNC_URL: z.string().url().optional(),
    API_INTERNAL_TOKEN: z.string().min(16).optional(),
    JWT_SECRET: z.string().min(32).optional(),
    ADMIN_EMAIL: z.string().email().optional(),
    ADMIN_PASSWORD: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.string().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().optional(),
    UPLOADS_DIR: z.string().optional(),
    MAX_FILE_SIZE_MB: z.string().optional()
  },
  runtimeEnv: process.env
})

export function requireEnv(name: keyof typeof env): string {
  const value = env[name]
  if (!value) {
    throw new Error(`${name} is required for this service`)
  }
  return value
}
