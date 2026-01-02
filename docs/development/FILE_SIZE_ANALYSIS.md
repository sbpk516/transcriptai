# File Size Showdown: Python vs C++

Switching to `whisper.cpp` will typically **REDUCE** your file size by 80-90%. Here is the math.

## Current Architecture (Python/MLX)
To make a standalone Mac app with Python, we are currently bundling:
1.  **Python Interpreter:** ~50 MB
2.  **PyTorch & Dependencies:** ~800 MB (Huge!)
3.  **MLX Libraries:** ~100 MB
4.  **FFmpeg:** ~80 MB

**Total Bundled Size:** ~1.1 GB (Before you even add models)

## Proposed Architecture (whisper.cpp)
Native C++ binaries do not need an interpreter or heavy libraries. They use what is already on the Mac.
1.  **whisper.cpp executable:** ~5 MB
2.  **FFmpeg (static):** ~80 MB
3.  **App Logic (Node/Electron):** ~150 MB

**Total Bundled Size:** ~235 MB

## What about the Models? (The hidden cost)
In both cases, you need the "Brain" files (weights).
*   **Base Model:** ~140 MB
*   **Small Model:** ~480 MB
*   **Large Model:** ~3 GB

**Strategy:**
*   **Goal:** Don't bundle *any* heavy models in the DMG.
*   **Action:** When a user first installs the app, it's tiny (~200MB). When they first hit "Transcribe", the app says "Downloading AI Brain..." and fetches the model then.
*   **Result:** A super small, fast-to-download installer.

## Verdict
**Migration will DECREASE your installer size from ~1GB+ to ~250MB.**
It is the only way to ship a professional Mac app without it being bloated.
