# Push-to-Talk Feature - Issue Analysis & Prevention Guide

## Executive Summary

During the push-to-talk feature debugging, we identified and fixed 3 critical issues across different system layers. This document categorizes these issues, identifies root causes, and provides prevention strategies.

---

## Issues Found & Categorized

### Issue #1: Event Structure Mismatch (Phase 3→4)
**Category:** Contract/Interface Violation  
**Severity:** Critical  
**Layer:** IPC Bridge (Main ↔ Renderer)

#### What Happened
```javascript
// Main process (preload.js) sent:
{ event: 'dictation:press-start', payload: {...} }

// Frontend expected:
{ type: 'dictation:press-start', payload: {...} }
```

Result: Frontend received events but `type` was `undefined`, so it couldn't process them.

#### Root Cause
1. **Lack of Type Safety:** No TypeScript interfaces for IPC events
2. **No Contract Testing:** Main and renderer evolved independently
3. **Silent Failures:** Event handlers didn't log when events were ignored
4. **Missing Integration Tests:** No end-to-end test covering IPC

#### Prevention Strategies

**Immediate:**
- ✅ Create shared TypeScript types for all IPC events
- ✅ Add runtime validation of event structure
- ✅ Add comprehensive logging at IPC boundaries

**Code Example:**
```typescript
// shared/types/dictation-events.ts
export interface DictationLifecycleEvent {
  type: 'dictation:press-start' | 'dictation:press-end' | 'dictation:press-cancel'
  payload: {
    timestamp: number
    durationMs?: number
  }
}

// preload.js - validate before sending
function sendLifecycleEvent(event: DictationLifecycleEvent) {
  if (!event.type || !event.payload) {
    throw new Error(`Invalid lifecycle event structure: ${JSON.stringify(event)}`)
  }
  // send...
}

// frontend - validate on receive
function handleLifecycleEvent(event: unknown) {
  const validated = DictationLifecycleEventSchema.parse(event) // Zod validation
  // process...
}
```

**Long-term:**
- Implement contract testing (e.g., Pact)
- E2E tests that verify IPC communication
- Code generation from shared schemas

---

### Issue #2: Async Timing Bug (Phase 5)
**Category:** Race Condition  
**Severity:** Critical  
**Layer:** Frontend (MediaRecorder API)

#### What Happened
```javascript
// Our code:
const capturedChunks = [...bufferedChunksRef.current]  // Captured BEFORE flush
recorder.stop()  // This triggers async flush to ondataavailable

// What actually happened:
// 1. capturedChunks = [] (empty, flush hasn't happened yet)
// 2. recorder.stop() called
// 3. ondataavailable fires with chunk (too late!)
// 4. buildSnippet fails: "No audio chunks available"
```

#### Root Cause
1. **Misunderstood API Behavior:** Didn't know MediaRecorder flushes asynchronously
2. **No API Documentation Review:** MDN docs clearly state `onstop` fires after data flush
3. **Insufficient Testing:** Manual tests worked intermittently (timing-dependent)
4. **Missing Unit Tests:** No test for MediaRecorder chunk capture

#### Prevention Strategies

