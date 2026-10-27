import { Menu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { FIRST_FIELD_SELECTOR, scrollToId } from '../utils/scroll';
import { LogoMark } from './LogoMark';
import './Navbar.css';

const LINKS = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'how-it-works', label: 'How It Works' },
  { id: 'criteria', label: 'Evaluation Criteria' },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);

  // Mark the section being read, so the nav shows where you are.
  useEffect(() => {
    let frame = 0;
    // The current section is the last one whose top has passed a line 35% down the viewport.
    // Computed from scroll position (not enter/leave events), so it is always consistent.
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.35;
      let current: string | null = null;
      for (const l of LINKS) {
        const el = document.getElementById(l.id);
        if (el && el.getBoundingClientRect().top <= line) current = l.id;
      }
      // Below the workspace sits its own results; they belong to the workspace.
      setActive(window.scrollY < 120 ? null : current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  // Close on Escape (returning focus to the button) and on outside click.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const go = (e: React.MouseEvent, id: string, focus?: string) => {
    e.preventDefault();
    setOpen(false);
    scrollToId(id, focus);
    history.replaceState(null, '', `#${id}`);
  };

  return (
    <header className="navbar" ref={navRef}>
      <div className="container navbar-inner">
        <a href="#top" className="brand" onClick={(e) => go(e, 'top')} aria-label="Prajna AI, back to top">
          <LogoMark />
          <span className="brand-text">
            <span className="brand-name">Prajna AI</span>
            <span className="brand-sub deva" lang="sa">
              प्रज्ञा
            </span>
          </span>
        </a>

        <nav className="nav-links" aria-label="Main">
          {LINKS.map((l) => (
            <a
              key={l.id}
              href={`#${l.id}`}
              aria-current={active === l.id ? 'location' : undefined}
              onClick={(e) => go(e, l.id)}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <a
          href="#workspace"
          className="btn btn-primary btn-sm nav-cta"
          onClick={(e) => go(e, 'workspace', FIRST_FIELD_SELECTOR)}
        >
          Evaluate an Answer
        </a>

        <button
          ref={menuButtonRef}
          type="button"
          className="menu-toggle"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      <div id="mobile-menu" className={`mobile-menu${open ? ' is-open' : ''}`} hidden={!open}>
        <div className="container">
          <nav aria-label="Mobile">
            {LINKS.map((l) => (
              <a key={l.id} href={`#${l.id}`} onClick={(e) => go(e, l.id)}>
                {l.label}
              </a>
            ))}
            <a
              href="#workspace"
              className="btn btn-primary"
              onClick={(e) => go(e, 'workspace', FIRST_FIELD_SELECTOR)}
            >
              Evaluate an Answer
            </a>
          </nav>
        </div>
      </div>
    </header>
  );
}
