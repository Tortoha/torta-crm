# Deploy the Admin panel (operator console) to Fly.io.
# Only one build arg here (admin doesn't talk to External API directly,
# all admin endpoints live under api-crm.tortacrm.com/api/admin/*).

Set-Location (Join-Path $PSScriptRoot '..\Admin\frontend')

Write-Host ""
Write-Host "[fly-deploy] Admin Frontend (torta-admin-frontend) -> fra" -ForegroundColor Cyan
Write-Host "  Build args:"
Write-Host "    VITE_API_BASE = https://api-crm.tortacrm.com"
Write-Host ""

fly deploy --build-arg VITE_API_BASE=https://api-crm.tortacrm.com

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[fly-deploy] Admin Frontend deploy FAILED. Check 'fly logs -a torta-admin-frontend'." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[fly-deploy] Admin Frontend deployed successfully." -ForegroundColor Green
Write-Host "  Live:  https://admin.tortacrm.com" -ForegroundColor Green
Write-Host ""
