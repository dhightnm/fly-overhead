# PowerShell script to rebuild Docker containers with no cache
# Usage: .\rebuild-docker.ps1 [dev|prod]

param(
    [Parameter(Position=0)]
    [ValidateSet("dev", "prod")]
    [string]$Mode = "prod"
)

Write-Host "Rebuilding Docker containers in $Mode mode..." -ForegroundColor Cyan

if ($Mode -eq "dev") {
    Write-Host "Stopping dev containers..." -ForegroundColor Yellow
    docker compose -f docker-compose.dev.yml stop
    
    Write-Host "Rebuilding dev containers (no cache)..." -ForegroundColor Yellow
    docker compose -f docker-compose.dev.yml build --no-cache server
    
    Write-Host "Starting dev containers..." -ForegroundColor Yellow
    docker compose -f docker-compose.dev.yml up -d
    
    Write-Host "✅ Dev containers rebuilt and started!" -ForegroundColor Green
} else {
    Write-Host "Stopping production containers..." -ForegroundColor Yellow
    docker compose stop
    
    Write-Host "Rebuilding production containers (no cache)..." -ForegroundColor Yellow
    docker compose build --no-cache --pull server
    
    Write-Host "Starting production containers..." -ForegroundColor Yellow
    docker compose up -d
    
    Write-Host "✅ Production containers rebuilt and started!" -ForegroundColor Green
}

Write-Host ""
Write-Host "Container status:" -ForegroundColor Cyan
docker compose ps

