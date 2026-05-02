'use strict'

const Module = require('node:module')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// ---------- electron + AI SDK stubs ----------
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-router-test-'))

const safeStorageStub = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('ENC:' + s, 'utf8'),
  decryptString: (b) => {
    const s = b.toString('utf8')
    if (!s.startsWith('ENC:')) throw new Error('bad ciphertext')
    return s.slice(4)
  },
}

const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return request
  return originalResolve.call(this, request, ...args)
}
require.cache.electron = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: {
    app: { getPath: () => tempDir },
    safeStorage: safeStorageStub,
  },
}

// Stub the AI SDK so no real network call is ever made.
const sdkCalls = []
let nextResult = { text: 'mocked response' }
let nextError = null

require.cache[require.resolve('ai')] = {
  id: 'ai',
  filename: 'ai',
  loaded: true,
  exports: {
    generateText: async (args) => {
      sdkCalls.push({ kind: 'generateText', args })
      if (nextError) throw nextError
      return nextResult
    },
  },
}

require.cache[require.resolve('@ai-sdk/anthropic')] = {
  id: '@ai-sdk/anthropic',
  filename: '@ai-sdk/anthropic',
  loaded: true,
  exports: {
    createAnthropic: (config) => {
      sdkCalls.push({ kind: 'createAnthropic', config: { hasKey: !!config.apiKey } })
      // returned function builds a "model" handle
      return (modelId) => ({ provider: 'anthropic', modelId })
    },
  },
}

require.cache[require.resolve('@ai-sdk/openai')] = {
  id: '@ai-sdk/openai',
  filename: '@ai-sdk/openai',
  loaded: true,
  exports: {
    createOpenAI: (config) => {
      sdkCalls.push({
        kind: 'createOpenAI',
        config: { hasKey: !!config.apiKey, baseURL: config.baseURL || null },
      })
      const factory = (modelId) => ({ provider: 'openai', modelId, mode: 'responses' })
      factory.chat = (modelId) => ({ provider: 'openai', modelId, mode: 'chat' })
      factory.completion = (modelId) => ({ provider: 'openai', modelId, mode: 'completion' })
      factory.responses = (modelId) => ({ provider: 'openai', modelId, mode: 'responses' })
      return factory
    },
  },
}

// Stub global fetch (used by testKey()'s raw-fetch path)
const fetchCalls = []
let nextFetchResponse = null
let nextFetchError = null
const originalFetch = global.fetch
global.fetch = async (url, init) => {
  fetchCalls.push({ url, init })
  if (nextFetchError) throw nextFetchError
  if (nextFetchResponse) return nextFetchResponse
  // Default: return 200 OK with a stub body
  return {
    ok: true,
    status: 200,
    async text() { return '{"ok":true}' },
  }
}

const byokStore = require('../src/main/byok-store')
const llmRouter = require('../src/main/llm-router')

