"use strict"

const Module = require("node:module")
const test = require("node:test")
const assert = require("node:assert/strict")

// Stub electron before anything requires it
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request === "electron") {
    return request
  }
  return originalResolve.call(this, request, ...args)
}
require.cache.electron = {
  id: "electron",
  filename: "electron",
  loaded: true,
  exports: {
    clipboard: { writeText() {}, readText() { return "" } },
    screen: { getCursorScreenPoint() { return { x: 0, y: 0 } } },
  },
}

const DictationManager = require("../src/main/dictation-manager")

function createStubFactory(state) {
  return class GlobalListenerStub {
    constructor() {
      state.instances.push(this)
    }

    async addListener(handler) {
      state.handlers.add(handler)
      state.added.push(handler)
      return Promise.resolve()
    }

    removeListener(handler) {
      state.handlers.delete(handler)
      state.removed.push(handler)
    }

    kill() {
      state.killed = true
    }
  }
}

function createStubNut() {
  const Key = new Proxy(
    {},
    {
      get: (_target, prop) => String(prop),
    },
  )
  return {
    keyboard: {},
    Key,
  }
}

function createListenerState() {
  return {
    handlers: new Set(),
    added: [],
    removed: [],
    instances: [],
    killed: false,
  }
}

function setupManager(state) {
  const manager = new DictationManager({ listenerFactory: createStubFactory(state) })
  const stubNut = createStubNut()
  manager._nut = stubNut
  manager._keyboard = stubNut.keyboard
  manager._keyEnum = stubNut.Key
  manager._shouldIgnoreEvent = () => false
  manager._mapListenerEventToKey = event => event.mockKey ?? null
  return manager
}

test("DictationManager attaches and detaches global listener", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const state = createListenerState()
  const manager = setupManager(state)
  const events = []
  manager.on("dictation:press-start", payload => events.push({ type: "start", payload }))
  manager.on("dictation:press-end", payload => events.push({ type: "end", payload }))
  manager.on("dictation:press-cancel", payload => events.push({ type: "cancel", payload }))
  manager.on("dictation:request-start", payload => events.push({ type: "request", payload }))

  const started = await manager.startListening({ shortcut: "Shift+A" })
  assert.equal(started, true)
  assert.equal(state.instances.length, 1)
  assert.equal(state.handlers.size, 1)
  assert.equal(state.added.length, 1)

  const handler = state.added[0]
  handler({ mockKey: "LeftShift", state: "DOWN" })
  handler({ mockKey: "A", state: "DOWN" })
  const pending = manager._pendingPermission
  assert.ok(pending)
  manager.grantPermission({ requestId: pending.id, source: "test" })
  handler({ mockKey: "A", state: "UP" })
  handler({ mockKey: "LeftShift", state: "UP" })
  // Advance past modifier keyup confirmation window
  t.mock.timers.tick(200)

  await manager.stopListening()
  assert.equal(state.handlers.size, 0)
  assert.equal(state.removed.length, 1)
  assert.equal(state.killed, true)

  const types = events.map(e => e.type)
  assert.deepEqual(types, ["start", "request", "end"])
  const [startEvent, requestEvent, endEvent] = events
  assert.ok(startEvent.payload.durationMs === 0)
  assert.equal(requestEvent.payload.requestId >= 1, true)
  assert.ok(endEvent.payload.durationMs >= 0)

  await manager.dispose()
  assert.equal(state.killed, true)
})

test("DictationManager cancels when permission denied", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const state = createListenerState()
  const manager = setupManager(state)
  const events = []
  manager.on("dictation:press-cancel", payload => events.push({ type: "cancel", payload }))
  manager.on("dictation:permission-denied", payload => events.push({ type: "denied", payload }))

  await manager.startListening({ shortcut: "Shift+A" })
  const handler = state.added[0]
  handler({ mockKey: "LeftShift", state: "DOWN" })
  handler({ mockKey: "A", state: "DOWN" })
  const pending = manager._pendingPermission
  assert.ok(pending)
  manager.denyPermission({ requestId: pending.id, reason: "test" })
  handler({ mockKey: "A", state: "UP" })
  handler({ mockKey: "LeftShift", state: "UP" })
  t.mock.timers.tick(200)

  await manager.stopListening()
  assert.deepEqual(
    events.map(e => e.type),
    ["denied", "cancel"],
  )
  await manager.dispose()
})

 test("DictationManager typeText with keyboard", async () => {
   const state = createListenerState()
   const manager = new DictationManager({ listenerFactory: createStubFactory(state) })
   const stubNut = createStubNut()
   stubNut.keyboard.type = async () => {}
   manager._nut = stubNut
   manager._keyboard = stubNut.keyboard

  const result = await manager.typeText('hello world')
  assert.equal(result.ok, true)
  assert.equal(result.method, 'keyboard')
})

