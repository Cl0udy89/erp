# Database Schema
_Last updated: 2026-05-20 — Phase 7 warehouse tables + OCR/Saldeo columns added_

## Table: erp_workspaces
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK — Clockify workspace ID |
| name | VARCHAR(255) | no | |
| raw_json | JSON | yes | Full Clockify response |
| synced_at | TIMESTAMP | no | Auto-updated |

## Table: erp_employees
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK — Clockify user ID |
| workspace_id | VARCHAR(64) | no | FK → erp_workspaces |
| name | VARCHAR(255) | no | |
| email | VARCHAR(255) | no | |
| status | VARCHAR(64) | yes | Clockify status |
| profile_picture | TEXT | yes | URL |
| hourly_rate | DECIMAL(15,2) | yes | Internal cost rate — NEVER expose to Consultant role |
| raw_json | JSON | yes | Full Clockify response |
| synced_at | TIMESTAMP | no | |
**Phase 1A columns added (addColumnIfMissing):** date_of_birth DATE, contract_type ENUM('uop','zlecenie','b2b','staz','other'), contract_number VARCHAR(255), contract_date DATE, contract_document_id VARCHAR(64), supervisor_id VARCHAR(64), first_collaboration_date DATE, position VARCHAR(255)
**Polish pass column added (addColumnIfMissing):** manual_avatar_override TINYINT(1) NOT NULL DEFAULT 0 — when 1, Clockify sync skips updating profile_picture; set automatically when profile_picture is updated via POST /employees/:id/profile; cleared via POST /employees/:id/reset-avatar
**Note:** `hourly_rate` serves as internal_rate (cost rate). `internal_rate` NOT added separately.

## Table: erp_clients
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK — Clockify client ID |
| workspace_id | VARCHAR(64) | no | FK → erp_workspaces |
| name | VARCHAR(255) | no | |
| email | VARCHAR(255) | yes | |
| archived | BOOLEAN | no | DEFAULT FALSE |
| raw_json | JSON | yes | |
| synced_at | TIMESTAMP | no | |
**Phase 1B columns added (addColumnIfMissing):** nip VARCHAR(10), address TEXT, cooperation_type ENUM('time_material','subscription','other'), notes TEXT

## Table: erp_projects
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK — Clockify project ID |
| workspace_id | VARCHAR(64) | no | FK → erp_workspaces |
| client_id | VARCHAR(64) | yes | FK → erp_clients |
| name | VARCHAR(255) | no | |
| billable | BOOLEAN | no | DEFAULT TRUE |
| color | VARCHAR(32) | yes | |
| archived | BOOLEAN | no | DEFAULT FALSE |
| billing_rate | DECIMAL(15,2) | yes | Phase 0 ✅ |
| billing_type | ENUM('hourly','fixed','subscription') | no | DEFAULT 'hourly' — Phase 0 ✅ |
| fixed_amount | DECIMAL(15,2) | yes | Phase 0 ✅ |
| subscription_min_hours | INT | yes | Phase 0 ✅ |
| subscription_overage_rate | DECIMAL(15,2) | yes | Phase 0 ✅ |
| raw_json | JSON | yes | |
| synced_at | TIMESTAMP | no | |

## Table: erp_time_entries
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK — Clockify ID or UUID for manual/timer entries |
| workspace_id | VARCHAR(64) | no | FK → erp_workspaces |
| employee_id | VARCHAR(64) | no | FK → erp_employees |
| client_id | VARCHAR(64) | yes | |
| project_id | VARCHAR(64) | yes | |
| task_id | VARCHAR(64) | yes | Clockify task ID — NULL for manual entries |
| description | TEXT | no | Task description / entry name |
| billable | BOOLEAN | no | DEFAULT FALSE |
| start_at | DATETIME(3) | no | |
| end_at | DATETIME(3) | yes | NULL = timer still running |
| duration_seconds | INT | yes | Calculated from start/end |
| work_date | DATE | no | |
| estimated_cost | DECIMAL(15,2) | yes | hours × hourly_rate_used |
| hourly_rate_used | DECIMAL(15,2) | yes | Snapshot of rate at entry time |
| source | ENUM('clockify','manual','timer') | no | DEFAULT 'clockify' — Phase 0 ✅ |
| timesheet_id | VARCHAR(64) | yes | Soft ref → erp_timesheets — Phase 0 ✅ |
| tags | JSON | yes | Nullable string array e.g. ["meeting","review"] — Phase 0 ✅ |
| raw_json | JSON | yes | Clockify raw data |
| synced_at | TIMESTAMP | no | |

