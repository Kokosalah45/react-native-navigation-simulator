import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogEntry } from '../engine/types';
import { CodeLine } from './CodeBlock';

interface Props {
  log: LogEntry[];
  onClear: () => void;
}

type Filter = 'all' | 'lifecycle' | 'problems';

const KIND_LABEL: Record<string, string> = {
  mount: 'MOUNT',
  unmount: 'UNMOUNT',
  focus: 'FOCUS',
  blur: 'BLUR',
};

const KIND_TONE: Record<string, string> = {
  mount: 'text-alive-400',
  unmount: 'text-gone-400',
  focus: 'text-focus-400',
  blur: 'text-ink-300',
};

/**
 * The lifecycle console. Everything a `console.log` in useEffect /
 * useFocusEffect would have printed, in the order the hooks would fire.
 */
export function EventLog({ log, onClear }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const bottomRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(() => {
    if (filter === 'lifecycle') return log.filter((e) => e.level === 'lifecycle');
    if (filter === 'problems') return log.filter((e) => e.level === 'error' || e.level === 'warn');
    return log;
  }, [log, filter]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [entries.length]);

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-ink-950">
      <header className="flex items-center gap-2 border-b border-ink-700 px-4 py-2">
        <h2 className="text-[12px] font-semibold text-ink-200">Lifecycle console</h2>
        <span className="mono text-[10px] text-ink-300">{log.length} events</span>

        <div className="ml-auto flex items-center gap-1">
          {(['all', 'lifecycle', 'problems'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                filter === f ? 'bg-ink-700 text-ink-200' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-200'
              }`}
            >
              {f}
            </button>
          ))}
          <button
            onClick={onClear}
            className="ml-1 rounded border border-ink-700 px-2 py-0.5 text-[10px] text-ink-300 transition-colors hover:border-ink-600 hover:text-ink-200"
          >
            clear
          </button>
        </div>
      </header>

      <div className="mono min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[10.5px] leading-[1.65]">
        {entries.length === 0 && <p className="text-ink-300">No events yet. Fire an action from the command center.</p>}

        {entries.map((entry) => (
          <div key={entry.id} className="flex gap-2 whitespace-pre-wrap">
            <span className="shrink-0 select-none text-ink-500">{String(entry.t).padStart(3, '0')}</span>

            {entry.level === 'action' && (
              <span className="flex min-w-0 gap-1.5">
                <span className="shrink-0 text-focus-400">$</span>
                <CodeLine code={entry.text} className="text-[10.5px]" />
              </span>
            )}

            {entry.level === 'lifecycle' && (
              <>
                <span className={`shrink-0 ${KIND_TONE[entry.kind ?? ''] ?? 'text-ink-300'}`}>
                  [{KIND_LABEL[entry.kind ?? ''] ?? '...'}]
                </span>
                <span className="shrink-0 text-ink-500">{entry.hook}</span>
                <span className="text-ink-200">{entry.text}</span>
              </>
            )}

            {entry.level === 'error' && <span className="text-gone-400">⨯ {entry.text}</span>}
            {entry.level === 'warn' && <span className="text-v6-400">△ {entry.text}</span>}
            {entry.level === 'info' && <span className="text-ink-300">· {entry.text}</span>}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
