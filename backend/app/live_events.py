"""
Lightweight event bus and SSE helpers for live/progressive transcription.

Phase 0: Standalone utility with per-call queues and a small ring buffer
to support reconnects. Used by an SSE endpoint to stream events to clients.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from typing import Any, AsyncGenerator, Deque, Dict, Optional


class TranscriptionEventBus:
    """Simple in-process pub/sub for per-call transcription events."""

    def __init__(self, buffer_size: int = 100):
        self._queues: Dict[str, asyncio.Queue] = {}
        self._buffers: Dict[str, Deque[Dict[str, Any]]] = {}
        self._buffer_size = buffer_size
        self._locks: Dict[str, asyncio.Lock] = {}
        self._logger = logging.getLogger('transcriptai.live_events')

    def _ensure(self, call_id: str) -> None:
        if call_id not in self._queues:
            self._queues[call_id] = asyncio.Queue()
            self._buffers[call_id] = deque(maxlen=self._buffer_size)
            self._locks[call_id] = asyncio.Lock()

    async def publish(self, call_id: str, event: Dict[str, Any]) -> None:
        """Publish an event for a call; also append to ring buffer."""
        self._ensure(call_id)
        # Copy to avoid mutation surprises
        data = dict(event)
        # Push to queue (non-blocking; await put)
        await self._queues[call_id].put(data)
        # Append to buffer
        async with self._locks[call_id]:
            self._buffers[call_id].append(data)
        # Debug log (avoid large payloads)
        etype = data.get("type") or "partial"
        clen = len(data.get("text", "")) if isinstance(data.get("text"), str) else 0
        self._logger.debug(f"publish[{call_id}] type={etype} chunk_index={data.get('chunk_index')} text_len={clen}")

    async def complete(self, call_id: str) -> None:
        """Publish a terminal completion event and cleanup soon after."""
        await self.publish(call_id, {"type": "complete"})
        self._logger.info(f"complete[{call_id}] emitted")

    def get_buffer(self, call_id: str) -> Deque[Dict[str, Any]]:
        self._ensure(call_id)
        return self._buffers[call_id]

    async def subscribe(self, call_id: str) -> AsyncGenerator[Dict[str, Any], None]:
        """Async generator yielding buffered events first, then live events."""
        self._ensure(call_id)
        self._logger.info(f"subscribe[{call_id}] opened")
        # Yield buffered events first (snapshot to avoid holding lock)
        async with self._locks[call_id]:
            snapshot = list(self._buffers[call_id])
        for evt in snapshot:
            yield evt
        # Then live events until complete
        queue = self._queues[call_id]
        while True:
            try:
                evt = await queue.get()
            except asyncio.CancelledError:
                self._logger.info(f"subscribe[{call_id}] cancelled")
                break
            yield evt
            if evt.get("type") == "complete":
                self._logger.info(f"subscribe[{call_id}] complete seen; closing")
                break


# Global bus instance
event_bus = TranscriptionEventBus(buffer_size=100)


def sse_format(event_type: Optional[str], data: Dict[str, Any]) -> str:
    """Format an SSE event with optional type and JSON data."""
    # Ensure JSON serializable
    payload = json.dumps(data, ensure_ascii=False)
    lines = []
    if event_type:
        lines.append(f"event: {event_type}")
    lines.append(f"data: {payload}")
    # End of message
    lines.append("")
    return "\n".join(lines) + "\n"
