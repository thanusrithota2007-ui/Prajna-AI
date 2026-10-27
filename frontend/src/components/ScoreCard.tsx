import { ArrowUpRight, Check, Quote } from 'lucide-react';
import type { DimensionResult } from '../types';
import { formatScore } from '../utils/text';

const BAND_CLASS: Record<DimensionResult['band'], string> = {
  'Needs work': 'band-low',
  Developing: 'band-mid',
  Solid: 'band-good',
  Strong: 'band-good',
};

export function ScoreCard({ dimension }: { dimension: DimensionResult }) {
  const { label, score, maxScore, band, explanation, strength, improvement, evidence, suggestions, key } = dimension;
  const pct = Math.round((score / maxScore) * 100);
  const titleId = `dim-${key}`;

  return (
    <article className="score-card" aria-labelledby={titleId}>
      <header className="score-card-head">
        <h4 id={titleId}>{label}</h4>
        <span className={`band ${BAND_CLASS[band]}`}>{band}</span>
      </header>

      <p className="score-figure">
        <span className="score-num">{formatScore(score)}</span>
        <span className="score-max"> / {maxScore}</span>
      </p>

      <div
        className={`bar ${BAND_CLASS[band]}`}
        role="meter"
        aria-label={`${label} score`}
        aria-valuemin={0}
        aria-valuemax={maxScore}
        aria-valuenow={score}
        aria-valuetext={`${formatScore(score)} out of ${maxScore}, ${band}`}
      >
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>

      <p className="score-explain">{explanation}</p>

      {strength && improvement && (
        <dl className="score-notes">
          <div>
            <dt>
              <Check size={15} aria-hidden="true" /> Strength
            </dt>
            <dd>{strength}</dd>
          </div>
          <div>
            <dt>
              <ArrowUpRight size={15} aria-hidden="true" /> To improve
            </dt>
            <dd>{improvement}</dd>
          </div>
        </dl>
      )}

      {evidence && evidence.length > 0 && (
        <div className="evidence">
          <h5>
            <Quote size={15} aria-hidden="true" /> From your answer
          </h5>
          <ul>
            {evidence.map((e, i) => (
              <li key={`${i}-${e.quote}`}>
                <q>{e.quote}</q>
                <span>{e.comment}</span>
                {!e.verified && <span className="chip chip-muted">Not found word-for-word in your answer</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {suggestions && suggestions.length > 0 && (
        <div className="evidence">
          <h5>
            <ArrowUpRight size={15} aria-hidden="true" /> To improve
          </h5>
          <ul>
            {suggestions.map((s, i) => (
              <li key={`${i}-${s}`}>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
