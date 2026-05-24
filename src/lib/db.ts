import crypto from "crypto"

import mysql, { type Pool, type RowDataPacket } from "mysql2/promise"

declare const Bun: {
  password: {
    hash(password: string, options?: { algorithm?: string }): Promise<string>
    verify(password: string, hash: string): Promise<boolean>
  }
}

import { requireEnv } from "#/env"

const databaseUrl = requireEnv("DATABASE_URL")

let pool: Pool | undefined
let schemaReady: Promise<void> | undefined

interface CountRow extends RowDataPacket {
  count: number
}

export function getDbPool() {
  pool ??= mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 10,
    decimalNumbers: true,
    namedPlaceholders: true,
    timezone: "Z"
  })

  return pool
}

export async function dbQuery<T extends Record<string, unknown>[] = Record<string, unknown>[]>(sql: string, values?: unknown[]) {
  await ensureDatabase()
  const [rows] = await getDbPool().query<RowDataPacket[]>(sql, values)
  return rows as unknown as T
}

export async function dbExecute(sql: string, values?: unknown[]) {
  await ensureDatabase()
  const [result] = await getDbPool().execute(sql, values as any[])
  return result
}

export async function ensureDatabase() {
  schemaReady ??= createSchema()
  return schemaReady
}

async function createSchema() {
  const db = getDbPool()

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_workspaces (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      raw_json JSON NULL,
      synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_clients (
      id VARCHAR(64) PRIMARY KEY,
      workspace_id VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NULL,
      archived BOOLEAN NOT NULL DEFAULT FALSE,
      raw_json JSON NULL,
      synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_clients_workspace (workspace_id),
      CONSTRAINT fk_clients_workspace
        FOREIGN KEY (workspace_id) REFERENCES erp_workspaces(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_employees (
      id VARCHAR(64) PRIMARY KEY,
      workspace_id VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      status VARCHAR(64) NULL,
      profile_picture TEXT NULL,
      raw_json JSON NULL,
      synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_employees_workspace (workspace_id),
      CONSTRAINT fk_employees_workspace
        FOREIGN KEY (workspace_id) REFERENCES erp_workspaces(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_projects (
      id VARCHAR(64) PRIMARY KEY,
      workspace_id VARCHAR(64) NOT NULL,
      client_id VARCHAR(64) NULL,
      name VARCHAR(255) NOT NULL,
      billable BOOLEAN NOT NULL DEFAULT TRUE,
      color VARCHAR(32) NULL,
      archived BOOLEAN NOT NULL DEFAULT FALSE,
      raw_json JSON NULL,
      synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_projects_workspace (workspace_id),
      INDEX idx_projects_client (client_id),
      CONSTRAINT fk_projects_workspace
        FOREIGN KEY (workspace_id) REFERENCES erp_workspaces(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_time_entries (
      id VARCHAR(64) PRIMARY KEY,
      workspace_id VARCHAR(64) NOT NULL,
      employee_id VARCHAR(64) NOT NULL,
      client_id VARCHAR(64) NULL,
      project_id VARCHAR(64) NULL,
      task_id VARCHAR(64) NULL,
      description TEXT NOT NULL,
      billable BOOLEAN NOT NULL DEFAULT FALSE,
      start_at DATETIME(3) NOT NULL,
      end_at DATETIME(3) NULL,
      duration_seconds INT NULL,
      work_date DATE NOT NULL,
      raw_json JSON NULL,
      synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_time_entries_workspace_date (workspace_id, work_date),
      INDEX idx_time_entries_employee_date (employee_id, work_date),
      INDEX idx_time_entries_client_date (client_id, work_date),
      INDEX idx_time_entries_project_date (project_id, work_date),
      INDEX idx_time_entries_client_report (workspace_id, client_id, project_id, employee_id, work_date),
      CONSTRAINT fk_time_entries_workspace
        FOREIGN KEY (workspace_id) REFERENCES erp_workspaces(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_time_entries_employee
        FOREIGN KEY (employee_id) REFERENCES erp_employees(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await addColumnIfMissing(
    "erp_time_entries",
    "client_id",
    "ALTER TABLE erp_time_entries ADD COLUMN client_id VARCHAR(64) NULL AFTER employee_id"
  )
  await addIndexIfMissing(
    "erp_time_entries",
    "idx_time_entries_client_date",
    "ALTER TABLE erp_time_entries ADD INDEX idx_time_entries_client_date (client_id, work_date)"
  )

  await addColumnIfMissing(
    "erp_employees",
    "hourly_rate",
    "ALTER TABLE erp_employees ADD COLUMN hourly_rate DECIMAL(15,2) DEFAULT NULL"
  )

  await addColumnIfMissing(
    "erp_time_entries",
    "estimated_cost",
    "ALTER TABLE erp_time_entries ADD COLUMN estimated_cost DECIMAL(15,2) DEFAULT NULL"
  )
  await addColumnIfMissing(
    "erp_time_entries",
    "hourly_rate_used",
    "ALTER TABLE erp_time_entries ADD COLUMN hourly_rate_used DECIMAL(15,2) DEFAULT NULL"
  )

  await addIndexIfMissing(
    "erp_time_entries",
    "idx_time_entries_employee_cost",
    "ALTER TABLE erp_time_entries ADD INDEX idx_time_entries_employee_cost (employee_id, estimated_cost)"
  )

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_sync_runs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      workspace_id VARCHAR(64) NOT NULL,
      status ENUM('running', 'success', 'failed') NOT NULL,
      users_count INT NOT NULL DEFAULT 0,
      clients_count INT NOT NULL DEFAULT 0,
      projects_count INT NOT NULL DEFAULT 0,
      time_entries_count INT NOT NULL DEFAULT 0,
      error_message TEXT NULL,
      started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TIMESTAMP NULL,
      INDEX idx_sync_runs_workspace_started (workspace_id, started_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_financial_categories (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      code VARCHAR(64) NOT NULL UNIQUE,
      description TEXT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_tax_rates (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      rate DECIMAL(8,6) NOT NULL,
      valid_from DATE NOT NULL,
      valid_to DATE NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_tax_rates_default (is_default, valid_from)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_financial_documents (
      id VARCHAR(64) PRIMARY KEY,
      document_number VARCHAR(255) NULL,
      document_name VARCHAR(255) NULL,
      document_type VARCHAR(64) NOT NULL,
      source_system VARCHAR(64) NOT NULL DEFAULT 'MANUAL',
      external_id VARCHAR(255) NULL,
      contractor_name VARCHAR(255) NULL,
      contractor_tax_id VARCHAR(64) NULL,
      issue_date DATE NULL,
      sale_date DATE NULL,
      received_date DATE NULL,
      accounting_date DATE NOT NULL,
      currency_code VARCHAR(3) NOT NULL DEFAULT 'PLN',
      net_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      vat_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      gross_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      exchange_rate DECIMAL(15,6) NULL,
      net_amount_pln DECIMAL(15,2) NOT NULL DEFAULT 0,
      vat_amount_pln DECIMAL(15,2) NOT NULL DEFAULT 0,
      gross_amount_pln DECIMAL(15,2) NOT NULL DEFAULT 0,
      description TEXT NULL,
      file_url TEXT NULL,
      import_status VARCHAR(64) NOT NULL DEFAULT 'MANUAL',
      allocation_status VARCHAR(64) NOT NULL DEFAULT 'NOT_ALLOCATED',
      raw_payload JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_financial_documents_date (accounting_date),
      INDEX idx_financial_documents_type (document_type),
      INDEX idx_financial_documents_status (allocation_status),
      INDEX idx_financial_documents_source (source_system, external_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_financial_document_allocations (
      id VARCHAR(64) PRIMARY KEY,
      financial_document_id VARCHAR(64) NOT NULL,
      project_id VARCHAR(64) NOT NULL,
      client_id VARCHAR(64) NULL,
      employee_id VARCHAR(64) NULL,
      allocation_date DATE NOT NULL,
      transaction_type VARCHAR(64) NOT NULL,
      category_id VARCHAR(64) NULL,
      description TEXT NULL,
      notes TEXT NULL,
      revenue_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      revenue_amount_pln DECIMAL(15,2) NOT NULL DEFAULT 0,
      goods_purchase_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
      service_cost_net DECIMAL(15,2) NOT NULL DEFAULT 0,
      realized_goods_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
      other_operating_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
      foreign_amount DECIMAL(15,2) NULL,
      currency_code VARCHAR(3) NULL,
      exchange_rate DECIMAL(15,6) NULL,
      cit_rate DECIMAL(8,6) NOT NULL DEFAULT 0.09,
      tax_effect DECIMAL(15,2) NOT NULL DEFAULT 0,
      tax_payable DECIMAL(15,2) NOT NULL DEFAULT 0,
      profit DECIMAL(15,2) NOT NULL DEFAULT 0,
      profit_after_tax DECIMAL(15,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_allocations_document (financial_document_id),
      INDEX idx_allocations_project_date (project_id, allocation_date),
      INDEX idx_allocations_client_date (client_id, allocation_date),
      INDEX idx_allocations_employee_date (employee_id, allocation_date),
      INDEX idx_allocations_type_date (transaction_type, allocation_date),
      CONSTRAINT fk_allocations_document
        FOREIGN KEY (financial_document_id) REFERENCES erp_financial_documents(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_allocations_project
        FOREIGN KEY (project_id) REFERENCES erp_projects(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_products (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      sku VARCHAR(128) NULL UNIQUE,
      description TEXT NULL,
      default_purchase_price DECIMAL(15,2) NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_stock_movements (
      id VARCHAR(64) PRIMARY KEY,
      product_id VARCHAR(64) NOT NULL,
      project_id VARCHAR(64) NULL,
      financial_document_id VARCHAR(64) NULL,
      allocation_id VARCHAR(64) NULL,
      movement_type VARCHAR(64) NOT NULL,
      movement_date DATE NOT NULL,
      quantity DECIMAL(15,4) NOT NULL,
      unit_price DECIMAL(15,2) NOT NULL,
      total_value DECIMAL(15,2) NOT NULL,
      description TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_stock_product_date (product_id, movement_date),
      INDEX idx_stock_project_date (project_id, movement_date),
      INDEX idx_stock_type_date (movement_type, movement_date),
      CONSTRAINT fk_stock_product
        FOREIGN KEY (product_id) REFERENCES erp_products(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_accounting_periods (
      id VARCHAR(64) PRIMARY KEY,
      year INT NOT NULL,
      month INT NOT NULL,
      date_from DATE NOT NULL,
      date_to DATE NOT NULL,
      status VARCHAR(64) NOT NULL DEFAULT 'OPEN',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_accounting_period (year, month)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // Phase 0: extend erp_time_entries
  await addColumnIfMissing(
    "erp_time_entries",
    "source",
    "ALTER TABLE erp_time_entries ADD COLUMN source ENUM('clockify','manual','timer') NOT NULL DEFAULT 'clockify'"
  )
  await addColumnIfMissing(
    "erp_time_entries",
    "timesheet_id",
    "ALTER TABLE erp_time_entries ADD COLUMN timesheet_id VARCHAR(64) NULL"
  )
  await addColumnIfMissing(
    "erp_time_entries",
    "tags",
    "ALTER TABLE erp_time_entries ADD COLUMN tags JSON NULL"
  )
  await addIndexIfMissing(
    "erp_time_entries",
    "idx_time_entries_timesheet",
    "ALTER TABLE erp_time_entries ADD INDEX idx_time_entries_timesheet (timesheet_id)"
  )
  await addIndexIfMissing(
    "erp_time_entries",
    "idx_time_entries_running_timer",
    "ALTER TABLE erp_time_entries ADD INDEX idx_time_entries_running_timer (employee_id, source, end_at)"
  )

  // Phase 0: extend erp_projects
  await addColumnIfMissing(
    "erp_projects",
    "billing_rate",
    "ALTER TABLE erp_projects ADD COLUMN billing_rate DECIMAL(15,2) NULL"
  )
  await addColumnIfMissing(
    "erp_projects",
    "billing_type",
    "ALTER TABLE erp_projects ADD COLUMN billing_type ENUM('hourly','fixed','subscription') NOT NULL DEFAULT 'hourly'"
  )
  await addColumnIfMissing(
    "erp_projects",
    "fixed_amount",
    "ALTER TABLE erp_projects ADD COLUMN fixed_amount DECIMAL(15,2) NULL"
  )
  await addColumnIfMissing(
    "erp_projects",
    "subscription_min_hours",
    "ALTER TABLE erp_projects ADD COLUMN subscription_min_hours INT NULL"
  )
  await addColumnIfMissing(
    "erp_projects",
    "subscription_overage_rate",
    "ALTER TABLE erp_projects ADD COLUMN subscription_overage_rate DECIMAL(15,2) NULL"
  )

  // Phase 0: erp_timesheets
  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_timesheets (
      id              VARCHAR(64)  PRIMARY KEY,
      workspace_id    VARCHAR(64)  NOT NULL,
      employee_id     VARCHAR(64)  NOT NULL,
      period_start    DATE         NOT NULL,
      period_end      DATE         NOT NULL,
      period_type     ENUM('weekly','monthly') NOT NULL DEFAULT 'weekly',
      status          ENUM('draft','submitted','approved','rejected') NOT NULL DEFAULT 'draft',
      submitted_at    DATETIME     NULL,
      approved_by     VARCHAR(64)  NULL,
      approved_at     DATETIME     NULL,
      rejection_note  TEXT         NULL,
      created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_timesheet_employee_period (employee_id, period_start, period_end),
      INDEX idx_timesheets_workspace_status (workspace_id, status),
      INDEX idx_timesheets_employee (employee_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // Phase 0: erp_timesheet_templates
  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_timesheet_templates (
      id            VARCHAR(64)  PRIMARY KEY,
      workspace_id  VARCHAR(64)  NOT NULL,
      employee_id   VARCHAR(64)  NOT NULL,
      name          VARCHAR(255) NOT NULL,
      template_data JSON         NOT NULL,
      created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_templates_employee (employee_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // Phase 0: erp_task_suggestions
  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_task_suggestions (
      id            VARCHAR(64)  PRIMARY KEY,
      workspace_id  VARCHAR(64)  NOT NULL,
      employee_id   VARCHAR(64)  NOT NULL,
      project_id    VARCHAR(64)  NOT NULL,
      task_name     VARCHAR(255) NOT NULL,
      used_count    INT          NOT NULL DEFAULT 1,
      last_used_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_suggestion (employee_id, project_id, task_name),
      INDEX idx_suggestions_lookup (employee_id, project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // Phase 1A — erp_employees
  await addColumnIfMissing("erp_employees", "date_of_birth",
    "ALTER TABLE erp_employees ADD COLUMN date_of_birth DATE NULL")
  await addColumnIfMissing("erp_employees", "contract_type",
    "ALTER TABLE erp_employees ADD COLUMN contract_type ENUM('uop','zlecenie','b2b','staz','other') NULL")
  await addColumnIfMissing("erp_employees", "contract_number",
    "ALTER TABLE erp_employees ADD COLUMN contract_number VARCHAR(255) NULL")
  await addColumnIfMissing("erp_employees", "contract_date",
    "ALTER TABLE erp_employees ADD COLUMN contract_date DATE NULL")
  await addColumnIfMissing("erp_employees", "contract_document_id",
    "ALTER TABLE erp_employees ADD COLUMN contract_document_id VARCHAR(64) NULL")
  await addColumnIfMissing("erp_employees", "supervisor_id",
    "ALTER TABLE erp_employees ADD COLUMN supervisor_id VARCHAR(64) NULL")
  await addColumnIfMissing("erp_employees", "first_collaboration_date",
    "ALTER TABLE erp_employees ADD COLUMN first_collaboration_date DATE NULL")
  await addColumnIfMissing("erp_employees", "position",
    "ALTER TABLE erp_employees ADD COLUMN position VARCHAR(255) NULL")
  // NOTE: hourly_rate already exists as internal_rate equivalent — do NOT add internal_rate

  // Polish pass: manual_avatar_override flag — prevents Clockify sync from overwriting profile_picture
  await addColumnIfMissing("erp_employees", "manual_avatar_override",
    "ALTER TABLE erp_employees ADD COLUMN manual_avatar_override TINYINT(1) NOT NULL DEFAULT 0")

  // Phase 1B — erp_clients
  await addColumnIfMissing("erp_clients", "nip",
    "ALTER TABLE erp_clients ADD COLUMN nip VARCHAR(10) NULL")
  await addColumnIfMissing("erp_clients", "address",
    "ALTER TABLE erp_clients ADD COLUMN address TEXT NULL")
  await addColumnIfMissing("erp_clients", "cooperation_type",
    "ALTER TABLE erp_clients ADD COLUMN cooperation_type ENUM('time_material','subscription','other') NULL")
  await addColumnIfMissing("erp_clients", "notes",
    "ALTER TABLE erp_clients ADD COLUMN notes TEXT NULL")

  await seedFinanceDictionaries()

  // ─── Phase 2: Auth & RBAC tables ──────────────────────────────────────────

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_users (
      id VARCHAR(64) PRIMARY KEY,
      workspace_id VARCHAR(64) NOT NULL,
      employee_id VARCHAR(64) NOT NULL,
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin','manager','consultant','accountant') NOT NULL DEFAULT 'consultant',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_login_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_email_workspace (email, workspace_id),
      INDEX idx_users_employee (employee_id),
      INDEX idx_users_workspace (workspace_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_refresh_tokens (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      token_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_refresh_user (user_id),
      INDEX idx_refresh_token (token_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_password_resets (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      token_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_reset_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_role_permissions (
      id VARCHAR(64) PRIMARY KEY,
      workspace_id VARCHAR(64) NOT NULL,
      role ENUM('admin','manager','consultant','accountant') NOT NULL,
      permission VARCHAR(128) NOT NULL,
      granted BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_role_permission (workspace_id, role, permission),
      INDEX idx_permissions_role (workspace_id, role)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await seedAdminUser()

  // ─── Phase 3: Accounting export log ───────────────────────────────────────

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_export_log (
      id            VARCHAR(64)  PRIMARY KEY,
      workspace_id  VARCHAR(64)  NOT NULL,
      exported_by   VARCHAR(64)  NOT NULL,
      export_type   VARCHAR(64)  NOT NULL,
      params        JSON         NOT NULL,
      created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_export_log_workspace (workspace_id),
      INDEX idx_export_log_user (exported_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // ─── Phase 4: Document management ─────────────────────────────────────────

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_documents (
      id                    VARCHAR(64)   PRIMARY KEY,
      workspace_id          VARCHAR(64)   NOT NULL,
      uploaded_by           VARCHAR(64)   NOT NULL,
      doc_type              ENUM(
                              'contract',
                              'invoice',
                              'receipt',
                              'id_document',
                              'certificate',
                              'nda',
                              'amendment',
                              'other'
                            ) NOT NULL,
      original_name         VARCHAR(255)  NOT NULL,
      storage_path          VARCHAR(512)  NOT NULL,
      mime_type             VARCHAR(128)  NOT NULL,
      file_size_bytes       INT           NOT NULL,
      contains_personal_data BOOLEAN      NOT NULL DEFAULT FALSE,
      notes                 TEXT          NULL,
      created_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_documents_workspace (workspace_id),
      INDEX idx_documents_uploader (uploaded_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_document_links (
      id           VARCHAR(64) PRIMARY KEY,
      document_id  VARCHAR(64) NOT NULL,
      entity_type  ENUM('employee','client','project') NOT NULL,
      entity_id    VARCHAR(64) NOT NULL,
      created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_doc_entity (document_id, entity_type, entity_id),
      INDEX idx_doc_links_document (document_id),
      INDEX idx_doc_links_entity (entity_type, entity_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // document_id on erp_financial_documents for linking uploaded PDFs to financial records
  await addColumnIfMissing("erp_financial_documents", "document_id",
    "ALTER TABLE erp_financial_documents ADD COLUMN document_id VARCHAR(64) NULL")

  // ─── Phase 5: Google Drive + Proxmox sync columns ─────────────────────────

  await addColumnIfMissing("erp_documents", "drive_file_id",
    "ALTER TABLE erp_documents ADD COLUMN drive_file_id VARCHAR(255) NULL")
  await addColumnIfMissing("erp_documents", "drive_folder_id",
    "ALTER TABLE erp_documents ADD COLUMN drive_folder_id VARCHAR(255) NULL")
  await addColumnIfMissing("erp_documents", "drive_synced_at",
    "ALTER TABLE erp_documents ADD COLUMN drive_synced_at DATETIME NULL")
  await addColumnIfMissing("erp_documents", "proxmox_synced_at",
    "ALTER TABLE erp_documents ADD COLUMN proxmox_synced_at DATETIME NULL")
  await addColumnIfMissing("erp_documents", "sync_error",
    "ALTER TABLE erp_documents ADD COLUMN sync_error TEXT NULL")

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_drive_folders (
      id              VARCHAR(64)   PRIMARY KEY,
      workspace_id    VARCHAR(64)   NOT NULL,
      entity_type     ENUM('root','client','consultant','project') NOT NULL,
      entity_id       VARCHAR(64)   NULL,
      entity_name     VARCHAR(255)  NOT NULL,
      subfolder       VARCHAR(128)  NULL,
      drive_folder_id VARCHAR(255)  NOT NULL,
      created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_folder (workspace_id, entity_type, entity_id, subfolder),
      INDEX idx_drive_folders_entity (entity_type, entity_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // ─── Phase 6: Audit trail ─────────────────────────────────────────────────

  // Split Phase 5's single sync_error into drive_sync_error + proxmox_sync_error
  await addColumnIfMissing("erp_documents", "drive_sync_error",
    "ALTER TABLE erp_documents ADD COLUMN drive_sync_error TEXT NULL")
  await addColumnIfMissing("erp_documents", "proxmox_sync_error",
    "ALTER TABLE erp_documents ADD COLUMN proxmox_sync_error TEXT NULL")
  await migrateSyncErrorColumn()

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_audit_log (
      id              VARCHAR(64)   PRIMARY KEY,
      workspace_id    VARCHAR(64)   NOT NULL,
      actor_user_id   VARCHAR(64)   NOT NULL,
      actor_name      VARCHAR(255)  NOT NULL,
      actor_role      ENUM('admin','manager','consultant','accountant') NOT NULL,
      action          ENUM(
                        'create',
                        'update',
                        'delete',
                        'view',
                        'login',
                        'logout',
                        'export',
                        'approve',
                        'reject',
                        'submit',
                        'role_change',
                        'permission_change',
                        'link',
                        'unlink'
                      ) NOT NULL,
      entity_type     VARCHAR(64)   NOT NULL,
      entity_id       VARCHAR(64)   NOT NULL,
      entity_label    VARCHAR(255)  NULL,
      changed_fields  JSON          NULL,
      metadata        JSON          NULL,
      ip_address      VARCHAR(45)   NULL,
      created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_audit_workspace_time (workspace_id, created_at DESC),
      INDEX idx_audit_entity (entity_type, entity_id),
      INDEX idx_audit_actor (actor_user_id),
      INDEX idx_audit_action (action)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // ─── Phase 7: Saldeo + OCR + Warehouse + CIT ─────────────────────────────────

  // Part A: OCR — track when OCR was last run on a financial doc
  await addColumnIfMissing("erp_financial_documents", "ocr_extracted_at",
    "ALTER TABLE erp_financial_documents ADD COLUMN ocr_extracted_at DATETIME NULL")

  // Part B: Saldeo export tracking columns
  await addColumnIfMissing("erp_financial_documents", "saldeo_document_id",
    "ALTER TABLE erp_financial_documents ADD COLUMN saldeo_document_id VARCHAR(255) NULL")
  await addColumnIfMissing("erp_financial_documents", "saldeo_exported_at",
    "ALTER TABLE erp_financial_documents ADD COLUMN saldeo_exported_at DATETIME NULL")
  await addColumnIfMissing("erp_financial_documents", "saldeo_export_error",
    "ALTER TABLE erp_financial_documents ADD COLUMN saldeo_export_error TEXT NULL")

  // Part C: Warehouse PZ/WZ documents
  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_warehouse_documents (
      id                 VARCHAR(64)                        PRIMARY KEY,
      workspace_id       VARCHAR(64)                        NOT NULL,
      doc_type           ENUM('PZ','WZ')                    NOT NULL,
      doc_number         VARCHAR(64)                        NOT NULL,
      financial_doc_id   VARCHAR(64)                        NULL,
      counterparty_id    VARCHAR(64)                        NULL,
      counterparty_type  ENUM('client','supplier')          NULL,
      doc_date           DATE                               NOT NULL,
      status             ENUM('draft','confirmed','cancelled') NOT NULL DEFAULT 'draft',
      notes              TEXT                               NULL,
      created_by         VARCHAR(64)                        NOT NULL,
      created_at         TIMESTAMP                          NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at         TIMESTAMP                          NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_warehouse_docs_workspace (workspace_id),
      INDEX idx_warehouse_docs_financial (financial_doc_id),
      INDEX idx_warehouse_docs_status (workspace_id, status),
      UNIQUE KEY uniq_warehouse_doc_number (workspace_id, doc_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_warehouse_document_items (
      id                    VARCHAR(64)    PRIMARY KEY,
      warehouse_document_id VARCHAR(64)    NOT NULL,
      product_id            VARCHAR(64)    NULL,
      product_name          VARCHAR(255)   NOT NULL,
      quantity              DECIMAL(15,4)  NOT NULL,
      unit                  VARCHAR(32)    NULL,
      unit_price            DECIMAL(15,2)  NULL,
      INDEX idx_warehouse_items_doc (warehouse_document_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // ─── Period locking ──────────────────────────────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS erp_accounting_periods (
      id            VARCHAR(64)               PRIMARY KEY,
      workspace_id  VARCHAR(64)               NOT NULL,
      period        VARCHAR(7)                NOT NULL,
      status        ENUM('open','closed')     NOT NULL DEFAULT 'open',
      closed_by     VARCHAR(64)               NULL,
      closed_at     DATETIME                  NULL,
      notes         TEXT                      NULL,
      created_at    TIMESTAMP                 NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_period (workspace_id, period),
      INDEX idx_periods_workspace (workspace_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // Migrate erp_accounting_periods to new schema (workspace_id + period columns)
  // The table may have been created with the old schema (year/month/date_from/date_to)
  // if the DB was initialized before the Phase 7 migration. Add missing columns safely.
  await addColumnIfMissing("erp_accounting_periods", "workspace_id",
    "ALTER TABLE erp_accounting_periods ADD COLUMN workspace_id VARCHAR(64) NOT NULL DEFAULT ''")
  await addColumnIfMissing("erp_accounting_periods", "period",
    "ALTER TABLE erp_accounting_periods ADD COLUMN period VARCHAR(7) NOT NULL DEFAULT ''")
  await addColumnIfMissing("erp_accounting_periods", "closed_by",
    "ALTER TABLE erp_accounting_periods ADD COLUMN closed_by VARCHAR(64) NULL")
  await addColumnIfMissing("erp_accounting_periods", "closed_at",
    "ALTER TABLE erp_accounting_periods ADD COLUMN closed_at DATETIME NULL")
  await addColumnIfMissing("erp_accounting_periods", "notes",
    "ALTER TABLE erp_accounting_periods ADD COLUMN notes TEXT NULL")

  // Part 2: project_id on warehouse documents for P&L
  await addColumnIfMissing("erp_warehouse_documents", "project_id",
    "ALTER TABLE erp_warehouse_documents ADD COLUMN project_id VARCHAR(64) NULL")
  await addIndexIfMissing("erp_warehouse_documents", "idx_warehouse_project",
    "ALTER TABLE erp_warehouse_documents ADD INDEX idx_warehouse_project (project_id)")

  // Seed permissions for all existing workspaces
  const [workspaces] = await db.query<import("mysql2").RowDataPacket[]>(
    "SELECT id FROM erp_workspaces"
  )
  for (const ws of workspaces) {
    await seedDefaultPermissions(ws.id as string)
  }
}

async function migrateSyncErrorColumn() {
  const [rows] = await getDbPool().query<CountRow[]>(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'erp_documents'
       AND COLUMN_NAME = 'sync_error'`
  )
  if ((rows[0]?.count ?? 0) === 0) return // Already migrated

  // Split sync_error into drive_sync_error and proxmox_sync_error
  await getDbPool().execute(`
    UPDATE erp_documents
    SET drive_sync_error   = IF(INSTR(sync_error, '|') > 0,
                                 TRIM(SUBSTRING_INDEX(sync_error, '|', 1)),
                                 sync_error),
        proxmox_sync_error = IF(INSTR(sync_error, '|') > 0,
                                 TRIM(SUBSTRING(sync_error, INSTR(sync_error, '|') + 2)),
                                 NULL)
    WHERE sync_error IS NOT NULL
  `)
  await getDbPool().execute(`ALTER TABLE erp_documents DROP COLUMN sync_error`)
  console.log("[DB] Migrated erp_documents.sync_error → drive_sync_error + proxmox_sync_error")
}

async function seedAdminUser() {
  const db = getDbPool()
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@sparksome.com"
  const adminPassword = process.env.ADMIN_PASSWORD ?? "changeme123"
  const usingDefault = !process.env.ADMIN_PASSWORD

  if (usingDefault) {
    console.warn("[WARN] Using default admin password — change ADMIN_PASSWORD in .env!")
  }

  // Check if admin user already exists
  const [existing] = await db.query<import("mysql2").RowDataPacket[]>(
    "SELECT id FROM erp_users WHERE email = ? LIMIT 1",
    [adminEmail]
  )
  if ((existing as import("mysql2").RowDataPacket[]).length > 0) return

  // Try to find a matching employee
  const [employees] = await db.query<import("mysql2").RowDataPacket[]>(
    "SELECT id, workspace_id FROM erp_employees WHERE email = ? LIMIT 1",
    [adminEmail]
  )

  let employeeId: string
  let workspaceId: string

  const empRows = employees as import("mysql2").RowDataPacket[]
  if (empRows.length > 0) {
    employeeId = empRows[0]!.id as string
    workspaceId = empRows[0]!.workspace_id as string
  } else {
    // Get first workspace or create a placeholder
    const [ws] = await db.query<import("mysql2").RowDataPacket[]>(
      "SELECT id FROM erp_workspaces LIMIT 1"
    )
    const wsRows = ws as import("mysql2").RowDataPacket[]
    if (wsRows.length > 0) {
      workspaceId = wsRows[0]!.id as string
    } else {
      workspaceId = "workspace_default"
      await db.execute(
        `INSERT INTO erp_workspaces (id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name=name`,
        [workspaceId, "Sparksome"]
      )
    }

    // Create placeholder employee
    employeeId = `emp_${crypto.randomUUID()}`
    await db.execute(
      `INSERT INTO erp_employees (id, workspace_id, name, email, status, synced_at)
       VALUES (?, ?, ?, ?, 'active', NOW())`,
      [employeeId, workspaceId, "Admin", adminEmail]
    )
  }

  // Hash password and create user
  const passwordHash = await Bun.password.hash(adminPassword, { algorithm: "argon2id" })
  const userId = `usr_${crypto.randomUUID()}`

  await db.execute(
    `INSERT INTO erp_users (id, workspace_id, employee_id, email, password_hash, role, is_active)
     VALUES (?, ?, ?, ?, ?, 'admin', 1)`,
    [userId, workspaceId, employeeId, adminEmail, passwordHash]
  )
  console.log(`[Auth] Admin user created: ${adminEmail}`)
}

export async function seedDefaultPermissions(workspaceId: string): Promise<void> {
  const db = getDbPool()

  // permission -> { admin, manager, consultant, accountant }
  const permissions: Array<[string, boolean, boolean, boolean, boolean]> = [
    ["dashboard.view",                  true,  true,  false, true],
    ["time_entries.create_own",         true,  true,  true,  false],
    ["time_entries.edit_own",           true,  true,  true,  false],
    ["time_entries.delete_own",         true,  true,  true,  false],
    ["time_entries.read_all",           true,  true,  false, true],
    ["time_entries.edit_others",        true,  true,  false, false],
    ["timesheets.submit",               true,  true,  true,  false],
    ["timesheets.approve",              true,  true,  false, false],
    ["employees.view_own",              true,  true,  true,  false],
    ["employees.edit_own",              true,  true,  true,  false],
    ["employees.view_all",              true,  true,  false, true],
    ["employees.edit_all",              true,  true,  false, false],
    ["employees.view_internal_rate",    true,  true,  false, true],
    ["clients.view",                    true,  true,  false, true],
    ["clients.edit",                    true,  true,  false, false],
    ["reports.view",                    true,  true,  false, true],
    ["reports.export",                  true,  true,  false, true],
    ["reports.accounting",              true,  true,  false, true],
    ["documents.view",                  true,  true,  false, true],
    ["documents.upload",                true,  true,  false, true],
    ["documents.manage",                true,  true,  false, false],
    ["inventory.view",                  true,  true,  false, true],
    ["inventory.edit",                  true,  true,  false, false],
    ["users.manage",                    true,  false, false, false],
    ["rbac.manage",                     true,  false, false, false],
    ["storage.manage",                  true,  false, false, false],
    ["audit.view",                      true,  false, false, false],
    // Phase 7
    ["warehouse.view",                  true,  true,  false, false],
    ["warehouse.manage",                true,  true,  false, false],
    // Period locking
    ["accounting.close_period",         true,  false, false, false]
  ]

  const roles: Array<"admin" | "manager" | "consultant" | "accountant"> = [
    "admin", "manager", "consultant", "accountant"
  ]

  for (const [permission, adminGrant, managerGrant, consultantGrant, accountantGrant] of permissions) {
    const grants = [adminGrant, managerGrant, consultantGrant, accountantGrant]
    for (let i = 0; i < roles.length; i++) {
      const role = roles[i]!
      const granted = grants[i]!
      const id = `perm_${crypto.randomUUID()}`
      await db.execute(
        `INSERT INTO erp_role_permissions (id, workspace_id, role, permission, granted)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE granted = VALUES(granted)`,
        [id, workspaceId, role, permission, granted ? 1 : 0]
      )
    }
  }
}

async function addColumnIfMissing(tableName: string, columnName: string, alterSql: string) {
  const [rows] = await getDbPool().query<CountRow[]>(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
    `,
    [tableName, columnName]
  )

  if ((rows[0]?.count ?? 0) === 0) {
    await getDbPool().execute(alterSql)
  }
}

async function addIndexIfMissing(tableName: string, indexName: string, alterSql: string) {
  const [rows] = await getDbPool().query<CountRow[]>(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?
    `,
    [tableName, indexName]
  )

  if ((rows[0]?.count ?? 0) === 0) {
    await getDbPool().execute(alterSql)
  }
}

async function seedFinanceDictionaries() {
  const categories = [
    ["cat_stock", "Zatowarowanie", "STOCK", "Koszty zakupu towaru i zapasy"],
    ["cat_marketing", "Marketing", "MARKETING", "Marketing i promocja"],
    ["cat_company", "Utrzymanie spółki", "COMPANY_OVERHEAD", "Koszty ogólne spółki"],
    ["cat_services", "Usługi obce", "EXTERNAL_SERVICES", "Usługi obce i podwykonawcy"],
    [
      "cat_contractors",
      "Wynagrodzenia / umowy zlecenie",
      "CONTRACTORS",
      "Rachunki i koszty kontraktorów"
    ],
    ["cat_equipment", "Sprzęt", "EQUIPMENT", "Sprzęt i wyposażenie"],
    ["cat_software", "Oprogramowanie", "SOFTWARE", "Licencje i narzędzia"],
    ["cat_office", "Biuro", "OFFICE", "Koszty biurowe"],
    ["cat_other", "Inne", "OTHER", "Pozostałe kategorie"]
  ]

  for (const category of categories) {
    await getDbPool().execute(
      `
        INSERT INTO erp_financial_categories (id, name, code, description)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          description = VALUES(description),
          is_active = true
      `,
      category
    )
  }

  await getDbPool().execute(
    `
      INSERT INTO erp_tax_rates (id, name, rate, valid_from, is_default)
      VALUES ('tax_cit_9', 'CIT 9%', 0.09, '2000-01-01', true)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        rate = VALUES(rate),
        is_default = true
    `
  )
}
