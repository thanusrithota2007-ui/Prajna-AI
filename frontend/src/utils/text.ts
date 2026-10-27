/** Count words the way an aspirant would: runs of non-space characters containing a letter or digit. */
export function countWords(text: string): number {
  const matches = text.trim().match(/\S*[\p{L}\p{N}]\S*/gu);
  return matches ? matches.length : 0;
}

/** Split into non-empty paragraphs (blank line or single line break). */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => countWords(s) > 0);
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Round to the nearest half mark. */
export function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

export function formatScore(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