test("DictationManager typeText supports object payload", async () => {
  const state = createListenerState()
  const manager = new DictationManager({ listenerFactory: createStubFactory(state) })
  const stubNut = createStubNut()
  stubNut.keyboard.type = async () => {}
  manager._nut = stubNut
  manager._keyboard = stubNut.keyboard

  const result = await manager.typeText({ text: 'object payload', mode: 'type' })
  assert.equal(result.ok, true)
  assert.equal(result.method, 'keyboard')
})

test("DictationManager typeText handles empty text", async () => {
  const manager = new DictationManager()
  const result = await manager.typeText('')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'empty_text')
})

// --- Phantom keyup suppression tests ---

test("phantom modifier keyup is suppressed when keydown follows within 150ms", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const state = createListenerState()
  const manager = setupManager(state)
  const events = []
  manager.on("dictation:press-start", payload => events.push({ type: "start", payload }))
  manager.on("dictation:press-end", payload => events.push({ type: "end", payload }))
  manager.on("dictation:press-cancel", payload => events.push({ type: "cancel", payload }))

  await manager.startListening({ shortcut: "Shift+A" })
  const handler = state.added[0]

  // Press shortcut
  handler({ mockKey: "LeftShift", state: "DOWN" })
  handler({ mockKey: "A", state: "DOWN" })
  assert.equal(manager._state, "pressed")

  // Phantom keyup for LeftShift (macOS phantom event)
  handler({ mockKey: "LeftShift", state: "UP" })
  // Key should still be in activeKeySet (deferred, not removed yet)
  assert.equal(manager._pendingKeyupTimers.size, 1)
  assert.equal(manager._state !== "idle", true, "state should not be idle during deferral")

  // Phantom keydown re-fires within 150ms
  t.mock.timers.tick(30)
  handler({ mockKey: "LeftShift", state: "DOWN" })

  // Timer should be cancelled, key restored
  assert.equal(manager._pendingKeyupTimers.size, 0)
  assert.equal(manager._state, "pressed")

  // No press-end should have fired
  assert.equal(events.filter(e => e.type === "end").length, 0)
  assert.equal(events.filter(e => e.type === "cancel").length, 0)

  // Now genuinely release
  handler({ mockKey: "A", state: "UP" })
  handler({ mockKey: "LeftShift", state: "UP" })
  t.mock.timers.tick(200)

  assert.equal(manager._state, "idle")
  assert.equal(events.filter(e => e.type === "end").length, 1)

  await manager.dispose()
})

test("genuine modifier release fires press-end after confirmation window", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const state = createListenerState()
  const manager = setupManager(state)
  const events = []
  manager.on("dictation:press-start", payload => events.push({ type: "start", payload }))
  manager.on("dictation:press-end", payload => events.push({ type: "end", payload }))

  await manager.startListening({ shortcut: "Shift+A" })
  const handler = state.added[0]

  // Press shortcut
  handler({ mockKey: "LeftShift", state: "DOWN" })
  handler({ mockKey: "A", state: "DOWN" })
  assert.equal(manager._state, "pressed")

  // Release A immediately (non-modifier, processed synchronously)
  handler({ mockKey: "A", state: "UP" })

  // Release LeftShift (modifier, deferred)
  handler({ mockKey: "LeftShift", state: "UP" })
  assert.equal(manager._pendingKeyupTimers.size, 1)

  // No press-end yet
  assert.equal(events.filter(e => e.type === "end").length, 0)

  // Advance past confirmation window
  t.mock.timers.tick(200)

  // Now press-end should have fired
  assert.equal(events.filter(e => e.type === "end").length, 1)
  assert.equal(manager._state, "idle")

  await manager.dispose()
})

