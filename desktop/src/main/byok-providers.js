'use strict'

const PROVIDERS = Object.freeze([
  Object.freeze({
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    format: 'anthropic',
    baseURL: null,
    defaultModel: 'claude-haiku-4-5',
  }),
  Object.freeze({
    id: 'openai',
    label: 'OpenAI',
    format: 'openai',
    baseURL: null,
    defaultModel: 'gpt-4o-mini',
  }),
  Object.freeze({
    id: 'google',
    label: 'Google Gemini',
    format: 'openai',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
  }),
  Object.freeze({
    id: 'xai',
    label: 'xAI (Grok)',
    format: 'openai',
    baseURL: 'https://api.x.ai/v1',
    defaultModel: 'grok-2-mini',
  }),
  Object.freeze({
    id: 'kimi',
    label: 'Moonshot (Kimi)',
    format: 'openai',
    // International platform endpoint (platform.moonshot.ai). The .cn endpoint is a
    // separate system whose keys are NOT interchangeable with .ai keys.
    baseURL: 'https://api.moonshot.ai/v1',
    defaultModel: 'moonshot-v1-8k',
  }),
  Object.freeze({
    id: 'nvidia',
    label: 'NVIDIA NIM',
    format: 'openai',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.1-8b-instruct',
  }),
  Object.freeze({
    id: 'deepseek',
    label: 'DeepSeek',
    format: 'openai',
    baseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
  }),
])

const PROVIDER_BY_ID = new Map(PROVIDERS.map(p => [p.id, p]))

function getProvider(id) {
  return PROVIDER_BY_ID.get(id) || null
}

function isValidProviderId(id) {
  return PROVIDER_BY_ID.has(id)
}

module.exports = {
  PROVIDERS,
  getProvider,
  isValidProviderId,
}
