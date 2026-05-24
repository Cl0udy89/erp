/**
 * Google Drive sync — raw Drive v3 REST API via fetch.
 * Uses a Service Account key file (GOOGLE_SERVICE_ACCOUNT_KEY_FILE env var).
 * If the key file is missing, all operations silently skip (warn log only).
 *
 * Implementation note: googleapis npm package was evaluated but skipped in favour
 * of raw fetch to avoid any Bun/Node.js compatibility issues with googleapis
 * internals (it uses http.ClientRequest which Bun emulates, but RSA signing and
 * token exchange are equally easy via crypto + fetch). Raw fetch gives us zero
 * extra dependencies and full control.
 */

import crypto from "crypto"
import fs from "fs"
import path from "path"

import { dbExecute, dbQuery } from "#/lib/db"

// ─── Config ───────────────────────────────────────────────────────────────────

function getKeyPath(): string {
  return process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE ?? "./credentials/google-service-account.json"
}

function getRootFolderId(): string | null {
  return process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? null
}

// ─── Service account auth ─────────────────────────────────────────────────────

interface ServiceAccountKey {
  client_email: string
  private_key: string
}

interface TokenCache {
  token: string
  expiresAt: number
}

let tokenCache: TokenCache | null = null

function loadKey(): ServiceAccountKey | null {
  const keyPath = getKeyPath()
  try {
    const raw = fs.readFileSync(keyPath, "utf-8")
    return JSON.parse(raw) as ServiceAccountKey
  } catch {
    return null
  }
}

async function getAccessToken(): Promise<string | null> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token
  }

  const key = loadKey()
  if (!key) {
    console.warn("[Drive] Service account key not found at", getKeyPath(), "— Drive sync skipped")
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  const exp = now + 3600

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/drive",
      aud: "https://oauth2.googleapis.com/token",
      exp,
      iat: now
    })
  ).toString("base64url")

  const sign = crypto.createSign("RSA-SHA256")
  sign.update(`${header}.${payload}`)
  const sig = sign.sign(key.private_key, "base64url")

  const jwt = `${header}.${payload}.${sig}`

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  })

  if (!resp.ok) {
    console.error("[Drive] Token exchange failed:", await resp.text())
    return null
  }

  const data = (await resp.json()) as { access_token: string; expires_in: number }
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return data.access_token
}

// ─── Drive API helpers ────────────────────────────────────────────────────────

async function driveListFiles(
  token: string,
  q: string
): Promise<Array<{ id: string; name: string }>> {
  const encoded = encodeURIComponent(q)
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encoded}&fields=files(id,name)&pageSize=10`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!resp.ok) return []
  const { files } = (await resp.json()) as { files: Array<{ id: string; name: string }> }
  return files ?? []
}

async function driveCreateFolder(
  token: string,
  name: string,
  parentId: string
): Promise<string | null> {
  const resp = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId]
    })
  })
  if (!resp.ok) {
    console.error("[Drive] createFolder failed:", name, await resp.text())
    return null
  }
  const { id } = (await resp.json()) as { id: string }
  return id
}

async function findOrCreateFolder(
  token: string,
  name: string,
  parentId: string
): Promise<string | null> {
  const safeName = name.replace(/'/g, "\\'")
  const files = await driveListFiles(
    token,
    `name='${safeName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  )
  if (files.length > 0) return files[0]!.id
  return driveCreateFolder(token, name, parentId)
}

// ─── Race condition guard ─────────────────────────────────────────────────────
// If two uploads arrive simultaneously for the same new entity, both will call
// getOrCreateDriveFolder. The in-flight map ensures only one Drive API call
// runs; the second awaits the same promise and gets the same folder ID back.

const inFlight = new Map<string, Promise<string | null>>()

