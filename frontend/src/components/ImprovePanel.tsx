import { Lightbulb } from 'lucide-react';
import type { EvaluationRequest, ImprovementPoint, SampleImprovement } from '../types';
import { countWords } from '../utils/text';

interface Props {
  /** Sample mode only. */
  sample?: SampleImprovement;
  /** Backend mode: the suggestions from the evaluation itself. */
  improvements?: ImprovementPoint[];
  request: EvaluationRequest;
}

export function ImprovePanel({ sample, improvements, request }: Props) {
  return (
    <div className="improve">
      {!sample && improvements && improvements.length > 0 && (
        <section className="improve-sample" aria-labelledby="improve-title-real">
          <header className="improve-head">
            <h3 id="improve-title-real">Suggestions for this answer</h3>
          </header>
          <p className="fb-sub">Taken from your evaluation, criterion by criterion. Rewrite the answer yourself using them.</p>
          <ul className="fb-list fb-list-plain">
            {improvements.map((it, i) => (
              <li key={`${i}-${it.action}`}>
                <strong>{it.title}: </strong>
                {it.action}
              </li>
            ))}
          </ul>
        </section>
      )}

      {sample && (
      <section className="improve-sample" aria-labelledby="improve-title-sample">
        <header className="improve-head">
          <h3 id="improve-title-sample">Sample improvement</h3>
          <span className="chip chip-saffron">
            <Lightbulb size={14} aria-hidden="true" />
            Sample, not generated from your answer
          </span>
        </header>
        <p className="fb-sub">{sample.caption}</p>

        <p className="improve-q">
          <span>Sample question</span>
          {sample.sampleQuestion}
        </p>

        <div className="improve-compare">
          <figure>
            <figcaption>Before</figcaption>
            <blockquote>{sample.before}</blockquote>
          </figure>
          <figure className="improve-after">
            <figcaption>After</figcaption>
            <blockquote>{sample.after}</blockquote>
          </figure>
        </div>

        <h4 className="improve-subhead">What changed</h4>
        <ul className="fb-list fb-list-plain">
          {sample.whatChanged.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>
      )}

      <section className="improve-original" aria-labelledby="original-title">
        <h3 id="original-title">Your original answer</h3>
        <p className="fb-sub">
          Kept exactly as you submitted it, {countWords(request.answer)} words. Try rewriting it using your feedback.
        </p>
        <details>
          <summary>Question</summary>
          <p className="original-text">{request.question}</p>
        </details>
        <details open>
          <summary>Answer</summary>
          <p className="original-text">{request.answer}</p>
        </details>
      </section>
    </div>
  );
}
