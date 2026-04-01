param(
  [string]$BackupDir = "./backups",
  [string]$DatabaseUrl = $env:DATABASE_URL
)

if (-not $DatabaseUrl) {
  Write-Error "DATABASE_URL is required"
  exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$dumpFile = Join-Path $BackupDir "ispfast_$timestamp.dump"

Write-Host "[backup] creating dump: $dumpFile"
pg_dump --format=custom --dbname "$DatabaseUrl" --file "$dumpFile"
if ($LASTEXITCODE -ne 0) {
  Write-Error "pg_dump failed"
  exit 1
}

$size = (Get-Item $dumpFile).Length
if ($size -le 0) {
  Write-Error "backup file is empty"
  exit 1
}

Write-Host "[verify] validating dump metadata"
pg_restore --list "$dumpFile" | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Error "pg_restore validation failed"
  exit 1
}

Write-Host "Backup and verification completed: $dumpFile ($size bytes)"
