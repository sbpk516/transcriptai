import type { LlmMessage } from '../../types/byok'

export const REPHRASE_SYSTEM_PROMPT = [
  'You are a copy editor for live speech transcripts.',
  'Rewrite the user\'s sentence so it reads as clear, natural English.',
  'Fix disfluencies ("um", "uh", "like", "you know", "I mean"), false starts, and obvious repetition.',
  'Preserve the speaker\'s meaning. Do not summarize, do not drop information, do not change the topic.',
  'If the input is already clean, return it largely unchanged.',
  'Output only the rewritten sentence. No commentary, no quotes, no preamble, no markdown.',
].join(' ')

export const GIST_SYSTEM_PROMPT = [
  'You summarize live meeting transcripts for someone who is half-listening and wants the gist.',
  'Always produce 1 to 3 short, plain-English bullet points capturing what the speaker is talking about.',
  'Each bullet is a takeaway in your own words — paraphrase, don\'t quote.',
  'Casual conversational tone, like catching a friend up.',
  'Format: one bullet per line, each prefixed with "• ".',
  'No preamble, no headings, no markdown beyond the bullets.',
  'Always attempt a summary, even if the transcript is brief or unclear — work with what is there.',
].join(' ')

export function buildRephraseMessages(rawSentence: string): LlmMessage[] {
  return [
    { role: 'system', content: REPHRASE_SYSTEM_PROMPT },
    { role: 'user', content: rawSentence.trim() },
  ]
}

export function buildGistMessages(transcript: string): LlmMessage[] {
  return [
    { role: 'system', content: GIST_SYSTEM_PROMPT },
    { role: 'user', content: transcript.trim() },
  ]
}
