import { useMemo, useState } from 'react';
import type { NavState, RouteState } from '../engine/types';
import type { Ghost, SessionState } from '../engine/session';
import { getScreenBlueprint } from '../engine/blueprint';
import { JsonTree } from './JsonTree';
import { isDrawerOpen } from '../engine/routers';
import { HintLabel, Tooltip } from './Tooltip';

interface Props {
  session: SessionState;
}

const NAV_META: Record<NavState['type'], { label: string; factory: string; tone: string }> = {
  stack: { label: 'STACK', factory: 'createNativeStackNavigator', tone: 'text-focus-400 border-focus-400/40 bg-focus-400/10' },
  tab: { label: 'TABS', factory: 'createBottomTabNavigator', tone: 'text-alive-400 border-alive-400/40 bg-alive-400/10' },
  drawer: { label: 'DRAWER', factory: 'createDrawerNavigator', tone: 'text-param-400 border-param-400/40 bg-param-400/10' },
};

export function VisualizerStack({ session }: Props) {
  const [view, setView] = useState<'tree' | 'json'>('tree');

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-ink-700 px-4 py-2.5">
        <div>
          <h2 className="text-[13px] font-semibold tracking-tight text-ink-200">Navigation state</h2>
          <p className="text-[10px] text-ink-300">What navigation.getState() returns, right now</p>
        </div>
        <div className="flex rounded-md border border-ink-700 bg-ink-900 p-0.5 text-[10px] font-medium">
          {(['tree', 'json'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded px-2.5 py-1 transition-colors ${
                view === v ? 'bg-ink-700 text-ink-200' : 'text-ink-300 hover:text-ink-200'
              }`}
            >
              {v === 'tree' ? 'Tree' : 'JSON'}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {view === 'tree' ? (
          <NavigatorPanel state={session.root} session={session} depth={0} />
        ) : (
          <JsonTree root={session.root} />
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function NavigatorPanel({ state, session, depth }: { state: NavState; session: SessionState; depth: number }) {
  const meta = NAV_META[state.type];
  const ghosts = session.ghosts.filter((g) => g.navKey === state.key);
  const open = state.type === 'drawer' && isDrawerOpen(state);

  return (
    <div
      className={`rounded-xl border bg-ink-900/60 ${
        session.last?.handledBy === state.key ? 'border-focus-400/60 shadow-[0_0_0_1px_rgba(56,189,248,0.25)]' : 'border-ink-700'
      } ${depth > 0 ? 'mt-2' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-700/70 px-3 py-2">
        <Tooltip
          wide
          label={
            <span>
              <strong className="text-ink-200">{meta.factory}</strong>
              <br />
              This navigator holds its own state object with its own <code className="text-focus-400">index</code> and{' '}
              <code className="text-focus-400">routes</code>. Actions are handled here first if the focused screen belongs to it,
              otherwise they bubble to the parent.
            </span>
          }
        >
          <span className={`mono cursor-help rounded border px-1.5 py-0.5 text-[9.5px] font-bold tracking-wider ${meta.tone}`}>
            {meta.label}
          </span>
        </Tooltip>

        <span className="mono text-[10.5px] text-ink-300">key: {state.key}</span>

        <Tooltip
          label={
            <span>
              <code className="text-focus-400">index</code> is the only pointer to the focused route. For a stack it is always{' '}
              <code>routes.length - 1</code>; for tabs and drawers it moves freely without changing the array.
            </span>
          }
        >
          <span className="mono cursor-help rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-200">index: {state.index}</span>
        </Tooltip>

        {open && (
          <span className="mono rounded border border-param-400/40 bg-param-400/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-param-400">
            DRAWER OPEN
          </span>
        )}

        {session.last?.handledBy === state.key && (
          <span className="ml-auto rounded bg-focus-400/15 px-1.5 py-0.5 text-[9.5px] font-semibold text-focus-400">
            HANDLED THE ACTION
          </span>
        )}
      </div>

      <div className="px-3 py-2">
        <div className="mono mb-2 overflow-x-auto whitespace-nowrap text-[9.5px] text-ink-300">
          <HintLabel
            label={
              <span>
                <code className="text-focus-400">routeNames</code> comes straight from the screens you declared. A router returns{' '}
                <code>null</code> for any action naming a screen that is not in this list, which is precisely how actions bubble
                upward.
              </span>
            }
          >
            routeNames
          </HintLabel>
          : [{state.routeNames.join(', ')}]
        </div>

        <div className="space-y-1.5">
          {state.routes.map((route, i) => (
            <RouteCard
              key={route.key}
              route={route}
              index={i}
              nav={state}
              session={session}
              depth={depth}
              isTop={i === state.routes.length - 1}
            />
          ))}
          {ghosts.map((ghost) => (
            <GhostCard key={`ghost-${ghost.key}`} ghost={ghost} />
          ))}
        </div>

        {state.history && (
          <div className="mono mt-2 overflow-x-auto whitespace-nowrap border-t border-ink-700/60 pt-2 text-[9.5px] text-ink-300">
            <HintLabel
              label={
                <span>
                  Tab and drawer navigators keep a <code className="text-focus-400">history</code> array to implement{' '}
                  <code>backBehavior</code>. An open drawer is stored here as a <code>{'{ type: "drawer" }'}</code> entry - which is
                  why closing the drawer changes state without touching any route.
                </span>
              }
            >
              history
            </HintLabel>
            : [{state.history.map((h) => (h.type === 'drawer' ? 'drawer:open' : h.key)).join(', ')}]
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RouteCard({
  route,
  index,
  nav,
  session,
  depth,
  isTop,
}: {
  route: RouteState;
  index: number;
  nav: NavState;
  session: SessionState;
  depth: number;
  isTop: boolean;
}) {
  const focused = session.focused.includes(route.key);
  const mounted = session.mounted.includes(route.key);
  const verdict = session.verdicts[route.key];
  const active = index === nav.index;
  const blueprint = getScreenBlueprint(session.idx, nav.key, route.name);

  const anim = useMemo(() => {
    if (!verdict) return '';
    if (verdict.outcome === 'added') return 'animate-push-in';
    if (verdict.outcome === 'refocused') return 'animate-flash';
    if (verdict.outcome === 'params-updated') return 'animate-flash';
    return 'animate-settle';
  }, [verdict]);

  const border = focused
    ? 'border-focus-400/70 bg-focus-400/[0.07]'
    : mounted
      ? 'border-ink-600 bg-ink-850'
      : 'border-dashed border-ink-700 bg-ink-900/40';

  return (
    <div className={`${anim} rounded-lg border ${border} transition-colors`}>
      <div className="flex items-start gap-2 px-2.5 py-2">
        <Tooltip
          label={
            <span>
              Position <code className="text-focus-400">routes[{index}]</code>
              {isTop && nav.type === 'stack' ? ' - the top of the stack.' : '.'} Array order is history order; React Navigation never
              reorders it.
            </span>
          }
        >
          <span
            className={`mono mt-0.5 cursor-help rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              active ? 'bg-focus-400/20 text-focus-400' : 'bg-ink-800 text-ink-300'
            }`}
          >
            {index}
          </span>
        </Tooltip>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12.5px] font-semibold text-ink-200">{route.name}</span>

            {focused && <Badge tone="focus" text="FOCUSED" tip="This route is on the focus chain from the root, so useFocusEffect has run and isFocused() is true." />}
            {!focused && mounted && (
              <Badge
                tone="alive"
                text="MOUNTED"
                tip="Rendered and alive in memory, but blurred. Its useEffect setup already ran and its component state is intact - only useFocusEffect has cleaned up."
              />
            )}
            {!mounted && (
              <Badge
                tone="idle"
                text="NOT MOUNTED"
                tip="Present in the routes array but never rendered. Tab and drawer navigators are lazy by default, so a screen you have not visited yet exists in state without existing in the tree."
              />
            )}
            {verdict?.outcome === 'added' && <Badge tone="new" text="NEW" tip={verdict.reason} />}
            {verdict?.outcome === 'params-updated' && <Badge tone="param" text="PARAMS" tip={verdict.reason} />}
          </div>

          <Tooltip
            wide
            label={
              <span>
                {verdict ? (
                  <>
                    <strong className="text-ink-200">Last action: {verdict.outcome}</strong>
                    <br />
                    {verdict.reason}
                  </>
                ) : (
                  blueprint?.blurb ?? 'A route object: a key, a name and optional params.'
                )}
                <br />
                <span className="text-ink-300">
                  The key identifies the component instance. Same key across a dispatch means the same React component, with its state
                  preserved.
                </span>
              </span>
            }
          >
            <div className="mono mt-0.5 cursor-help text-[10px] text-ink-300">key: {route.key}</div>
          </Tooltip>

          {route.params && (
            <div className="mono mt-1 overflow-x-auto whitespace-nowrap rounded border border-param-400/25 bg-param-400/[0.07] px-1.5 py-1 text-[10px] text-param-400">
              <HintLabel
                label={
                  <span>
                    Params live on the route object, not in component state. <code className="text-focus-400">setParams()</code>{' '}
                    shallow-merges into this object and produces a new route object - the previous one is never mutated, which is
                    what lets React detect the change.
                  </span>
                }
              >
                params
              </HintLabel>
              : {JSON.stringify(route.params)}
            </div>
          )}
        </div>
      </div>

      {route.state && (
        <div className="border-t border-ink-700/60 px-2.5 pb-2.5 pt-1">
          <div className="mono mb-1 text-[9.5px] text-ink-300">route.state - nested navigator</div>
          <NavigatorPanel state={route.state} session={session} depth={depth + 1} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function GhostCard({ ghost }: { ghost: Ghost }) {
  return (
    <div className="animate-dissolve overflow-hidden rounded-lg border border-gone-400/40 bg-gone-400/[0.08] px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="mono rounded bg-gone-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-gone-400">×</span>
        <span className="text-[12.5px] font-semibold text-gone-400 line-through">{ghost.name}</span>
        <span className="mono text-[10px] text-gone-400/70">{ghost.key}</span>
      </div>
      <p className="mt-1 text-[10px] leading-snug text-gone-400/80">{ghost.reason}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const BADGE_TONES = {
  focus: 'border-focus-400/50 bg-focus-400/15 text-focus-400',
  alive: 'border-alive-400/40 bg-alive-400/10 text-alive-400',
  idle: 'border-ink-600 bg-ink-800 text-ink-300',
  new: 'border-focus-400/50 bg-focus-400/20 text-focus-400',
  param: 'border-param-400/50 bg-param-400/15 text-param-400',
} as const;

function Badge({ tone, text, tip }: { tone: keyof typeof BADGE_TONES; text: string; tip: string }) {
  return (
    <Tooltip wide label={tip}>
      <span className={`mono cursor-help rounded border px-1.5 py-[1px] text-[9px] font-bold tracking-wider ${BADGE_TONES[tone]}`}>
        {text}
      </span>
    </Tooltip>
  );
}
