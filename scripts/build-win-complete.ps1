# ============================================================================
# TranscriptAI Complete Windows (NSIS) Builder
# ============================================================================
# Windows analogue of scripts/build-dmg-complete.sh. Builds the backend
# (PyInstaller), the frontend (Vite), and the NSIS installer (electron-builder).
# Code signing / notarization are macOS-only and intentionally absent here.
#
# Prerequisites (must be installed on this Windows host):
#   - Python 3 (with backend requirements installed; ideally an activated venv)
#   - Node.js + npm
#   - PyInstaller (pip install pyinstaller)
#   - Native binaries present in backend-cpp\win\ (built via backend-cpp\scripts\)
#
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File scripts\build-win-complete.ps1
#   ... -Clean    # remove previous backend/frontend/dist artifacts first
#   ... -Force    # force rebuild of backend even if present
# ============================================================================

param(
    [switch]$Clean,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$RootDir     = Split-Path -Parent $PSScriptRoot
$DesktopDir  = Join-Path $RootDir "desktop"
$BackendDir  = Join-Path $RootDir "backend"
$FrontendDir = Join-Path $RootDir "frontend"
$WinCppDir   = Join-Path $RootDir "backend-cpp\win"

function Log-Step($msg)    { Write-Host "`n==== $msg ====" -ForegroundColor Cyan }
function Log-Info($msg)    { Write-Host "[INFO] $msg" }
function Log-Success($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Log-Warn($msg)    { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Log-Error($msg)   { Write-Host "[ERROR] $msg" -ForegroundColor Red }

# ---------------------------------------------------------------------------
Log-Step "STEP 0: Cleanup"
if ($Clean) {
    Remove-Item -Recurse -Force (Join-Path $BackendDir "bin\transcriptai-backend") -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force (Join-Path $BackendDir "dist") -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force (Join-Path $BackendDir "build") -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force (Join-Path $FrontendDir "dist") -ErrorAction SilentlyContinue
    Get-ChildItem (Join-Path $DesktopDir "dist") -Filter "*.exe" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Log-Success "Cleanup complete"
} else {
    Log-Info "Skipping cleanup (pass -Clean to remove previous artifacts)"
}

# ---------------------------------------------------------------------------
Log-Step "STEP 1: Prerequisites"
foreach ($tool in @("python", "node", "npm")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Log-Error "$tool is required but not found on PATH"; exit 1
    }
}
Log-Success "python: $(python --version)"
Log-Success "node: $(node --version)"
Log-Success "npm: $(npm --version)"

python -c "import PyInstaller" 2>$null
if (-not $?) {
    Log-Warn "PyInstaller not found; installing..."
    pip install pyinstaller
}
Log-Success "PyInstaller available"

# ---------------------------------------------------------------------------
Log-Step "STEP 2: Native binaries (backend-cpp\win)"
$required = @("whisper-server.exe", "rnnoise.dll", "ffmpeg.exe", "ffprobe.exe")
$missing = @()
foreach ($f in $required) {
    if (-not (Test-Path (Join-Path $WinCppDir $f))) { $missing += $f }
}
if ($missing.Count -gt 0) {
    Log-Warn "Missing native binaries in backend-cpp\win: $($missing -join ', ')"
    Log-Warn "Build them first via backend-cpp\scripts\ (see backend-cpp\win\README.md)."
    Log-Warn "Continuing — the packaged app will not transcribe until these are present."
} else {
    Log-Success "All required native binaries present"
}

# ---------------------------------------------------------------------------
Log-Step "STEP 3: Python dependencies"
$req = Join-Path $RootDir "requirements.txt"
if (Test-Path $req) {
    Log-Info "Installing backend requirements..."
    pip install -q -r $req
    Log-Success "Python dependencies installed"
} else {
    Log-Warn "requirements.txt not found"
}

# ---------------------------------------------------------------------------
Log-Step "STEP 4: Node dependencies"
Push-Location $DesktopDir
if ((-not (Test-Path "node_modules")) -or $Force) { npm install }
Pop-Location
Push-Location $FrontendDir
if ((-not (Test-Path "node_modules")) -or $Force) { npm install }
Pop-Location
Log-Success "Node dependencies installed"

# ---------------------------------------------------------------------------
Log-Step "STEP 5: Build backend (PyInstaller)"
$backendOut = Join-Path $BackendDir "bin\transcriptai-backend"
if ((Test-Path $backendOut) -and (-not $Force)) {
    Log-Info "Backend binary exists, skipping (pass -Force to rebuild)"
} else {
    & powershell -ExecutionPolicy Bypass -File (Join-Path $BackendDir "build-backend.ps1")
    if (-not (Test-Path (Join-Path $backendOut "transcriptai-backend.exe"))) {
        Log-Error "Backend build failed - transcriptai-backend.exe not found"; exit 1
    }
    Log-Success "Backend built"
}

# ---------------------------------------------------------------------------
Log-Step "STEP 6: Build frontend (Vite)"
Push-Location $FrontendDir
npm run build:electron
Pop-Location
if (-not (Test-Path (Join-Path $FrontendDir "dist\index.html"))) {
    Log-Error "Frontend build failed - index.html not found"; exit 1
}
Log-Success "Frontend built"

# ---------------------------------------------------------------------------
Log-Step "STEP 7: Build NSIS installer (electron-builder)"
Push-Location $DesktopDir
Get-ChildItem "dist" -Filter "*.exe" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
npm run dist:win
Pop-Location

# ---------------------------------------------------------------------------
Log-Step "STEP 8: Verify"
$installer = Get-ChildItem (Join-Path $DesktopDir "dist") -Filter "*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($installer) {
    $sizeMb = [math]::Round($installer.Length / 1MB, 1)
    Log-Success "Installer created: $($installer.FullName) ($sizeMb MB)"
    exit 0
} else {
    Log-Error "Installer (.exe) not found in desktop\dist after build"
    exit 1
}
