# ISPFAST Installation Script for Windows
# Usage: .\install.ps1 [dev|prod]

param (
    [string]$Environment = "dev"
)

# --- Helper Functions ---
function Test-CommandExists {
    param ([string]$command)
    return [bool](Get-Command $command -ErrorAction SilentlyContinue)
}

# --- Script Start ---
Write-Host "🚀 Installing ISPFAST ($Environment environment)..." -ForegroundColor Green

# Verify script is run from the correct directory
if (-not (Test-Path "docker-compose.yml")) {
    Write-Host "❌ Error: Please run this script from the project's root directory." -ForegroundColor Red
    exit 1
}

# Determine Compose file
$composeFile = "docker-compose.$Environment.yml"
if (-not (Test-Path $composeFile)) {
    Write-Host "❌ Error: Compose file '$composeFile' not found for environment '$Environment'." -ForegroundColor Red
    exit 1
}

# Check for Docker
$dockerCommand = if (Test-CommandExists "docker") { "docker" } else { $null }
if (-not $dockerCommand) {
    Write-Host "❌ Docker is not installed or not in your PATH. Please install Docker Desktop for Windows." -ForegroundColor Red
    exit 1
}
Write-Host "✅ Docker found."

# Create directories
Write-Host "📁 Creating required directories..."
"logs", "backups", "ssl" | ForEach-Object {
    if (-not (Test-Path $_)) {
        New-Item -ItemType Directory -Path $_ | Out-Null
        Write-Host "   - Created '$_'"
    }
}

# Copy environment file
if (-not (Test-Path ".env")) {
    Write-Host "📄 Creating .env file from example..." -ForegroundColor Yellow
    Copy-Item ".env.example" -Destination ".env"
    Write-Host "⚠️  Please review and edit the .env file with your specific configuration!" -ForegroundColor Yellow
    if ($Environment -eq "prod") {
        Write-Host "   🚨 For production, ensure ALL 'REQUIRED for Production' variables in .env are set." -ForegroundColor Red
    }
}

# Build and start services
Write-Host "🐳 Building and starting services with Docker..." -ForegroundColor Cyan
try {
    & $dockerCommand compose -f $composeFile build
    & $dockerCommand compose -f $composeFile up -d
} catch {
    Write-Host "❌ Docker Compose command failed. Please check your Docker setup." -ForegroundColor Red
    Write-Host $_
    exit 1
}

Write-Host "⏳ Waiting for services to initialize before setting up the database..."
Start-Sleep -Seconds 15

# Initialize database
Write-Host "🗄️  Initializing database..." -ForegroundColor Cyan
try {
    & $dockerCommand compose -f $composeFile exec backend flask db upgrade
} catch {
    Write-Host "❌ Database initialization failed. The backend service might not have started correctly." -ForegroundColor Red
    Write-Host "   You may need to run this command manually later:"
    Write-Host "   docker compose -f $composeFile exec backend flask db upgrade"
    Write-Host $_
}

# Install frontend dependencies (for dev environment)
if ($Environment -eq "dev") {
    Write-Host "📦 Installing frontend dependencies..." -ForegroundColor Cyan
    try {
        & $dockerCommand compose -f $composeFile exec frontend npm install
    } catch {
        Write-Host "❌ Frontend dependency installation failed." -ForegroundColor Red
        Write-Host "   You may need to run this command manually later:"
        Write-Host "   docker compose -f $composeFile exec frontend npm install"
        Write-Host $_
    }
}

Write-Host ""
Write-Host "✅ Installation completed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "🌐 Access the application:" -ForegroundColor White
if ($Environment -eq "dev") {
    Write-Host "   - Frontend: http://localhost:3000"
    Write-Host "   - Backend API: http://localhost:5000"
} elseif ($Environment -eq "prod") {
    Write-Host "   - Frontend & API are accessible via the domain you configured in your .env file."
    Write-Host "   - Ensure your DNS records point to this server's IP address."
}
Write-Host ""
Write-Host "📝 Next steps:" -ForegroundColor White
Write-Host "   1. If you haven't, stop this script and edit the .env file with your custom values."
Write-Host "   2. Configure your MikroTik routers."
Write-Host "   3. Set up payment gateways and email services as needed."
Write-Host ""
Write-Host "ℹ️ Useful commands:"
Write-Host "   - To stop services: docker compose -f $composeFile down"
Write-Host "   - To view logs: docker compose -f $composeFile logs -f"
