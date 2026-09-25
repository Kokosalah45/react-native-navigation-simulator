import { useCallback, useRef, useState } from 'react';

interface Props {
  /** 'vertical' renders a vertical bar that drags horizontally (between columns). */
  orientation: 'vertical' | 'horizontal';
  /** Called once per drag so the parent can snapshot the current size. */
  onResizeStart: () => void;
  /** Total pixel delta from the drag origin. */
  onResize: (delta: number) => void;
  /** Double-click restores the default. */
  onReset: () => void;
  label: string;
}

const STEP = 24;

/**
 * A draggable divider. Uses pointer capture so the drag keeps tracking even
 * when the cursor leaves the handle, and reports the TOTAL delta from the drag
 * origin so that clamping in the parent never causes drift.
 */
export function ResizeHandle({ orientation, onResizeStart, onResize, onReset, label }: Props) {
  const origin = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const vertical = orientation === 'vertical';

  const handleDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      origin.current = vertical ? e.clientX : e.clientY;
      setActive(true);
      onResizeStart();
    },
    [vertical, onResizeStart],
  );

  const handleMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (origin.current === null) return;
      onResize((vertical ? e.clientX : e.clientY) - origin.current);
    },
    [vertical, onResize],
  );

  const handleUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    origin.current = null;
    setActive(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const back = vertical ? 'ArrowLeft' : 'ArrowUp';
      const forward = vertical ? 'ArrowRight' : 'ArrowDown';
      if (e.key !== back && e.key !== forward) return;
      e.preventDefault();
      onResizeStart();
      onResize(e.key === back ? -STEP : STEP);
    },
    [vertical, onResizeStart, onResize],
  );

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      title={`${label} — drag to resize, double-click to reset`}
      tabIndex={0}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onDoubleClick={onReset}
      onKeyDown={handleKey}
      className={`group relative flex shrink-0 items-center justify-center bg-ink-800 outline-none transition-colors hover:bg-focus-400/50 focus-visible:bg-focus-400/60 ${
        active ? 'bg-focus-400/70' : ''
      } ${vertical ? 'h-full w-1.5 cursor-col-resize' : 'h-1.5 w-full cursor-row-resize'}`}
    >
      {/* grip dots, so the divider reads as draggable */}
      <span
        className={`pointer-events-none rounded-full bg-ink-500 opacity-0 transition-opacity group-hover:opacity-100 ${
          vertical ? 'h-6 w-[2px]' : 'h-[2px] w-6'
        } ${active ? 'opacity-100' : ''}`}
      />
    </div>
  );
}
