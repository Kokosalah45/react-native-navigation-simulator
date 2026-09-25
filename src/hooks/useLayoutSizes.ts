import { useCallback, useEffect, useRef, useState } from 'react';

/** Pixel sizes of the resizable panes. The visualizer column takes the slack. */
export interface LayoutSizes {
  device: number;
  controls: number;
  inspector: number;
  /** Height of the layout-configuration row inside the inspector column. */
  config: number;
}

export const DEFAULT_SIZES: LayoutSizes = { device: 312, controls: 400, inspector: 452, config: 320 };

const LIMITS: Record<keyof LayoutSizes, [number, number]> = {
  device: [248, 560],
  controls: [320, 680],
  inspector: [300, 820],
  config: [120, 900],
};

const STORAGE_KEY = 'rn-nav-sim:layout';

const clamp = (key: keyof LayoutSizes, value: number) => {
  const [min, max] = LIMITS[key];
  return Math.round(Math.min(Math.max(value, min), max));
};

function read(): LayoutSizes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SIZES;
    const parsed = JSON.parse(raw) as Partial<LayoutSizes>;
    return {
      device: clamp('device', parsed.device ?? DEFAULT_SIZES.device),
      controls: clamp('controls', parsed.controls ?? DEFAULT_SIZES.controls),
      inspector: clamp('inspector', parsed.inspector ?? DEFAULT_SIZES.inspector),
      config: clamp('config', parsed.config ?? DEFAULT_SIZES.config),
    };
  } catch {
    // Private windows and blocked site data both throw here.
    return DEFAULT_SIZES;
  }
}

export function useLayoutSizes() {
  const [sizes, setSizes] = useState<LayoutSizes>(DEFAULT_SIZES);
  const snapshot = useRef<LayoutSizes>(DEFAULT_SIZES);

  // Read after mount so the server-rendered / first paint markup stays stable.
  useEffect(() => {
    const stored = read();
    setSizes(stored);
    snapshot.current = stored;
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
    } catch {
      /* not worth surfacing */
    }
  }, [sizes]);

  /** Snapshot the current sizes at the start of a drag. */
  const beginResize = useCallback(() => {
    snapshot.current = sizes;
  }, [sizes]);

  /**
   * `delta` is the total movement since the drag started. `sign` is -1 for a
   * pane that grows when the pointer moves left/up (the inspector column).
   *
   * `budget` keeps the flexible pane from being squeezed out of existence:
   * `available` is the track size minus the dividers, `floor` the smallest the
   * flexible pane may become.
   */
  const resize = useCallback(
    (key: keyof LayoutSizes, delta: number, sign: 1 | -1 = 1, budget?: { available: number; floor: number }) => {
      setSizes((current) => {
        let next = clamp(key, snapshot.current[key] + delta * sign);

        if (budget && budget.available > 0) {
          const siblings: (keyof LayoutSizes)[] =
            key === 'config' ? [] : (['device', 'controls', 'inspector'] as const).filter((k) => k !== key);
          const taken = siblings.reduce((sum, k) => sum + current[k], 0);
          const ceiling = budget.available - taken - budget.floor;
          next = Math.max(LIMITS[key][0], Math.min(next, ceiling));
        }

        return { ...current, [key]: next };
      });
    },
    [],
  );

  const reset = useCallback((key: keyof LayoutSizes) => {
    setSizes((current) => ({ ...current, [key]: DEFAULT_SIZES[key] }));
  }, []);

  const resetAll = useCallback(() => setSizes(DEFAULT_SIZES), []);

  return { sizes, beginResize, resize, reset, resetAll };
}

/** Matches a CSS media query, so the resizable grid only applies when it fits. */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
