import { scrollToId } from '../utils/scroll';
import { LogoMark } from './LogoMark';
import './Sections.css';

const LINKS = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'how-it-works', label: 'How It Works' },
  { id: 'criteria', label: 'Evaluation Criteria' },
  { id: 'top', label: 'Back to top' },
];

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <div className="footer-brand">
              <LogoMark size={32} />
              <strong>
                Prajna AI <span aria-hidden="true">&mdash;</span> <span className="deva" lang="sa">प्रज्ञा</span>
              </strong>
            </div>
            <p className="footer-tagline">Write with clarity. Think with depth.</p>
            <p className="footer-desc">
              A practice companion for UPSC Mains aspirants: structured feedback on reasoning, evidence and expression,
              with clear steps for the next answer.
            </p>
          </div>

          <nav aria-label="Footer">
            {LINKS.map((l) => (
              <a
                key={l.id}
                href={`#${l.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  scrollToId(l.id);
                  history.replaceState(null, '', `#${l.id}`);
                }}
              >
                {l.label}
              </a>
            ))}
          </nav>
        </div>

        <p className="footer-bottom">
          Evaluations are for practice and learning. Prajna AI is not affiliated with the Union Public Service
          Commission, and its feedback does not predict examination marks.
        </p>
      </div>
    </footer>
  );
}
