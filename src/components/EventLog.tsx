import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogEntry } from '../engine/types';
import type { SessionState } from '../engine/session';
import { readHabits, type Habit } from '../engine/coach';
import { CodeLine } from './CodeBlock';
import { InfoTip } from './Tooltip';

interface Props {
  log: LogEntry[];
  session: SessionState;
  onClear: () => void;
}

type Filter = 'all' | 'lifecycle' | 'problems' | 'session';

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
export function EventLog({ log, session, onClear }: Props) {
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
        <span className="mono text-[10px] text-ink-300">
          {filter === 'session' ? `${session.journey.length} dispatched` : `${log.length} events`}
        </span>
        {filter === 'session' && (
          <InfoTip label="The session read back as a whole. No single dispatch looks wrong on its own - it is the pattern across them that tells you whether the structure is fighting you." />
        )}

        <div className="ml-auto flex items-center gap-1">
          {(['all', 'lifecycle', 'problems', 'session'] as const).map((f) => (
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

      {filter === 'session' ? (
        <SessionView session={session} />
      ) : (
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
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

const SEVERITY = {
  warn: { tone: 'border-v6-400/45 bg-v6-400/[0.07]', mark: '△', text: 'text-v6-400' },
  info: { tone: 'border-ink-700 bg-ink-900/50', mark: '·', text: 'text-ink-300' },
  good: { tone: 'border-alive-400/35 bg-alive-400/[0.05]', mark: '✓', text: 'text-alive-400' },
} as const;

const KIND_NOTE: Record<string, string> = {
  mount: 'mounted a screen',
  unmount: 'destroyed a screen',
  swap: 'swapped one screen for another',
  focus: 'moved focus only',
  none: 'changed nothing',
};

/**
 * The session read back as a whole: what you have been doing, and what it
 * suggests about the shape of the layout.
 */
function SessionView({ session }: { session: SessionState }) {
  const habits = useMemo(() => readHabits(session), [session]);
  const journey = session.journey;

  if (!journey.length) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <p className="text-[11px] leading-relaxed text-ink-300">
          Nothing dispatched yet. Move around the app the way you would in the real one — a few screens deep, into another
          section, then back — and this reads the run back to you: which calls grew the stack, which returned to what was
          already there, and whether the structure is the one fighting you.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
      {habits.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {habits.map((habit) => (
            <HabitCard key={habit.id} habit={habit} />
          ))}
        </div>
      )}

      <h3 className="mono mb-1 text-[9.5px] uppercase tracking-wider text-ink-500">this session</h3>
      <ol className="space-y-1">
        {journey.map((entry) => (
          <li
            key={entry.seq}
            className={`rounded border px-2 py-1.5 ${
              entry.error
                ? 'border-gone-400/40 bg-gone-400/[0.06]'
                : entry.duplicated
                  ? 'border-v6-400/40 bg-v6-400/[0.05]'
                  : 'border-ink-700/70 bg-ink-900/40'
            }`}
          >
            <div className="flex items-baseline gap-1.5">
              <span className="mono shrink-0 text-[9.5px] text-ink-500">{String(entry.seq).padStart(2, '0')}</span>
              <CodeLine code={entry.code} className="min-w-0 text-[10px]" />
            </div>
            <div className="mono mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-5 text-[9.5px] text-ink-500">
              <span>
                {entry.error ? (
                  <span className="text-gone-400">unhandled</span>
                ) : (
                  <>
                    handled by <span className="text-ink-300">{entry.handledBy}</span>
                    {entry.handledByType && entry.handledByType !== 'stack' && (
                      <span className="text-alive-400"> ({entry.handledByType})</span>
                    )}
                  </>
                )}
              </span>
              <span>· {KIND_NOTE[entry.kind]}</span>
              <span>· root depth {entry.rootDepth}</span>
              {entry.popOption && <span className="text-alive-400">· pop: true</span>}
              {entry.duplicated && <span className="text-v6-400">· 2nd {entry.duplicated}</span>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function HabitCard({ habit }: { habit: Habit }) {
  const [open, setOpen] = useState(false);
  const tone = SEVERITY[habit.severity];

  return (
    <div className={`rounded-lg border px-2.5 py-2 ${tone.tone}`}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-1.5 text-left">
        <span className={`mono shrink-0 text-[11px] leading-none ${tone.text}`}>{tone.mark}</span>
        <span className="min-w-0 flex-1 text-[11px] font-semibold leading-snug text-ink-200">{habit.title}</span>
        <span className="mono shrink-0 text-[9px] text-ink-500">{open ? 'less' : 'why'}</span>
      </button>

      {open && (
        <div className="mt-1.5 space-y-1.5 pl-[18px]">
          <p className="text-[10.5px] leading-relaxed text-ink-300">{habit.detail}</p>
          {habit.fix && (
            <p className="rounded border border-focus-400/30 bg-focus-400/[0.07] px-2 py-1.5 text-[10.5px] leading-relaxed text-ink-200">
              <span className="mono text-[9px] font-bold uppercase tracking-wider text-focus-400">do this </span>
              {habit.fix}
            </p>
          )}
          {habit.seqs.length > 0 && (
            <p className="mono text-[9.5px] text-ink-500">
              dispatch {habit.seqs.map((n) => String(n).padStart(2, '0')).join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