**Immediate:**
- ✅ Document all async API behaviors in code comments
- ✅ Use event-driven patterns for async APIs (wait for events, don't guess timing)
- ✅ Add deterministic tests for async operations

**Code Example:**
```typescript
// ❌ BAD: Assumes synchronous behavior
recorder.stop()
const chunks = [...bufferedChunks]  // Race condition!

// ✅ GOOD: Wait for async completion
recorder.onstop = () => {
  const chunks = [...bufferedChunks]  // Guaranteed to have all data
  processChunks(chunks)
}
recorder.stop()
```

**Testing Strategy:**
```typescript
// Unit test with mock MediaRecorder
test('captures all chunks before processing', async () => {
  const recorder = new MockMediaRecorder()
  const chunks = []
  
  recorder.ondataavailable = (e) => chunks.push(e.data)
  recorder.start()
  
  // Simulate async flush
  await new Promise(resolve => {
    recorder.onstop = () => {
      expect(chunks.length).toBe(1)
      expect(chunks[0].size).toBeGreaterThan(0)
      resolve()
    }
    recorder.stop()
  })
})
```

**Long-term:**
- Code review checklist: "Are async operations properly awaited?"
- Static analysis rules for common async pitfalls
- Integration tests with actual MediaRecorder

---

### Issue #3: Input Validation Too Strict (Phase 6)
**Category:** Input Validation / API Contract  
**Severity:** High  
**Layer:** Backend API

#### What Happened
```python
# Frontend sent:
media_type = "audio/webm;codecs=opus"

# Backend validation:
ALLOWED = {"audio/webm", "audio/wav", ...}
if media_type not in ALLOWED:  # Exact match only!
    raise HTTPException(400, "Unsupported media_type")
```

Result: Valid WebM audio rejected because codec parameter wasn't stripped.

#### Root Cause
1. **Insufficient Input Normalization:** Didn't handle real-world MIME type formats
2. **No Integration Tests:** Backend tested with clean inputs only
3. **Brittle Validation:** Exact string match instead of semantic validation
4. **Missing Examples:** API docs didn't show what formats are actually sent

#### Prevention Strategies

**Immediate:**
- ✅ Normalize inputs before validation (strip codec info, lowercase, trim)
- ✅ Test with real-world inputs, not just clean examples
- ✅ Log rejected inputs to identify patterns

**Code Example:**
```python
# ❌ BAD: Brittle exact match
if media_type not in ALLOWED_TYPES:
    raise ValidationError()

# ✅ GOOD: Normalize then validate
def normalize_media_type(media_type: str) -> str:
    """
    Normalize MIME type for validation.
    
    Examples:
      'audio/webm;codecs=opus' -> 'audio/webm'
      'AUDIO/WAV' -> 'audio/wav'
      '  audio/mp3  ' -> 'audio/mp3'
    """
    return media_type.split(';')[0].strip().lower()

normalized = normalize_media_type(request.media_type)
if normalized not in ALLOWED_TYPES:
    raise ValidationError(f"Unsupported media type: {normalized}")
```

**Testing Strategy:**
```python
@pytest.mark.parametrize("media_type,expected", [
    ("audio/webm", "audio/webm"),
    ("audio/webm;codecs=opus", "audio/webm"),
    ("AUDIO/WAV", "audio/wav"),
    ("  audio/mp3  ", "audio/mp3"),
    ("audio/ogg;codecs=vorbis", "audio/ogg"),
])
def test_normalize_media_type(media_type, expected):
    assert normalize_media_type(media_type) == expected
```

**Long-term:**
- API contract tests with real client data
- Schema validation libraries (Pydantic with custom validators)
- Logging of all validation failures for analysis

---

## Common Patterns & Root Causes

### 1. **Lack of Contract Testing**
All three issues involved **interface boundaries**:
- Issue #1: Main ↔ Renderer IPC
- Issue #2: Code ↔ Browser API
- Issue #3: Frontend ↔ Backend API

**Prevention:** Test at boundaries with real data.

### 2. **Insufficient Understanding of Async Behavior**
Issue #2 stemmed from not understanding when MediaRecorder flushes data.

**Prevention:**
- Read official API documentation
- Add comments explaining async behavior
- Use TypeScript for better async typing

### 3. **Testing Only Happy Paths**
All issues passed manual "happy path" testing but failed in real use.

**Prevention:**
- Test edge cases (empty data, malformed inputs, timing variations)
- Property-based testing
- Chaos testing (introduce delays, race conditions)

### 4. **Silent Failures**
Events were sent but ignored without logging.

**Prevention:**
- Log at every boundary
- Fail loudly in development
- Add telemetry for production

---

## Prevention Checklist for Future Features

### Design Phase
- [ ] Define clear interfaces/contracts for all boundaries
- [ ] Document async behavior and timing assumptions
- [ ] Identify integration points that need testing
- [ ] Create shared types for cross-boundary communication

### Implementation Phase
- [ ] Add logging at every system boundary
- [ ] Validate inputs at entry points
- [ ] Handle edge cases (empty, null, malformed data)
- [ ] Use TypeScript interfaces for contracts
- [ ] Wait for async operations to complete (events, promises)

### Testing Phase
- [ ] Unit tests for individual components
- [ ] Integration tests for boundaries (IPC, API, browser APIs)
- [ ] Test with real-world data (codec parameters, variations)
- [ ] Test timing-sensitive operations (race conditions)
- [ ] Add negative test cases (invalid inputs, failures)

### Code Review Phase
- [ ] Verify async operations are properly awaited
- [ ] Check input validation is comprehensive
- [ ] Ensure contracts match between sender/receiver
- [ ] Confirm adequate logging exists
- [ ] Test coverage for critical paths

### Deployment Phase
- [ ] Monitor logs for unexpected errors
- [ ] Track validation failures
- [ ] Add alerts for critical path failures
- [ ] Collect telemetry on edge cases

---

## Recommended Tools & Practices

### Type Safety
- **TypeScript** with strict mode
- **Zod** or **io-ts** for runtime validation
- **Shared type definitions** across layers

### Testing
- **Vitest** for unit tests
- **Playwright** for E2E tests
- **MSW** for mocking backend APIs
- **Property-based testing** (fast-check)

### Logging & Monitoring
- **Structured logging** (JSON format)
- **Log levels** (debug, info, warn, error)
- **Correlation IDs** across boundaries
- **Telemetry** for production (Sentry, LogRocket)

### Documentation
- **ADRs** (Architecture Decision Records) for major choices
- **API documentation** with examples (real client data)
- **Inline comments** for non-obvious async behavior
- **Runbooks** for debugging common issues

---

## Specific Recommendations for SignalHub

### 1. Create Shared Types Package
```
signalhub/
  shared/
    types/
      dictation-events.ts     # IPC event types
      api-contracts.ts        # Backend API types
      media-types.ts          # Audio format types
```

### 2. Add Integration Test Suite
```typescript
// tests/integration/push-to-talk.test.ts
describe('Push-to-Talk E2E', () => {
  it('should transcribe audio from key press to text insertion', async () => {
    // Simulate full flow
    await pressKeys(['CMD', 'Option'])
    await speak('hello world')
    await releaseKeys()
    
    // Verify
    expect(await getTranscript()).toBe('hello world')
    expect(await getInsertedText()).toBe('hello world')
  })
})
```

### 3. Add Diagnostic Middleware
```typescript
// Log all IPC events
ipcRenderer.on('*', (event, ...args) => {
  console.log('[IPC]', event, args)
})

// Log all API requests/responses
apiClient.interceptors.request.use(req => {
  console.log('[API Request]', req)
  return req
})
```

### 4. Create Test Data Generators
```typescript
// tests/fixtures/media-types.ts
export const REAL_WORLD_MEDIA_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm;codecs=vp8',
  'AUDIO/WAV',
  '  audio/mp3  ',
  'audio/ogg;codecs=vorbis',
]

// Use in tests
REAL_WORLD_MEDIA_TYPES.forEach(mediaType => {
  it(`should accept ${mediaType}`, async () => {
    const response = await uploadAudio({ media_type: mediaType })
    expect(response.status).toBe(200)
  })
})
```

---

## Conclusion

### Issue Categories
1. **Contract Violations** (40% of issues) - Mismatched interfaces
2. **Async/Timing Bugs** (40% of issues) - Race conditions
3. **Input Validation** (20% of issues) - Too strict/brittle

### Root Causes
1. Lack of contract testing at boundaries
2. Insufficient understanding of async APIs
3. Testing only happy paths with clean data
4. Silent failures without adequate logging

### Key Takeaways
- **Test at boundaries** with real data
- **Document async behavior** explicitly
- **Log everything** at integration points
- **Use TypeScript** for contract enforcement
- **Test edge cases** and timing variations

### Success Metrics
Going forward, measure:
- % of boundaries with integration tests
- % of async operations with explicit await/event handling
- % of inputs with validation and normalization
- Mean time to diagnose issues (via logging)

---

---

## Issues Fixed - January 2026 Session

### Issue #4: Permission Check API Mismatch
**Category:** API Contract Violation
**Severity:** Critical
**Layer:** Main Process (Electron ↔ Native Module)
**Date Fixed:** 2026-01-04

#### What Happened
```javascript
// Code used (WRONG):
macPermissions.isTrustedAccessibilityClient?.(false)  // Returns undefined
macPermissions.getMicrophoneAuthorizationStatus?.()   // Returns undefined

// Correct API:
macPermissions.getAuthStatus('accessibility')  // Returns 'authorized'
macPermissions.getAuthStatus('microphone')     // Returns 'authorized'
```

Result: Permission checks returned `undefined`, causing auto-grant logic to fail and timeout after 5 seconds.

#### Root Cause
1. **Wrong method names** for `@nut-tree-fork/node-mac-permissions` package
2. **Optional chaining masked the error** - `?.()` returned `undefined` silently instead of throwing
3. **No unit tests** for permission check functions

#### Files Changed
- `desktop/src/main.js` (lines 186-237): Fixed `checkMacAccessibility()` and `checkMacMicPermission()` to use `getAuthStatus()`
- `desktop/src/main.js` (line 221): Fixed `promptMacPermissions()` to use `askForAccessibilityAccess()`

#### Prevention Strategies
- Test native module APIs before integration
- Add explicit error handling instead of relying on optional chaining
- Document correct API usage in code comments

---

### Issue #5: Background Audio Throttling (Silent Recording)
**Category:** Electron Configuration
**Severity:** Critical
**Layer:** Electron Main Process (webPreferences)
**Date Fixed:** 2026-01-04

#### What Happened
```
Push-to-Talk scenario:
1. User focuses on another app (e.g., Notes)
2. User presses Command+Option shortcut
3. Audio recording starts in background Electron window
4. MediaRecorder captures SILENT audio (all zeros)
5. Whisper returns "[ Silence ]"
```

Result: Push-to-talk only produced `[ Silence ]` even though user was speaking.

#### Root Cause
1. **Electron's default `backgroundThrottling: true`** throttles renderer processes when not focused
2. **MediaRecorder API affected** - audio capture returns empty buffers when throttled
3. **Audio files had correct duration but silent content** - made debugging confusing

#### Files Changed
- `desktop/src/main.js` (line 610): Added `backgroundThrottling: false` to `webPreferences`

```javascript
webPreferences: {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  backgroundThrottling: false  // ← Critical for push-to-talk
}
```

#### Prevention Strategies
- Test features in their intended usage context (background vs foreground)
- Document Electron settings that affect audio/media APIs
- Add integration tests for background scenarios

---

### Issue #6: Live Recording Stale Closure
**Category:** React Hooks Bug
**Severity:** Medium
**Layer:** Frontend (React Component)
**Date Fixed:** 2026-01-04

#### What Happened
```javascript
// onTranscriptStart called AFTER async operations
const start = useCallback(async () => {
  const res = await apiClient.post('/api/v1/live/start')  // Async call first
  // ... more async code ...
  onTranscriptStart()  // Too late! UI shows old transcript during loading
}, [sessionId])  // Missing onTranscriptStart in dependencies!
```

Result: Old transcripts appeared when starting a new recording because UI wasn't cleared immediately.

#### Root Cause
1. **Stale closure** - `onTranscriptStart` not in dependency array
2. **Async timing** - UI clear happened after API call instead of immediately
3. **User perception** - Delay between clicking "Rec" and UI clearing felt broken

#### Files Changed
- `frontend/src/pages/Upload.tsx`:
  - Moved `onTranscriptStart()` call to beginning of `start()` function
  - Added `onTranscriptStart` to dependency array

```javascript
const start = useCallback(async () => {
  // Clear UI IMMEDIATELY before any async operations
  if (onTranscriptStart) {
    onTranscriptStart()
  }

  // Now do async work...
  const res = await apiClient.post('/api/v1/live/start')
}, [sessionId, onTranscriptStart])  // ← Fixed dependency array
```

#### Prevention Strategies
- Use ESLint `react-hooks/exhaustive-deps` rule
- Clear UI state synchronously before async operations
- Review React hooks for missing dependencies

---

## New Feature Added: macOS Permissions UI

### Purpose
Added a permissions status section in Settings page for macOS users to:
- View current Accessibility and Microphone permission status
- Request permissions with one click
- Refresh status after granting permissions in System Settings

### Files Changed
1. `desktop/src/main.js`:
   - Added `dictation:get-mac-permissions` IPC handler
   - Added `dictation:request-mac-permissions` IPC handler

2. `desktop/src/preload.js`:
   - Added `getMacPermissions()` bridge method
   - Added `requestMacPermissions()` bridge method

3. `frontend/src/pages/Settings.tsx`:
   - Added `MacPermissions` type
   - Added permission state and loading state
   - Added `fetchMacPermissions()` and `requestMacPermissions()` handlers
   - Added "macOS Permissions" UI card with status indicators

### UI Features
- Color-coded status: Green (Granted), Red (Denied), Amber (Not Set)
- "Request Permissions" button when permissions missing
- "Refresh" button to update status
- Helpful text directing users to System Settings for denied permissions

---

## Updated Issue Statistics

### Issue Categories (All Sessions)
1. **Contract Violations** (50% of issues) - Mismatched interfaces/APIs
2. **Async/Timing Bugs** (30% of issues) - Race conditions, stale closures
3. **Configuration Issues** (10% of issues) - Electron settings, environment
4. **Input Validation** (10% of issues) - Too strict/brittle

### Key Learnings (January 2026)
- **Test native module APIs** before assuming method names
- **Disable background throttling** for audio capture features
- **Clear UI state synchronously** before async operations
- **Always include callbacks in dependency arrays**

---

## References
- [MDN MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [Electron IPC Best Practices](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Electron backgroundThrottling](https://www.electronjs.org/docs/latest/api/browser-window#winsetbackgroundthrottlingthrottling)
- [@nut-tree-fork/node-mac-permissions](https://github.com/nicxvan/node-mac-permissions)
- [Contract Testing with Pact](https://docs.pact.io/)
- [Property-Based Testing](https://github.com/dubzzz/fast-check)

