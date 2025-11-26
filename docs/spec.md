# Feature: Short Clip Transcription Resilience
Goal: Guarantee intelligible transcripts for sub-15s recordings by orchestrating a chunked fallback pipeline exposed via a focused UI control.

Scope:
- backend/app/api/short_clip_fallback_router.py: FastAPI router wiring `POST /api/v1/pipeline/short-clip` into orchestrator stubs.
- backend/app/pipeline_short_clip_fallback.py: Fallback coordinator that schedules chunked retries without bundling business logic.
- backend/app/contracts/short_clip_request.py: Pydantic models derived from schemas for request/response payloads.
- frontend/src/features/short-clip/ShortClipFallbackPanel.tsx: Thin UI shell that surfaces retry CTA and progress details.
- frontend/src/stores/shortClipFallbackStore.ts: State container mirroring backend job lifecycle with explicit status invariants.
- schemas/transcription-short-clip-request.schema.json & schemas/transcription-short-clip-response.schema.json: Shared contracts for retry entrypoint.

Interfaces:
- POST `/api/v1/pipeline/short-clip`: Accepts `schemas/transcription-short-clip-request.schema.json`, returns `schemas/transcription-short-clip-response.schema.json`. Backend enqueues work and echoes deterministic metadata for polling.
- SSE `live/short-clip/{clipId}` stream (piggybacks existing Live Events bus): Emits progress frames shaped by `schemas/transcription-short-clip-response.schema.json` with `status` transitions.
- `shortClipFallbackStore` state: `{ status: 'idle' | 'queued' | 'processing' | 'succeeded' | 'failed'; clipId: string | null; errorMessage?: string; lastUpdatedAt: string }` and must stay in sync with SSE payloads.

Non-Goals:
- Automatic clip segmentation heuristics (the orchestrator only wires TODOs).
- Language selection UI beyond existing forced-English behavior.
- Offline packaging changes; Electron bootstrap remains untouched pending validation.

Perf/Reliability:
- Fallback job acknowledgement < 300ms on warm backend; SSE heartbeat every ≤1s while processing.
- No silent failures: enqueue errors surface friendly message and `errorMessage` in store.
- Deterministic retries: identical request payload yields consistent `jobId` formatting and status ordering; no unhandled asyncio tasks.
- Backend contracts validated against JSON Schema with `extra='forbid'`; frontend types auto-derived to prevent drift.

Schemas:
- schemas/transcription-short-clip-request.schema.json
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://transcriptai.local/schemas/transcription-short-clip-request.schema.json",
  "title": "TranscriptionShortClipRequest",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "clipId",
    "sourcePath"
  ],
  "properties": {
    "clipId": {
      "type": "string",
      "format": "uuid",
      "description": "Identifier for the existing transcription job that produced an empty result."
    },
    "sourcePath": {
      "type": "string",
      "description": "Absolute path to the normalized audio file replayed by the fallback pipeline."
    },
    "forcedLanguage": {
      "type": "string",
      "description": "Optional ISO language code to override detection; defaults to existing desktop flag.",
      "minLength": 2,
      "maxLength": 5
    },
    "requestedBy": {
      "type": "string",
      "description": "Actor initiating the fallback (ui|api|automation).",
      "enum": [
        "ui",
        "api",
        "automation"
      ]
    }
  }
}
```
- schemas/transcription-short-clip-response.schema.json
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://transcriptai.local/schemas/transcription-short-clip-response.schema.json",
  "title": "TranscriptionShortClipResponse",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "ok",
    "jobId",
    "clipId",
    "status",
    "queuedAt"
  ],
  "properties": {
    "ok": {
      "type": "boolean",
      "description": "Indicates whether the request was accepted or the last chunk processed successfully."
    },
    "jobId": {
      "type": "string",
      "description": "Deterministic identifier for the fallback job (uuid-v4).",
      "format": "uuid"
    },
    "clipId": {
      "type": "string",
      "format": "uuid",
      "description": "Echoes the originating clip identifier."
    },
    "status": {
      "type": "string",
      "enum": [
        "queued",
        "processing",
        "succeeded",
        "failed"
      ],
      "description": "Current lifecycle state for the fallback attempt."
    },
    "queuedAt": {
      "type": "string",
      "format": "date-time",
      "description": "RFC 3339 timestamp of when the fallback job entered the queue."
    },
    "completedAt": {
      "type": "string",
      "format": "date-time",
      "description": "RFC 3339 timestamp captured once the fallback finishes."
    },
    "errorMessage": {
      "type": "string",
      "description": "Human-readable failure summary returned when status=failed."
    },
    "estimatedLatencyMs": {
      "type": "integer",
      "description": "Estimated processing latency communicated during queue acknowledgement."
    }
  }
}
```
