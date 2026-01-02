# Proposed Architecture: Hybrid Engine (`whisper.cpp` + Python)

This architecture introduces `whisper.cpp` as a specialized high-performance inference engine, while retaining the Python backend for NLP and business logic.

## High-Level Architecture

```mermaid
graph TD
    User((User))
    
    subgraph "desktop (Electron Host)"
        Main[Electron Main Process]
        Renderer[React UI Window]
        KeyServer[Mac Key Server]
        
        Main -->|Spawns| PyProcess
        Main -->|Spawns| CppServer
        Main -->|Spawns| KeyServer
        
        Renderer <-->|HTTP| PyProcess
    end

    subgraph "Inference Engine (C++)"
        CppServer["whisper-server (C++)"]
        Model[GGML Model (bin)]
        
        CppServer -->|Loads| Model
    end

    subgraph "backend (Python Runtime)"
        PyProcess[FastAPI Server]
        
        subgraph "Logic Layer"
            Orch[Orchestrator]
            NLP[NLP Processor]
            LiveMic[Live Mic Session]
            YT[YouTube Logic]
        end
        
        subgraph "Data Layer"
            DB[(SQLite)]
            FS[Audio Files]
        end
        
        PyProcess -->|1. Send Audio| CppServer
        CppServer -->|2. Return Text| PyProcess
        PyProcess -->|3. Analyze| NLP
        PyProcess -->|4. Save| DB
        
        YT -->|Fast Path: Fetch Text| Internet((YouTube))
        YT -->|Slow Path: Download Audio| FS
        YT -.->|Fallback| CppServer
    end
    
    User <-->|Interacts| Renderer
```

## Key Changes

### 1. The "Engine Swap"
*   **Removed:** The internal `WhisperProcessor` (Python/PyTorch) is removed.
*   **Added:** A standalone `whisper-server` binary (compiled from `whisper.cpp`).
*   **Benefit:** The "backend" no longer needs PyTorch (~700MB). It only needs lightweight libraries (`fastapi`, `numpy`, `nltk`).

### 2. Communication Flow
*   **Old:** Python -> Function Call -> PyTorch -> GPU.
*   **New:** Python -> HTTP Request (localhost:8080) -> C++ Server -> Metal/GPU.

### 3. File Size Impact
*   **Before:** ~1.1 GB (Python + PyTorch + CUDA/MPS libs)
*   **After:** ~300 MB (Python + C++ Binary + NLTK)
    *   *Note:* Python is still kept for NLP (Sentiment/Keywords), but it is much smaller without machine learning libraries.

## New System Components

| Component | Responsibility | Status |
| :--- | :--- | :--- |
| **Electron Main** | Process Manager. Now spawns *three* processes: Backend, KeyServer, and WhisperServer. | **Modified** |
| **Python Backend** | Coordinator. Receives upload, sends to C++, gets text, runs NLP, saves to DB. | **Modified** (Stripped of Torch) |
| **Whisper Server** | Pure Inference. Loads model once, handles audio-to-text. High speed, low memory. | **NEW** (C++) |
| **NLP Processor** | Sentiment, Risk, Keywords. Keeps existing logic. | **Unchanged** |
| **YouTube Logic** | Dual Strategy: 1. Try `youtube-transcript-api`. 2. Fallback to `yt-dlp` + Whisper. | **NEW** (Python) |
