---
Structure: Monorepo with FastAPI backend (`backend/app`), Vite React frontend (`frontend/src`), and Electron wrapper (`desktop/src`). Backend endpoints currently live in `backend/app/main.py`; new routers sit under `backend/app/api`. Frontend features belong in `frontend/src/features`. TODO: Replace this inferred map once `docs/docs__architecture__live-recording-longform.md` is restored.
Contracts: All IPC/HTTP payloads defined under `/schemas/*.json`; backend Pydantic models and frontend TS types auto-generated via `scripts/scaffold.ts` and must mark `extra='forbid'` / `as const` to lock structure.
Errors: Never throw across IPC boundaries; FastAPI handlers return `{"ok": false, "errorMessage": str}` on known failures and surface 5xx for unexpected conditions.
Logging: Use structured logger (`logging.getLogger('transcriptai.<area>')`) with `{event, msg, fields}` payloads; frontend mirrors via `console.info` with tagged objects.
Testing: Backend uses `pytest` (unit + pipeline), frontend relies on Vitest/Jest-style unit tests and Playwright for E2E smoke; deterministic waits only (polling, fake timers) and no `sleep`.
Naming: Files/directories kebab-case (`short-clip-fallback-panel.tsx`), React components PascalCase, functions camelCase, Python modules snake_case, JSON keys camelCase unless persisted in DB.
Boundaries: Forbid cross-layer imports (frontend cannot import backend modules); avoid circular dependencies by routing through service interfaces; contracts shared only via generated artifacts under `frontend/src/contracts` and `backend/app/contracts`.
---
