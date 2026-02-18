# Test: Docker Startup – RAG Demo

 Purpose
Verify that the RAG demo services start successfully using Docker without requiring local model setup or API keys.

 Preconditions
- Docker Desktop installed and running
- Repository cloned locally
- No OpenAI or Llama API keys set in the environment

 Steps
1. Navigating to the repository root directory.
2. Running 'docker compose up' by using the default configuration.
3. Observing container startup logs.

 Expected Result
- All containers starting without errors.
- Manual interaction is not required during startup.
- The application exposing its expected service endpoints.

 Environment
- OS: macOS
- Execution method: Docker Desktop
- Date: 02.02.2026
- Tester: Selin
