Set-Location "C:\Users\bartl\Documents\agy\ERP_SPARKSOME\erp-od praktykantow"
Get-Content ".env.local" | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]*?)\s*=\s*(.*)\s*$') {
        $key = $Matches[1].Trim()
        $val = $Matches[2].Trim()
        [System.Environment]::SetEnvironmentVariable($key, $val, "Process")
        $env:($key) = $val
    }
}
Write-Host "Backend env loaded. Starting on port 4001..."
bun run src/services/backend-api-service.ts
