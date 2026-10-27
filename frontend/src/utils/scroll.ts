const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Smooth-scroll to an element id, then optionally move keyboard focus inside it.
 * The focus target is looked up after the delay, not before, so it still works
 * when the section is re-created (remounted) in the meantime.
 */
export function scrollToId(id: string, focusSelector?: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = prefersReducedMotion();
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  if (focusSelector) {
    window.setTimeout(
      () => {
        // preventScroll: the scroll above is already handling the viewport.
        document.getElementById(id)?.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
      },
      reduce ? 0 : 450,
    );
  }
}

export const FIRST_FIELD_SELECTOR = '#question';
