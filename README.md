# ESE1 - Power Platform Documentation Generator

You can find the steps to setting up and runing the app below, please make sure that you read over them carefully as everything listed below is required to run the app

---

## 1. Prerequisites

Before running locally, ensure you have:

- Docker Desktop installed and running  
- Azure CLI installed  
- Access to an Azure Key Vault
- The latest release .zip

---

## 2. Install Docker

Head to [docker's webstie](https://www.docker.com/) where you should see the option to download docker desktop for your operating system, and then follow the install process

---

## 3. Install Azure CLI

### Windows

Run:

    winget install --id Microsoft.AzureCLI --exact --source winget

Restart your terminal afterwards.

Verify installation:

    az --version



### macOS (Homebrew)

Run:

    brew update
    brew install azure-cli

Verify installation:

    az --version



### Linux (Ubuntu / Debian)

Run:

    curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

Verify installation:

    az --version

---

## 4. Azure Key Vault Setup

Head to [Azure](https://portal.azure.com/#home) and make sure that you setup (or are apart of) a Key Vault with the following naming scheme:


| Name | Value |
| ------ | ------ |
|    AI-API-KEY    |   *your OpenAI key*     |
|    AZURE-AD-CLIENT-ID    |    *your client ID*    |
| AZURE-AD-CLIENT-SECRET | *your client secret* |
| AZURE-AD-TENANT-ID | *your tenant ID* |
| AZURE-OPENAI-ENDPOINT | *your OpenAI endpoint* |
| NEXTAUTH-SECRET | *your next auth secret* |

Then login to Azure by opening your terminal and typing:

    az login

If prompted, select the correct subscription

---

## 5. Download latest release

Download the latest release of the app from [here](https://github.com/JoaoManuel2005/ese1/releases), simply click on the docker-images.zip folder which contatins all the artifacts and it will start downloading

---

## 6. Running the Full Application

Extract the docker-images.zip folder that you just downloaded into your desired directory, and make sure you have docker desktop running



Open the docker-images folder in your terminal:

`C:\Users\...\docker-images>`

To fetch secrets from Azure Key Vault and start all services use the following commands for your operating system:

### Windows:

    Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
    .\scripts\run-with-images.ps1

### macOS / Linux:

    chmod +x scripts/run-with-images.sh
    ./scripts/run-with-images.sh


After running the script you should see the containers up and running on docker desktop, you can expand docker-images to see:
- rag-backend-dotnet
- pac-cli
- documentation-generator

You should be able to see to see `port 3000:3000` or similar next to the documentation-generator container, you can simply click that to start the app in your browser

---

## 8. User Guide

- When setting up the Azure Key Vault your api keys and endpoints should already be set for you. If not then please make sure that your vault is set-up the same as shown above under 'Azure key vault set up'
- Upload solution files by drag and drop or clicking 'Browse' in the input files section
- Generate documentation by clicking 'Parse & Generate Docs'
- Sign in to use the chat history feature and to remember changes made to your system prompt
- You can start/stop the app anytime by opening docker desktop and clicking the start/stop button under actions next to docker-images
---
