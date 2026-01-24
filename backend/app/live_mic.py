"""
Mic-based live transcription session manager.

Implements a simple session lifecycle:
- start() -> session_id
- add_chunk(session_id, file_path) -> stores raw and converted wav chunk; returns chunk index
- partials(session_id) -> list of partial texts collected
- set_partial(session_id, idx, text)
- stop(session_id) -> finalize and return final text (concatenate partials)

Storage: per-session working directory under DATA_DIR/uploads/live_sessions/<session_id>
"""
from __future__ import annotations

import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from .config import settings


@dataclass
class LiveSession:
    session_id: str
    dir: Path
    chunks: List[Path] = field(default_factory=list)
    partials: List[str] = field(default_factory=list)


class LiveSessionManager:
    def __init__(self):
        base = Path(settings.upload_dir) / "live_sessions"
        base.mkdir(parents=True, exist_ok=True)
        self.base = base
        self.sessions: Dict[str, LiveSession] = {}

    def start(self) -> LiveSession:
        sid = str(uuid.uuid4())
        sdir = self.base / sid
        sdir.mkdir(parents=True, exist_ok=True)
        sess = LiveSession(session_id=sid, dir=sdir)
        self.sessions[sid] = sess
        return sess

    def get(self, session_id: str) -> Optional[LiveSession]:
        return self.sessions.get(session_id)

    def add_raw_chunk(self, session_id: str, raw_path: Path) -> int:
        sess = self.sessions.get(session_id)
        if not sess:
            raise KeyError("session_not_found")
        # Store raw under dir/chunks
        chunks_dir = sess.dir / "chunks"
        chunks_dir.mkdir(exist_ok=True)
        idx = len(sess.chunks)
        # Normalize extension to keep original name
        ext = raw_path.suffix or ".bin"
        dest = chunks_dir / f"chunk_{idx}{ext}"
        raw_path.replace(dest)
        sess.chunks.append(dest)
        # Ensure partials list has matching slot
        while len(sess.partials) < len(sess.chunks):
            sess.partials.append("")
        return idx

    def set_partial(self, session_id: str, idx: int, text: str) -> None:
        sess = self.sessions.get(session_id)
        if not sess:
            raise KeyError("session_not_found")
        while len(sess.partials) <= idx:
            sess.partials.append("")
        sess.partials[idx] = text or ""

    def stop(self, session_id: str) -> Dict[str, str]:
        sess = self.sessions.get(session_id)
        if not sess:
            raise KeyError("session_not_found")
        final_text = " ".join([p for p in sess.partials if p]).strip()
        # Clean up session to prevent data accumulation across recordings
        del self.sessions[session_id]
        return {"session_id": session_id, "final_text": final_text}


# Global manager
live_sessions = LiveSessionManager()

