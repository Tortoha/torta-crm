# Deploy the CRM frontend (Landing + CRM console) to Fly.io.
#
# IMPORTANT: VITE_API_BASE + VITE_EXTERNAL_API_BASE are baked into the JS bundle
# at `npm run build` time (Vite replaces `import.meta.env.VITE_...` with literal
# strings). They MUST be passed as --build-arg here so the prod bundle hits the
# prod backends. If you skip them, the bundle will default to localhost URLs
# from api.js and the prod site will fail to reach the backend.

Set-Location (Join-Path $PSScriptRoot '..\CRM\frontend')

Write-Host ""
Write-Host "[fly-deploy] CRM Frontend (torta-crm-frontend) -> fra" -ForegroundColor Cyan
Write-Host "  Build args:"
Write-Host "    VITE_API_BASE          = https://api-crm.tortacrm.com"
Write-Host "    VITE_EXTERNAL_API_BASE = https://api.tortacrm.com"
Write-Host ""

fly deploy `
    --build-arg VITE_API_BASE=https://api-crm.tortacrm.com `
    --build-arg VITE_EXTERNAL_API_BASE=https://api.tortacrm.com

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[fly-deploy] CRM Frontend deploy FAILED. Check 'fly logs -a torta-crm-frontend'." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[fly-deploy] CRM Frontend deployed successfully." -ForegroundColor Green
Write-Host "  Live:  https://tortacrm.com" -ForegroundColor Green
Write-Host ""
