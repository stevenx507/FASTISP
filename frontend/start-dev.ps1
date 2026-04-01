#!/usr/bin/env powershell
# Frontend Dev Server Launcher
# Este script instala dependencias e inicia el servidor de desarrollo

Write-Host "🚀 ISPMAX Frontend Dev Server Launcher" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Green

$frontendPath = Get-Location
Write-Host "`n📁 Working directory: $frontendPath" -ForegroundColor Cyan

# Verificar si node_modules existe
if (-not (Test-Path "node_modules")) {
    Write-Host "`n📦 Installing dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ npm install failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "✅ node_modules found, skipping install" -ForegroundColor Green
}

# Iniciar dev server
Write-Host "`n🔧 Starting development server..." -ForegroundColor Cyan
Write-Host "   URL: http://localhost:3000" -ForegroundColor Green
Write-Host "   Press Ctrl+C to stop server" -ForegroundColor Gray
Write-Host ""

npm run dev
