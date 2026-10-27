import type { Subject } from '../types';

export const SUBJECT_OPTIONS: { value: Subject; label: string }[] = [
  { value: 'GS1', label: 'General Studies I' },
  { value: 'GS2', label: 'General Studies II' },
  { value: 'GS3', label: 'General Studies III' },
  { value: 'GS4', label: 'General Studies IV' },
  { value: 'Essay', label: 'Essay' },
  { value: 'Optional', label: 'Optional Subject' },
  { value: 'Other', label: 'Other' },
];

export const MARKS_PRESETS = [10, 15, 20] as const;

/** Common UPSC Mains conventions: 10 marks ≈ 150 words, 15 marks ≈ 250 words. */
export const DEFAULT_WORDS_FOR_MARKS: Record<number, number> = {
  10: 150,
  15: 250,
  20: 300,
};

export const WORD_LIMIT_PRESETS = [150, 250, 300] as const;

export const CUSTOM_MARKS_RANGE = { min: 1, max: 100 };
export const CUSTOM_WORDS_RANGE = { min: 30, max: 2000 };

/** Fallback when a custom marks value has no convention: roughly 17 words per mark. */
export function suggestWordLimit(marks: number): number {
  if (DEFAULT_WORDS_FOR_MARKS[marks]) return DEFAULT_WORDS_FOR_MARKS[marks];
  return Math.min(CUSTOM_WORDS_RANGE.max, Math.max(CUSTOM_WORDS_RANGE.min, Math.round((marks * 17) / 10) * 10));
}

/** Below this many words, the user is asked before clearing; very short drafts clear instantly. */
export const CONFIRM_CLEAR_WORDS = 25;

/** Minimum words before an answer can be evaluated. */
export const MIN_ANSWER_WORDS = 20;
