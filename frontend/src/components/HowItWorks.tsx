import { ClipboardCheck, FileText, TrendingUp } from 'lucide-react';
import './Sections.css';

const STEPS = [
  {
    n: '01',
    title: 'Submit',
    text: 'Paste the UPSC Mains question and your answer.',
    Icon: FileText,
  },
  {
    n: '02',
    title: 'Evaluate',
    text: 'Review feedback on clarity of thought, depth of analysis, and language and expression.',
    Icon: ClipboardCheck,
  },
  {
    n: '03',
    title: 'Improve',
    text: 'Use the feedback to strengthen your next answer.',
    Icon: TrendingUp,
  },
];

export function HowItWorks() {
  return (
    <section className="section how" id="how-it-works" aria-labelledby="how-title">
      <div className="container">
        <div className="section-head">
          <h2 id="how-title">How it works</h2>
          <p>Three steps, repeated with every answer you write.</p>
        </div>

        <ol className="how-steps">
          {STEPS.map(({ n, title, text, Icon }) => (
            <li key={n}>
              <div className="how-top">
                <span className="how-icon" aria-hidden="true">
                  <Icon size={22} />
                </span>
                <span className="how-num" aria-hidden="true">
                  {n}
                </span>
              </div>
              <h3>
                <span className="sr-only">Step {n}: </span>
                {title}
              </h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
