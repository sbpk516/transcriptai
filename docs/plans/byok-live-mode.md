# BYOK + Live Mode — Plan

Live transcription with parallel plain-English rephrasing, gated behind a Bring-Your-Own-Key model so the feature is shippable.

## The three phases

| Phase | Ships | Independently useful? |
|---|---|---|
| 1. **BYOK foundation** | Settings UI for API keys (Claude, OpenAI, Gemini, Grok, Kimi, NVIDIA, DeepSeek). Keychain storage. Provider abstraction via Vercel AI SDK. Test button per provider. | Yes — sets up any future LLM feature. |
| 2. **Live transcription** | Chunked recording (1–2 s slices). New "Live Mode" window with a single text pane that fills in as the user speaks. No LLM yet. | Yes — live captions for meetings/notes. |
| 3. **Parallel rephrasing** | Second pane in Live Mode showing the plain-English version. LLM call per chunk via the BYOK adapter from Phase 1. | Final vision. |

Each phase is shippable on its own. Phase 2 and Phase 3 build on Phase 1.

---

# Phase 1 — BYOK API key foundation

## Goal

Let the user store API keys for multiple LLM providers, keep the keys safe, and call any provider through one uniform code path. No UI for using the LLM yet — that arrives in Phase 3.

## Non-goals (deferred)

- Streaming transcription (Phase 2)
- Live Mode window (Phase 2)
- Rephrasing UI (Phase 3)
- Provider auto-discovery / model picker (do later if needed)

## Providers in scope

| Provider | API format | Vercel AI SDK adapter |
|---|---|---|
| Anthropic (Claude) | native | `@ai-sdk/anthropic` |
| OpenAI | native | `@ai-sdk/openai` |
| Google Gemini | native + OpenAI-compat | `@ai-sdk/google` |
| xAI (Grok) | OpenAI-compat | `@ai-sdk/openai` w/ custom baseURL |
| Moonshot (Kimi) | OpenAI-compat | `@ai-sdk/openai` w/ custom baseURL |
| NVIDIA NIM | OpenAI-compat | `@ai-sdk/openai` w/ custom baseURL |
| DeepSeek | OpenAI-compat | `@ai-sdk/openai` w/ custom baseURL |

Two formats handled in code: Anthropic native + OpenAI-compatible (used by 6 providers via different `baseURL`).

## Architecture

```
┌─────────────────────────────┐
│  Renderer (React)           │
│  Settings page → calls IPC  │
└──────────────┬──────────────┘
               │ contextBridge / preload
               ▼
┌─────────────────────────────┐
│  Main process (Node)        │
│  ├── byok-store.js          │  Keychain read/write
│  ├── llm-router.js          │  Vercel AI SDK adapters
│  └── IPC handlers           │
└──────────────┬──────────────┘
               │ HTTPS
               ▼
        Provider APIs
```

**Key decision: keys never leave the main process.** Renderer asks main process to make completions via IPC. Renderer never sees the raw key. This matches the existing dictation IPC pattern.

## Storage decision: Electron `safeStorage`

- Built into Electron — no native dep, no extra package
- On macOS, encrypts via Keychain under the hood
- API: `safeStorage.encryptString(plaintext) → Buffer`, `safeStorage.decryptString(buffer) → string`
- Persist the encrypted blob to a JSON file in `app.getPath('userData')`
- File: `userData/byok-keys.json` with shape `{ "anthropic": "<base64-encrypted>", "openai": "<base64>", ... }`

Rejected alternatives:
- `keytar` — native dependency, build pain on Apple Silicon, deprecated upstream
- Plain JSON file — keys at rest unencrypted, unacceptable
- macOS `security` CLI — works but slower (subprocess per op) and not cross-platform

## File-level tasks

### New files

| File | Purpose |
|---|---|
| `desktop/src/main/byok-store.js` | Read/write encrypted keys via `safeStorage`. Pure logic, testable. |
| `desktop/src/main/llm-router.js` | Provider registry + `complete(provider, messages, options)` using Vercel AI SDK. Returns text or async iterator (stream). |
| `frontend/src/pages/SettingsByok.tsx` | New section component, mounted inside existing `Settings.tsx`. |
| `frontend/src/types/byok.ts` | Shared types (`ProviderId`, `ProviderStatus`, `LlmCompleteRequest`, `LlmCompleteResult`). |

### Modified files

| File | Change |
|---|---|
| `desktop/src/main.js` | Register IPC handlers: `byok:list`, `byok:set-key`, `byok:delete-key`, `byok:test-key`, `llm:complete`. |
| `desktop/src/preload.js` | Expose `transcriptaiByok` and `transcriptaiLlm` APIs via `contextBridge`. |
| `frontend/src/pages/Settings.tsx` | Render `<SettingsByok />` section. |
| `desktop/package.json` | Add deps: `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`. (Other providers reuse `@ai-sdk/openai` with `baseURL`.) |

## IPC contract

All over `ipcRenderer.invoke` (request/response).

```ts
// byok:list → ProviderStatus[]
type ProviderId = 'anthropic' | 'openai' | 'google' | 'xai' | 'kimi' | 'nvidia' | 'deepseek'
type ProviderStatus = {
  id: ProviderId
  label: string             // "Anthropic (Claude)"
  hasKey: boolean           // never returns the key itself
  lastTestedAt?: number     // unix ms
  lastTestResult?: 'ok' | 'invalid' | 'network_error'
}

// byok:set-key (id, key) → { ok: boolean, error?: string }
// byok:delete-key (id)   → { ok: boolean }
// byok:test-key (id)     → { ok: boolean, error?: string, latencyMs?: number }

// llm:complete (request) → { ok: boolean, text?: string, error?: string }
type LlmCompleteRequest = {
  provider: ProviderId
  model?: string            // optional override; default per-provider
  messages: { role: 'user' | 'assistant' | 'system', content: string }[]
  maxTokens?: number
  temperature?: number
}
```

