# Credentials Setup — Phase 5

_Instructions for the person deploying the server. Claude Code does NOT execute these steps._

---

## Google Drive — Service Account

### 1. Create a Service Account in Google Workspace

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → IAM & Admin → Service Accounts
2. Create a new service account: `sparksome-erp-drive`
3. Grant no IAM roles on the project (it only needs Drive access, granted below)
4. Create a key → JSON → download as `google-service-account.json`

### 2. Enable the Drive API

In the same project: APIs & Services → Library → Google Drive API → Enable

### 3. Share the ERP root folder

1. In Google Drive, create a shared folder called **"Sparksome ERP"** (or choose any existing one)
2. Share it with the service account email (looks like `sparksome-erp-drive@your-project.iam.gserviceaccount.com`) → **Editor** role
3. Copy the folder ID from the URL: `https://drive.google.com/drive/folders/{FOLDER_ID}`

### 4. Place the key file on the server

```bash
mkdir -p /path/to/erp/credentials
cp ~/Downloads/google-service-account.json /path/to/erp/credentials/google-service-account.json
chmod 600 /path/to/erp/credentials/google-service-account.json
```

### 5. Set environment variables

In `.env` or `docker-compose.yml`:

```env
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./credentials/google-service-account.json
GOOGLE_DRIVE_ROOT_FOLDER_ID=1AbCdEfGhIjKlMnOpQrStUv   # from step 3
```

If `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` is missing or the file doesn't exist, Drive sync is skipped silently with a warning log. Uploads still succeed.

---

## Proxmox — rsync over SSH

### 1. Generate an SSH key pair

Run on the ERP server (not on Proxmox):

```bash
ssh-keygen -t rsa -b 4096 -C "erpbackup" -f ./credentials/proxmox_rsa -N ""
```

This creates:
- `./credentials/proxmox_rsa` — private key (keep secret)
- `./credentials/proxmox_rsa.pub` — public key

### 2. Create a backup user on Proxmox

On the Proxmox host:

```bash
useradd -m -s /bin/bash erpbackup
mkdir -p /home/erpbackup/.ssh
cat /path/to/proxmox_rsa.pub >> /home/erpbackup/.ssh/authorized_keys
chmod 700 /home/erpbackup/.ssh
chmod 600 /home/erpbackup/.ssh/authorized_keys
chown -R erpbackup:erpbackup /home/erpbackup/.ssh
```

### 3. Create the storage directory

```bash
mkdir -p /mnt/storage/sparksome-erp-uploads
chown erpbackup:erpbackup /mnt/storage/sparksome-erp-uploads
```

### 4. Test rsync manually

From the ERP server:

```bash
ssh -i ./credentials/proxmox_rsa erpbackup@192.168.x.x "echo ok"
rsync -az -e "ssh -i ./credentials/proxmox_rsa" ./uploads/ erpbackup@192.168.x.x:/mnt/storage/sparksome-erp-uploads/
```

### 5. Set environment variables

```env
PROXMOX_SFTP_HOST=192.168.1.100
PROXMOX_SFTP_USER=erpbackup
PROXMOX_SFTP_KEY_PATH=./credentials/proxmox_rsa
PROXMOX_SFTP_DIR=/mnt/storage/sparksome-erp-uploads
```

If `PROXMOX_SFTP_HOST` is not set, Proxmox sync is skipped silently. Uploads still succeed.

---

## Required tools on the ERP server

- `rsync` — must be installed: `apt install rsync` or `yum install rsync`
- `ssh` — standard OpenSSH client

---

## Docker Compose volume mount

Add the credentials directory to `docker-compose.yml`:

```yaml
services:
  backend-api:
    volumes:
      - ./credentials:/app/credentials:ro
      - ./uploads:/app/uploads
    environment:
      - GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./credentials/google-service-account.json
      - GOOGLE_DRIVE_ROOT_FOLDER_ID=1AbCdEf...
      - PROXMOX_SFTP_HOST=192.168.1.100
      - PROXMOX_SFTP_USER=erpbackup
      - PROXMOX_SFTP_KEY_PATH=./credentials/proxmox_rsa
      - PROXMOX_SFTP_DIR=/mnt/storage/sparksome-erp-uploads
```

**Note:** `rsync` and `ssh` must be available inside the backend-api Docker container.
If using the default Bun image, add to Dockerfile:
```dockerfile
RUN apt-get update && apt-get install -y rsync openssh-client && rm -rf /var/lib/apt/lists/*
```
