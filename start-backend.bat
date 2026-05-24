@echo off
cd /d "C:\Users\bartl\Documents\agy\ERP_SPARKSOME\erp-od praktykantow"
for /f "usebackq tokens=1,* delims==" %%A in (".env.local") do (
  set "line=%%A"
  if not "!line:~0,1!"=="#" if not "%%A"=="" set "%%A=%%B"
)
setlocal enabledelayedexpansion
for /f "usebackq tokens=1,* delims==" %%A in (".env.local") do (
  if not "%%A"=="" (
    set "first=%%A"
    if not "!first:~0,1!"=="#" set "%%A=%%B"
  )
)
bun run src/services/backend-api-service.ts
