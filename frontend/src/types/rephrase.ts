import type { ProviderId } from './byok'

export type SentenceStatus = 'pending' | 'polishing' | 'done' | 'error' | 'skipped'

export interface SentenceState {
  index: number
  raw: string
  polished: string | null
  status: SentenceStatus
  errorCode?: string
}

export interface RephraseProviderOption {
  id: ProviderId
  label: string
  defaultModel: string
}
