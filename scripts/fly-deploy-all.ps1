# Deploy all 4 apps sequentially: CRM Backend -> External API -> CRM Frontend
# -> Admin Frontend. Each invokes its own script and stops on first failure
# so a broken build doesn't leave us with half-updated prod state.
#
# Sequential (not parallel) on purpose: cleaner logs, easier to debug, and
# Fly remote builder gets fewer concurrent jobs. Total time: ~5-8 minutes
# from cold cache, ~2-3 min if nothing rebuilds heavy layers.

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host " FLY DEPLOY: ALL 4 apps (CRM backend / External / 2 fronts)" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host ""

$start = Get-Date

$steps = @(
    @{ Name = 'CRM Backend';   Script = 'fly-deploy-crm-backend.ps1' },
    @{ Name = 'External API';  Script = 'fly-deploy-external.ps1' },
    @{ Name = 'CRM Frontend';  Script = 'fly-deploy-crm-frontend.ps1' },
    @{ Name = 'Admin Frontend'; Script = 'fly-deploy-admin.ps1' }
)

$i = 0
foreach ($step in $steps) {
    $i++
    Write-Host ""
    Write-Host "[$i/4] === $($step.Name) ===" -ForegroundColor Yellow
    & (Join-Path $PSScriptRoot $step.Script)
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "[fly-deploy-all] STOPPED at step $i ($($step.Name)). Fix it and re-run, or run remaining manually." -ForegroundColor Red
        exit 1
    }
}

$elapsed = (Get-Date) - $start
$min = [Math]::Floor($elapsed.TotalMinutes)
$sec = $elapsed.Seconds

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " ALL 4 apps deployed successfully ($min m $sec s)" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  https://tortacrm.com           (Landing + CRM console)"
Write-Host "  https://api-crm.tortacrm.com   (CRM backend API)"
Write-Host "  https://api.tortacrm.com       (External API)"
Write-Host "  https://admin.tortacrm.com     (Admin panel)"
Write-Host ""