function resetState() {
  byokStore._resetForTests()
  sdkCalls.length = 0
  fetchCalls.length = 0
  nextResult = { text: 'mocked response' }
  nextError = null
  nextFetchResponse = null
  nextFetchError = null
  const file = byokStore.getKeysFilePath()
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

// ---------- complete() ----------

test('complete rejects unknown provider', async () => {
  resetState()
  const r = await llmRouter.complete({ provider: 'not-a-thing', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'unknown_provider')
})

test('complete rejects when no key is stored', async () => {
  resetState()
  const r = await llmRouter.complete({ provider: 'anthropic', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'no_key')
})

test('complete rejects empty messages', async () => {
  resetState()
  byokStore.setKey('anthropic', 'sk-test')
  const r = await llmRouter.complete({ provider: 'anthropic', messages: [] })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'no_messages')
})

test('complete returns text on success (anthropic path)', async () => {
  resetState()
  byokStore.setKey('anthropic', 'sk-test')
  nextResult = { text: 'hello world' }
  const r = await llmRouter.complete({ provider: 'anthropic', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(r.ok, true)
  assert.equal(r.text, 'hello world')
  assert.equal(sdkCalls.some(c => c.kind === 'createAnthropic'), true)
})

test('complete uses custom baseURL for OpenAI-compatible providers (nvidia)', async () => {
  resetState()
  byokStore.setKey('nvidia', 'nvapi-test')
  await llmRouter.complete({ provider: 'nvidia', messages: [{ role: 'user', content: 'hi' }] })
  const openaiCall = sdkCalls.find(c => c.kind === 'createOpenAI')
  assert.ok(openaiCall, 'createOpenAI was called')
  assert.equal(openaiCall.config.baseURL, 'https://integrate.api.nvidia.com/v1')
})

test('complete maps 401 error to invalid', async () => {
  resetState()
  byokStore.setKey('openai', 'sk-bad')
  nextError = new Error('Request failed with status 401 Unauthorized')
  const r = await llmRouter.complete({ provider: 'openai', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'invalid')
})

test('complete maps fetch errors to network_error', async () => {
  resetState()
  byokStore.setKey('openai', 'sk-test')
  nextError = new Error('fetch failed: ENOTFOUND api.openai.com')
  const r = await llmRouter.complete({ provider: 'openai', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(r.error, 'network_error')
})

test('complete passes maxOutputTokens when maxTokens provided', async () => {
  resetState()
  byokStore.setKey('openai', 'sk-test')
  await llmRouter.complete({
    provider: 'openai',
    messages: [{ role: 'user', content: 'hi' }],
    maxTokens: 42,
  })
  const genCall = sdkCalls.find(c => c.kind === 'generateText')
  assert.ok(genCall)
  assert.equal(genCall.args.maxOutputTokens, 42)
})

// ---------- testKey() ----------

test('testKey returns no_key when nothing stored', async () => {
  resetState()
  const r = await llmRouter.testKey('anthropic')
  assert.equal(r.error, 'no_key')
})

test('testKey returns ok with latencyMs on 200 (anthropic raw path)', async () => {
  resetState()
  byokStore.setKey('anthropic', 'sk-ant-test')
  const r = await llmRouter.testKey('anthropic')
  assert.equal(r.ok, true)
  assert.equal(typeof r.latencyMs, 'number')
  // Verify it hit the Anthropic messages endpoint with x-api-key header
  const call = fetchCalls[fetchCalls.length - 1]
  assert.match(call.url, /api\.anthropic\.com\/v1\/messages/)
  assert.equal(call.init.headers['x-api-key'], 'sk-ant-test')
})

test('testKey returns ok for OpenAI-compat provider with custom baseURL (nvidia)', async () => {
  resetState()
  byokStore.setKey('nvidia', 'nvapi-test')
  const r = await llmRouter.testKey('nvidia')
  assert.equal(r.ok, true)
  const call = fetchCalls[fetchCalls.length - 1]
  assert.match(call.url, /integrate\.api\.nvidia\.com\/v1\/chat\/completions/)
  assert.equal(call.init.headers['authorization'], 'Bearer nvapi-test')
})

test('testKey returns invalid for HTTP 401', async () => {
  resetState()
  byokStore.setKey('openai', 'sk-bad')
  nextFetchResponse = { ok: false, status: 401, async text() { return 'Unauthorized' } }
  const r = await llmRouter.testKey('openai')
  assert.equal(r.error, 'invalid')
})

test('testKey returns rate_limited for HTTP 429', async () => {
  resetState()
  byokStore.setKey('openai', 'sk-test')
  nextFetchResponse = { ok: false, status: 429, async text() { return 'Too Many Requests' } }
  const r = await llmRouter.testKey('openai')
  assert.equal(r.error, 'rate_limited')
})

test('testKey returns model_not_found for HTTP 404', async () => {
  resetState()
  byokStore.setKey('openai', 'sk-test')
  nextFetchResponse = { ok: false, status: 404, async text() { return 'Not Found' } }
  const r = await llmRouter.testKey('openai')
  assert.equal(r.error, 'model_not_found')
})

test('testKey returns network_error for thrown fetch error', async () => {
  resetState()
  byokStore.setKey('openai', 'sk-test')
  nextFetchError = new Error('fetch failed: ECONNREFUSED')
  const r = await llmRouter.testKey('openai')
  assert.equal(r.error, 'network_error')
})

test('testKey returns unknown_provider for nonsense id', async () => {
  resetState()
  const r = await llmRouter.testKey('not-real')
  assert.equal(r.error, 'unknown_provider')
})

// ---------- classifyError unit tests ----------

test('_classifyError: 401 → invalid', () => {
  assert.equal(llmRouter._classifyError(new Error('401 Unauthorized')), 'invalid')
})

test('_classifyError: ENOTFOUND → network_error', () => {
  assert.equal(llmRouter._classifyError(new Error('fetch failed ENOTFOUND')), 'network_error')
})

test('_classifyError: random → other', () => {
  assert.equal(llmRouter._classifyError(new Error('something weird happened')), 'other')
})

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})
