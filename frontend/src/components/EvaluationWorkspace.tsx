import { CircleAlert, Eraser, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CONFIRM_CLEAR_WORDS,
  CUSTOM_MARKS_RANGE,
  CUSTOM_WORDS_RANGE,
  MARKS_PRESETS,
  MIN_ANSWER_WORDS,
  SUBJECT_OPTIONS,
  WORD_LIMIT_PRESETS,
  suggestWordLimit,
} from '../data/options';
import { EvaluationError, LIMITS, evaluateAnswer, isMockMode } from '../services/evaluationApi';
import type { EvaluationRequest, EvaluationResult, Subject } from '../types';
import { countWords } from '../utils/text';
import './EvaluationWorkspace.css';

type FieldName = 'question' | 'subject' | 'marks' | 'words' | 'answer';
type Errors = Partial<Record<FieldName, string>>;

/** DOM id to focus for each field when validation fails. */
const FOCUS_ID: Record<FieldName, string> = {
  question: 'question',
  subject: 'subject',
  marks: 'custom-marks',
  words: 'custom-words',
  answer: 'answer',
};
const FIELD_ORDER: FieldName[] = ['question', 'subject', 'marks', 'words', 'answer'];

interface Props {
  onEvaluated: (request: EvaluationRequest, result: EvaluationResult) => void;
}