**Timer invariant:** `source = 'timer' AND end_at IS NULL` = currently running. Only one per employee enforced in API (409).

## Table: erp_timesheets ✅ Phase 0
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK |
| workspace_id | VARCHAR(64) | no | |
| employee_id | VARCHAR(64) | no | Soft ref → erp_employees |
| period_start | DATE | no | |
| period_end | DATE | no | |
| period_type | ENUM('weekly','monthly') | no | DEFAULT 'weekly' |
| status | ENUM('draft','submitted','approved','rejected') | no | DEFAULT 'draft' |
| submitted_at | DATETIME | yes | |
| approved_by | VARCHAR(64) | yes | Soft ref → erp_employees |
| approved_at | DATETIME | yes | |
| rejection_note | TEXT | yes | |
| created_at | TIMESTAMP | no | |
| updated_at | TIMESTAMP | no | |
**Unique:** (employee_id, period_start, period_end)

## Table: erp_timesheet_templates ✅ Phase 0
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK |
| workspace_id | VARCHAR(64) | no | |
| employee_id | VARCHAR(64) | no | Soft ref → erp_employees |
| name | VARCHAR(255) | no | |
| template_data | JSON | no | Arbitrary entry template structure |
| created_at | TIMESTAMP | no | |
| updated_at | TIMESTAMP | no | |

## Table: erp_task_suggestions ✅ Phase 0
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK |
| workspace_id | VARCHAR(64) | no | |
| employee_id | VARCHAR(64) | no | |
| project_id | VARCHAR(64) | no | |
| task_name | VARCHAR(255) | no | |
| used_count | INT | no | DEFAULT 1, incremented on each use |
| last_used_at | TIMESTAMP | no | Auto-updated |
**Unique:** (employee_id, project_id, task_name)

## Table: erp_sync_runs
| column | type | nullable | notes |
|---|---|---|---|
| id | BIGINT UNSIGNED | no | PK AUTO_INCREMENT |
| workspace_id | VARCHAR(64) | no | |
| status | ENUM | no | 'running','success','failed' |
| users_count | INT | no | |
| clients_count | INT | no | |
| projects_count | INT | no | |
| time_entries_count | INT | no | |
| error_message | TEXT | yes | |
| started_at | TIMESTAMP | no | |
| finished_at | TIMESTAMP | yes | |

## Table: erp_financial_categories
| column | type | notes |
|---|---|---|
| id | VARCHAR(64) PK | Seeded: cat_stock, cat_marketing, cat_company, cat_services, cat_contractors, cat_equipment, cat_software, cat_office, cat_other |
| name | VARCHAR(255) | Polish name |
| code | VARCHAR(64) UNIQUE | e.g. STOCK, MARKETING, COMPANY_OVERHEAD |
| description | TEXT | |
| is_active | BOOLEAN | |

## Table: erp_tax_rates
| column | type | notes |
|---|---|---|
| id | VARCHAR(64) PK | Seeded: tax_cit_9 |
| name | VARCHAR(255) | e.g. "CIT 9%" |
| rate | DECIMAL(8,6) | e.g. 0.09 |
| valid_from | DATE | |
| valid_to | DATE null | |
| is_default | BOOLEAN | |