test("non-modifier keys are processed immediately without deferral", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const state = createListenerState()
  const manager = setupManager(state)
  const events = []
  manager.on("dictation:press-start", payload => events.push({ type: "start", payload }))
  manager.on("dictation:press-end", payload => events.push({ type: "end", payload }))

  // Use a shortcut with a non-modifier key: F13
  await manager.startListening({ shortcut: "F13" })
  const handler = state.added[0]

  handler({ mockKey: "F13", state: "DOWN" })
  assert.equal(manager._state, "pressed")

  // Release F13 — should process immediately, no deferral
  handler({ mockKey: "F13", state: "UP" })
  assert.equal(manager._pendingKeyupTimers.size, 0)
  assert.equal(manager._state, "idle")
  assert.equal(events.filter(e => e.type === "end").length, 1)

  await manager.dispose()
})

test("dual-modifier phantom keyups are both suppressed correctly", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const state = createListenerState()
  const manager = setupManager(state)
  const events = []
  manager.on("dictation:press-start", payload => events.push({ type: "start", payload }))
  manager.on("dictation:press-end", payload => events.push({ type: "end", payload }))
  manager.on("dictation:press-cancel", payload => events.push({ type: "cancel", payload }))

  // Shortcut: Cmd+Alt (both modifiers)
  await manager.startListening({ shortcut: "Cmd+Alt" })
  const handler = state.added[0]

  handler({ mockKey: "LeftCmd", state: "DOWN" })
  handler({ mockKey: "LeftAlt", state: "DOWN" })
  assert.equal(manager._state, "pressed")

  // Phantom UP for both modifiers
  handler({ mockKey: "LeftCmd", state: "UP" })
  handler({ mockKey: "LeftAlt", state: "UP" })
  assert.equal(manager._pendingKeyupTimers.size, 2)

  // Both phantom keydowns re-fire
  t.mock.timers.tick(30)
  handler({ mockKey: "LeftCmd", state: "DOWN" })
  handler({ mockKey: "LeftAlt", state: "DOWN" })

  // Both timers cancelled, state recovered
  assert.equal(manager._pendingKeyupTimers.size, 0)
  assert.equal(manager._state, "pressed")
  assert.equal(events.filter(e => e.type === "end").length, 0)
  assert.equal(events.filter(e => e.type === "cancel").length, 0)

  // Now genuinely release both
  handler({ mockKey: "LeftCmd", state: "UP" })
  handler({ mockKey: "LeftAlt", state: "UP" })
  t.mock.timers.tick(200)

  assert.equal(manager._state, "idle")
  assert.equal(events.filter(e => e.type === "end").length, 1)

  await manager.dispose()
})

test("cancelActivePress clears pending keyup timers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const state = createListenerState()
  const manager = setupManager(state)
  const events = []
  manager.on("dictation:press-start", payload => events.push({ type: "start", payload }))
  manager.on("dictation:press-end", payload => events.push({ type: "end", payload }))
  manager.on("dictation:press-cancel", payload => events.push({ type: "cancel", payload }))

  await manager.startListening({ shortcut: "Shift+A" })
  const handler = state.added[0]

  handler({ mockKey: "LeftShift", state: "DOWN" })
  handler({ mockKey: "A", state: "DOWN" })
  assert.equal(manager._state, "pressed")

  // Phantom UP for LeftShift — deferred
  handler({ mockKey: "LeftShift", state: "UP" })
  assert.equal(manager._pendingKeyupTimers.size, 1)

  // Cancel the active press while timer is pending
  manager.cancelActivePress({ reason: "test_cancel" })
  assert.equal(manager._pendingKeyupTimers.size, 0)
  assert.equal(manager._state, "idle")

  // Advancing timers should not cause any further events
  const eventCountBefore = events.length
  t.mock.timers.tick(200)
  assert.equal(events.length, eventCountBefore)

  await manager.dispose()
})

test("dispose clears pending keyup timers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const state = createListenerState()
  const manager = setupManager(state)

  await manager.startListening({ shortcut: "Shift+A" })
  const handler = state.added[0]

  handler({ mockKey: "LeftShift", state: "DOWN" })
  handler({ mockKey: "A", state: "DOWN" })

  // Phantom UP — deferred
  handler({ mockKey: "LeftShift", state: "UP" })
  assert.equal(manager._pendingKeyupTimers.size, 1)

  await manager.dispose()
  assert.equal(manager._pendingKeyupTimers.size, 0)

  // Advancing timers should not throw or cause issues
  t.mock.timers.tick(200)
})
