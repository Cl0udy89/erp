/**
 * Proxmox backup sync — rsync over SSH.
 * Config via env vars:
 *   PROXMOX_SFTP_HOST     — remote host IP/hostname
 *   PROXMOX_SFTP_USER     — SSH username (default: erpbackup)
 *   PROXMOX_SFTP_KEY_PATH — path to private key (default: ./credentials/proxmox_rsa)
 *   PROXMOX_SFTP_DIR      — remote base directory (default: /mnt/storage/sparksome-erp-uploads)
 *
 * Subdirectory structure on Proxmox mirrors local: {remoteDir}/{storagePath}
 * The remote parent directory is created via ssh mkdir -p before rsync runs.
 *
 * Both commands are run synchronously (spawnSync) since this runs fire-and-forget
 * in a background async context — no need for async child_process.
 */

import path from "path"
import { spawnSync } from "child_process"

import { dbExecute, dbQuery } from "#/lib/db"

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig(): {
  host: string | null
  user: string
  keyPath: string
  remoteDir: string
} {
  return {
    host: process.env.PROXMOX_SFTP_HOST ?? null,
    user: process.env.PROXMOX_SFTP_USER ?? "erpbackup",
    keyPath: process.env.PROXMOX_SFTP_KEY_PATH ?? "./credentials/proxmox_rsa",
    remoteDir: process.env.PROXMOX_SFTP_DIR ?? "/mnt/storage/sparksome-erp-uploads"
  }
}

// ─── SSH helpers ──────────────────────────────────────────────────────────────

function sshArgs(user: string, host: string, keyPath: string): string[] {
  return [
    "-i", keyPath,
    "-o", "StrictHostKeyChecking=no",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10"
  ].concat([`${user}@${host}`])
}

function runSsh(
  user: string,
  host: string,
  keyPath: string,
  command: string
): { ok: boolean; stderr: string } {
  const result = spawnSync("ssh", [...sshArgs(user, host, keyPath), command], {
    timeout: 30_000,
    encoding: "utf-8"
  })
  const ok = result.status === 0 && !result.error
  const stderr = result.stderr ?? (result.error?.message ?? "")
  return { ok, stderr }
}

function runRsync(
  user: string,
  host: string,
  keyPath: string,
  localPath: string,
  remotePath: string
): { ok: boolean; stderr: string } {
  const sshCmd = `ssh -i ${keyPath} -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10`
  const result = spawnSync(
    "rsync",
    ["-az", "--checksum", "-e", sshCmd, localPath, `${user}@${host}:${remotePath}`],
    { timeout: 120_000, encoding: "utf-8" }
  )
  const ok = result.status === 0 && !result.error
  const stderr = result.stderr ?? (result.error?.message ?? "")
  return { ok, stderr }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function syncDocumentToProxmox(documentId: string): Promise<void> {
  const cfg = getConfig()
  if (!cfg.host) {
    // Silently skip — Proxmox not configured
    return
  }

  const rows = await dbQuery<import("mysql2").RowDataPacket[]>(
    "SELECT storage_path FROM erp_documents WHERE id = ? LIMIT 1",
    [documentId]
  )
  const doc = rows[0]
  if (!doc) return

  const uploadsDir = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads")
  const localPath = path.join(uploadsDir, doc.storage_path as string)
  const remotePath = path.posix.join(cfg.remoteDir, (doc.storage_path as string).replace(/\\/g, "/"))
  const remoteDir = path.posix.dirname(remotePath)

  // Step 1: ensure remote directory exists
  const mkdirResult = runSsh(cfg.user, cfg.host, cfg.keyPath, `mkdir -p ${remoteDir}`)
  if (!mkdirResult.ok) {
    const errMsg = `ssh mkdir -p failed: ${mkdirResult.stderr.trim()}`
    await dbExecute("UPDATE erp_documents SET proxmox_sync_error = ? WHERE id = ?", [errMsg, documentId])
    return
  }

  // Step 2: rsync the file
  const rsyncResult = runRsync(cfg.user, cfg.host, cfg.keyPath, localPath, remotePath)
  if (!rsyncResult.ok) {
    const errMsg = `rsync failed: ${rsyncResult.stderr.trim()}`
    await dbExecute("UPDATE erp_documents SET proxmox_sync_error = ? WHERE id = ?", [errMsg, documentId])
    return
  }

  // Success
  const now = new Date().toISOString().slice(0, 19).replace("T", " ")
  await dbExecute(
    "UPDATE erp_documents SET proxmox_synced_at = ? WHERE id = ?",
    [now, documentId]
  )
}

export async function retryFailedProxmoxSyncs(
  workspaceId: string
): Promise<{ attempted: number; succeeded: number; stillFailing: number }> {
  const cfg = getConfig()
  if (!cfg.host) return { attempted: 0, succeeded: 0, stillFailing: 0 }

  const rows = await dbQuery<import("mysql2").RowDataPacket[]>(
    "SELECT id FROM erp_documents WHERE workspace_id = ? AND proxmox_synced_at IS NULL",
    [workspaceId]
  )

  let succeeded = 0
  for (const row of rows) {
    try {
      await syncDocumentToProxmox(row.id as string)
      const check = await dbQuery<import("mysql2").RowDataPacket[]>(
        "SELECT proxmox_synced_at FROM erp_documents WHERE id = ?",
        [row.id]
      )
      if (check[0]?.proxmox_synced_at) succeeded++
    } catch (err) {
      console.error("[Proxmox] retryFailedProxmoxSyncs error for", row.id, err)
    }
  }

  return {
    attempted: rows.length,
    succeeded,
    stillFailing: rows.length - succeeded
  }
}

export function isProxmoxConfigured(): boolean {
  return !!getConfig().host
}
