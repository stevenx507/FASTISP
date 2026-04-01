#!/bin/bash

# ISPMAX Installation Script
# Usage: ./install.sh [dev|prod]

set -e

# Self-permission check
if [ ! -x "$0" ]; then
    echo "❌ Error: El script no tiene permisos de ejecución."
    echo "   Por favor, ejecuta: chmod +x $0"
    exit 1
fi

ENVIRONMENT=${1:-dev}
COMPOSE_FILE="docker-compose.$ENVIRONMENT.yml"

echo "🚀 Installing ISPMAX ($ENVIRONMENT environment)..."

# Check Docker and Docker Compose
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Create directories
echo "📁 Creating directories..."
mkdir -p logs backups ssl

# Copy environment files
if [ ! -f .env ]; then
    echo "📄 Creating .env file from example..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your configuration!"
    if [ "$ENVIRONMENT" = "prod" ]; then
        echo "    🚨 For production, ensure ALL mandatory variables (marked 'REQUIRED for Production' in .env.example) are correctly set."
    fi
fi

# Build and start services
echo "🐳 Building and starting services..."
docker-compose -f $COMPOSE_FILE build
docker-compose -f $COMPOSE_FILE up -d

# Initialize database
echo "🗄️  Initializing database..."
docker-compose -f $COMPOSE_FILE exec backend flask db upgrade

# Install frontend dependencies (only for development)
if [ "$ENVIRONMENT" = "dev" ]; then
    echo "📦 Installing frontend dependencies..."
    docker-compose -f $COMPOSE_FILE exec frontend npm install
else
    echo "📦 Frontend dependencies are handled by Docker image build in production."
fi

echo "✅ Installation completed!"
echo ""
echo "🌐 Access the application:"
if [ "$ENVIRONMENT" = "dev" ]; then
    echo "   Frontend: http://localhost:3000"
    echo "   Backend API: http://localhost:5000/api"
    echo "   PGAdmin: http://localhost:5050 (user: ispmax, pass: password, db: ispmax_dev)" # Added credentials as they are fixed in dev config
elif [ "$ENVIRONMENT" = "prod" ]; then
    echo "   Frontend: https://${FRONTEND_HOST} (via Traefik)"
    echo "   Backend API: Accesible via Frontend (https://${FRONTEND_HOST}/api)"
    echo "   PGAdmin: If configured, access securely (e.g., via SSH tunnel)"
    echo ""
    echo "🚨 Production notes:"
    echo "   - Ensure DNS for ${FRONTEND_HOST} points to your server."
    echo "   - Traefik will handle SSL certificates via Let's Encrypt using TRAEFIK_ACME_EMAIL."
fi
echo ""
echo "📝 Next steps:"
echo "   1. Configure your MikroTik routers"
echo "   2. Set up payment gateway (Stripe)"
echo "3. Configure email service"
echo ""
echo "🔄 To stop: docker-compose -f $COMPOSE_FILE down"
echo "📊 To view logs: docker-compose -f $COMPOSE_FILE logs -f"
