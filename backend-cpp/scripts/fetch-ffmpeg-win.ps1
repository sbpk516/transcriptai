# Download static ffmpeg.exe + ffprobe.exe for Windows into backend-cpp\win.
# These are bundled in the installer so the backend can shell out to ffmpeg
# without requiring the user to install it.
#
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File backend-cpp\scripts\fetch-ffmpeg-win.ps1

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$WinOut  = Join-Path $RootDir "backend-cpp\win"
$Tmp     = Join-Path $env:TEMP "transcriptai-ffmpeg"
New-Item -ItemType Directory -Force -Path $WinOut | Out-Null
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

# BtbN publishes static, redistributable Windows builds (GPL/LGPL).
$url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
$zip = Join-Path $Tmp "ffmpeg.zip"

Write-Host "==== Downloading static FFmpeg (win64) ===="
Write-Host "  $url"
Invoke-WebRequest -Uri $url -OutFile $zip

Write-Host "==== Extracting ===="
Expand-Archive -Path $zip -DestinationPath $Tmp -Force

foreach ($exe in @("ffmpeg.exe", "ffprobe.exe")) {
    $found = Get-ChildItem $Tmp -Recurse -Filter $exe | Select-Object -First 1
    if (-not $found) { Write-Host "[ERROR] $exe not found in archive"; exit 1 }
    Copy-Item $found.FullName (Join-Path $WinOut $exe) -Force
    Write-Host "  [OK] $exe -> $WinOut"
}

Write-Host "`n[OK] ffmpeg.exe + ffprobe.exe written to $WinOut"
Write-Host "Note: BtbN 'gpl' builds are GPL-licensed; use a 'lgpl' build if you need LGPL terms."
