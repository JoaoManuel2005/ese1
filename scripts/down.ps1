#Requires -Version 5.1

$ErrorActionPreference = "Stop"

$script:Clean = $false

foreach ($arg in $args) {
  switch ($arg.ToLowerInvariant()) {
    "--clean" { $script:Clean = $true }
    "-clean" { $script:Clean = $true }
    "-c" { $script:Clean = $true }
    default {
      Write-Host "Unknown argument: $arg" -ForegroundColor Red
      Write-Host ""
      Write-Host "Usage:" -ForegroundColor Blue
      Write-Host "  .\down.ps1              # Stop containers"
      Write-Host "  .\down.ps1 --clean      # Stop containers and remove volumes"
      Write-Host "  .\down.ps1 -c           # Short form of --clean"
      exit 1
    }
  }
}

$projectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $projectDir

Write-Host "     Stopping Power Platform Documentation Generator" -ForegroundColor Blue
Write-Host ""

$composeArgs = @()
$dotnetCompose = Join-Path $projectDir "docker-compose.dotnet.yml"
$imagesCompose = Join-Path $projectDir "docker-compose.images.yml"

if (Test-Path -LiteralPath $dotnetCompose -PathType Leaf) {
  $composeArgs += @("-f", $dotnetCompose)
}

if (Test-Path -LiteralPath $imagesCompose -PathType Leaf) {
  $composeArgs += @("-f", $imagesCompose)
}

$psOutput = docker compose @composeArgs ps 2>$null
$hasRunningContainers = $LASTEXITCODE -eq 0 -and ($psOutput | Select-String -Pattern "\bUp\b" -Quiet)

if ($hasRunningContainers) {
  Write-Host "Stopping Docker containers..." -ForegroundColor Yellow
  docker compose @composeArgs down
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose down failed."
  }
  Write-Host "Containers stopped" -ForegroundColor Green
} else {
  Write-Host "No running containers found" -ForegroundColor Yellow
}

if ($script:Clean) {
  Write-Host "Removing volumes..." -ForegroundColor Yellow
  docker compose @composeArgs down -v
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose down -v failed."
  }
  Write-Host "Volumes removed" -ForegroundColor Green
}

Write-Host ""
Write-Host "Services stopped successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Usage:" -ForegroundColor Blue
Write-Host "  .\down.ps1              # Stop containers"
Write-Host "  .\down.ps1 --clean      # Stop containers and remove volumes"
Write-Host "  .\down.ps1 -c           # Short form of --clean"
Write-Host ""
