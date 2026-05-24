@echo off
setlocal enabledelayedexpansion
cd /d "C:\Users\bartl\Documents\agy\ERP_SPARKSOME\erp-od praktykantow"
for /f "usebackq tokens=1,* delims==" %%A in (".env.local") do (
  if not "%%A"=="" (
    set "first=%%A"
    if not "!first:~0,1!"=="#" set "%%A=%%B"
  )
)
bun run src/services/clockify-sync-service.ts
