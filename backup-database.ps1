# PowerShell script to backup the fly_overhead database
# Usage: .\backup-database.ps1 [backup-directory]

param(
    [Parameter(Position=0)]
    [string]$BackupDir = "."
)

Write-Host "Creating database backup..." -ForegroundColor Cyan

$timestamp = Get-Date -Format "yyyyMMdd_HHMMSS"
$backupFile = "fly_overhead_backup_$timestamp.sql"
$backupPath = Join-Path $BackupDir $backupFile

try {
    # Check if container is running
    $containerRunning = docker ps --filter "name=fly-overhead-postgres" --format "{{.Names}}"
    if (-not $containerRunning) {
        Write-Host "Error: fly-overhead-postgres container is not running!" -ForegroundColor Red
        exit 1
    }

    Write-Host "Dumping database..." -ForegroundColor Yellow
    
    # Create backup inside container
    docker exec fly-overhead-postgres pg_dump -U postgres -d fly_overhead -F c -f /tmp/$backupFile
    
    if ($LASTEXITCODE -ne 0) {
        throw "pg_dump failed"
    }
    
    Write-Host "Copying backup to local machine..." -ForegroundColor Yellow
    
    # Copy backup out of container
    docker cp "fly-overhead-postgres:/tmp/$backupFile" $backupPath
    
    if ($LASTEXITCODE -ne 0) {
        throw "docker cp failed"
    }
    
    # Clean up inside container
    docker exec fly-overhead-postgres rm /tmp/$backupFile
    
    # Get file size
    $fileSize = (Get-Item $backupPath).Length / 1MB
    $fileSizeRounded = [math]::Round($fileSize, 2)
    
    Write-Host ""
    Write-Host "✅ Backup created successfully!" -ForegroundColor Green
    Write-Host "   File: $backupPath" -ForegroundColor White
    Write-Host "   Size: $fileSizeRounded MB" -ForegroundColor White
    Write-Host ""
    
} catch {
    Write-Host ""
    Write-Host "❌ Backup failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    exit 1
}

