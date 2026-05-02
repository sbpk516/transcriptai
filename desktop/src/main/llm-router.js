'use strict'

const { generateText } = require('ai')
const { createAnthropic } = require('@ai-sdk/anthropic')
const { createOpenAI } = require('@ai-sdk/openai')

const { getProvider } = require('./byok-providers')
const byokStore = require('./byok-store')

function log(message, meta) {
  if (meta) {
    console.log(`[LlmRouter] ${message}`, meta)
  } else {
    console.log(`[LlmRouter] ${message}`)
  }
}

// NOTE: For OpenAI-compatible providers (xAI, Kimi, NVIDIA, DeepSeek, Google's compat
// endpoint) we MUST use `openai.chat(modelId)` because the default `openai(modelId)`
// targets OpenAI's new `/responses` endpoint which these providers don't implement.
// `openai.chat()` targets the universally-supported `/chat/completions` endpoint.
function buildModel(provider, apiKey, modelId) {
  const targetModel = modelId || provider.defaultModel
  if (provider.format === 'anthropic') {
    return createAnthropic({ apiKey })(targetModel)
  }
  if (provider.format === 'openai') {
    const openai = createOpenAI({
      apiKey,
      ...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
    })
    return openai.chat(targetModel)
  }
  throw new Error(`unknown_provider_format:${provider.format}`)
}

function buildModelWithOverride(provider, apiKey, modelOverride) {
  return buildModel(provider, apiKey, modelOverride)
}

function classifyError(error) {
  const message = (error && (error.message || error.toString())) || 'unknown_error'
  const lower = message.toLowerCase()
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid api key') || lower.includes('invalid_api_key')) {
    return 'invalid'
  }
  if (lower.includes('403') || lower.includes('forbidden')) {
    return 'invalid'
  }
  if (lower.includes('429') || lower.includes('too many requests') || lower.includes('rate limit')) {
    return 'rate_limited'
  }
  if (lower.includes('aborterror') || lower.includes('abort') || lower.includes('was aborted')) {
    return 'timeout'
  }
  if (lower.includes('fetch failed') || lower.includes('network') || lower.includes('enotfound') || lower.includes('econnrefused')) {
    return 'network_error'
  }
  if (lower.includes('timeout')) {
    return 'timeout'
  }
  if (lower.includes('not found') || lower.includes('404')) {
    return 'model_not_found'
  }
  return 'other'
}

const TEST_TIMEOUT_MS = 15_000

/**
 * Run a non-streaming completion. Returns { ok, text? } | { ok: false, error }.
 *
 * @param {object} req
 * @param {string} req.provider provider id (must exist in byok-providers)
 * @param {string} [req.model] override default model
 * @param {Array<{role: string, content: string}>} req.messages
 * @param {number} [req.maxTokens]
 * @param {number} [req.temperature]
 */
async function complete(req) {
  if (!req || typeof req !== 'object') {
    return { ok: false, error: 'invalid_request' }
  }
  const provider = getProvider(req.provider)
  if (!provider) {
    return { ok: false, error: 'unknown_provider' }
  }
  if (!Array.isArray(req.messages) || req.messages.length === 0) {
    return { ok: false, error: 'no_messages' }
  }

  const apiKey = byokStore.getKey(provider.id)
  if (!apiKey) {
    return { ok: false, error: 'no_key' }
  }

  let model
  try {
    model = buildModelWithOverride(provider, apiKey, req.model)
  } catch (error) {
    log('failed to build model', { id: provider.id, error: error.message })
    return { ok: false, error: 'model_init_failed' }
  }

  try {
    const result = await generateText({
      model,
      messages: req.messages,
      ...(typeof req.maxTokens === 'number' ? { maxOutputTokens: req.maxTokens } : {}),
      ...(typeof req.temperature === 'number' ? { temperature: req.temperature } : {}),
    })
    const text = typeof result.text === 'string' ? result.text : ''
    return { ok: true, text }
  } catch (error) {
    const kind = classifyError(error)
    log('completion failed', { id: provider.id, kind })
    return { ok: false, error: kind === 'other' ? 'completion_failed' : kind }
  }
}

/**
 * Map an HTTP status code to one of our error kinds.
 */
function statusToKind(status) {
  if (status === 401 || status === 403) return 'invalid'
  if (status === 404) return 'model_not_found'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'network_error'
  return 'other'
}

/**
 * Run a raw chat-completion test against the provider's API. Avoids the AI SDK so we
 * can isolate network / endpoint problems from SDK quirks. Used only by testKey().
 */
async function rawTestRequest(provider, apiKey, signal) {
  if (provider.format === 'anthropic') {
    const url = 'https://api.anthropic.com/v1/messages'
    const response = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.defaultModel,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'Reply with: ok' }],
      }),
    })
    return response
  }
  // OpenAI-compatible (openai, google compat, xai, kimi, nvidia, deepseek)
  const baseURL = provider.baseURL || 'https://api.openai.com/v1'
  const url = `${baseURL}/chat/completions`
  const response = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.defaultModel,
      max_tokens: 5,
      messages: [{ role: 'user', content: 'Reply with: ok' }],
    }),
  })
  return response
}

/**
 * Issue a tiny test prompt against the provider's stored key. Uses raw fetch (not the
 * AI SDK) so failures are easier to diagnose and don't suffer from SDK-internal retries.
 */
async function testKey(providerId) {
  const provider = getProvider(providerId)
  if (!provider) return { ok: false, error: 'unknown_provider' }

  const apiKey = byokStore.getKey(provider.id)
  if (!apiKey) return { ok: false, error: 'no_key' }

  const startedAt = Date.now()
  const abortController = new AbortController()
  const timeoutHandle = setTimeout(() => abortController.abort(), TEST_TIMEOUT_MS)
  try {
    const response = await rawTestRequest(provider, apiKey, abortController.signal)
    const latencyMs = Date.now() - startedAt
    if (response.ok) {
      return { ok: true, latencyMs }
    }
    let bodyText = ''
    try {
      bodyText = (await response.text()).slice(0, 300)
    } catch (_) {}
    let kind = statusToKind(response.status)
    // Anthropic and others return 400 for "out of credits / quota exceeded" — surface as its own kind.
    const lowerBody = bodyText.toLowerCase()
    if (lowerBody.includes('credit balance') || lowerBody.includes('insufficient_quota') || lowerBody.includes('quota') && lowerBody.includes('exceed')) {
      kind = 'out_of_credits'
    }
    log('test key failed', {
      id: provider.id,
      kind,
      status: response.status,
      bodyPreview: bodyText,
    })
    return { ok: false, error: kind === 'other' ? 'completion_failed' : kind }
  } catch (error) {
    const kind = classifyError(error)
    log('test key failed (network)', { id: provider.id, kind, message: error && error.message })
    return { ok: false, error: kind === 'other' ? 'completion_failed' : kind }
  } finally {
    clearTimeout(timeoutHandle)
  }
}

module.exports = {
  complete,
  testKey,
  // exported for tests
  _classifyError: classifyError,
}
