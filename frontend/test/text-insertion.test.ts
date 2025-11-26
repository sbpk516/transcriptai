import test from 'node:test'
import assert from 'node:assert/strict'

const originalDocument = globalThis.document
const originalEvent = globalThis.Event
const originalWindow = globalThis.window

class SimpleEvent {
  type: string
  constructor(type: string, _init?: any) {
    this.type = type
  }
}

async function loadHelper() {
  return await import('../src/modules/dictation/textInsertion.js')
}

function withDocument(fakeDoc: any, fn: () => Promise<void> | void) {
  globalThis.document = fakeDoc
  globalThis.Event = SimpleEvent as any
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.document = originalDocument
      globalThis.Event = originalEvent as any
    })
}

test('insertDictationText inserts into focused input', async () => {
  const { insertDictationText } = await loadHelper()
  const input: any = {
    tagName: 'INPUT',
    value: 'hello',
    selectionStart: 5,
    selectionEnd: 5,
    readOnly: false,
    disabled: false,
    dispatched: [] as any[],
    focus() {},
    dispatchEvent(ev: any) {
      this.dispatched.push(ev)
      return true
    },
  }
  const fakeDoc: any = {
    activeElement: input,
  }

  await withDocument(fakeDoc, async () => {
    const outcome = await insertDictationText(' world')
    assert.equal(outcome.ok, true)
    if (outcome.ok) {
      assert.equal(outcome.method, 'input')
    }
    assert.equal(input.value, 'hello world')
    assert.equal(input.selectionStart, 11)
    assert.equal(input.selectionEnd, 11)
    assert.equal(input.dispatched[0]?.type, 'input')
  })
})

test('insertDictationText falls back to bridge', async () => {
  const { insertDictationText } = await loadHelper()
  const calls: any[] = []
  ;(globalThis as any).window = globalThis
  ;(window as any).transcriptaiDictation = {
    async typeText(payload: any) {
      calls.push(payload)
      return { ok: true }
    },
  }

  await withDocument({ activeElement: null }, async () => {
    const outcome = await insertDictationText('bridge test')
    assert.equal(outcome.ok, true)
    if (outcome.ok) {
      assert.equal(outcome.method, 'bridge')
    }
    assert.equal(calls[0].text, 'bridge test')
  })

  delete (window as any).transcriptaiDictation
  if (originalWindow === undefined) {
    delete (globalThis as any).window
  } else {
    globalThis.window = originalWindow
  }
})

test('insertDictationText skips when expected target no longer focused', async () => {
  const { insertDictationText, snapshotActiveEditable } = await loadHelper()

  const primaryInput: any = {
    tagName: 'TEXTAREA',
    value: 'primary',
    selectionStart: 7,
    selectionEnd: 7,
    readOnly: false,
    disabled: false,
    dispatched: [] as any[],
    focus() {},
    dispatchEvent() {
      throw new Error('should not dispatch when target changes')
    },
  }
  const secondaryInput: any = {
    tagName: 'INPUT',
    value: 'secondary',
    selectionStart: 9,
    selectionEnd: 9,
    readOnly: false,
    disabled: false,
    dispatched: [] as any[],
    focus() {},
    dispatchEvent() {
      return true
    },
  }

  const fakeDoc: any = {
    activeElement: primaryInput,
  }

  await withDocument(fakeDoc, async () => {
    const snapshot = snapshotActiveEditable()
    assert.ok(snapshot, 'expected snapshot to exist for focused input')

    fakeDoc.activeElement = secondaryInput

    const outcome = await insertDictationText(' should skip', { expectedTarget: snapshot })
    assert.equal(outcome.ok, false)
    if (!outcome.ok) {
      assert.equal(outcome.reason, 'target_mismatch')
    }
    assert.equal(primaryInput.value, 'primary')
    assert.equal(secondaryInput.value, 'secondary')
  })
})
