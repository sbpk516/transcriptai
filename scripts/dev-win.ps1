# Windows dev launcher.
# Runs the app in dev mode (Vite + Electron + Python backend) using the dedicated
# project venv at .\venv instead of whatever `python` happens to be on PATH.
#
# Setup once:
#   python -m venv venv
#   .\venv\Scripts\python.exe -m pip install -r requirements.txt
#
# Then run:
#   powershell -ExecutionPolicy Bypass -File scripts\dev-win.ps1

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$VenvPy  = Join-Path $RootDir "venv\Scripts\python.exe"

if (-not (Test-Path $VenvPy)) {
    Write-Host "[ERROR] Project venv not found at $VenvPy" -ForegroundColor Red
    Write-Host "Create it with:" -ForegroundColor Yellow
    Write-Host "  python -m venv venv"
    Write-Host "  .\venv\Scripts\python.exe -m pip install -r requirements.txt"
    exit 1
}

# main.js (startBackendDev) spawns: (ELECTRON_PYTHON || 'python') -m uvicorn app.main:app
# Setting ELECTRON_PYTHON makes the dev backend use the isolated project venv.
$env:ELECTRON_PYTHON = $VenvPy
Write-Host "[dev-win] ELECTRON_PYTHON = $VenvPy" -ForegroundColor Cyan

Set-Location (Join-Path $RootDir "desktop")
npm run dev
