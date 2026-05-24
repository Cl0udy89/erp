"use client"

import { Download, ExternalLink, FileText, ImageIcon, FileSpreadsheet, Loader2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "#/components/ui/button"
import { isPreviewable } from "#/api/documents"

// ─── PDF Viewer ───────────────────────────────────────────────────────────────
//
// Implementation: browser-native PDF rendering via <iframe>.
// All modern browsers (Chrome/Firefox/Edge/Safari) have built-in PDF viewers
// that handle multi-page rendering, zoom, and download natively.
//
// pdfjs-dist was not added as a dependency to keep the bundle lean for an
// intranet ERP. If custom annotation/text-extraction is needed in a future
// phase, pdfjs-dist can be added then.
//
// For non-PDF files: images are rendered with <img>, docx/xlsx show a
// file icon with a download button.

interface PdfViewerProps {
  /** Relative URL to the file endpoint, e.g. /documents/:id/file */
  src: string
  /** Original filename for display and download */
  filename: string
  mimeType: string
}

export function PdfViewer({ src, filename, mimeType }: PdfViewerProps) {
  const previewType = isPreviewable(mimeType)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Download URL appends ?download=1 to force Content-Disposition: attachment
  const downloadUrl = `${src}${src.includes("?") ? "&" : "?"}download=1`

  useEffect(() => {
    setLoading(true)
    setError(false)
  }, [src])

  if (previewType === "pdf") {
    return (
      <div className="flex h-full flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
          <span className="text-sm font-medium truncate max-w-xs" title={filename}>
            {filename}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <a href={src} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-1" />
                Open tab
              </a>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href={downloadUrl} download={filename}>
                <Download className="h-4 w-4 mr-1" />
                Download
              </a>
            </Button>
          </div>
        </div>

        {/* Viewer area */}
        <div className="relative flex-1 min-h-0">
          {loading && !error && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <FileText className="h-12 w-12" />
              <p className="text-sm">Failed to load document — it may have been moved or deleted.</p>
              <Button variant="outline" size="sm" asChild>
                <a href={downloadUrl} download={filename}>
                  <Download className="h-4 w-4 mr-1" />
                  Try downloading
                </a>
              </Button>
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={src}
            className="h-full w-full border-0"
            title={filename}
            onLoad={() => setLoading(false)}
            onError={() => { setLoading(false); setError(true) }}
          />
        </div>
      </div>
    )
  }

  if (previewType === "image") {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
          <span className="text-sm font-medium truncate max-w-xs" title={filename}>
            {filename}
          </span>
          <Button variant="ghost" size="sm" asChild>
            <a href={downloadUrl} download={filename}>
              <Download className="h-4 w-4 mr-1" />
              Download
            </a>
          </Button>
        </div>
        <div className="relative flex-1 min-h-0 overflow-auto flex items-center justify-center p-4 bg-muted/10">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
          {error ? (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <ImageIcon className="h-12 w-12" />
              <p className="text-sm">Failed to load image.</p>
            </div>
          ) : (
            <img
              src={src}
              alt={filename}
              className="max-w-full max-h-full object-contain rounded shadow"
              onLoad={() => setLoading(false)}
              onError={() => { setLoading(false); setError(true) }}
            />
          )}
        </div>
      </div>
    )
  }

  // Non-previewable: docx, xlsx, etc.
  const isWord = mimeType.includes("wordprocessingml")
  const isExcel = mimeType.includes("spreadsheetml")

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 text-muted-foreground p-8">
      {isExcel ? (
        <FileSpreadsheet className="h-16 w-16" />
      ) : isWord ? (
        <FileText className="h-16 w-16" />
      ) : (
        <FileText className="h-16 w-16" />
      )}
      <div className="text-center space-y-1">
        <p className="font-medium text-foreground">{filename}</p>
        <p className="text-sm">
          {isWord ? "Word document" : isExcel ? "Excel spreadsheet" : "File"} — no preview available
        </p>
      </div>
      <Button asChild>
        <a href={downloadUrl} download={filename}>
          <Download className="h-4 w-4 mr-2" />
          Download file
        </a>
      </Button>
    </div>
  )
}
