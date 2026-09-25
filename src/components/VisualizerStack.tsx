import { useEffect, useState } from 'react';
import type { SessionState } from '../engine/session';
import type { FlowDirection } from './flowLayout';
import { JsonTree } from './JsonTree';
import { StateFlow } from './StateFlow';
import { InfoTip } from './Tooltip';

interface Props {
  session: SessionState;
}

const DIR_KEY = 'rn-nav-sim:flow-dir';

/**
 * The live `navigation.getState()` panel.
 *
 * Graph view draws the state tree with React Flow; JSON view shows the same
 * object verbatim. They are two readings of one value, not two models.
 */
export function VisualizerStack({ session }: Props) {
  const [view, setView] = useState<'graph' | 'json'>('graph');
  const [dir, setDir] = useState<FlowDirection>('TB');

  // Read after mount, so the first paint does not depend on storage that can
  // be missing or blocked.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(DIR_KEY);
      if (stored === 'TB' || stored === 'LR') setDir(stored);
    } catch {
      /* private window, blocked site data */
    }
  }, []);

  const pickDir = (next: FlowDirection) => {
    setDir(next);
    try {
      localStorage.setItem(DIR_KEY, next);
    } catch {
      /* not worth surfacing */
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-ink-700 px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-ink-200">
            Navigation state
            <InfoTip label="Every navigator is its own state object with its own index and routes. Each step away from the root is one getParent() hop, so the line from a screen back to the root is the path an action bubbles along. Drag to pan, scroll to zoom; the view refits whenever the shape changes." />
          </h2>
          <p className="text-[10px] text-ink-300">What navigation.getState() returns, right now</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {view === 'graph' && (
            <div className="flex items-center gap-1">
              <div className="flex rounded-md border border-ink-700 bg-ink-900 p-0.5 text-[10px] font-medium">
                {(
                  [
                    ['TB', 'Vertical'],
                    ['LR', 'Horizontal'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => pickDir(id)}
                    className={`rounded px-2 py-1 transition-colors ${
                      dir === id ? 'bg-ink-700 text-ink-200' : 'text-ink-300 hover:text-ink-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <InfoTip label="Vertical grows downward, which reads like the config object you wrote and like the JSON beside it. Horizontal puts one getParent() hop per column, which makes the bubbling path easier to follow on a deeply nested layout. Your choice is remembered." />
            </div>
          )}

          <div className="flex rounded-md border border-ink-700 bg-ink-900 p-0.5 text-[10px] font-medium">
            {(
              [
                ['graph', 'Graph'],
                ['json', 'JSON'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={`rounded px-2.5 py-1 transition-colors ${
                  view === id ? 'bg-ink-700 text-ink-200' : 'text-ink-300 hover:text-ink-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* React Flow needs a parent with a real width and height, and pans and
          zooms itself - so this container must not scroll. */}
      <div className={`min-h-0 flex-1 ${view === 'graph' ? 'overflow-hidden' : 'overflow-y-auto p-3'}`}>
        {view === 'graph' ? <StateFlow session={session} dir={dir} /> : <JsonTree root={session.root} />}
      </div>
    </section>
  );
}