## Table: erp_financial_documents
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK UUID |
| document_number | VARCHAR(255) | yes | Invoice number |
| document_name | VARCHAR(255) | yes | Filename |
| document_type | VARCHAR(64) | no | See type enum |
| source_system | VARCHAR(64) | no | DEFAULT 'MANUAL' |
| external_id | VARCHAR(255) | yes | Saldeo/KSeF ID |
| contractor_name | VARCHAR(255) | yes | |
| contractor_tax_id | VARCHAR(64) | yes | NIP |
| issue_date | DATE | yes | |
| sale_date | DATE | yes | |
| received_date | DATE | yes | |
| accounting_date | DATE | no | Month this belongs to |
| currency_code | VARCHAR(3) | no | DEFAULT 'PLN' |
| net_amount | DECIMAL(15,2) | no | Original currency |
| vat_amount | DECIMAL(15,2) | no | |
| gross_amount | DECIMAL(15,2) | no | |
| exchange_rate | DECIMAL(15,6) | yes | |
| net_amount_pln | DECIMAL(15,2) | no | PLN equivalent |
| vat_amount_pln | DECIMAL(15,2) | no | |
| gross_amount_pln | DECIMAL(15,2) | no | |
| description | TEXT | yes | |
| file_url | TEXT | yes | Phase 4: local/Drive path |
| import_status | VARCHAR(64) | no | DEFAULT 'MANUAL' |
| allocation_status | VARCHAR(64) | no | NOT_ALLOCATED / PARTIAL / ALLOCATED |
| raw_payload | JSON | yes | |

## Table: erp_financial_document_allocations
Maps financial documents to projects.
| column | type | notes |
|---|---|---|
| id | VARCHAR(64) | PK |
| financial_document_id | VARCHAR(64) | FK → erp_financial_documents (CASCADE) |
| project_id | VARCHAR(64) | FK → erp_projects (CASCADE) |
| client_id | VARCHAR(64) null | |
| employee_id | VARCHAR(64) null | |
| allocation_date | DATE | |
| transaction_type | VARCHAR(64) | |
| category_id | VARCHAR(64) null | FK → erp_financial_categories |
| revenue_amount | DECIMAL(15,2) | |
| revenue_amount_pln | DECIMAL(15,2) | |
| goods_purchase_cost | DECIMAL(15,2) | |
| service_cost_net | DECIMAL(15,2) | |
| realized_goods_cost | DECIMAL(15,2) | |
| other_operating_cost | DECIMAL(15,2) | |
| foreign_amount | DECIMAL(15,2) null | |
| currency_code | VARCHAR(3) null | |
| exchange_rate | DECIMAL(15,6) null | |
| cit_rate | DECIMAL(8,6) | |
| tax_effect | DECIMAL(15,2) | |
| tax_payable | DECIMAL(15,2) | |
| profit | DECIMAL(15,2) | |
| profit_after_tax | DECIMAL(15,2) | |
| notes | TEXT null | |
| description | TEXT null | |

## Table: erp_products
id (UUID), name, sku (unique), description, default_purchase_price, is_active.

## Table: erp_stock_movements
id, product_id→erp_products, project_id, financial_document_id, allocation_id, movement_type, movement_date, quantity, unit_price, total_value, description.

## Table: erp_accounting_periods
id, year, month, date_from, date_to, status (OPEN/CLOSED). Unique (year, month).

## Table: erp_users ✅ Phase 2
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK |
| workspace_id | VARCHAR(64) | no | FK → erp_workspaces |
| employee_id | VARCHAR(64) | no | soft ref → erp_employees |
| email | VARCHAR(255) | no | UNIQUE with workspace_id |
| password_hash | VARCHAR(255) | no | Argon2id via Bun.password |
| role | ENUM('admin','manager','consultant','accountant') | no | DEFAULT 'consultant' |
| is_active | BOOLEAN | no | DEFAULT TRUE |
| last_login_at | DATETIME | yes | |
**Unique:** (email, workspace_id)

## Table: erp_refresh_tokens ✅ Phase 2
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK |
| user_id | VARCHAR(64) | no | soft ref → erp_users |
| token_hash | VARCHAR(255) | no | SHA-256 of raw token |
| expires_at | DATETIME | no | 30 days |

