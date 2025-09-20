#!/bin/bash

# Production Deployment Script for crypto-portofolio.com
echo "🚀 Deploying Portfolio Tracker to Production..."

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo "❌ Error: .env.production file not found!"
    echo "Please create .env.production with your production environment variables."
    echo "You can use env.production.example as a template."
    exit 1
fi

# Load production environment variables safely
set -a  # automatically export all variables
. "$(pwd)/.env.production"  # Use absolute path
set +a  # stop automatically exporting

# Build and start the application
echo "🔨 Building Docker image..."
docker compose build

echo "🔄 Starting production container..."
docker compose up -d

echo "✅ Production deployment complete!"
echo "🌐 Your app should be available at: https://crypto-portofolio.com"
echo "🔐 OAuth login should work with Google"

# Show container status
echo "📊 Container status:"
docker compose ps
