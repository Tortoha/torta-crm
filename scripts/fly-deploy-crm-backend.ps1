# Deploy the CRM backend to Fly.io.
# Builds the image from CRM/backend/Dockerfile via Fly remote builder, pushes
# to the Fly registry, recreates the machine in Frankfurt with the new image.
# ~30-60 seconds when pip layer is cached, ~2-3 min if requirements.txt changed.
#
# Note: pure ASCII in case the script gets re-saved without BOM on RU Windows.

Set-Location (Join-Path $PSScriptRoot '..\CRM\backend')

Write-Host ""
Write-Host "[fly-deploy] CRM Backend (torta-crm-backend) -> fra" -ForegroundColor Cyan
Write-Host ""

fly deploy

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[fly-deploy] CRM Backend deploy FAILED. Check 'fly logs -a torta-crm-backend'." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[fly-deploy] CRM Backend deployed successfully." -ForegroundColor Green
Write-Host "  Live:  https://api-crm.tortacrm.com/docs" -ForegroundColor Green
Write-Host ""
