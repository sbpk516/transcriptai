# Current System Architecture

This document maps the components of the existing **Python/MLX** version of TranscriptAI.

## High-Level Architecture

```mermaid
graph TD
    User((User))
    
    subgraph "desktop (Electron Host)"
        Main[Electron Main Process]
        Renderer[React UI Window]
        DictationMgr[Dictation Manager]
        KeyServer[Mac Key Server (Sidecar)]
        Indicator[Indicator Window (Overlay)]
        Update[Update Checker]
        
        Main -->|Spawns| PyProcess
        Main -->|Spawns| KeyServer
        Main -->|Manages| Indicator
        
        Renderer <-->|IPC| Main
        Renderer <-->|HTTP| PyProcess
        
        DictationMgr -->|Events| Main
        KeyServer -->|Global Hotkeys| DictationMgr
    end

    subgraph "backend (Python Runtime)"
        PyProcess[FastAPI Server]
        
        subgraph "Core Processors"
            W[Whisper Processor]
            note[Uses PyTorch + OpenAI Whisper<br/>(MLX dependencies exist but code uses Torch)]
            NLP[NLP Processor]
            LiveMic[Live Mic Session]
        end
        
        subgraph "Data Layer"
            DB[(SQLite)]
            FS[Audio Files]
            Cache[HuggingFace Cache]
        end
        
        PyProcess -->|Transcribes| W
        W --- note
        PyProcess -->|Analyzes| NLP
        PyProcess -->|Records| LiveMic
        PyProcess -->|Reads/Writes| DB
        PyProcess -->|Saves| FS
    end

    User -->|Interacts| Renderer
    User -->|Presses Hotkey| KeyServer
    User -->|Sees Overlay| Indicator
```

## End-to-End Flows

### 1. App Launch
1.  User clicks App Icon.
2.  **Electron Main** starts. Checks for updates (`Update Checker`).
3.  **Electron Main** spawns **Python Backend** (hidden subprocess).
    *   Dev: `uvicorn app.main:app`
    *   Prod: `transcriptai-backend` (compiled binary)
4.  **Electron Main** waits for `http://127.0.0.1:port/health` to return 200 OK.
5.  **Electron Main** spawns **Mac Key Server** (for global hotkeys).
6.  **Electron Main** creates **React Window**.
7.  React App loads and performs its own handshake with the Backend.

### 2. Live Recording (In-App)
1.  User clicks "Record" in React UI.
2.  React uses **Web Audio API** (`navigator.mediaDevices.getUserMedia`) to capture audio.
3.  Audio chunks are sent via HTTP POST to Python Backend (`/upload`).
4.  Python saves chunks to `audio_uploads`.
5.  **Whisper Processor** transcribes chunks in background using **PyTorch** (MPS on Mac).
6.  Updates are polled by or pushed to React.

### 3. Push-to-Talk (Dictation)
1.  User holds Global Hotkey (e.g., F1).
2.  **Mac Key Server** detects key down (even if app is backgrounded).
3.  Sends signal to **Dictation Manager** (Electron).
4.  Electron shows **Indicator Window** (Overlay) near cursor.
5.  Electron tells Python start recording (or captures mic and streams to Python).
6.  User releases key.
7.  Python finalizes transcription using **PyTorch**.
8.  Electron uses accessibility APIs to **type text** into the active application.

### 4. File Upload
1.  User drags file into React UI.
2.  React uploads file to Python (`/api/v1/upload`).
3.  Python saves to `data_dir`.
4.  Python adds job to Queue.
5.  **Whisper Processor** picks up job, transcribes.
6.  **NLP Processor** analyzes text (Sentiment/Risks).
7.  Results saved to SQLite.