async function getOrCreateDriveFolder(params: {
  workspaceId: string
  entityType: "root" | "client" | "consultant" | "project"
  entityId: string | null
  entityName: string
  subfolder: string | null
  token: string
}): Promise<string | null> {
  const { workspaceId, entityType, entityId, subfolder } = params
  const lockKey = `${workspaceId}:${entityType}:${entityId ?? ""}:${subfolder ?? ""}`

  const flying = inFlight.get(lockKey)
  if (flying) return flying

  const promise = _resolveFolder(params)
  inFlight.set(lockKey, promise)
  try {
    return await promise
  } finally {
    inFlight.delete(lockKey)
  }
}

async function _resolveFolder(params: {
  workspaceId: string
  entityType: "root" | "client" | "consultant" | "project"
  entityId: string | null
  entityName: string
  subfolder: string | null
  token: string
}): Promise<string | null> {
  const { workspaceId, entityType, entityId, entityName, subfolder, token } = params

  // DB cache check
  const cached = await dbQuery<import("mysql2").RowDataPacket[]>(
    `SELECT drive_folder_id FROM erp_drive_folders
      WHERE workspace_id = ?
        AND entity_type = ?
        AND (entity_id = ? OR (entity_id IS NULL AND ? IS NULL))
        AND (subfolder = ? OR (subfolder IS NULL AND ? IS NULL))
      LIMIT 1`,
    [workspaceId, entityType, entityId, entityId, subfolder, subfolder]
  )
  if (cached.length > 0) return cached[0]!.drive_folder_id as string

  const rootId = getRootFolderId()
  if (!rootId) {
    console.warn("[Drive] GOOGLE_DRIVE_ROOT_FOLDER_ID not set — Drive sync skipped")
    return null
  }

  // Find/create top-level category folder
  let parentId: string = rootId
  if (entityType !== "root") {
    const category =
      entityType === "client" ? "Clients" :
      entityType === "consultant" ? "Consultants" :
      "Projects"
    const catId = await findOrCreateFolder(token, category, rootId)
    if (!catId) return null
    parentId = catId
  }

  // Find/create entity folder
  let folderId: string = parentId
  if (entityType !== "root") {
    const entityFolderId = await findOrCreateFolder(token, entityName, parentId)
    if (!entityFolderId) return null
    folderId = entityFolderId
  }

  // Find/create subfolder
  if (subfolder) {
    const subId = await findOrCreateFolder(token, subfolder, folderId)
    if (!subId) return null
    folderId = subId
  }

  // Cache result
  const cacheId = `drf_${crypto.randomUUID()}`
  await dbExecute(
    `INSERT INTO erp_drive_folders (id, workspace_id, entity_type, entity_id, entity_name, subfolder, drive_folder_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE drive_folder_id = VALUES(drive_folder_id), entity_name = VALUES(entity_name)`,
    [cacheId, workspaceId, entityType, entityId, entityName, subfolder, folderId]
  )

  return folderId
}

// ─── doc_type → Drive subfolder mapping ──────────────────────────────────────

function getSubfolder(docType: string, entityType: "employee" | "client" | "project"): string | null {
  if (docType === "contract") return "Contracts"
  if (docType === "invoice" && entityType === "client") return "Invoices"
  if (docType === "receipt" && entityType === "employee") return "Receipts"
  if (docType === "nda") return "Contracts"
  if (docType === "amendment") return "Contracts"
  return null
}

function toDriveEntityType(entityType: "employee" | "client" | "project"): "consultant" | "client" | "project" {
  return entityType === "employee" ? "consultant" : entityType
}

// ─── Upload a file to Drive ───────────────────────────────────────────────────

