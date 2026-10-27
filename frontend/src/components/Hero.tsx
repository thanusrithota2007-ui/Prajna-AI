import { ArrowRight, ShieldCheck } from 'lucide-react';
import { isMockMode } from '../services/evaluationApi';
import { FIRST_FIELD_SELECTOR, scrollToId } from '../utils/scroll';
import './Hero.css';

function go(e: React.MouseEvent, id: string, focus?: string) {
  e.preventDefault();
  scrollToId(id, focus);
  history.replaceState(null, '', `#${id}`);
}

const LENSES = [
  { title: 'Clarity of thought', text: 'Is the answer organised, relevant and direct?' },
  { title: 'Depth of analysis', text: 'Does it reason, give evidence and weigh more than one side?' },
  { title: 'Language and expression', text: 'Is it precise and readable in an exam setting?' },
];

export function Hero() {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="container">
        <p className="hero-label">YOUR UPSC MAINS ANSWER-WRITING COACH</p>
        <h1 id="hero-title">
          Write better answers.
          <br />
          Think deeper.
        </h1>

        <div className="hero-body">
          <div className="hero-copy">
            <p className="hero-lede">
              Get structured feedback on your UPSC Mains answers, understand where your reasoning falls short, and learn
              how to improve.
            </p>

            <div className="hero-actions">
              <a
                href="#workspace"
                className="btn btn-primary"
                onClick={(e) => go(e, 'workspace', FIRST_FIELD_SELECTOR)}
              >
                Evaluate My Answer
                <ArrowRight size={18} className="nudge" aria-hidden="true" />
              </a>
              <a href="#criteria" className="btn btn-secondary" onClick={(e) => go(e, 'criteria')}>
                Explore the Evaluation
              </a>
            </div>

            <p className="hero-note">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>
                {isMockMode
                  ? 'This version runs on sample data in your browser. Your answer is not uploaded.'
                  : 'Practice feedback for learning, not an official UPSC evaluation.'}
              </span>
            </p>

            <ul className="lenses" aria-label="What every answer is read for">
              {LENSES.map((l) => (
                <li key={l.title}>
                  <strong>{l.title}</strong>
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
          </div>

          <AnnotatedSheet />
        </div>
      </div>
    </section>
  );
}

type Tone = 'good' | 'revisit';

function Pin({ k, tone }: { k: string; tone: Tone }) {
  return (
    <sup className={`pin pin-${tone}`} aria-label={`note ${k}`}>
      {k}
    </sup>
  );
}

/**
 * The product's signature visual: a ruled answer sheet marked up like a tutor's
 * script, with margin notes beside the lines they refer to.
 * Illustrative only: a made-up question and answer, not a real evaluation.
 */
function AnnotatedSheet() {
  return (
    <figure className="sheet" aria-labelledby="sheet-caption">
      <div className="sheet-paper">
        <figcaption className="sheet-meta" id="sheet-caption">
          <span className="chip chip-muted">Illustration</span>
          <span>A made-up sample, not a real evaluation</span>
        </figcaption>

        <div className="sheet-q">
          <span>Sample question</span>
          <p>Examine the challenges of cooperative federalism in India.</p>
        </div>

        <div className="sheet-rows">
          <div className="anno-row">
            <p className="anno-text">
              Cooperative federalism treats the Centre and states as partners in policy.{' '}
              <mark className="hl hl-good" style={{ ['--i' as string]: 0 }}>
                Its promise is visible in the GST Council
                <Pin k="A" tone="good" />
              </mark>
              , where decisions are shared.
            </p>
            <aside className="anno-note anno-good" style={{ ['--i' as string]: 0 }}>
              <span className="pin pin-good" aria-hidden="true">A</span>
              <div>
                <b>Works well</b>
                <span>A named forum beats a general claim.</span>
              </div>
            </aside>
          </div>

          <div className="anno-row">
            <p className="anno-text">
              <mark className="hl hl-good" style={{ ['--i' as string]: 1 }}>
                However
                <Pin k="B" tone="good" />
              </mark>
              , fiscal dependence on central transfers limits that partnership.
            </p>
            <aside className="anno-note anno-good" style={{ ['--i' as string]: 1 }}>
              <span className="pin pin-good" aria-hidden="true">B</span>
              <div>
                <b>Works well</b>
                <span>A counter-view shows balance. Add why it matters.</span>
              </div>
            </aside>
          </div>

          <div className="anno-row">
            <p className="anno-text">
              <span className="hl hl-gap" style={{ ['--i' as string]: 2 }}>
                Way forward goes here.
                <Pin k="C" tone="revisit" />
              </span>
            </p>
            <aside className="anno-note anno-revisit" style={{ ['--i' as string]: 2 }}>
              <span className="pin pin-revisit" aria-hidden="true">C</span>
              <div>
                <b>Revisit</b>
                <span>Many questions expect a way forward.</span>
              </div>
            </aside>
          </div>
        </div>

        <ul className="legend" aria-label="Key to the marks">
          <li>
            <span className="key key-good" aria-hidden="true" />
            Green line: working well
          </li>
          <li>
            <span className="key key-revisit" aria-hidden="true" />
            Saffron wave: worth revisiting
          </li>
        </ul>
      </div>
    </figure>
  );
}
