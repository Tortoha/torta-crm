# Push the whole stack to Docker on PARALLEL ports so native VS Code Run All
# keeps working. Standard ports (8001/8000/5174/5175/5432) stay with native;
# Docker takes the +10000 (or +1 for PG) variants:
#   5433 ........ postgres
#   18001 ....... CRM backend
#   18000 ....... External API
#   15174 ....... CRM frontend
#   15175 ....... Admin frontend
#
# First run: ~3-5 min (npm ci + npm run build x 3 frontends + pip install).
# Subsequent runs reuse layer cache: much faster unless you changed deps.
#
# NOTE: pure ASCII only. PowerShell 5.1 on RU Windows reads non-BOM UTF-8
# as cp1251 and chokes on em-dashes / typographic quotes.

Set-Location (Join-Path $PSScriptRoot '..')

Write-Host ""
Write-Host "[docker-up] Building images with parallel-port build args..." -ForegroundColor Cyan
docker compose -f docker-compose.yml -f docker-compose.parallel.yml build

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[docker-up] Build failed. Aborting." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[docker-up] Starting containers..." -ForegroundColor Cyan
docker compose -f docker-compose.yml -f docker-compose.parallel.yml up -d

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[docker-up] Compose up failed. Aborting." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[docker-up] Waiting for healthchecks..." -ForegroundColor Cyan
$tries = 0
while ($tries -lt 30) {
    $unhealthy = docker compose -f docker-compose.yml -f docker-compose.parallel.yml ps --format '{{.Status}}' |
                 Where-Object { $_ -notmatch 'healthy' }
    if (-not $unhealthy) { break }
    Start-Sleep 2
    $tries++
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " Docker stack UP on parallel ports (native untouched)" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Postgres        localhost:5433  (user=postgres, db=crmdb)"
Write-Host "  CRM backend     http://localhost:18001/docs"
Write-Host "  External API    http://localhost:18000/docs"
Write-Host "  CRM frontend    http://localhost:15174"
Write-Host "  Admin frontend  http://localhost:15175"
Write-Host ""
Write-Host "Native (still alive on standard ports):"
Write-Host "  CRM backend     http://localhost:8001/docs"
Write-Host "  External API    http://localhost:8000/docs"
Write-Host "  CRM frontend    http://localhost:5174"
Write-Host "  Admin frontend  http://localhost:5175"
Write-Host ""
Write-Host "Tear down later with: scripts\docker-down.ps1" -ForegroundColor Yellow
Write-Host ""

docker compose -f docker-compose.yml -f docker-compose.parallel.yml ps