## Table: erp_password_resets ✅ Phase 2
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK |
| user_id | VARCHAR(64) | no | soft ref → erp_users |
| token_hash | VARCHAR(255) | no | |
| expires_at | DATETIME | no | 1 hour |
| used_at | DATETIME | yes | |

## Table: erp_role_permissions ✅ Phase 2
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK |
| workspace_id | VARCHAR(64) | no | |
| role | ENUM('admin','manager','consultant','accountant') | no | |
| permission | VARCHAR(128) | no | e.g. 'time_entries.read_all' |
| granted | BOOLEAN | no | DEFAULT TRUE |
**Unique:** (workspace_id, role, permission)

## Table: erp_documents ✅ Phase 4 + Phase 5 sync columns
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK — `doc_UUID` |
| workspace_id | VARCHAR(64) | no | |
| uploaded_by | VARCHAR(64) | no | soft ref → erp_users |
| doc_type | ENUM('contract','invoice','receipt','id_document','certificate','nda','amendment','other') | no | |
| original_name | VARCHAR(255) | no | filename from upload |
| storage_path | VARCHAR(512) | no | relative to UPLOADS_DIR |
| mime_type | VARCHAR(128) | no | |
| file_size_bytes | INT | no | |
| contains_personal_data | BOOLEAN | no | DEFAULT FALSE; auto-TRUE for id_document |
| notes | TEXT | yes | |
| created_at | TIMESTAMP | no | |
| updated_at | TIMESTAMP | no | ON UPDATE |
| drive_file_id | VARCHAR(255) | yes | Google Drive file ID (null = not synced) |
| drive_folder_id | VARCHAR(255) | yes | Drive folder the file lives in |
| drive_synced_at | DATETIME | yes | When Drive sync last succeeded |
| proxmox_synced_at | DATETIME | yes | When Proxmox rsync last succeeded |
| drive_sync_error | TEXT | yes | Drive sync error (null = no error) — Phase 6 renamed |
| proxmox_sync_error | TEXT | yes | Proxmox sync error (null = no error) — Phase 6 renamed |

## Table: erp_drive_folders ✅ Phase 5
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK — `drf_UUID` |
| workspace_id | VARCHAR(64) | no | |
| entity_type | ENUM('root','client','consultant','project') | no | |
| entity_id | VARCHAR(64) | yes | null for root |
| entity_name | VARCHAR(255) | no | client/consultant/project name at time of creation |
| subfolder | VARCHAR(128) | yes | e.g. 'Contracts', 'Invoices', null = entity root |
| drive_folder_id | VARCHAR(255) | no | Google Drive folder ID (cached) |
| created_at | TIMESTAMP | no | |
**Unique:** (workspace_id, entity_type, entity_id, subfolder)

## Table: erp_document_links ✅ Phase 4
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK |
| document_id | VARCHAR(64) | no | soft ref → erp_documents |
| entity_type | ENUM('employee','client','project') | no | |
| entity_id | VARCHAR(64) | no | |
| created_at | TIMESTAMP | no | |
**Unique:** (document_id, entity_type, entity_id)

**Phase 4 addColumnIfMissing:** `erp_financial_documents.document_id VARCHAR(64) NULL`

## Table: erp_audit_log ✅ Phase 6
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK — `aud_UUID` |
| workspace_id | VARCHAR(64) | no | |
| actor_user_id | VARCHAR(64) | no | user who performed the action |
| actor_name | VARCHAR(255) | no | name at time of event |
| actor_role | VARCHAR(64) | no | role at time of event |
| action | VARCHAR(64) | no | create / update / delete / view / submit / approve / reject / login / logout / export / link / unlink / role_change / permission_change |
| entity_type | VARCHAR(64) | no | time_entry / timesheet / employee / client / document / user / role_permission / accounting_report |
| entity_id | VARCHAR(255) | no | PK of the affected entity |
| entity_label | VARCHAR(512) | yes | human-readable name (description, filename, email…) |
| changed_fields | JSON | yes | `{field: {from, to}}` — only for update events |
| metadata | JSON | yes | arbitrary context (snapshot, source, exportType…) |
| ip_address | VARCHAR(64) | yes | |
| created_at | DATETIME(3) | no | DEFAULT CURRENT_TIMESTAMP(3) — millisecond precision |
**Index:** (workspace_id, created_at DESC), (workspace_id, entity_type, entity_id), (workspace_id, actor_user_id)