async function uploadFileToDrive(
  token: string,
  folderId: string,
  fileName: string,
  mimeType: string,
  filePath: string
): Promise<string | null> {
  const fileBuffer = fs.readFileSync(filePath)
  const fileSize = fileBuffer.length

  if (fileSize > 5 * 1024 * 1024) {
    // Resumable upload for files > 5 MB
    const initResp = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Upload-Content-Type": mimeType,
          "X-Upload-Content-Length": String(fileSize)
        },
        body: JSON.stringify({ name: fileName, parents: [folderId] })
      }
    )
    if (!initResp.ok) {
      console.error("[Drive] resumable upload init failed:", await initResp.text())
      return null
    }
    const uploadUrl = initResp.headers.get("location")
    if (!uploadUrl) return null

    const uploadResp = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mimeType, "Content-Length": String(fileSize) },
      body: fileBuffer
    })
    if (!uploadResp.ok) {
      console.error("[Drive] resumable upload PUT failed:", await uploadResp.text())
      return null
    }
    const { id } = (await uploadResp.json()) as { id: string }
    return id
  }

  // Simple multipart upload for files ≤ 5 MB
  const boundary = `boundary_${crypto.randomUUID().replace(/-/g, "")}`
  const metaPart = JSON.stringify({ name: fileName, parents: [folderId] })

  const parts = [
    `--${boundary}\r\n`,
    `Content-Type: application/json; charset=UTF-8\r\n\r\n`,
    `${metaPart}\r\n`,
    `--${boundary}\r\n`,
    `Content-Type: ${mimeType}\r\n\r\n`
  ]
  const preamble = Buffer.from(parts.join(""))
  const closing = Buffer.from(`\r\n--${boundary}--`)
  const body = Buffer.concat([preamble, fileBuffer, closing])

  const resp = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length)
      },
      body
    }
  )

  if (!resp.ok) {
    console.error("[Drive] simple upload failed:", await resp.text())
    return null
  }
  const { id } = (await resp.json()) as { id: string }
  return id
}