Streaming variant (`llm:complete-stream`) deferred until Phase 3 — not needed in Phase 1.

## Settings UI (rough)

```
┌─────────────────────────────────────────────────┐
│  API Keys                                        │
│  Used by Live Mode and other AI features.        │
│  Keys are encrypted via macOS Keychain.          │
├─────────────────────────────────────────────────┤
│  Anthropic (Claude)         [✓ saved · valid]    │
│  ●●●●●●●●●●●●●●●●●●●  [Edit] [Test] [Remove]    │
│                                                  │
│  OpenAI                     [— not set]          │
│  [paste key here]    [Save] [Test]               │
│                                                  │
│  Google Gemini              [✓ saved · invalid]  │
│  ●●●●●●●●●●●●●●●●●●●  [Edit] [Test] [Remove]    │
│  ...                                             │
└─────────────────────────────────────────────────┘
```

- Key input: type `password`, masked
- Status pill: not set / saved / saved · valid / saved · invalid / saved · network error
- "Test" button calls `llm:complete` with a 5-token prompt and reports latency

## Default models per provider

For Phase 1's test call (and as default for Phase 3):

| Provider | Default model |
|---|---|
| anthropic | claude-haiku-4-5 |
| openai | gpt-4o-mini |
| google | gemini-2.0-flash |
| xai | grok-2-mini |
| kimi | moonshot-v1-8k |
| nvidia | meta/llama-3.1-8b-instruct |
| deepseek | deepseek-chat |

Models hardcoded as defaults in Phase 1; user-selectable picker is a Phase 3+ enhancement.

## Testing plan

- **Unit:** `byok-store.test.js` — encrypt/decrypt round-trip, missing key handling, corrupted file recovery
- **Unit:** `llm-router.test.js` — provider routing (mock fetch), error mapping
- **Manual:** for each provider, paste a real key, hit Test, expect green tick. Use a key with insufficient permissions to verify the error path.
- **Manual:** quit and relaunch app, verify keys persist and decrypt
- **Manual:** delete `userData/byok-keys.json`, verify graceful empty state

## Risks and tradeoffs

| Risk | Mitigation |
|---|---|
| `safeStorage` returns `isEncryptionAvailable() === false` on a misconfigured Mac | Fall back to plaintext + show warning banner ("keys stored unencrypted"), or refuse to save. Pick refuse for Phase 1. |
| User pastes wrong-format key | Test button catches via real API call; provider-specific format pre-validation is over-engineering |
| Vercel AI SDK breaking change | Pin major version in `package.json` |
| API key leak via crash logs | Never log keys; `byok-store` only logs key IDs, never values |
| Renderer compromised → exfiltrates keys | Mitigated by keys living in main process; renderer can only request completions |

## Acceptance criteria

- [ ] User can paste a key for any of the 7 providers in Settings
- [ ] Keys persist across app restarts
- [ ] Keys are encrypted at rest (verify by inspecting `byok-keys.json`)
- [ ] Test button reports green/red within 10 s
- [ ] No raw key ever appears in renderer logs, main-process logs, or IPC payloads from main → renderer
- [ ] Removing a key actually deletes it from disk
- [ ] App still launches and runs normally if `byok-keys.json` is missing or corrupted

## Estimated effort

Roughly 4–6 hours of focused work:
- Main-process plumbing (byok-store + llm-router + IPC): ~2 h
- Settings UI: ~1.5 h
- Wiring + manual testing across 7 providers: ~1.5 h
- Polish + tests: ~1 h

---

# Phase 2 — Live transcription (stub)

To be detailed when Phase 1 is complete. High-level:

- Switch dictation `MediaRecorder` to use a `timeslice` (≈ 1 000 ms) so chunks arrive while recording
- New backend endpoint `/api/v1/dictation/transcribe-chunk` that accepts an audio chunk + sessionId and returns the latest cumulative transcript
- New "Live Mode" window — separate React route, single text area that updates as chunks return
- Hotkey (separate from press-and-hold) to toggle Live Mode, e.g. `Cmd+Shift+Option+L`
- Press-and-hold dictation stays untouched

Open questions for Phase 2:
- Per-chunk transcription vs. rolling-buffer transcription (latter has better word-boundary accuracy)
- Whisper-server vs. OpenAI Whisper API for live (latency tradeoff)
- Transcript edit / dismiss / save flows

# Phase 3 — Parallel rephrasing (stub)

To be detailed when Phase 2 is complete. High-level:

- For each transcribed chunk (or buffered N seconds), call the user's selected LLM via Phase 1's `llm:complete` (streaming variant)
- Two-pane Live Mode UI: raw transcript left, plain-English right
- Configurable rephrase prompt per user
- Throttling so we don't fire one LLM call per word — debounce, send when transcript stabilizes for ≈ 800 ms

Open questions for Phase 3:
- Single-pass rephrase vs. running edit-in-place
- How to preserve sentence boundaries when chunks arrive mid-sentence
- Cost guardrails — show running token usage in the UI
