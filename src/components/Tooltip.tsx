import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  /** Widen for long explanations. */
  wide?: boolean;
  /** Hover dwell before showing, in ms. Keyboard focus always shows instantly. */
  delay?: number;
}

const DEFAULT_DELAY = 350;

/**
 * Portal-based tooltip: the visualizer panels scroll, so an inline absolutely
 * positioned tooltip would be clipped by their overflow container.
 *
 * Two rules keep these out of the way:
 *  - hovering has to dwell before anything appears, so passing the pointer
 *    over a control on the way somewhere else never pops a panel open;
 *  - the trigger should be a small, deliberate target. Anything wide or
 *    horizontally scrollable (code blocks, params, selects) gets an `InfoTip`
 *    or a short underlined label instead of wrapping the whole element.
 */
export function Tooltip({ label, children, className = '', wide = false, delay = DEFAULT_DELAY }: TooltipProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const width = wide ? 380 : 300;
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12);
    const top = rect.top > 220 ? rect.top - 12 : rect.bottom + 12;
    setPos({ top, left });
  }, [wide]);

  const clear = useCallback(() => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const show = useCallback(() => {
    clear();
    timer.current = window.setTimeout(place, delay);
  }, [clear, place, delay]);

  const hide = useCallback(() => {
    clear();
    setPos(null);
  }, [clear]);

  useEffect(() => clear, [clear]);

  return (
    <>
      <span
        ref={ref}
        className={className}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={place}
        onBlur={hide}
        tabIndex={0}
      >
        {children}
      </span>
      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{
              top: pos.top,
              left: pos.left,
              width: wide ? 380 : 300,
              transform: pos.top < 220 ? undefined : 'translateY(-100%)',
            }}
            className="animate-fade-up pointer-events-none fixed z-50 rounded-lg border border-ink-600 bg-ink-850/98 p-3 text-[11px] leading-relaxed text-ink-200 shadow-2xl shadow-black/60 backdrop-blur"
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * A small question-mark target. Use this next to a heading or label when the
 * thing being explained is wide, scrollable or interactive, so the explanation
 * never sits between the reader and the content.
 */
export function InfoTip({ label, wide = true, className = '' }: { label: ReactNode; wide?: boolean; className?: string }) {
  return (
    <Tooltip wide={wide} label={label} className={`inline-flex ${className}`}>
      <span className="mono inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-ink-600 text-[8.5px] leading-none text-ink-300 transition-colors hover:border-focus-400 hover:text-focus-400">
        ?
      </span>
    </Tooltip>
  );
}

/**
 * A short inline label that carries a tooltip, marked with a dotted underline.
 * Keeps the hover target down to the word itself rather than the whole line.
 */
export function HintLabel({ label, children, wide = true }: { label: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <Tooltip wide={wide} label={label}>
      <span className="cursor-help underline decoration-ink-500 decoration-dotted underline-offset-2 hover:decoration-focus-400">
        {children}
      </span>
    </Tooltip>
  );
}
