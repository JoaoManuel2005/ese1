#!/bin/bash

# =============================================================================
# Start Backend & Frontend Servers
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/rag_backend"
FRONTEND_DIR="$PROJECT_DIR/documentation_generator"
VENV_DIR="$PROJECT_DIR/.venv"

echo -e "${BLUE}==============================================================================${NC}"
echo -e "${BLUE}     Power Platform Documentation Generator${NC}"
echo -e "${BLUE}==============================================================================${NC}"
echo ""

# Check if virtual environment exists
if [ ! -d "$VENV_DIR" ]; then
    echo -e "${RED}Error: Virtual environment not found at $VENV_DIR${NC}"
    echo -e "${YELLOW}Run: python3 -m venv .venv && source .venv/bin/activate && pip install -r rag_backend/requirements.txt${NC}"
    exit 1
fi

# Check if .env has valid API key
if ! grep -q "sk-" "$BACKEND_DIR/.env" 2>/dev/null; then
    echo -e "${YELLOW}⚠ Warning: OpenAI API key not found in .env file${NC}"
    echo -e "${YELLOW}  Document generation will fail without it.${NC}"
    echo -e "${YELLOW}  Add your key to: $BACKEND_DIR/.env${NC}"
    echo ""
fi

# Kill any existing processes on ports
echo -e "${YELLOW}Stopping any existing servers...${NC}"
lsof -ti :8000 | xargs kill -9 2>/dev/null
lsof -ti :3000 | xargs kill -9 2>/dev/null
sleep 1

# Start Backend in background
echo -e "${BLUE}Starting backend server...${NC}"
cd "$BACKEND_DIR"
"$VENV_DIR/bin/python" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Start Frontend in background
echo -e "${BLUE}Starting frontend server...${NC}"
cd "$FRONTEND_DIR"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing Node.js dependencies...${NC}"
    npm install
fi

npm run dev &
FRONTEND_PID=$!

# Wait a moment for both to start
sleep 3

echo ""
echo -e "${GREEN}==============================================================================${NC}"
echo -e "${GREEN}     Servers Started Successfully!${NC}"
echo -e "${GREEN}==============================================================================${NC}"
echo ""
echo -e "  ${BLUE}Frontend:${NC}  http://localhost:3000"
echo -e "  ${BLUE}Backend:${NC}   http://localhost:8000"
echo -e "  ${BLUE}API Docs:${NC}  http://localhost:8000/docs"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all servers${NC}"
echo ""

# Handle Ctrl+C to stop both servers
trap "echo -e '\n${YELLOW}Stopping servers...${NC}'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT

# Wait for servers
wait
