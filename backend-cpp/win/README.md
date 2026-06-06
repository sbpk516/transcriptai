# Windows native binaries

This directory holds the Windows native binaries used by the backend and Electron
shell (mac equivalents live in `backend-cpp/mac/`).

| File | Committed? | Source / how to (re)build |
|------|-----------|---------------------------|
| `whisper-server.exe` | ✅ yes (small) | whisper.cpp release (CPU) or `scripts/build-whisper-win.ps1` |
| `whisper.dll`, `ggml*.dll` | ✅ yes (small) | whisper.cpp release (CPU) or `scripts/build-whisper-win.ps1` |
| `ffmpeg.exe`, `ffprobe.exe` | ❌ no — **gitignored** (~200 MB each) | `scripts/fetch-ffmpeg-win.ps1` (downloads a static build) |
| `rnnoise.dll` | optional | `scripts/build-rnnoise-win.ps1` (noise suppression; auto-disabled if absent) |

After a fresh clone on Windows, run `backend-cpp/scripts/fetch-ffmpeg-win.ps1`
to populate `ffmpeg.exe`/`ffprobe.exe` before packaging or running live/upload
transcription. The committed whisper binaries are the prebuilt CPU build; for a
GPU build (CUDA/Vulkan) rebuild from source via `scripts/build-whisper-win.ps1`.

`whisper-server.exe` must accept the flags the Electron shell passes
(`-m`, `--port`, `-t`, `--vad`, `--vad-model`, `--vad-threshold`) — see
`desktop/src/main.js`. `rnnoise.dll` must export the C symbols bound via ctypes in
`backend/app/noise_processor.py` (`rnnoise_create`, `rnnoise_destroy`,
`rnnoise_process_frame`, `rnnoise_get_frame_size`).
