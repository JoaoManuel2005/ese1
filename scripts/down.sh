#!/bin/bash

# Stop All Services (Backend & Frontend Containers)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${BLUE}     Stopping Power Platform Documentation Generator${NC}"
echo ""

# Determine which docker-compose files are in use
COMPOSE_FILES=""
if [ -f "$PROJECT_DIR/docker-compose.dotnet.yml" ]; then
    COMPOSE_FILES="-f $PROJECT_DIR/docker-compose.dotnet.yml"
fi
if [ -f "$PROJECT_DIR/docker-compose.images.yml" ]; then
    COMPOSE_FILES="$COMPOSE_FILES -f $PROJECT_DIR/docker-compose.images.yml"
fi

# Check if there are any running containers
if docker compose $COMPOSE_FILES ps 2>/dev/null | grep -q "Up"; then
    echo -e "${YELLOW}Stopping Docker containers...${NC}"
    docker compose $COMPOSE_FILES down
    echo -e "${GREEN}✓ Containers stopped${NC}"
else
    echo -e "${YELLOW}No running containers found${NC}"
fi

# Optional: Remove volumes flag
if [ "${1:-}" = "--clean" ] || [ "${1:-}" = "-c" ]; then
    echo -e "${YELLOW}Removing volumes...${NC}"
    docker compose $COMPOSE_FILES down -v
    echo -e "${GREEN}✓ Volumes removed${NC}"
fi

echo ""
echo -e "${GREEN}Services stopped successfully!${NC}"
echo ""
echo -e "${BLUE}Usage:${NC}"
echo -e "  ./down.sh              # Stop containers"
echo -e "  ./down.sh --clean      # Stop containers and remove volumes"
echo -e "  ./down.sh -c           # Short form of --clean"
echo ""
