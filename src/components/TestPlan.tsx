import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { DUP_TEST_LAYOUT, SECTIONS, STORAGE_KEYS, TOTAL, type Scenario } from '../testPlan';
import { importLayout, loadLayouts, saveLayouts } from '../engine/layouts';
import { CodeBlock } from './CodeBlock';
import { InfoTip } from './Tooltip';

type Status = 'pass' | 'fail';
type Runs = Record<string, Status>;

const RUNS_KEY = 'rn-nav-sim:test-runs';

const readRuns = (): Runs => {
  try {
    const raw = localStorage.getItem(RUNS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Runs) : {};
  } catch {
    return {}; // private window, blocked site data
  }
};

/**
 * The manual test plan, as a page you can work through.
 *
 * Results live in localStorage rather than in memory so a run survives the
 * reloads several of the checks ask for - B1 and B2 both end in "reload the
 * page", and a checklist that forgets itself at that point is useless.
 */
export function TestPlan() {
  const [runs, setRuns] = useState<Runs>({});
  const [imported, setImported] = useState<string | null>(null);
  const navigate = useNavigate();

  // Mirrors `runs` so a mark always builds on the latest results. Reading the
  // state variable instead meant two clicks in quick succession both started
  // from the same snapshot, and the first one was lost.
  const latest = useRef<Runs>({});

  const persist = useCallback((next: Runs) => {
    latest.current = next;
    setRuns(next);
    try {
      localStorage.setItem(RUNS_KEY, JSON.stringify(next));
    } catch {
      /* not worth surfacing */
    }
  }, []);

  useEffect(() => {
    const stored = readRuns();
    latest.current = stored;
    setRuns(stored);
  }, []);

  const mark = (id: string, status: Status) => {
    const next = { ...latest.current };
    if (next[id] === status) delete next[id];
    else next[id] = status;
    persist(next);
  };

  const tally = useMemo(() => {
    const values = Object.values(runs);
    return {
      pass: values.filter((v) => v === 'pass').length,
      fail: values.filter((v) => v === 'fail').length,
    };
  }, [runs]);

  const done = tally.pass + tally.fail;

  /** Loads the fixture these checks need and drops you into the simulator. */
  const loadFixture = () => {
    const result = importLayout(DUP_TEST_LAYOUT);
    if (!result.ok) {
      setImported(result.errors[0] ?? 'Could not import the layout.');
      return;
    }
    const existing = loadLayouts().filter((l) => l.label !== result.value.label);
    saveLayouts([...existing, result.value]);
    navigate('/');
  };

  return (
    <div className="min-h-full bg-ink-950">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-ink-700 bg-ink-900/95 px-4 py-2.5 backdrop-blur">
        <div className="min-w-0">
          <h1 className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-ink-200">
            Manual test plan
            <InfoTip label="Each check is written to be able to fail: a step you can perform and one observable result. Results are kept in this browser, so a run survives the reloads some of the checks ask for." />
          </h1>
          <p className="text-[10px] text-ink-300">
            {TOTAL} checks · ordered by risk, newest work first
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="mono rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-[10.5px] text-ink-300">
            <span className="text-alive-400">{tally.pass} pass</span>
            {' · '}
            <span className={tally.fail ? 'text-gone-400' : ''}>{tally.fail} fail</span>
            {' · '}
            {TOTAL - done} left
          </span>

          <button
            onClick={() => persist({})}
            disabled={done === 0}
            className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1 text-[11px] text-ink-200 transition-colors hover:border-ink-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reset run
          </button>

          <Link
            to="/"
            className="rounded-md border border-focus-400/50 bg-focus-400/10 px-2.5 py-1 text-[11px] text-focus-400 transition-colors hover:bg-focus-400/20"
          >
            ‹ Simulator
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[900px] px-4 py-5">
        {/* ------------------------------- setup ------------------------------- */}
        <section className="mb-6 rounded-xl border border-ink-700 bg-ink-900/60 p-4">
          <h2 className="text-[12.5px] font-semibold text-ink-200">Setup</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-300">
            Section A needs two instances of the same nested navigator, which none of the built-in presets can produce —
            they have no screen you can reach twice. This fixture has two: a tab navigator and a stack, side by side as
            routes of one root stack.
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              onClick={loadFixture}
              className="rounded-md border border-alive-400/50 bg-alive-400/10 px-2.5 py-1 text-[11px] text-alive-400 transition-colors hover:bg-alive-400/20"
            >
              Save fixture &amp; open simulator
            </button>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(DUP_TEST_LAYOUT).then(
                  () => setImported('Copied.'),
                  () => setImported('Could not copy.'),
                );
              }}
              className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1 text-[11px] text-ink-200 transition-colors hover:border-ink-500"
            >
              Copy JSON
            </button>
            {imported && <span className="text-[10.5px] text-ink-300">{imported}</span>}
          </div>

          <CodeBlock code={DUP_TEST_LAYOUT} language="json" className="mt-2.5 max-h-56" />

          <h3 className="mt-4 text-[11px] font-semibold text-ink-200">Starting from clean</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-300">
            Everything the app remembers between visits lives under these keys. Clear them to reproduce a first visit:
          </p>
          <ul className="mono mt-1.5 space-y-0.5">
            {STORAGE_KEYS.map(([key, what]) => (
              <li key={key} className="text-[10px] text-ink-300">
                <span className="text-param-400">{key}</span> — {what}
              </li>
            ))}
          </ul>
        </section>

        {/* ------------------------------ sections ----------------------------- */}
        {SECTIONS.map((section) => (
          <section key={section.id} className="mb-6">
            <div className="mb-2 flex items-baseline gap-2">
              <span className="mono rounded border border-focus-400/40 bg-focus-400/10 px-1.5 py-0.5 text-[10px] font-bold text-focus-400">
                {section.id}
              </span>
              <h2 className="text-[13px] font-semibold tracking-tight text-ink-200">{section.title}</h2>
            </div>
            <p className="mb-2.5 text-[11px] leading-relaxed text-ink-300">{section.blurb}</p>

            <div className="space-y-2">
              {section.scenarios.map((scenario) => (
                <Check key={scenario.id} scenario={scenario} status={runs[scenario.id]} onMark={mark} />
              ))}
            </div>
          </section>
        ))}

        <p className="pb-6 text-[10.5px] leading-relaxed text-ink-300">
          A failure here is worth more than a pass: every check in section A and B3 exists because that exact thing
          broke once, silently, and the graph went on looking plausible.
        </p>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Check({
  scenario,
  status,
  onMark,
}: {
  scenario: Scenario;
  status?: Status;
  onMark: (id: string, status: Status) => void;
}) {
  const border =
    status === 'pass'
      ? 'border-alive-400/50 bg-alive-400/[0.05]'
      : status === 'fail'
        ? 'border-gone-400/50 bg-gone-400/[0.06]'
        : 'border-ink-700 bg-ink-900/40';

  return (
    <div className={`rounded-lg border p-3 transition-colors ${border}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono rounded bg-ink-800 px-1.5 py-0.5 text-[10px] font-semibold text-ink-300">
          {scenario.id}
        </span>
        <h3 className="min-w-0 flex-1 text-[12px] font-semibold text-ink-200">{scenario.title}</h3>

        <span className="flex shrink-0 gap-1">
          <button
            onClick={() => onMark(scenario.id, 'pass')}
            className={`mono rounded border px-2 py-0.5 text-[10px] transition-colors ${
              status === 'pass'
                ? 'border-alive-400 bg-alive-400/15 text-alive-400'
                : 'border-ink-700 text-ink-300 hover:border-alive-400 hover:text-alive-400'
            }`}
          >
            pass
          </button>
          <button
            onClick={() => onMark(scenario.id, 'fail')}
            className={`mono rounded border px-2 py-0.5 text-[10px] transition-colors ${
              status === 'fail'
                ? 'border-gone-400 bg-gone-400/15 text-gone-400'
                : 'border-ink-700 text-ink-300 hover:border-gone-400 hover:text-gone-400'
            }`}
          >
            fail
          </button>
        </span>
      </div>

      <ol className="mt-2 space-y-1">
        {scenario.steps.map((step, i) => (
          <li key={`${scenario.id}-${i}`} className="flex gap-2 text-[11px] leading-relaxed text-ink-200">
            <span className="mono shrink-0 text-ink-500">{i + 1}.</span>
            <span className="mono text-[10.5px]">{step}</span>
          </li>
        ))}
      </ol>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-200">
        <span className="mono text-[9.5px] font-bold uppercase tracking-wider text-focus-400">expect </span>
        {scenario.expect}
      </p>

      {scenario.why && (
        <p className="mt-1.5 border-l-2 border-ink-700 pl-2 text-[10.5px] leading-relaxed text-ink-300">
          {scenario.why}
        </p>
      )}
    </div>
  );
}
