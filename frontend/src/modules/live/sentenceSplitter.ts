// Common abbreviations whose trailing period must NOT trigger a sentence split.
// Lowercased, no trailing period in the set.
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st',
  'e.g', 'i.e', 'etc', 'vs', 'fig', 'no',
  'inc', 'ltd', 'co', 'corp',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
  'a.m', 'p.m', 'am', 'pm',
])

const TERMINAL = new Set(['.', '?', '!', '…'])

function endsWithAbbreviation(text: string): boolean {
  // Look at the last token before the period.
  const match = /([A-Za-z][A-Za-z.]*)\.\s*$/.exec(text)
  if (!match) return false
  return ABBREVIATIONS.has(match[1].toLowerCase())
}

function isDecimalContext(text: string, dotIdx: number): boolean {
  // 3.14, $1.50 — preceded and followed by digits.
  const prev = text[dotIdx - 1]
  const next = text[dotIdx + 1]
  return /\d/.test(prev) && /\d/.test(next)
}

export interface SplitResult {
  sentences: string[]
  remainder: string
}

/**
 * Splits `text` into completed sentences (terminated by `.`/`?`/`!`/`…` followed
 * by whitespace or end-of-string) plus a trailing `remainder` of unfinished text.
 *
 * The function is pure and call-stable: if a final sentence has no terminal
 * punctuation, it stays in `remainder` until either more text arrives or the
 * caller flushes it explicitly (e.g. on stop).
 */
export function splitSentences(text: string): SplitResult {
  if (!text) return { sentences: [], remainder: '' }

  const sentences: string[] = []
  let start = 0

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (!TERMINAL.has(ch)) continue

    // Decimal like 3.14 — not a boundary.
    if (ch === '.' && isDecimalContext(text, i)) continue

    // Look ahead: terminal punctuation only ends a sentence if followed by
    // whitespace or end-of-string. (Avoids splitting "U.S.A" mid-token.)
    const next = text[i + 1]
    if (next !== undefined && !/\s/.test(next)) continue

    const candidate = text.slice(start, i + 1)
    if (endsWithAbbreviation(candidate)) continue

    sentences.push(candidate.trim())
    // Skip whitespace after the terminator.
    let j = i + 1
    while (j < text.length && /\s/.test(text[j])) j++
    start = j
    i = j - 1
  }

  return {
    sentences,
    remainder: text.slice(start).trim(),
  }
}

/**
 * Given the previous transcript text and the current text, returns any
 * newly-completed sentences and the new remainder. The caller tracks the last
 * `remainder` as `prevText` for the next call.
 *
 * Implementation note: we just split the full current text and return the diff
 * against `prevText`'s length. Simpler than tracking offsets across edits, and
 * robust to whisper-style retroactive corrections.
 */
export function splitNewSentences(
  prevSentenceCount: number,
  currentText: string,
): { newSentences: string[]; remainder: string; totalCount: number } {
  const { sentences, remainder } = splitSentences(currentText)
  const newSentences = sentences.slice(prevSentenceCount)
  return { newSentences, remainder, totalCount: sentences.length }
}
