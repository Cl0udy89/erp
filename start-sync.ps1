Set-Location "C:\Users\bartl\Documents\agy\ERP_SPARKSOME\erp-od praktykantow"
Get-Content ".env.local" | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]*?)\s*=\s*(.*)\s*$') {
        $key = $Matches[1].Trim()
        $val = $Matches[2].Trim()
        [System.Environment]::SetEnvironmentVariable($key, $val, "Process")
        $env:($key) = $val
    }
}
Write-Host "Sync env loaded. Starting Clockify sync on port 4000..."
bun run src/services/clockify-sync-service.ts
