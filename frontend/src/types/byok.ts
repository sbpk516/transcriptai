export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'xai'
  | 'kimi'
  | 'nvidia'
  | 'deepseek'

export interface ProviderInfo {
  id: ProviderId
  label: string
  defaultModel: string
  hasKey: boolean
}

export interface BYOKListResult {
  ok: boolean
  providers?: ProviderInfo[]
  encryptionAvailable?: boolean
  error?: string
}

export interface BYOKMutationResult {
  ok: boolean
  error?: string
}

export interface BYOKTestResult {
  ok: boolean
  error?: string
  latencyMs?: number
}

export interface LlmMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface LlmCompleteRequest {
  provider: ProviderId
  model?: string
  messages: LlmMessage[]
  maxTokens?: number
  temperature?: number
}

export type LlmCompleteResult =
  | { ok: true; text: string }
  | { ok: false; error: string }

export interface BYOKBridge {
  listProviders(): Promise<BYOKListResult>
  setKey(id: ProviderId, key: string): Promise<BYOKMutationResult>
  deleteKey(id: ProviderId): Promise<BYOKMutationResult>
  testKey(id: ProviderId): Promise<BYOKTestResult>
}

export interface LlmBridge {
  complete(request: LlmCompleteRequest): Promise<LlmCompleteResult>
}

declare global {
  interface Window {
    transcriptaiByok?: BYOKBridge
    transcriptaiLlm?: LlmBridge
  }
}
