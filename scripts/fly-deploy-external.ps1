# Deploy the External API to Fly.io.
# Builds External/Dockerfile, pushes, recreates torta-external-api in fra.
# Same shape as fly-deploy-crm-backend.ps1.

Set-Location (Join-Path $PSScriptRoot '..\External')

Write-Host ""
Write-Host "[fly-deploy] External API (torta-external-api) -> fra" -ForegroundColor Cyan
Write-Host ""

fly deploy

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[fly-deploy] External API deploy FAILED. Check 'fly logs -a torta-external-api'." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[fly-deploy] External API deployed successfully." -ForegroundColor Green
Write-Host "  Live:  https://api.tortacrm.com/docs" -ForegroundColor Green
Write-Host ""
