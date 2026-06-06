# Build a standalone Windows backend binary with PyInstaller.
# Mirrors build-backend.sh. PyInstaller cannot cross-compile, so this MUST run
# on Windows in the Python environment where backend deps are installed.
#
# Usage (from an activated conda/venv with deps installed):
#   powershell -ExecutionPolicy Bypass -File backend\build-backend.ps1
#
# Output: backend\bin\transcriptai-backend\transcriptai-backend.exe (onedir)

$ErrorActionPreference = "Stop"

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Out  = Join-Path $Here "bin"

Write-Host "Building backend binary into: $Out"
New-Item -ItemType Directory -Force -Path $Out | Out-Null

Set-Location $Here

# NOTE: the .spec file unconditionally excludes torch (transcription is done by the
# whisper.cpp server, not PyTorch), so this flag is currently informational only.
if (-not $env:TRANSCRIPTAI_BUNDLE_TORCH) { $env:TRANSCRIPTAI_BUNDLE_TORCH = "0" }
Write-Host "TRANSCRIPTAI_BUNDLE_TORCH=$($env:TRANSCRIPTAI_BUNDLE_TORCH)"

# --- SAFETY CHECK: verify the active Python env has deps ---
Write-Host "Checking Python environment..."
python -c "import uvicorn" 2>$null
if (-not $?) {
    Write-Host "ERROR: 'uvicorn' not found in the current Python environment."
    Write-Host "   Activate the conda/venv where backend dependencies are installed, then retry."
    exit 1
}
Write-Host "Environment looks good (uvicorn found)."

# PyInstaller onedir build via the shared spec.
python -m PyInstaller -y --clean transcriptai-backend.spec
if (-not $?) { Write-Host "ERROR: PyInstaller build failed."; exit 1 }

# Move built onedir from dist/ to bin/
$DistDir = Join-Path $Here "dist\transcriptai-backend"
$DestDir = Join-Path $Out "transcriptai-backend"
if (Test-Path $DistDir) {
    Write-Host "Moving built binary to $Out..."
    if (Test-Path $DestDir) { Remove-Item -Recurse -Force $DestDir }
    Move-Item $DistDir $Out
    Write-Host "Backend binary available in: $DestDir\transcriptai-backend.exe"
} else {
    Write-Host "ERROR: Built binary not found in $Here\dist\"
    exit 1
}
