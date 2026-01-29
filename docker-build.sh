#!/bin/bash
# Docker Build and Run Script for Documentation Generator System
# Usage: ./docker-build.sh [command]
#   Commands: build, up, down, logs, clean

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if .env file exists
check_env() {
    if [ ! -f ".env" ]; then
        print_warning ".env file not found. Creating from .env.example..."
        if [ -f ".env.example" ]; then
            cp .env.example .env
            print_status "Created .env file. Please edit it with your API keys."
        else
            print_error ".env.example not found!"
            exit 1
        fi
    fi
}

build() {
    print_status "Building Docker images..."
    docker-compose build
    print_status "Build complete!"
}

up() {
    check_env
    print_status "Starting services..."
    docker-compose up -d
    print_status "Services started!"
    print_status "Documentation Generator: http://localhost:3000"
    print_status "RAG Backend API: http://localhost:8000"
    print_status "RAG Backend Docs: http://localhost:8000/docs"
}

up_dev() {
    check_env
    print_status "Starting services in development mode..."
    docker-compose -f docker-compose.dev.yml up -d
    print_status "Development services started!"
    print_status "Documentation Generator: http://localhost:3000"
    print_status "RAG Backend API: http://localhost:8000"
}

down() {
    print_status "Stopping services..."
    docker-compose down
    docker-compose -f docker-compose.dev.yml down 2>/dev/null || true
    print_status "Services stopped!"
}

logs() {
    docker-compose logs -f
}

logs_backend() {
    docker-compose logs -f rag-backend
}

logs_frontend() {
    docker-compose logs -f documentation-generator
}

clean() {
    print_warning "This will remove all containers, images, and volumes!"
    read -p "Are you sure? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_status "Cleaning up..."
        docker-compose down -v --rmi all 2>/dev/null || true
        docker-compose -f docker-compose.dev.yml down -v --rmi all 2>/dev/null || true
        print_status "Cleanup complete!"
    fi
}

status() {
    print_status "Container Status:"
    docker-compose ps
}

case "${1:-help}" in
    build)
        build
        ;;
    up)
        up
        ;;
    dev)
        up_dev
        ;;
    down)
        down
        ;;
    logs)
        logs
        ;;
    logs-backend)
        logs_backend
        ;;
    logs-frontend)
        logs_frontend
        ;;
    clean)
        clean
        ;;
    status)
        status
        ;;
    restart)
        down
        up
        ;;
    *)
        echo "Documentation Generator Docker Management"
        echo ""
        echo "Usage: $0 <command>"
        echo ""
        echo "Commands:"
        echo "  build         Build Docker images"
        echo "  up            Start all services (production)"
        echo "  dev           Start all services (development with hot-reload)"
        echo "  down          Stop all services"
        echo "  restart       Restart all services"
        echo "  logs          View logs from all services"
        echo "  logs-backend  View logs from RAG backend only"
        echo "  logs-frontend View logs from frontend only"
        echo "  status        Show container status"
        echo "  clean         Remove all containers, images, and volumes"
        ;;
esac
