import type { NavAction } from '../engine/types';
import type { SessionState } from '../engine/session';
import { canGoBack } from '../engine/session';
import { focusedNavigators } from '../engine/NavigatorEngine';
import { getScreenBlueprint } from '../engine/blueprint';
import { isDrawerOpen } from '../engine/routers';
import { Tooltip } from './Tooltip';

interface Props {
  session: SessionState;
  dispatch: (action: NavAction) => void;
}

/**
 * The device canvas. Everything rendered here is derived from the same state
 * object the visualizer shows - the phone is a view of the state, never a
 * separate source of truth.
 */
export function PhoneCanvas({ session, dispatch }: Props) {
  const chain = focusedNavigators(session.root);
  const leaf = chain[chain.length - 1];
  const route = leaf.routes[leaf.index];
  const blueprint = getScreenBlueprint(session.idx, leaf.key, route.name);

  const tabNav = [...chain].reverse().find((n) => n.type === 'tab');
  const drawerNav = chain.find((n) => n.type === 'drawer');
  const drawerOpen = drawerNav ? isDrawerOpen(drawerNav) : false;
  const back = canGoBack(session);

  const stackDepth = leaf.type === 'stack' ? leaf.routes.length : 1;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-[286px] rounded-[2.25rem] border-[7px] border-ink-700 bg-ink-950 shadow-2xl shadow-black/60">
        {/* notch */}
        <div className="absolute left-1/2 top-0 z-20 h-[22px] w-[110px] -translate-x-1/2 rounded-b-2xl bg-ink-700" />

        <div className="relative h-[518px] overflow-hidden rounded-[1.7rem] bg-ink-900">
          {/* status bar */}
          <div className="mono flex items-center justify-between px-4 pb-1 pt-2 text-[9px] text-ink-300">
            <span>9:41</span>
            <span>React Navigation {session.version}</span>
          </div>

          {/* header */}
          <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2.5">
            {drawerNav && (
              <button
                onClick={() => dispatch({ type: 'TOGGLE_DRAWER' })}
                aria-label="Toggle drawer"
                className="rounded p-1 text-ink-300 transition-colors hover:bg-ink-800 hover:text-ink-200"
              >
                <span className="mono block text-[13px] leading-none">≡</span>
              </button>
            )}

            {back && (
              <Tooltip
                label={
                  <span>
                    The back affordance is rendered from <code className="text-focus-400">canGoBack()</code>, which asks every
                    navigator up the chain whether it can handle a GO_BACK action.
                  </span>
                }
              >
                <button
                  onClick={() => dispatch({ type: 'GO_BACK' })}
                  className="rounded p-1 text-focus-400 transition-colors hover:bg-ink-800"
                  aria-label="Go back"
                >
                  <span className="mono block text-[13px] leading-none">‹</span>
                </button>
              </Tooltip>
            )}

            <h3 className="truncate text-[13px] font-semibold text-ink-200">{blueprint?.title ?? route.name}</h3>

            <span className="mono ml-auto rounded bg-ink-800 px-1.5 py-0.5 text-[9px] text-ink-300">
              {leaf.type === 'stack' ? `depth ${stackDepth}` : `tab ${leaf.index + 1}/${leaf.routes.length}`}
            </span>
          </div>

          {/* screen body - re-keyed on route.key so a new instance animates in */}
          <div key={route.key} className="animate-push-in px-4 py-5">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-focus-400/40 bg-focus-400/10 text-[15px] font-bold text-focus-400">
              {blueprint?.icon ?? route.name.charAt(0)}
            </div>

            <h4 className="text-[17px] font-semibold text-ink-200">{route.name}</h4>
            <p className="mono mt-0.5 text-[10px] text-ink-300">{route.key}</p>

            {blueprint?.blurb && <p className="mt-3 text-[11.5px] leading-relaxed text-ink-300">{blueprint.blurb}</p>}

            {route.params ? (
              <div className="mono mt-4 rounded-lg border border-param-400/25 bg-param-400/[0.07] p-2.5 text-[10px] text-param-400">
                <div className="mb-1 text-ink-300">route.params</div>
                {JSON.stringify(route.params, null, 2)}
              </div>
            ) : (
              <div className="mono mt-4 rounded-lg border border-dashed border-ink-700 p-2.5 text-[10px] text-ink-500">
                route.params is undefined
              </div>
            )}

            {leaf.type === 'stack' && stackDepth > 1 && (
              <div className="mt-4">
                <p className="mono mb-1.5 text-[9.5px] text-ink-300">still alive underneath</p>
                <div className="space-y-1">
                  {leaf.routes
                    .slice(0, -1)
                    .reverse()
                    .map((r, i) => (
                      <div
                        key={r.key}
                        style={{ opacity: Math.max(0.25, 0.75 - i * 0.18), marginLeft: i * 6 }}
                        className="mono rounded border border-ink-700 bg-ink-850 px-2 py-1 text-[9.5px] text-ink-300"
                      >
                        {r.name}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* tab bar */}
          {tabNav && (
            <div className="absolute inset-x-0 bottom-0 flex border-t border-ink-700 bg-ink-850">
              {tabNav.routes.map((r, i) => {
                const active = i === tabNav.index;
                const mounted = session.mounted.includes(r.key);
                return (
                  <button
                    key={r.key}
                    onClick={() => dispatch({ type: 'JUMP_TO', payload: { name: r.name } })}
                    className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors ${
                      active ? 'text-focus-400' : 'text-ink-300 hover:text-ink-200'
                    }`}
                  >
                    <span className="text-[13px] font-semibold leading-none">
                      {getScreenBlueprint(session.idx, tabNav.key, r.name)?.icon ?? r.name.charAt(0)}
                    </span>
                    <span className="max-w-full truncate px-1 text-[8.5px]">{r.name}</span>
                    {!mounted && (
                      <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full border border-ink-500" title="not mounted yet" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* drawer overlay */}
          {drawerNav && drawerOpen && (
            <div className="absolute inset-0 z-10 flex">
              <div className="animate-push-in w-[72%] border-r border-ink-700 bg-ink-850 p-3">
                <p className="mono mb-2 text-[9.5px] text-ink-300">{drawerNav.key}</p>
                {drawerNav.routes.map((r, i) => (
                  <button
                    key={r.key}
                    onClick={() => dispatch({ type: 'NAVIGATE', payload: { name: r.name } })}
                    className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors ${
                      i === drawerNav.index ? 'bg-focus-400/15 text-focus-400' : 'text-ink-200 hover:bg-ink-800'
                    }`}
                  >
                    <span className="mono w-4 text-center text-[11px]">
                      {getScreenBlueprint(session.idx, drawerNav.key, r.name)?.icon ?? r.name.charAt(0)}
                    </span>
                    {r.name}
                  </button>
                ))}
              </div>
              <button
                aria-label="Close drawer"
                onClick={() => dispatch({ type: 'CLOSE_DRAWER' })}
                className="flex-1 bg-black/50 backdrop-blur-[1px]"
              />
            </div>
          )}
        </div>
      </div>

      <p className="mono mt-2 text-[9.5px] text-ink-500">
        focus chain: {chain.map((n) => n.routes[n.index].name).join(' › ')}
      </p>
    </div>
  );
}