async function createDriveShortcut(
  token: string,
  targetFileId: string,
  name: string,
  folderId: string
): Promise<string | null> {
  const resp = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.shortcut",
      shortcutDetails: { targetId: targetFileId },
      parents: [folderId]
    })
  })
  if (!resp.ok) return null
  const { id } = (await resp.json()) as { id: string }
  return id
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function syncDocumentToDrive(documentId: string): Promise<void> {
  const token = await getAccessToken()
  if (!token) return

  // Load document with linked entities + entity names
  const rows = await dbQuery<import("mysql2").RowDataPacket[]>(
    `SELECT d.workspace_id, d.doc_type, d.original_name, d.storage_path, d.mime_type,
            d.drive_file_id,
            GROUP_CONCAT(dl.entity_type ORDER BY dl.created_at SEPARATOR ',') AS entity_types,
            GROUP_CONCAT(dl.entity_id   ORDER BY dl.created_at SEPARATOR ',') AS entity_ids,
            GROUP_CONCAT(
              COALESCE(e.name, c.name, p.name) ORDER BY dl.created_at SEPARATOR '|||'
            ) AS entity_names
       FROM erp_documents d
       LEFT JOIN erp_document_links dl ON dl.document_id = d.id
       LEFT JOIN erp_employees e ON e.id = dl.entity_id AND dl.entity_type = 'employee'
       LEFT JOIN erp_clients   c ON c.id = dl.entity_id AND dl.entity_type = 'client'
       LEFT JOIN erp_projects  p ON p.id = dl.entity_id AND dl.entity_type = 'project'
      WHERE d.id = ?
      GROUP BY d.id`,
    [documentId]
  )

  const doc = rows[0]
  if (!doc) return

  const uploadsDir = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads")
  const localPath = path.join(uploadsDir, doc.storage_path as string)

  if (!fs.existsSync(localPath)) {
    await dbExecute(
      "UPDATE erp_documents SET drive_sync_error = ? WHERE id = ?",
      [`local file not found at ${doc.storage_path}`, documentId]
    )
    return
  }

  const entityTypesList: Array<"employee" | "client" | "project"> =
    doc.entity_types ? (doc.entity_types as string).split(",") as Array<"employee" | "client" | "project"> : []
  const entityIdsList: string[] = doc.entity_ids ? (doc.entity_ids as string).split(",") : []
  const entityNamesList: string[] = doc.entity_names ? (doc.entity_names as string).split("|||") : []

  // Determine primary entity (first linked, or workspace root if none)
  let primaryFolderId: string | null

  if (entityTypesList.length === 0) {
    // No linked entities — upload to root folder
    primaryFolderId = await getOrCreateDriveFolder({
      workspaceId: doc.workspace_id as string,
      entityType: "root",
      entityId: null,
      entityName: "Sparksome ERP",
      subfolder: null,
      token
    })
  } else {
    const et = entityTypesList[0]!
    primaryFolderId = await getOrCreateDriveFolder({
      workspaceId: doc.workspace_id as string,
      entityType: toDriveEntityType(et),
      entityId: entityIdsList[0] ?? null,
      entityName: entityNamesList[0] ?? entityIdsList[0] ?? "Unknown",
      subfolder: getSubfolder(doc.doc_type as string, et),
      token
    })
  }

  if (!primaryFolderId) {
    await dbExecute(
      "UPDATE erp_documents SET drive_sync_error = ? WHERE id = ?",
      ["could not resolve target folder", documentId]
    )
    return
  }

  // Upload file to primary folder
  const driveFileId = await uploadFileToDrive(
    token,
    primaryFolderId,
    doc.original_name as string,
    doc.mime_type as string,
    localPath
  )

  if (!driveFileId) {
    await dbExecute(
      "UPDATE erp_documents SET drive_sync_error = ? WHERE id = ?",
      ["upload to Drive failed", documentId]
    )
    return
  }

  // Create shortcuts in secondary entity folders
  for (let i = 1; i < entityTypesList.length; i++) {
    const et = entityTypesList[i]!
    const secondaryFolderId = await getOrCreateDriveFolder({
      workspaceId: doc.workspace_id as string,
      entityType: toDriveEntityType(et),
      entityId: entityIdsList[i] ?? null,
      entityName: entityNamesList[i] ?? entityIdsList[i] ?? "Unknown",
      subfolder: getSubfolder(doc.doc_type as string, et),
      token
    }).catch(() => null)

    if (secondaryFolderId) {
      await createDriveShortcut(token, driveFileId, doc.original_name as string, secondaryFolderId).catch(() => null)
    }
  }

  // Update DB record
  const now = new Date().toISOString().slice(0, 19).replace("T", " ")
  await dbExecute(
    `UPDATE erp_documents
        SET drive_file_id   = ?,
            drive_folder_id = ?,
            drive_synced_at = ?,
            drive_sync_error = NULL
      WHERE id = ?`,
    [driveFileId, primaryFolderId, now, documentId]
  )
}

export async function retryFailedDriveSyncs(
  workspaceId: string
): Promise<{ attempted: number; succeeded: number; stillFailing: number }> {
  const rows = await dbQuery<import("mysql2").RowDataPacket[]>(
    `SELECT id FROM erp_documents
      WHERE workspace_id = ? AND drive_file_id IS NULL AND drive_sync_error IS NOT NULL`,
    [workspaceId]
  )

  let succeeded = 0
  for (const row of rows) {
    try {
      await syncDocumentToDrive(row.id as string)
      // Check if it succeeded
      const check = await dbQuery<import("mysql2").RowDataPacket[]>(
        "SELECT drive_file_id FROM erp_documents WHERE id = ?",
        [row.id]
      )
      if (check[0]?.drive_file_id) succeeded++
    } catch (err) {
      console.error("[Drive] retryFailedDriveSyncs error for", row.id, err)
    }
  }

  return {
    attempted: rows.length,
    succeeded,
    stillFailing: rows.length - succeeded
  }
}

export async function isDriveConfigured(): Promise<boolean> {
  const key = loadKey()
  return key !== null && getRootFolderId() !== null
}