## Table: erp_export_log ✅ Phase 3
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK |
| workspace_id | VARCHAR(64) | no | |
| exported_by | VARCHAR(64) | no | user id |
| export_type | VARCHAR(64) | no | monthly_pdf / monthly_csv / cost_billed_csv |
| params | JSON | no | snapshot of filter params |
| created_at | TIMESTAMP | no | DEFAULT CURRENT_TIMESTAMP |

## Table: erp_warehouse_documents ✅ Phase 7C
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK — `wh_UUID` |
| workspace_id | VARCHAR(64) | no | |
| doc_type | ENUM('PZ','WZ') | no | PZ=goods receipt, WZ=goods issue |
| doc_number | VARCHAR(64) | no | Format: `PZ/YYYY/MM/001` — unique per workspace |
| financial_doc_id | VARCHAR(64) | yes | soft ref → erp_documents (the uploaded invoice) |
| counterparty_id | VARCHAR(64) | yes | |
| counterparty_type | ENUM('client','supplier') | yes | |
| doc_date | DATE | no | |
| status | ENUM('draft','confirmed','cancelled') | no | DEFAULT 'draft' |
| notes | TEXT | yes | |
| created_by | VARCHAR(64) | no | soft ref → erp_users |
| created_at | TIMESTAMP | no | |
| updated_at | TIMESTAMP | no | ON UPDATE |
**Unique:** (workspace_id, doc_number)
**Auto-create:** draft PZ is automatically created when a document with docType='invoice' is uploaded.

## Table: erp_warehouse_document_items ✅ Phase 7C
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK — `whi_UUID` |
| warehouse_document_id | VARCHAR(64) | no | FK → erp_warehouse_documents |
| product_id | VARCHAR(64) | yes | soft ref → erp_products |
| product_name | VARCHAR(255) | no | |
| quantity | DECIMAL(15,4) | no | |
| unit | VARCHAR(32) | yes | |
| unit_price | DECIMAL(15,2) | yes | |

**Phase 7A addColumnIfMissing on erp_documents:** `ocr_data JSON NULL`, `ocr_processed_at DATETIME NULL`
**Phase 7B addColumnIfMissing on erp_financial_documents:** `saldeo_document_id VARCHAR(255) NULL`, `saldeo_exported_at DATETIME NULL`, `saldeo_export_error TEXT NULL`

## Table: erp_accounting_periods ✅ Period Locking
| column | type | nullable | notes |
|---|---|---|---|
| id | VARCHAR(64) | no | PK |
| workspace_id | VARCHAR(64) | no | |
| period | VARCHAR(7) | no | YYYY-MM format |
| status | ENUM('open','closed') | no | DEFAULT 'open' — no row = open by default |
| closed_by | VARCHAR(64) | yes | user id |
| closed_at | DATETIME | yes | |
| notes | TEXT | yes | |
| created_at | TIMESTAMP | no | |
**Unique:** (workspace_id, period)

**addColumnIfMissing on erp_warehouse_documents (P&L Materials):** `project_id VARCHAR(64) NULL` + index `idx_warehouse_project`

## Relations
- erp_employees → erp_workspaces (many-to-one)
- erp_clients → erp_workspaces (many-to-one)
- erp_projects → erp_workspaces, erp_clients (many-to-one each)
- erp_time_entries → erp_workspaces, erp_employees (many-to-one each)
- erp_timesheets → employee_id soft ref, workspace_id soft ref
- erp_timesheet_templates → employee_id soft ref, workspace_id soft ref
- erp_task_suggestions → employee_id, project_id soft refs
- erp_financial_document_allocations → erp_financial_documents, erp_projects (many-to-one each)
- erp_stock_movements → erp_products (many-to-one)
