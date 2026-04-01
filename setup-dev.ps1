#!/usr/bin/env powershell
# ISPMAX Dev Environment Setup Script
# Ejecuta este script para preparar el entorno de desarrollo

Write-Host "🚀 ISPMAX Development Setup" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

# Verificar Python
Write-Host "`n1️⃣  Checking Python..." -ForegroundColor Cyan
$pythonCmd = "C:/Users/steve/OneDrive/Documentos/ISPFAST/ISPFAST/.venv/Scripts/python.exe"

if (-not (Test-Path $pythonCmd)) {
    Write-Host "❌ Python venv not found at .venv" -ForegroundColor Red
    Write-Host "   Run: python -m venv .venv"
    exit 1
}
Write-Host "✅ Python venv found" -ForegroundColor Green

# Generar ENCRYPTION_KEY
Write-Host "`n2️⃣  Generating ENCRYPTION_KEY..." -ForegroundColor Cyan
$encKey = & $pythonCmd -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
Write-Host "✅ Key generated: $($encKey.Substring(0, 20))..." -ForegroundColor Green

# Configurar variables de entorno para esta sesión PowerShell
Write-Host "`n3️⃣  Setting environment variables..." -ForegroundColor Cyan
$env:ENCRYPTION_KEY = $encKey
$env:DATABASE_URL = 'sqlite:///dev.db'
$env:REDIS_URL = 'redis://localhost:6379/0'
$env:CORS_ORIGINS = 'http://localhost:3000'
$env:MIKROTIK_DEFAULT_USERNAME = 'admin'
$env:MIKROTIK_DEFAULT_PASSWORD = 'admin'
Write-Host "✅ Environment variables set" -ForegroundColor Green

# Verificar Node.js
Write-Host "`n4️⃣  Checking Node.js..." -ForegroundColor Cyan
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Node.js not found. Install from https://nodejs.org/" -ForegroundColor Yellow
}

# Información de inicio
Write-Host "`n" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Ready to start development!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

Write-Host "`n📝 Next steps:" -ForegroundColor Cyan
Write-Host "  1. Backend (Terminal A):"
Write-Host "     cd backend"
Write-Host "     python run.py"
Write-Host ""
Write-Host "  2. Frontend (Terminal B):"
Write-Host "     cd frontend"
Write-Host "     npm install  (primera vez)"
Write-Host "     npm run dev"
Write-Host ""
Write-Host "  3. Abre http://localhost:3000 en tu navegador" -ForegroundColor Yellow
Write-Host ""
Write-Host "Variables de entorno configuradas en esta sesión PowerShell." -ForegroundColor Green
Write-Host "Si abres nuevas terminals, necesitarás re-ejecutar este script." -ForegroundColor Gray
