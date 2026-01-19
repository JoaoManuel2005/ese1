#!/bin/bash

# =============================================================================
# Install Dependencies Script
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/rag-backend"
FRONTEND_DIR="$PROJECT_DIR/doc-gen-prototype"
VENV_DIR="$PROJECT_DIR/.venv"

echo -e "${BLUE}==============================================================================${NC}"
echo -e "${BLUE}     Installing Dependencies${NC}"
echo -e "${BLUE}==============================================================================${NC}"
echo ""

# Create Python virtual environment if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
    echo -e "${YELLOW}Creating Python virtual environment...${NC}"
    python3 -m venv "$VENV_DIR"
    echo -e "${GREEN}✓ Virtual environment created${NC}"
fi

# Activate and install Python dependencies
echo -e "${YELLOW}Installing Python dependencies...${NC}"
source "$VENV_DIR/bin/activate"
pip install --upgrade pip
pip install -r "$BACKEND_DIR/requirements.txt"
echo -e "${GREEN}✓ Python dependencies installed${NC}"
echo ""

# Install Node.js dependencies
echo -e "${YELLOW}Installing Node.js dependencies...${NC}"
cd "$FRONTEND_DIR"
npm install
echo -e "${GREEN}✓ Node.js dependencies installed${NC}"
echo ""

echo -e "${GREEN}==============================================================================${NC}"
echo -e "${GREEN}     Installation Complete!${NC}"
echo -e "${GREEN}==============================================================================${NC}"
echo ""
echo -e "Next steps:"
echo -e "  1. Add your OpenAI API key to: ${BLUE}$BACKEND_DIR/.env${NC}"
echo -e "  2. Run: ${BLUE}./run.sh${NC} to start the servers"
echo ""
