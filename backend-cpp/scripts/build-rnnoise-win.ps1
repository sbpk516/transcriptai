# Build RNNoise as a Windows DLL with exported C symbols.
#
# Requirements: Visual Studio 2022 Build Tools (MSVC) + CMake + git.
#
# CRITICAL: the resulting rnnoise.dll must EXPORT the C functions that
# backend/app/noise_processor.py binds via ctypes:
#   rnnoise_create, rnnoise_destroy, rnnoise_process_frame, rnnoise_get_frame_size
# MSVC does not export symbols by default, so we force
# CMAKE_WINDOWS_EXPORT_ALL_SYMBOLS=ON. Verify with `dumpbin /EXPORTS rnnoise.dll`.
#
# Output: backend-cpp\win\rnnoise.dll
#
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File backend-cpp\scripts\build-rnnoise-win.ps1

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$WinOut  = Join-Path $RootDir "backend-cpp\win"
$Work    = Join-Path $env:TEMP "transcriptai-rnnoise"

New-Item -ItemType Directory -Force -Path $WinOut | Out-Null

Write-Host "==== Cloning xiph/rnnoise ===="
if (Test-Path $Work) { Remove-Item -Recurse -Force $Work }
git clone --depth 1 https://github.com/xiph/rnnoise $Work

# xiph/rnnoise ships autotools, not CMake. Provide a minimal CMakeLists that
# compiles the src/*.c into a shared library if one is not already present.
$cmakeLists = Join-Path $Work "CMakeLists.txt"
if (-not (Test-Path $cmakeLists)) {
    Write-Host "==== Writing minimal CMakeLists.txt for a shared build ===="
@'
cmake_minimum_required(VERSION 3.15)
project(rnnoise C)
set(CMAKE_WINDOWS_EXPORT_ALL_SYMBOLS ON)
file(GLOB RNNOISE_SOURCES "src/*.c")
# Exclude standalone tools that define their own main()
list(FILTER RNNOISE_SOURCES EXCLUDE REGEX ".*(dump_features|gen_tables|test).*")
add_library(rnnoise SHARED ${RNNOISE_SOURCES})
target_include_directories(rnnoise PUBLIC include src)
target_compile_definitions(rnnoise PRIVATE COMPILE_OPUS=0)
'@ | Out-File -FilePath $cmakeLists -Encoding ascii
}

# rnnoise expects a generated model header (rnnoise_data.c) — newer trees bundle
# it; if a download script exists, run it.
$modelScript = Join-Path $Work "download_model.sh"
if (Test-Path $modelScript) {
    Write-Host "==== Note: rnnoise has download_model.sh ===="
    Write-Host "If the build fails on missing model data, run download_model.sh under WSL/git-bash first."
}

Write-Host "==== Configuring (CMake, shared lib, export all symbols) ===="
$build = Join-Path $Work "build"
cmake -S $Work -B $build `
    -DCMAKE_BUILD_TYPE=Release `
    -DBUILD_SHARED_LIBS=ON `
    -DCMAKE_WINDOWS_EXPORT_ALL_SYMBOLS=ON
if (-not $?) { Write-Host "[ERROR] CMake configure failed"; exit 1 }

Write-Host "==== Building ===="
cmake --build $build --config Release -j
if (-not $?) { Write-Host "[ERROR] Build failed"; exit 1 }

Write-Host "==== Collecting rnnoise.dll ===="
$dll = Get-ChildItem $build -Recurse -Filter "rnnoise.dll" | Select-Object -First 1
if (-not $dll) { Write-Host "[ERROR] rnnoise.dll not produced"; exit 1 }
Copy-Item $dll.FullName (Join-Path $WinOut "rnnoise.dll") -Force

Write-Host "==== Verifying exported symbols ===="
$dumpbin = Get-Command dumpbin -ErrorAction SilentlyContinue
if ($dumpbin) {
    $exports = & dumpbin /EXPORTS (Join-Path $WinOut "rnnoise.dll")
    foreach ($sym in @("rnnoise_create", "rnnoise_destroy", "rnnoise_process_frame", "rnnoise_get_frame_size")) {
        if ($exports -match $sym) { Write-Host "  [OK] exports $sym" }
        else { Write-Host "  [WARN] MISSING export: $sym" -ForegroundColor Yellow }
    }
} else {
    Write-Host "dumpbin not on PATH; verify exports manually."
}

Write-Host "`n[OK] rnnoise.dll written to $WinOut"
Write-Host "If any symbol is missing, noise suppression will auto-disable (non-fatal) — see noise_processor.py."