function parseWholeNumber(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

export function EvaluationWorkspace({ onEvaluated }: Props) {
  const [question, setQuestion] = useState('');
  const [subject, setSubject] = useState<Subject | ''>('');
  const [marksChoice, setMarksChoice] = useState<string>('15');
  const [customMarks, setCustomMarks] = useState('');
  const [wordChoice, setWordChoice] = useState<string>('250');
  const [customWords, setCustomWords] = useState('');
  const [wordsTouched, setWordsTouched] = useState(false);
  const [answer, setAnswer] = useState('');

  const [errors, setErrors] = useState<Errors>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const keepButtonRef = useRef<HTMLButtonElement>(null);

  const marks = marksChoice === 'custom' ? parseWholeNumber(customMarks) : Number(marksChoice);
  const wordLimit = wordChoice === 'custom' ? parseWholeNumber(customWords) : Number(wordChoice);
  const marksValid = marks !== null && marks >= CUSTOM_MARKS_RANGE.min && marks <= CUSTOM_MARKS_RANGE.max;
  const wordLimitValid =
    wordLimit !== null && wordLimit >= CUSTOM_WORDS_RANGE.min && wordLimit <= CUSTOM_WORDS_RANGE.max;

  const wordCount = useMemo(() => countWords(answer), [answer]);

  useEffect(() => {
    if (confirmingClear) keepButtonRef.current?.focus();
  }, [confirmingClear]);

  /** Clear one field's error as soon as the user edits it. */
  const touch = (field: FieldName) => {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
    setApiError(null);
  };

  /** When marks change, suggest a matching word limit unless the user has chosen their own. */
  const applySuggestedWords = (nextMarks: number | null) => {
    if (wordsTouched || nextMarks === null || nextMarks < CUSTOM_MARKS_RANGE.min || nextMarks > CUSTOM_MARKS_RANGE.max) return;
    const suggested = suggestWordLimit(nextMarks);
    if ((WORD_LIMIT_PRESETS as readonly number[]).includes(suggested)) {
      setWordChoice(String(suggested));
    } else {
      setWordChoice('custom');
      setCustomWords(String(suggested));
    }
  };

  const onMarksChoice = (value: string) => {
    setMarksChoice(value);
    touch('marks');
    applySuggestedWords(value === 'custom' ? parseWholeNumber(customMarks) : Number(value));
  };

  const onCustomMarks = (value: string) => {
    setCustomMarks(value);
    touch('marks');
    applySuggestedWords(parseWholeNumber(value));
  };

  const validate = (): Errors => {
    const e: Errors = {};
    if (question.trim().length < 10) {
      e.question = question.trim()
        ? 'This looks too short to be a full question. Paste the complete question so feedback can check relevance.'
        : 'Enter the question you are answering.';
    }
    if (question.trim().length > LIMITS.questionChars) {
      e.question = `The question is ${question.trim().length.toLocaleString()} characters. The limit is ${LIMITS.questionChars.toLocaleString()}.`;
    }
    if (!subject) e.subject = 'Choose the paper or subject.';
    if (!marksValid) {
      e.marks = `Enter whole marks between ${CUSTOM_MARKS_RANGE.min} and ${CUSTOM_MARKS_RANGE.max}.`;
    }
    if (!wordLimitValid) {
      e.words = `Enter a word limit between ${CUSTOM_WORDS_RANGE.min} and ${CUSTOM_WORDS_RANGE.max}.`;
    }
    if (!answer.trim()) {
      e.answer = 'Write or paste your answer to get feedback.';
    } else if (answer.trim().length > LIMITS.answerChars) {
      e.answer = `Your answer is ${answer.trim().length.toLocaleString()} characters. The limit is ${LIMITS.answerChars.toLocaleString()} (about ${Math.round(LIMITS.answerChars / 6.5)} words).`;
    } else if (wordCount < MIN_ANSWER_WORDS) {
      e.answer = `Your answer has ${wordCount} word${wordCount === 1 ? '' : 's'}. Add at least ${MIN_ANSWER_WORDS} so there is enough to evaluate.`;
    }
    return e;
  };

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (loading) return;

    const found = validate();
    setErrors(found);
    const firstInvalid = FIELD_ORDER.find((f) => found[f]);
    if (firstInvalid) {
      document.getElementById(FOCUS_ID[firstInvalid])?.focus();
      return;
    }

    const request: EvaluationRequest = {
      question: question.trim(),
      answer: answer.trim(),
      subject: subject as Subject,
      marks: marks as number,
      wordLimit: wordLimit as number,
    };

    setLoading(true);
    setApiError(null);
    try {
      const result = await evaluateAnswer(request);
      onEvaluated(request, result);
    } catch (err) {
      setApiError(
        err instanceof EvaluationError ? err.message : 'Something went wrong while evaluating. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  const requestClear = () => {
    if (wordCount >= CONFIRM_CLEAR_WORDS) {
      setConfirmingClear(true);
    } else {
      doClear();
    }
  };
  const doClear = () => {
    setAnswer('');
    setConfirmingClear(false);
    touch('answer');
    document.getElementById('answer')?.focus();
  };

  // Word-limit indicator
  const ratio = wordLimitValid && wordLimit ? wordCount / wordLimit : 0;
  const over = wordLimitValid && wordLimit ? wordCount - wordLimit : 0;
  const limitState: 'idle' | 'ok' | 'near' | 'over' =
    !wordLimitValid || wordCount === 0 ? 'idle' : over > 0 ? 'over' : ratio >= 0.9 ? 'near' : 'ok';
  const limitMessage = {
    idle: wordLimitValid ? 'Start writing to see how you use the limit.' : 'Set a valid word limit to track your length.',
    ok: `${Math.round(ratio * 100)}% of the limit used`,
    near: 'Close to the limit',
    over: `${over} word${over === 1 ? '' : 's'} over the limit`,
  }[limitState];

  const errorCount = Object.keys(errors).length;

  return (
    <section className="section workspace" id="workspace" aria-labelledby="workspace-title">
      <div className="container">
        <div className="section-head">
          <h2 id="workspace-title">Evaluate your answer</h2>
          <p>Paste the question and your answer. Feedback appears below the form.</p>
        </div>

        {!isMockMode && (
          <p className="demo-banner" role="note">
            <CircleAlert size={18} aria-hidden="true" />
            <span>
              Each of the three criteria is scored out of 10. Subject, marks and word limit only drive the word counter
              here; the evaluator does not use them.
            </span>
          </p>
        )}

        <form className="ws-card" onSubmit={onSubmit} noValidate aria-busy={loading}>
          <div className="ws-grid">
            {/* Question */}
            <div className="field ws-question">
              <label className="field-label" htmlFor="question">
                Question
              </label>
              <textarea
                id="question"
                className="input"
                rows={3}
                placeholder="Enter the question you are answering..."
                value={question}
                onChange={(e) => {
                  setQuestion(e.target.value);
                  touch('question');
                }}
                aria-invalid={!!errors.question}
                aria-describedby={errors.question ? 'question-error' : 'question-hint'}
                disabled={loading}
              />
              {errors.question ? (
                <FieldError id="question-error">{errors.question}</FieldError>
              ) : (
                <p className="field-hint" id="question-hint">
                  Include the directive word, such as discuss, examine or critically analyse.
                </p>
              )}
            </div>

            {/* Settings */}
            <div className="ws-settings">
              <div className="field">
                <label className="field-label" htmlFor="subject">
                  Subject or paper
                </label>
                <select
                  id="subject"
                  className="input"
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value as Subject | '');
                    touch('subject');
                  }}
                  aria-invalid={!!errors.subject}
                  aria-describedby={errors.subject ? 'subject-error' : undefined}
                  disabled={loading}
                >
                  <option value="">Select a paper</option>
                  {SUBJECT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {errors.subject && <FieldError id="subject-error">{errors.subject}</FieldError>}
              </div>

              <fieldset className="field" disabled={loading}>
                <legend className="field-label">Marks allotted</legend>
                <div className="segmented" role="radiogroup" aria-label="Marks allotted">
                  {MARKS_PRESETS.map((m) => (
                    <Choice
                      key={m}
                      name="marks"
                      value={String(m)}
                      checked={marksChoice === String(m)}
                      onChange={onMarksChoice}
                    >
                      {m} marks
                    </Choice>
                  ))}
                  <Choice name="marks" value="custom" checked={marksChoice === 'custom'} onChange={onMarksChoice}>
                    Custom
                  </Choice>
                </div>
                {marksChoice === 'custom' && (
                  <div className="custom-input">
                    <label className="sr-only" htmlFor="custom-marks">
                      Custom marks
                    </label>
                    <input
                      id="custom-marks"
                      className="input"
                      type="number"
                      inputMode="numeric"
                      min={CUSTOM_MARKS_RANGE.min}
                      max={CUSTOM_MARKS_RANGE.max}
                      step={1}
                      placeholder="e.g. 12"
                      value={customMarks}
                      onChange={(e) => onCustomMarks(e.target.value)}
                      aria-invalid={!!errors.marks}
                      aria-describedby={errors.marks ? 'marks-error' : undefined}
                    />
                    <span className="unit">marks</span>
                  </div>
                )}
                {errors.marks && <FieldError id="marks-error">{errors.marks}</FieldError>}
              </fieldset>

              <fieldset className="field" disabled={loading}>
                <legend className="field-label">Word limit</legend>
                <div className="segmented" role="radiogroup" aria-label="Word limit">
                  {WORD_LIMIT_PRESETS.map((w) => (
                    <Choice
                      key={w}
                      name="words"
                      value={String(w)}
                      checked={wordChoice === String(w)}
                      onChange={(v) => {
                        setWordChoice(v);
                        setWordsTouched(true);
                        touch('words');
                      }}
                    >
                      {w} words
                    </Choice>
                  ))}
                  <Choice
                    name="words"
                    value="custom"
                    checked={wordChoice === 'custom'}
                    onChange={(v) => {
                      setWordChoice(v);
                      setWordsTouched(true);
                      touch('words');
                    }}
                  >
                    Custom
                  </Choice>
                </div>
                {wordChoice === 'custom' && (
                  <div className="custom-input">
                    <label className="sr-only" htmlFor="custom-words">
                      Custom word limit
                    </label>
                    <input
                      id="custom-words"
                      className="input"
                      type="number"
                      inputMode="numeric"
                      min={CUSTOM_WORDS_RANGE.min}
                      max={CUSTOM_WORDS_RANGE.max}
                      step={10}
                      placeholder="e.g. 200"
                      value={customWords}
                      onChange={(e) => {
                        setCustomWords(e.target.value);
                        setWordsTouched(true);
                        touch('words');
                      }}
                      aria-invalid={!!errors.words}
                      aria-describedby={errors.words ? 'words-error' : undefined}
                    />
                    <span className="unit">words</span>
                  </div>
                )}
                {errors.words ? (
                  <FieldError id="words-error">{errors.words}</FieldError>
                ) : (
                  <p className="field-hint">
                    {wordsTouched ? 'Your own limit is kept when you change marks.' : 'Suggested from the marks. You can change it.'}
                  </p>
                )}
              </fieldset>
            </div>

            {/* Answer */}
            <div className="field ws-answer">
              <label className="field-label" htmlFor="answer">
                Your answer
              </label>
              <textarea
                id="answer"
                className="input answer-input"
                placeholder={
                  'Write or paste your answer here...\n\nInclude your introduction, main arguments, examples, and conclusion.'
                }
                value={answer}
                onChange={(e) => {
                  setAnswer(e.target.value);
                  touch('answer');
                  if (confirmingClear) setConfirmingClear(false);
                }}
                aria-invalid={!!errors.answer}
                aria-describedby={errors.answer ? 'answer-error answer-meter-text' : 'answer-meter-text'}
                disabled={loading}
              />
              {errors.answer && <FieldError id="answer-error">{errors.answer}</FieldError>}

              <div className={`meter meter-${limitState}`}>
                <div className="meter-row">
                  <span className="meter-count">
                    <strong>{wordCount}</strong> {wordCount === 1 ? 'word' : 'words'}
                    <span className="meter-limit"> / {wordLimitValid ? wordLimit : '—'} limit</span>
                  </span>
                  <span className="meter-text" id="answer-meter-text">
                    {limitState === 'over' && <TriangleAlert size={14} aria-hidden="true" />}
                    {limitMessage}
                  </span>
                </div>
                <div
                  className="meter-track"
                  role="progressbar"
                  aria-label="Words used against the limit"
                  aria-valuemin={0}
                  aria-valuemax={wordLimitValid ? wordLimit ?? 0 : 0}
                  aria-valuenow={wordCount}
                  aria-valuetext={`${wordCount} of ${wordLimitValid ? wordLimit : 'no valid'} words`}
                >
                  <div className="meter-fill" style={{ width: `${Math.min(ratio, 1) * 100}%` }} />
                  <span className="meter-tick" aria-hidden="true" />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="ws-actions">
              <div className="clear-area">
                {confirmingClear ? (
                  <div className="confirm" role="group" aria-label="Confirm clearing your answer">
                    <span>Discard these {wordCount} words?</span>
                    <button type="button" className="btn btn-secondary btn-sm" ref={keepButtonRef} onClick={() => setConfirmingClear(false)}>
                      Keep answer
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={doClear}>
                      Clear it
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={requestClear}
                    disabled={loading || answer.length === 0}
                  >
                    <Eraser size={16} aria-hidden="true" />
                    Clear answer
                  </button>
                )}
              </div>

              <div className="submit-area">
                {errorCount > 0 && (
                  <p className="submit-error" role="alert">
                    <CircleAlert size={16} aria-hidden="true" />
                    {errorCount === 1 ? 'Fix the highlighted field to continue.' : `Fix the ${errorCount} highlighted fields to continue.`}
                  </p>
                )}
                {apiError && (
                  <p className="submit-error" role="alert">
                    <CircleAlert size={16} aria-hidden="true" />
                    {apiError}
                  </p>
                )}
                <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
                  {loading ? (
                    <>
                      <LoaderCircle size={18} className="spin" aria-hidden="true" />
                      Evaluating...
                    </>
                  ) : (
                    'Evaluate My Answer'
                  )}
                </button>
              </div>
            </div>
          </div>

          <p className="sr-only" role="status" aria-live="polite">
            {loading ? 'Evaluating your answer.' : ''}
          </p>
        </form>
      </div>
    </section>
  );
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p className="field-error" id={id}>
      <CircleAlert size={15} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function Choice({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label>
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} />
      <span className="seg">{children}</span>
    </label>
  );
}
