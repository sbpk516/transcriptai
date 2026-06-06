# Build whisper.cpp (server + shared libs) for Windows, CPU-only.
#
# Requirements on this Windows host:
#   - Visual Studio 2022 Build Tools (MSVC v143) + Windows SDK
#   - CMake >= 3.21 (cmake on PATH)
#   - git
#
# Output: backend-cpp\win\whisper-server.exe + whisper.dll + ggml*.dll
#
# Usage (from repo root, in a "Developer PowerShell for VS 2022" or any shell
# where cmake/MSVC are on PATH):
#   powershell -ExecutionPolicy Bypass -File backend-cpp\scripts\build-whisper-win.ps1
#   ... -Ref v1.8.2     # pin a specific whisper.cpp tag/commit (recommended)

param(
    # Pin to the version the macOS binary was built from for behavior parity.
    # libwhisper.1.8.2.dylib in backend-cpp\mac suggests whisper.cpp v1.8.2.
    [string]$Ref = "v1.8.2"
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$WinOut  = Join-Path $RootDir "backend-cpp\win"
$Work    = Join-Path $env:TEMP "transcriptai-whispercpp"

New-Item -ItemType Directory -Force -Path $WinOut | Out-Null

Write-Host "==== Cloning whisper.cpp ($Ref) ===="
if (Test-Path $Work) { Remove-Item -Recurse -Force $Work }
git clone --depth 1 --branch $Ref https://github.com/ggml-org/whisper.cpp $Work
if (-not $?) {
    Write-Host "Branch clone failed; cloning default and checking out $Ref"
    git clone https://github.com/ggml-org/whisper.cpp $Work
    Push-Location $Work; git checkout $Ref; Pop-Location
}

Write-Host "==== Configuring (CMake, CPU-only, shared libs) ===="
# GGML_NATIVE=OFF keeps the binary portable across CPUs (no AVX512-only codegen).
# BUILD_SHARED_LIBS=ON produces whisper.dll + ggml*.dll alongside the server exe.
$build = Join-Path $Work "build"
cmake -S $Work -B $build `
    -DCMAKE_BUILD_TYPE=Release `
    -DBUILD_SHARED_LIBS=ON `
    -DWHISPER_BUILD_SERVER=ON `
    -DWHISPER_BUILD_EXAMPLES=ON `
    -DGGML_NATIVE=OFF
if (-not $?) { Write-Host "[ERROR] CMake configure failed"; exit 1 }

Write-Host "==== Building ===="
cmake --build $build --config Release -j
if (-not $?) { Write-Host "[ERROR] Build failed"; exit 1 }

Write-Host "==== Collecting artifacts into $WinOut ===="
# whisper.cpp places Release artifacts under build\bin\Release (exe + dlls).
$binDir = Join-Path $build "bin\Release"
if (-not (Test-Path $binDir)) { $binDir = Join-Path $build "bin" }

$serverExe = Get-ChildItem $binDir -Recurse -Filter "*server*.exe" | Select-Object -First 1
if (-not $serverExe) { Write-Host "[ERROR] whisper server exe not found under $binDir"; exit 1 }
Copy-Item $serverExe.FullName (Join-Path $WinOut "whisper-server.exe") -Force

Get-ChildItem $binDir -Recurse -Filter "*.dll" | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $WinOut $_.Name) -Force
}

Write-Host "==== Verifying flags ===="
# The Electron shell passes: -m <model> --port <n> --vad --vad-model <f> --vad-threshold <x>
& (Join-Path $WinOut "whisper-server.exe") --help 2>&1 | Select-String -Pattern "port|vad|model" | ForEach-Object { Write-Host "  $_" }

Write-Host "`n[OK] whisper-server.exe + DLLs written to $WinOut"
Write-Host "If --help above does not list --port/--vad, update desktop\src\main.js arg construction to match."
