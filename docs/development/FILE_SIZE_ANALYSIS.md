# File Size Analysis: Streamlined Architecture

By removing the massive **MLX** and **PyTorch** dependencies, we have reduced the backend bundle size by ~80%.

## Lite Architecture (Current)
To make a standalone Mac app, we are currently bundling:
1.  **Python Interpreter:** ~50 MB
2.  **Core Dependencies (uvicorn, socketio, etc.):** ~100 MB
3.  **FFmpeg:** ~80 MB

**Total Bundled Size:** ~230 MB (Before adding models)

## Previous Architecture (Python/MLX) - REMOVED
Previously, the app included:
1.  **PyTorch & Dependencies:** ~800 MB
2.  **MLX Libraries:** ~100 MB
3.  **Total Bundled Size:** ~1.1 GB

## What about the Models? (The hidden cost)
In both cases, we need the "Brain" files (weights).
*   **Base Model:** ~140 MB
*   **Small Model:** ~480 MB
*   **Large Model:** ~3 GB

**Strategy:**
*   **Goal:** Don't bundle any heavy models in the DMG.
*   **Action:** When a user first installs the app, it's tiny (~230MB). When they first hit "Transcribe", the app says "Downloading AI Brain..." and fetches the model then.
*   **Result:** A super small, fast-to-download installer.

## Verdict
**The migration to the Lite architecture successfully DECREASED the installer size from ~1GB+ to ~230MB.**
This ensures a professional, fast, and lightweight experience for all users.
