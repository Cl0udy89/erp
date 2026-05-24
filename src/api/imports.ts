import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import z from "zod"

import { backendPost } from "#/lib/backend-client"
import type { ExcelImportPreviewRow } from "#/lib/excel-import-service"

const ExcelPreviewSchema = z.object({
  fileName: z.string(),
  contentBase64: z.string()
})

const ExcelCommitSchema = z.object({
  rows: z.array(z.unknown())
})

export const previewExcelImportFn = createServerFn({ method: "POST" })
  .inputValidator(ExcelPreviewSchema)
  .handler(async ({ data }): Promise<any> => backendPost("/imports/excel/preview", data))

export const commitExcelImportFn = createServerFn({ method: "POST" })
  .inputValidator(ExcelCommitSchema)
  .handler(async ({ data }): Promise<any> => backendPost("/imports/excel/commit", data))

export function usePreviewExcelImport() {
  return useMutation({
    mutationFn: (data: z.infer<typeof ExcelPreviewSchema>) => previewExcelImportFn({ data })
  })
}

export function useCommitExcelImport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (rows: ExcelImportPreviewRow[]) => commitExcelImportFn({ data: { rows } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["erp", "finance"] })
    }
  })
}
