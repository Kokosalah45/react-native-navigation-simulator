import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { NavAction, RNVersion } from '../engine/types';
import { PRESETS, getPreset } from '../engine/blueprint';
import {
  type CustomLayout,
  asPreset,
  blankLayout,
  duplicateAsCustom,
  isCustomId,
  loadLayouts,
  saveLayouts,
} from '../engine/layouts';
import { LayoutBuilder } from './LayoutBuilder';
import { initSession, sessionReducer } from '../engine/session';
import { PhoneCanvas } from './PhoneCanvas';
import { CommandCenter } from './CommandCenter';
import { VisualizerStack } from './VisualizerStack';
import { EventLog } from './EventLog';
import { CodePanel } from './CodePanel';
import { Scenarios, type Scenario } from './Scenarios';
import { ResizeHandle } from './ResizeHandle';
import { useLayoutSizes, useMediaQuery, type LayoutSizes } from '../hooks/useLayoutSizes';

/** Width of the collapsed config column. */
const RAIL_W = 34;
const RAIL_KEY = 'rn-nav-sim:rail';
import { HintLabel, Tooltip } from './Tooltip';

const GHOST_MS = 620;
const STEP_MS = 1150;

export function AppSimulator() {
  const [session, send] = useReducer(sessionReducer, undefined, () => initSession(PRESETS[0], 'v7'));
  const [runner, setRunner] = useState<{ scenario: Scenario; step: number } | null>(null);
  const ghostTimer = useRef<number | null>(null);

  const dispatch = useCallback((action: NavAction, source?: string) => send({ type: 'dispatch', action, source }), []);

  /* ------- custom layouts: built in the builder, kept in localStorage ------- */
  const [layouts, setLayouts] = useState<CustomLayout[]>([]);
  const [draft, setDraft] = useState<CustomLayout | null>(null);

  useEffect(() => {
    setLayouts(loadLayouts());
  }, []);

  const persist = useCallback((next: CustomLayout[]) => {
    setLayouts(next);
    if (!saveLayouts(next)) {
      // Storage can be unavailable (private window, blocked site data). The
      // layout still works for this session; it just will not survive a reload.
      console.warn('Could not persist layouts to localStorage.');
    }
  }, []);

  const options = useMemo(() => [...PRESETS, ...layouts.map(asPreset)], [layouts]);

  const saveLayout = useCallback(
    (layout: CustomLayout) => {
      const next = layouts.some((l) => l.id === layout.id)
        ? layouts.map((l) => (l.id === layout.id ? layout : l))
        : [...layouts, layout];
      persist(next);
      setDraft(layout);
      setRunner(null);
      send({ type: 'setPreset', preset: asPreset(layout) });
    },
    [layouts, persist],
  );

  const deleteLayout = useCallback(
    (id: string) => {
      const next = layouts.filter((l) => l.id !== id);
      persist(next);
      setDraft(null);
      if (session.preset.id === id) {
        setRunner(null);
        send({ type: 'setPreset', preset: PRESETS[0] });
      }
    },
    [layouts, persist, session.preset.id],
  );


  /* Ghost routes animate out, then are dropped from state. */
  useEffect(() => {
    if (!session.ghosts.length) return;
    if (ghostTimer.current) window.clearTimeout(ghostTimer.current);
    ghostTimer.current = window.setTimeout(() => send({ type: 'clearGhosts' }), GHOST_MS);
    return () => {
      if (ghostTimer.current) window.clearTimeout(ghostTimer.current);
    };
  }, [session.ghosts]);

  /* Scripted scenario playback. */
  useEffect(() => {
    if (!runner) return;
    if (runner.step >= runner.scenario.steps.length) {
      const done = window.setTimeout(() => setRunner(null), 900);
      return () => window.clearTimeout(done);
    }
    const timer = window.setTimeout(
      () => {
        send({ type: 'dispatch', action: runner.scenario.steps[runner.step] });
        setRunner((r) => (r ? { ...r, step: r.step + 1 } : null));
      },
      runner.step === 0 ? 420 : STEP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [runner]);

  const runScenario = useCallback((scenario: Scenario) => {
    send({ type: 'setPreset', preset: getPreset(scenario.presetId) });
    setRunner({ scenario, step: 0 });
  }, []);

  const preset = session.preset;

  /** Below this width the columns stack and the dividers are pointless. */
  const wide = useMediaQuery('(min-width: 1280px)');
  const { sizes, beginResize, resize, reset, resetAll } = useLayoutSizes();

  const gridRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);

  /**
   * The config + console column collapses to a rail. It is the column you stop
   * needing once you know the layout, and reclaiming it gives the state graph
   * room to breathe on a laptop screen.
   */
  const [railed, setRailed] = useState(false);

  useEffect(() => {
    try {
      setRailed(localStorage.getItem(RAIL_KEY) === '1');
    } catch {
      /* private window, blocked site data */
    }
  }, []);

  const toggleRail = useCallback(() => {
    setRailed((open) => {
      const next = !open;
      try {
        localStorage.setItem(RAIL_KEY, next ? '1' : '0');
      } catch {
        /* not worth surfacing */
      }
      return next;
    });
  }, []);

  /** Leaves the navigation-state column at least 280px, whatever you drag. */
  const columnBudget = useCallback(
    () => ({
      available: (gridRef.current?.clientWidth ?? 0) - (railed ? RAIL_W + 12 : 18),
      floor: 280,
      // A railed column keeps its remembered width but occupies none of it.
      exclude: railed ? (['inspector'] as (keyof LayoutSizes)[]) : undefined,
    }),
    [railed],
  );
  const rowBudget = useCallback(() => ({ available: (inspectorRef.current?.clientHeight ?? 0) - 6, floor: 160 }), []);

  return (
    <div className="flex h-full flex-col bg-ink-950">
      {/* ------------------------------ header ------------------------------ */}
      <header className="flex flex-wrap items-center gap-3 border-b border-ink-700 bg-ink-900 px-4 py-2.5">
        <div className="mr-2">
          <h1 className="text-[14px] font-semibold tracking-tight text-ink-200">React Navigation Simulator</h1>
          <p className="text-[10px] text-ink-300">A live model of the router state machine — {preset.factory}</p>
        </div>

        <label className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-ink-300">Layout</span>
          <select
            value={preset.id}
            onChange={(e) => {
              setRunner(null);
              const next = options.find((o) => o.id === e.target.value) ?? PRESETS[0];
              send({ type: 'setPreset', preset: next });
            }}
            className="rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-[11.5px] text-ink-200 outline-none focus:border-focus-400"
          >
            <optgroup label="Presets">
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
            {layouts.length > 0 && (
              <optgroup label="My layouts">
                {layouts.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>

          <Tooltip
            wide
            label="Build your own navigator tree for a proof of concept, or edit the one that is loaded. Custom layouts run on the same engine as the presets and can be exported to JSON and imported back."
          >
            <button
              onClick={() => {
                const current = layouts.find((l) => l.id === preset.id);
                setDraft(current ?? (isCustomId(preset.id) ? blankLayout() : duplicateAsCustom(preset)));
              }}
              className="rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-[11px] text-ink-200 transition-colors hover:border-focus-400 hover:text-focus-400"
            >
              {layouts.some((l) => l.id === preset.id) ? 'Edit layout' : 'Build layout'}
            </button>
          </Tooltip>
        </label>

        <VersionSwitch
          version={session.version}
          onChange={(v) => {
            setRunner(null);
            send({ type: 'setVersion', version: v });
          }}
        />

        <div className="flex items-center gap-3 rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1">
          <Toggle
            checked={session.options.strictPopTo}
            onChange={(v) => send({ type: 'setOption', key: 'strictPopTo', value: v })}
            label="strict popTo"
            tip="ON: popTo() refuses to instantiate a screen that is not already in the stack and raises a simulation error — popTo as a pure rollback helper. OFF: the documented v7 behaviour, where popTo pops the current screen and adds the target instead."
          />
          <Toggle
            checked={session.options.navigationInChildEnabled}
            onChange={(v) => send({ type: 'setOption', key: 'navigationInChildEnabled', value: v })}
            label="navigationInChild"
            tip="Whether an unhandled navigate() may drill DOWN into an already-mounted child navigator. Default in v6, removed as a default in v7 (kept behind the navigationInChildEnabled prop on NavigationContainer)."
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          {wide && (
            <Tooltip
              wide
              label="Collapse the layout configuration and lifecycle console into a rail, giving the state graph the width back. Click the rail to bring them back; the choice is remembered."
            >
              <button
                onClick={toggleRail}
                className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1 text-[11px] text-ink-200 transition-colors hover:border-ink-500 hover:bg-ink-800"
              >
                {railed ? '‹ Show config' : 'Hide config ›'}
              </button>
            </Tooltip>
          )}
          {wide && (
            <Tooltip
              wide
              label="Drag any divider to resize a column, or double-click one to restore just that pane. Sizes are remembered between visits."
            >
              <button
                onClick={resetAll}
                className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1 text-[11px] text-ink-200 transition-colors hover:border-ink-500 hover:bg-ink-800"
              >
                Reset layout
              </button>
            </Tooltip>
          )}
          <button
            onClick={() => {
              setRunner(null);
              send({ type: 'restart' });
            }}
            className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1 text-[11px] text-ink-200 transition-colors hover:border-ink-500 hover:bg-ink-800"
          >
            Restart app
          </button>

          <Tooltip
            wide
            label="The manual test plan for this app: the checks that would have caught the bugs it actually hit. Results are kept in this browser, so a run survives the reloads some of the checks ask for."
          >
            <Link
              to="/tests"
              className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1 text-[11px] text-ink-200 transition-colors hover:border-focus-400 hover:text-focus-400"
            >
              Test plan ›
            </Link>
          </Tooltip>
        </div>
      </header>

      {draft && (
        <LayoutBuilder
          layout={draft}
          presets={PRESETS}
          saved={layouts.some((l) => l.id === draft.id)}
          onChange={setDraft}
          onSave={saveLayout}
          onDelete={deleteLayout}
          onClose={() => setDraft(null)}
        />
      )}

      {/* ------------------------------ body ------------------------------ */}
      <div
        ref={gridRef}
        className={
          wide
            ? 'grid min-h-0 flex-1 overflow-hidden'
            : 'flex min-h-0 flex-1 flex-col divide-y divide-ink-700 overflow-y-auto'
        }
        style={
          wide
            ? {
                gridTemplateColumns: railed
                  ? `${sizes.device}px auto ${sizes.controls}px auto minmax(0,1fr) ${RAIL_W}px`
                  : `${sizes.device}px auto ${sizes.controls}px auto minmax(0,1fr) auto ${sizes.inspector}px`,
              }
            : undefined
        }
      >
        {/* -------- 1: device -------- */}
        <div className={`flex min-h-0 flex-col gap-3 overflow-y-auto p-4 ${wide ? '' : 'min-h-[560px]'}`}>
          <PhoneCanvas session={session} dispatch={dispatch} />

          <div>
            <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-300">Guided scenarios</h3>
            <Scenarios
              activeId={runner?.scenario.id ?? null}
              stepIndex={runner?.step ?? 0}
              onRun={runScenario}
              onStop={() => setRunner(null)}
            />
          </div>
        </div>

        {wide && (
          <ResizeHandle
            orientation="vertical"
            label="Device panel width"
            onResizeStart={beginResize}
            onResize={(d) => resize('device', d, 1, columnBudget())}
            onReset={() => reset('device')}
          />
        )}

        {/* -------- 2: controls -------- */}
        <div className={`flex min-h-0 flex-col overflow-y-auto ${wide ? '' : 'min-h-[560px]'}`}>
          <div className="border-b border-ink-700 p-4">
            <Explanation session={session} />
          </div>
          <div className="p-4">
            <CommandCenter session={session} dispatch={dispatch} />
          </div>
        </div>

        {wide && (
          <ResizeHandle
            orientation="vertical"
            label="Controls panel width"
            onResizeStart={beginResize}
            onResize={(d) => resize('controls', d, 1, columnBudget())}
            onReset={() => reset('controls')}
          />
        )}

        {/* -------- 3: navigation state -------- */}
        <div className={`flex min-h-0 flex-col overflow-hidden ${wide ? '' : 'min-h-[520px]'}`}>
          <VisualizerStack session={session} />
        </div>

        {wide && !railed && (
          <ResizeHandle
            orientation="vertical"
            label="Inspector column width"
            onResizeStart={beginResize}
            // Dragging left must GROW the inspector, so the delta is inverted.
            onResize={(d) => resize('inspector', d, -1, columnBudget())}
            onReset={() => reset('inspector')}
          />
        )}

        {/* -------- 4: layout config + lifecycle console -------- */}
        {wide && railed ? (
          <button
            onClick={toggleRail}
            title="Show layout configuration and lifecycle console"
            className="group flex flex-col items-center gap-3 border-l border-ink-700 bg-ink-900/60 py-3 transition-colors hover:bg-ink-850"
          >
            <span className="text-[12px] leading-none text-ink-300 transition-colors group-hover:text-focus-400">‹</span>
            <span
              className="mono text-[9.5px] tracking-wider text-ink-300 transition-colors group-hover:text-ink-200"
              style={{ writingMode: 'vertical-rl' }}
            >
              config · console
            </span>
            {session.log.length > 0 && (
              <span className="mono rounded bg-ink-800 px-1 py-0.5 text-[9px] text-ink-300">{session.log.length}</span>
            )}
          </button>
        ) : (
        <div
          ref={inspectorRef}
          className={wide ? 'grid min-h-0 overflow-hidden' : 'flex flex-col divide-y divide-ink-700'}
          style={wide ? { gridTemplateRows: `${sizes.config}px auto minmax(0,1fr)` } : undefined}
        >
          <div className={`flex min-h-0 flex-col overflow-hidden ${wide ? '' : 'min-h-[360px]'}`}>
            <CodePanel blueprint={preset.blueprint} version={session.version} />
          </div>

          {wide && (
            <ResizeHandle
              orientation="horizontal"
              label="Layout configuration height"
              onResizeStart={beginResize}
              onResize={(d) => resize('config', d, 1, rowBudget())}
              onReset={() => reset('config')}
            />
          )}

          <div className={`flex min-h-0 flex-col overflow-hidden ${wide ? '' : 'min-h-[320px]'}`}>
            <EventLog log={session.log} session={session} onClear={() => send({ type: 'clearLog' })} />
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Explanation({ session }: { session: ReturnType<typeof initSession> }) {
  const last = session.last;

  if (!last) {
    return (
      <div className="rounded-lg border border-dashed border-ink-700 p-3">
        <h3 className="text-[12px] font-semibold text-ink-200">Nothing dispatched yet</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-300">
          Fire an action below, or run a guided scenario. Every dispatch is explained here: which navigator handled it, which screens
          were destroyed, and which survived with their component state intact.
        </p>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border p-3 ${last.error ? 'border-gone-400/50 bg-gone-400/[0.07]' : 'border-ink-700 bg-ink-900/60'}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="mono truncate text-[11.5px] font-semibold text-ink-200">{last.label}</span>
        {last.handledBy && (
          <Tooltip label="The navigator whose router returned a new state object. Every other navigator the action passed through returned null.">
            <span className="mono ml-auto shrink-0 cursor-help rounded bg-focus-400/15 px-1.5 py-0.5 text-[9.5px] text-focus-400">
              {last.handledBy}
            </span>
          </Tooltip>
        )}
      </div>

      {last.error ? (
        <p className="text-[11px] leading-relaxed text-gone-400">{last.error}</p>
      ) : (
        <p className="text-[11px] leading-relaxed text-ink-200">{last.rationale}</p>
      )}

      {last.hops.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {last.hops.map((hop, i) => (
            <Tooltip
              key={`${hop.name}-${i}`}
              wide
              label={
                hop.handledBy
                  ? `Level ${i + 1} of the nested payload. navigate('${hop.name}') was handled by ${hop.handledBy}, which then made the next level reachable.`
                  : `Level ${i + 1} was not handled by any navigator.`
              }
            >
              <span className="mono flex cursor-help items-center gap-1 text-[9.5px]">
                {i > 0 && <span className="text-ink-500">›</span>}
                <span className="rounded bg-ink-800 px-1.5 py-0.5 text-ink-200">{hop.name}</span>
                <span className="text-focus-400">{hop.handledBy}</span>
              </span>
            </Tooltip>
          ))}
        </div>
      )}

      {last.source && (
        <p className="mono mt-2 text-[9.5px] text-ink-300">
          dispatched from: {last.source} (getParent)
        </p>
      )}

      {last.versionNote && (
        <p className="mt-2 rounded border border-v6-400/25 bg-v6-400/[0.07] px-2 py-1.5 text-[10.5px] leading-snug text-ink-200">
          <span className="mono mr-1 font-bold text-v6-400">note</span>
          {last.versionNote}
        </p>
      )}

      {last.bubblePath.length > 1 && (
        <p className="mono mt-2 overflow-x-auto whitespace-nowrap text-[9.5px] text-ink-300">
          <HintLabel label="An action starts at the navigator owning the focused screen and bubbles up until a router returns a non-null state. Routers that could not handle it returned null. For a nested payload this lists every hop's path end to end.">
            bubbled
          </HintLabel>
          : {last.bubblePath.join(' → ')}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function VersionSwitch({ version, onChange }: { version: RNVersion; onChange: (v: RNVersion) => void }) {
  return (
    <div className="flex rounded-md border border-ink-700 bg-ink-850 p-0.5">
      {(['v6', 'v7'] as const).map((v) => (
        <Tooltip
          key={v}
          wide
          label={
            v === 'v6'
              ? 'React Navigation 6 mechanics: navigate() unwinds to an existing screen, navigate() can drill into a mounted child navigator, and popTo does not exist.'
              : 'React Navigation 7 mechanics: navigate() pushes instead of going back, popTo() handles rollback explicitly, nested screens must be addressed through their parent, and the state tree is frozen in development.'
          }
        >
          <button
            onClick={() => onChange(v)}
            className={`mono rounded px-2.5 py-1 text-[11px] font-bold transition-colors ${
              version === v
                ? v === 'v6'
                  ? 'bg-v6-400/20 text-v6-400'
                  : 'bg-v7-400/20 text-v7-400'
                : 'text-ink-300 hover:text-ink-200'
            }`}
          >
            {v}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  tip,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  tip: string;
}) {
  return (
    <Tooltip wide label={tip}>
      <label className="mono flex cursor-pointer items-center gap-1.5 text-[10px] text-ink-200">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-3 w-3 accent-sky-400" />
        {label}
      </label>
    </Tooltip>
  );
}
