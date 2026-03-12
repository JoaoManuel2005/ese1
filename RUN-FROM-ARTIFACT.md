# Run the app from CI artifact

1. **Download** the `docker-images` artifact from the GitHub Actions run and **extract it into a single directory** (e.g. `./my-app/`). Do not move or rename the extracted files.

2. **Image tars location**: The script loads images from the **same directory** as `docker-compose.images.yml`. That directory must contain:
   - `dotnet-backend.tar`
   - `documentation_generator.tar`
   - `pac_cli.tar`
   - `docker-compose.images.yml`
   - `scripts/run-with-images.sh` (Linux/macOS)
   - `scripts/run-with-images.ps1` (Windows)
   Run the script from that directory; the tars must be there.

3. **Provide secrets** via Azure Key Vault: ensure `az` CLI is logged in and the `docgenvault` vault is accessible (secrets: AI-API-KEY, AZURE-OPENAI-ENDPOINT, NEXTAUTH-SECRET, AZURE-AD-CLIENT-ID, AZURE-AD-CLIENT-SECRET, AZURE-AD-TENANT-ID).

4. **Run** (from the artifact root directory):
   - **Linux/macOS (bash):**
     ```bash
     chmod +x scripts/run-with-images.sh
     ./scripts/run-with-images.sh
     ```
   - **Windows (PowerShell):**
     ```powershell
     .\scripts\run-with-images.ps1
     ```
   The script will load the three .tar files from the current directory, generate `.env.generated`, and start the stack with Docker Compose. On Windows, ensure Docker Desktop is running and the Azure CLI (`az`) is installed and logged in.

5. **Access**:
   - Backend: http://localhost:8001
   - Documentation UI: http://localhost:3000

To stop: `docker compose -f docker-compose.images.yml down`
