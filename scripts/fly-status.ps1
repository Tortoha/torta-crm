# Show status of all 5 Fly machines (postgres + 4 apps) in one table.
# Quick way to verify everything's alive after deploys or before a demo.

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " FLY STATUS: all torta-* apps" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$apps = @(
    'torta-db',
    'torta-crm-backend',
    'torta-external-api',
    'torta-crm-frontend',
    'torta-admin-frontend'
)

foreach ($app in $apps) {
    Write-Host ""
    Write-Host "--- $app ---" -ForegroundColor Yellow
    fly status -a $app
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " URLs to smoke-test in browser:" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  https://tortacrm.com                  (Landing)"
Write-Host "  https://api-crm.tortacrm.com/docs     (CRM Swagger)"
Write-Host "  https://api.tortacrm.com/docs         (External Swagger)"
Write-Host "  https://admin.tortacrm.com/login      (Admin Sign In)"
Write-Host ""
