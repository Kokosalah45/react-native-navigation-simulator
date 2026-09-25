import { useState } from 'react';
import type { SessionState } from '../engine/session';
import { JsonTree } from './JsonTree';
import { StateFlow } from './StateFlow';
import { InfoTip } from './Tooltip';

interface Props {
  session: SessionState;
}

/**
 * The live `navigation.getState()` panel.
 *
 * Graph view draws the state tree with React Flow; JSON view shows the same
 * object verbatim. They are two readings of one value, not two models.
 */
export function VisualizerStack({ session }: Props) {
  const [view, setView] = useState<'graph' | 'json'>('graph');

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-ink-700 px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-ink-200">
            Navigation state
            <InfoTip label="Every navigator is its own state object with its own index and routes. Depth runs left to right, so one column is one getParent() hop - and the path an action bubbles along is the horizontal one. Drag to pan, scroll to zoom; the view refits whenever the shape changes." />
          </h2>
          <p className="text-[10px] text-ink-300">What navigation.getState() returns, right now</p>
        </div>
        <div className="flex shrink-0 rounded-md border border-ink-700 bg-ink-900 p-0.5 text-[10px] font-medium">
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
      </header>

      {/* React Flow needs a parent with a real width and height, and pans and
          zooms itself - so this container must not scroll. */}
      <div className={`min-h-0 flex-1 ${view === 'graph' ? 'overflow-hidden' : 'overflow-y-auto p-3'}`}>
        {view === 'graph' ? <StateFlow session={session} /> : <JsonTree root={session.root} />}
      </div>
    </section>
  );
}
