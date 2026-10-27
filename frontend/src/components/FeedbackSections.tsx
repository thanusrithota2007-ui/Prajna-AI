import { CircleCheck, CircleDashed } from 'lucide-react';
import type { ImprovementPoint, StructureReview } from '../types';

export function StrengthsSection({ items }: { items: string[] }) {
  return (
    <section className="fb-block" aria-labelledby="strengths-title">
      <h3 id="strengths-title">What You Did Well</h3>
      <ul className="fb-list fb-list-good">
        {items.map((text) => (
          <li key={text}>
            <span className="fb-mark fb-mark-good" aria-hidden="true">
              <CircleCheck size={18} />
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ImprovementsSection({ items }: { items: ImprovementPoint[] }) {
  return (
    <section className="fb-block" aria-labelledby="improve-title">
      <h3 id="improve-title">Where You Can Improve</h3>
      <ul className="fb-list">
        {items.map((it, i) => (
          <li key={`${i}-${it.title}`} className="fb-improve">
            <strong>{it.title}</strong>
            <span>
              <b>Change: </b>
              {it.action}
            </span>
            {it.reason && (
              <span className="fb-why">
                <b>Why: </b>
                {it.reason}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NextStepsSection({ steps }: { steps: string[] }) {
  return (
    <section className="fb-block" aria-labelledby="steps-title">
      <h3 id="steps-title">Your Next Steps</h3>
      <ol className="steps">
        {steps.map((s) => (
          <li key={s}>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function StructureSection({ items }: { items: StructureReview[] }) {
  return (
    <section className="fb-block" aria-labelledby="structure-title">
      <h3 id="structure-title">Answer-Writing Structure</h3>
      <p className="fb-sub">
        A quick read of how the answer is shaped. The right structure depends on the question, so "Worth checking" is a
        prompt, not a mistake.
      </p>
      <ol className="structure">
        {items.map((it) => (
          <li key={it.part} className={`structure-item structure-${it.status}`}>
            <div className="structure-head">
              {it.status === 'observed' ? (
                <CircleCheck size={18} aria-hidden="true" />
              ) : (
                <CircleDashed size={18} aria-hidden="true" />
              )}
              <strong>{it.part}</strong>
              <span className={`chip ${it.status === 'observed' ? 'chip-green' : 'chip-muted'}`}>
                {it.status === 'observed' ? 'Signal found' : 'Worth checking'}
              </span>
            </div>
            <p>{it.note}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
