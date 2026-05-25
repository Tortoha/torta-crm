# Tear down the parallel Docker stack started by docker-up.ps1.
# Native VS Code Run All stack is unaffected -- different ports.
#
# Pass -WipeVolume to also drop the postgres data volume (full reset).
#
# NOTE: pure ASCII only. PowerShell 5.1 on RU Windows reads non-BOM
# UTF-8 as cp1251 and chokes on em-dashes / typographic quotes.

param(
    [switch]$WipeVolume
)

Set-Location (Join-Path $PSScriptRoot '..')

Write-Host ""
Write-Host "[docker-down] Stopping parallel Docker stack..." -ForegroundColor Cyan

if ($WipeVolume) {
    Write-Host "[docker-down] -WipeVolume flag set: Postgres data will be deleted." -ForegroundColor Yellow
    docker compose -f docker-compose.yml -f docker-compose.parallel.yml down -v
} else {
    docker compose -f docker-compose.yml -f docker-compose.parallel.yml down
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "[docker-down] Done. Native ports (5432/8000/8001/5174/5175) untouched." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[docker-down] Compose down returned non-zero. Check 'docker ps' manually." -ForegroundColor Red
}
Write-Host ""
