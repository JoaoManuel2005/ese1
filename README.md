# ESE1  
# Power Platform Documentation Generator

---

## 1. Objective

Build an application that automatically generates high-quality technical documentation from Microsoft Power Platform solution files, powered by a Retrieval-Augmented Generation (RAG) pipeline for backend processing and NextJS as the user-facing interface.

The solution simplifies documentation production for consultants, developers, and business users by analysing solution components and producing structured, import-ready outputs.

---

## 2. Secrets Management (Azure Key Vault)

This project does NOT store API keys or client secrets in the repository.

All sensitive configuration is managed via Azure Key Vault and injected into Docker containers at runtime.

### Prerequisites

Before running locally, ensure you have:

- Docker Desktop installed and running  
- Azure CLI installed  
- Access to the Azure Key Vault (docgenvault) with one of the following roles:
  - Key Vault Secrets User (read access)
  - Key Vault Administrator (manage access)

---

## Install Azure CLI

### Windows

Run:

    winget install --id Microsoft.AzureCLI --exact --source winget

Restart your terminal afterwards.

Verify installation:

    az --version

---

### macOS (Homebrew)

Run:

    brew update
    brew install azure-cli

Verify installation:

    az --version

---

### Linux (Ubuntu / Debian)

Run:

    curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

Verify installation:

    az --version

---

## First-Time Setup

Login to Azure:

    az login

If prompted, select the correct subscription.

---

## Python Dependency Profiles

This repository uses split Python dependency sets:

- `requirements.txt`: core runtime dependencies only (no heavyweight ML embedding stack).
- `requirements-ml.txt`: optional ML/RAG extras (LlamaIndex, ChromaDB, FAISS, sentence-transformers).
- `requirements-ci.txt`: minimal CI test dependencies.

Install by use case:

    pip install -r requirements.txt

For full ML/RAG workflows:

    pip install -r requirements.txt -r requirements-ml.txt

For CI-only checks:

    pip install -r requirements-ci.txt

Note: existing Docker/dev backend setup uses `rag_backend/requirements.txt` and remains unchanged.

---

## Running the Full Application (Docker)

To fetch secrets from Azure Key Vault and start all services:

Windows:

    .\scripts\up.ps1

macOS / Linux:

    chmod +x scripts/up.sh
    ./scripts/up.sh

This script will:

- Fetch required secrets from Azure Key Vault  
- Generate a local .env.generated file (gitignored)  
- Build and start all Docker containers  

Secrets are pulled from the Azure Key Vault named docgenvault. Make sure you have run `az login` first.  

If secrets are rotated in Azure, simply re-run the script.

Important:

- .env.generated is automatically created and must NEVER be committed.  
- Secrets are centrally managed in Azure Key Vault.  

---

## 3. Core Features & Requirements

### Must Haves

| Requirement | Description |
|-------------|-------------|
| Power Platform Solution Analysis | Extract and document key artefacts from solution files (Power Apps, Power Automate, Dataverse, SharePoint) |
| SharePoint Metadata Integration | Automatically fetch SharePoint lists, libraries, and column schemas using Microsoft Graph API |
| Tech Documentation Generation | Automatically create structured documentation using a RAG pipeline and generative AI |
| Entity Relationship Diagram (ERD) | Generate ERDs based on Dataverse / SharePoint / solution data |
| Solution Overview / Architecture Diagram | Auto-generate architecture diagrams from solution metadata |
| Export to Target System | Output must be compatible with defined import template |
| Tech Stack Alignment | Backend uses C#, NodeJS, JavaScript, .NET |
| User-Friendly Frontend | UI built with NextJS for non-technical users |

---

## 4. High-Level Architecture

User (NextJS)  
↓  
API Layer (.NET / NodeJS)  
↓  
Solution File Parser (C#)  
↓  
RAG Pipeline (LLM + Vector DB)  
↓  
Documentation + ERD + Architecture Output  

---

## 5. Target Users

- Power Platform Developers  
- Solution Architects  
- Documentation Teams  
- Business Analysts  
- Non-technical stakeholders  

---

## 6. Success Criteria

- Generates technical documentation from solution files with minimal interaction  
- Produces valid ERDs and architecture diagrams  
- Output importable into target system  
- Works with customer tech stack  
- Usable without technical training  

---

## Dataset Scoping & Reset Behaviour

Each upload session uses a dataset_id.

All ingestion and retrieval calls include the active dataset_id to prevent data leakage between sessions.

Clearing files resets the dataset server-side via /rag/reset.

---

## Debugging

- Confirm active dataset ID in the UI  
- Check /rag/status?dataset_id=<id> for document count  
- If sources are incorrect, reset and re-ingest  
