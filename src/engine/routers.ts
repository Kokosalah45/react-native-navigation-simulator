import type { NavAction, NavState, Params, RouteState, RouteVerdict } from './types';
import type { BlueprintIndex } from './blueprint';
import { getNavigatorBlueprint, getScreenBlueprint, makeRoute } from './blueprint';
import type { EngineOptions } from './types';

/**
 * The routers.
 *
 * Each router is a pure function `(state, action) => state | null`, exactly
 * like `StackRouter`, `TabRouter` and `DrawerRouter` in
 * `@react-navigation/routers`. Returning `null` means "I cannot handle this
 * action" - which is what makes actions bubble up to the parent navigator.
 */

export interface RouterContext {
  options: EngineOptions;
  idx: BlueprintIndex;
}

export interface RouterOutcome {
  /** `null` => not handled, bubble to the parent navigator. */
  state: NavState | null;
  rationale?: string;
  verdicts?: RouteVerdict[];
  /** A hard failure: the action was addressed to this router but is invalid. */
  error?: string;
  versionNote?: string;
}

const NOT_HANDLED: RouterOutcome = { state: null };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const lastIndexOfName = (routes: RouteState[], name: string) => {
  for (let i = routes.length - 1; i >= 0; i--) if (routes[i].name === name) return i;
  return -1;
};

/**
 * React Navigation replaces params by default and shallow-merges only when
 * `merge: true` is passed. `setParams` is the one that always merges.
 */
const withParams = (route: RouteState, params: Params | undefined, merge: boolean): RouteState => {
  if (params === undefined) return route;
  const next = merge ? { ...(route.params ?? {}), ...params } : params;
  return { ...route, params: next };
};

const removedVerdicts = (routes: RouteState[], reason: string): RouteVerdict[] =>
  routes.map((r) => ({ key: r.key, name: r.name, outcome: 'removed' as const, reason }));

const keptVerdicts = (routes: RouteState[], reason: string): RouteVerdict[] =>
  routes.map((r) => ({ key: r.key, name: r.name, outcome: 'kept' as const, reason }));

const fmt = (names: string[]) => names.join(', ');

function buildRoute(ctx: RouterContext, navKey: string, name: string, params?: Params): RouteState | null {
  const screen = getScreenBlueprint(ctx.idx, navKey, name);
  if (!screen) return null;
  return makeRoute(screen, params);
}

/* ------------------------------------------------------------------ */
/* Shared: RESET / SET_PARAMS                                          */
/* ------------------------------------------------------------------ */

function handleReset(state: NavState, action: Extract<NavAction, { type: 'RESET' }>, ctx: RouterContext): RouterOutcome {
  const { routes: specs, index } = action.payload;
  if (specs.length === 0) return { state: null, error: 'reset() requires at least one route.' };

  const unknown = specs.filter((s) => !state.routeNames.includes(s.name)).map((s) => s.name);
  if (unknown.length) {
    return {
      state: null,
      error: `reset() referenced screen(s) not declared on this navigator: ${fmt(unknown)}. Declared: ${fmt(state.routeNames)}.`,
    };
  }
  if (index < 0 || index >= specs.length) {
    return { state: null, error: `reset() index ${index} is out of bounds for ${specs.length} route(s).` };
  }

  const routes = specs
    .map((s) => buildRoute(ctx, state.key, s.name, s.params))
    .filter((r): r is RouteState => r !== null);

  const next: NavState = {
    ...state,
    index,
    routes,
    ...(state.history ? { history: [{ type: 'route' as const, key: routes[index].key }] } : {}),
  };

  return {
    state: next,
    verdicts: [
      ...removedVerdicts(state.routes, 'reset() discarded the entire previous state object. Every key is gone, so every component unmounts.'),
      ...routes.map((r) => ({
        key: r.key,
        name: r.name,
        outcome: 'added' as const,
        reason: 'Created fresh by reset(). New key => a brand-new component instance with no preserved state.',
      })),
    ],
    rationale:
      `reset() replaced the navigator state wholesale with ${routes.length} route(s) [${fmt(routes.map((r) => r.name))}] ` +
      `focused at index ${index}. Note that keys are regenerated, so nothing is reused - this is the most destructive action there is.`,
  };
}

function handleSetParams(state: NavState, params: Params, replace: boolean): RouterOutcome {
  const current = state.routes[state.index];
  const nextRoute: RouteState = { ...current, params: replace ? params : { ...(current.params ?? {}), ...params } };
  const routes = state.routes.slice();
  routes[state.index] = nextRoute;

  const method = replace ? 'replaceParams' : 'setParams';

  return {
    state: { ...state, routes },
    verdicts: [
      {
        key: current.key,
        name: current.name,
        outcome: 'params-updated',
        reason: replace
          ? 'replaceParams() swaps route.params for a new object. Keys that were there before and are absent now are gone.'
          : 'setParams() shallow-merges into the focused route, like React setState. A new route object and a new state object are created - the old ones are never mutated.',
      },
    ],
    rationale:
      `${method}(${JSON.stringify(params)}) ${replace ? 'replaced' : 'merged into'} the params of ${current.name}. ` +
      `The route keeps its key (${current.key}), so the component is NOT remounted - it just re-renders with new params. ` +
      'In v7 the state tree is frozen in development, so an in-place mutation here would have thrown.',
  };
}

/* ------------------------------------------------------------------ */
/* backBehavior (tab + drawer)                                         */
/* ------------------------------------------------------------------ */

const backBehaviorOf = (state: NavState, ctx: RouterContext) =>
  getNavigatorBlueprint(ctx.idx, state.key)?.backBehavior ?? 'firstRoute';

const BEHAVIOR_NOTE: Record<string, string> = {
  firstRoute: 'the first screen declared on the navigator',
  initialRoute: 'the screen named by initialRouteName',
  order: 'the screen declared immediately before the focused one',
  history: 'the last visited screen (duplicates dropped from history)',
  fullHistory: 'the last visited screen (duplicates kept, like web history)',
  none: 'nothing - the navigator ignores back entirely',
};

/** Resolves GO_BACK for a tab/drawer navigator per its backBehavior. */
function resolveBackTarget(state: NavState, ctx: RouterContext): { index: number; history?: NavState['history'] } | null {
  const behavior = backBehaviorOf(state, ctx);
  const history = state.history ?? [];

  switch (behavior) {
    case 'none':
      return null;

    case 'order':
      return state.index > 0 ? { index: state.index - 1 } : null;

    case 'initialRoute': {
      const bp = getNavigatorBlueprint(ctx.idx, state.key);
      const name = bp?.initialRouteName ?? state.routeNames[0];
      const index = Math.max(0, state.routeNames.indexOf(name));
      return index === state.index ? null : { index };
    }

    case 'history':
    case 'fullHistory': {
      const routeEntries = history.filter((e) => e.type === 'route');
      if (routeEntries.length < 2) return null;
      const previous = routeEntries[routeEntries.length - 2];
      const index = state.routes.findIndex((r) => previous.type === 'route' && r.key === previous.key);
      if (index === -1) return null;
      // Drop only the entry we are leaving.
      const cut = history.lastIndexOf(routeEntries[routeEntries.length - 1]);
      return { index, history: history.filter((_, i) => i !== cut) };
    }

    case 'firstRoute':
    default:
      return state.index === 0 ? null : { index: 0 };
  }
}

function tabGoBack(state: NavState, ctx: RouterContext): RouterOutcome {
  const behavior = backBehaviorOf(state, ctx);
  const target = resolveBackTarget(state, ctx);

  if (!target) {
    return {
      state: null,
      rationale:
        `goBack() was not handled by ${state.key}: with backBehavior: "${behavior}" it goes to ${BEHAVIOR_NOTE[behavior]}, ` +
        'and there is nowhere left to go. The router returned null, so the action bubbles up to the parent navigator.',
    };
  }

  const route = state.routes[target.index];
  return {
    state: {
      ...state,
      index: target.index,
      history: target.history ?? [{ type: 'route', key: route.key }],
    },
    verdicts: [
      {
        key: route.key,
        name: route.name,
        outcome: 'refocused',
        reason: `backBehavior: "${behavior}" sends GO_BACK to ${BEHAVIOR_NOTE[behavior]}. No route was added or removed.`,
      },
    ],
    rationale:
      `goBack() in a ${state.type} navigator does not pop anything. With backBehavior: "${behavior}" it moved focus to ` +
      `${route.name} (index ${target.index}). Remember that "firstRoute" is the default for BOTH bottom tabs and the drawer.`,
  };
}

/** History entries are appended on every jump; `history` drops older duplicates. */
function pushHistory(state: NavState, ctx: RouterContext, key: string): NavState['history'] {
  const behavior = backBehaviorOf(state, ctx);
  const history = state.history ?? [];
  const base = behavior === 'fullHistory' ? history : history.filter((e) => !(e.type === 'route' && e.key === key));
  return [...base, { type: 'route', key }];
}

/* ------------------------------------------------------------------ */
/* Stack router                                                        */
/* ------------------------------------------------------------------ */

export function stackRouter(state: NavState, action: NavAction, ctx: RouterContext): RouterOutcome {
  const { version } = ctx.options;
  const current = state.routes[state.index];

  switch (action.type) {
    case 'NAVIGATE':
    case 'NAVIGATE_DEPRECATED': {
      const { name, params, merge = false } = action.payload;
      if (!state.routeNames.includes(name)) return NOT_HANDLED;

      const popMode =
        action.type === 'NAVIGATE_DEPRECATED' ||
        version === 'v6' ||
        (action.type === 'NAVIGATE' && action.payload.pop === true);

      // Already focused: no new instance in any version, params are just updated.
      if (current.name === name) {
        const routes = state.routes.slice();
        routes[state.index] = withParams(current, params, merge);
        return {
          state: { ...state, routes },
          verdicts: [
            {
              key: current.key,
              name,
              outcome: params === undefined ? 'kept' : 'params-updated',
              reason: 'Already the focused route, so navigate() is a no-op apart from params. No push, no unmount.',
            },
          ],
          rationale:
            `navigate('${name}') found '${name}' already focused at index ${state.index}. ` +
            `Both v6 and v7 agree here: the screen stays put${params === undefined ? '' : ' and only its params change'}.`,
        };
      }

      const existingIndex = lastIndexOfName(state.routes, name);

      if (popMode && existingIndex !== -1) {
        const destroyed = state.routes.slice(existingIndex + 1);
        const routes = state.routes.slice(0, existingIndex + 1);
        routes[existingIndex] = withParams(routes[existingIndex], params, merge);

        return {
          state: { ...state, index: existingIndex, routes },
          verdicts: [
            ...keptVerdicts(routes.slice(0, existingIndex), 'Below the target - untouched, still mounted.'),
            {
              key: routes[existingIndex].key,
              name,
              outcome: 'refocused',
              reason:
                `The EXISTING instance was reused in place. Its key (${routes[existingIndex].key}) and array position (${existingIndex}) ` +
                'are unchanged - the route is never lifted or swapped to the top. Local component state survives.',
            },
            ...removedVerdicts(
              destroyed,
              'Above the target, so it was truncated off the routes array by the slice. Unmounted and destroyed - its local state is gone.',
            ),
          ],
          rationale:
            `${action.type === 'NAVIGATE_DEPRECATED' ? 'navigateDeprecated' : 'navigate'}('${name}') found an existing '${name}' at index ${existingIndex}. ` +
            `The router did routes.slice(0, ${existingIndex + 1}), destroying ${destroyed.length} screen(s) above it` +
            `${destroyed.length ? ` [${fmt(destroyed.map((r) => r.name))}]` : ''} and moving index back to ${existingIndex}. ` +
            'The target is NOT moved to the end of the array - focus comes down to it.',
          versionNote:
            version === 'v6'
              ? 'v6 mechanic: navigate() goes back to an existing screen. This is exactly the behaviour v7 removed.'
              : 'You opted into the legacy path (pop: true / navigateDeprecated), so v7 reproduced the v6 unwind.',
        };
      }

      // v7 default: navigate() no longer goes back - it pushes.
      const route = buildRoute(ctx, state.key, name, params);
      if (!route) return NOT_HANDLED;
      const routes = [...state.routes, route];

      return {
        state: { ...state, index: routes.length - 1, routes },
        verdicts: [
          ...keptVerdicts(state.routes, 'Still in the routes array below the new screen - mounted, just not focused.'),
          {
            key: route.key,
            name,
            outcome: 'added',
            reason:
              existingIndex !== -1
                ? `A SECOND instance of '${name}' was appended. The older one at index ${existingIndex} is untouched and still alive.`
                : 'Not present in the stack, so a new instance was appended at the top.',
          },
        ],
        rationale:
          existingIndex !== -1
            ? `navigate('${name}') found '${name}' already at index ${existingIndex}, but v7 does NOT go back any more. ` +
              'It pushed a duplicate instance on top instead. Use popTo() (or navigate with pop: true) to unwind.'
            : `navigate('${name}') found no '${name}' in the stack, so it pushed a new instance at index ${routes.length - 1}.`,
        versionNote:
          existingIndex !== -1 && version === 'v7'
            ? 'v7 breaking change: "The navigate method no longer goes back, use popTo instead." Flip the version switch to v6 to see the unwind.'
            : undefined,
      };
    }

    case 'PUSH': {
      const { name, params } = action.payload;
      if (!state.routeNames.includes(name)) return NOT_HANDLED;
      const route = buildRoute(ctx, state.key, name, params);
      if (!route) return NOT_HANDLED;
      const dupes = state.routes.filter((r) => r.name === name).length;
      const routes = [...state.routes, route];

      return {
        state: { ...state, index: routes.length - 1, routes },
        verdicts: [
          ...keptVerdicts(state.routes, 'push() never removes anything. Still mounted underneath.'),
          {
            key: route.key,
            name,
            outcome: 'added',
            reason:
              dupes > 0
                ? `push() is unconditional: this is instance #${dupes + 1} of '${name}'. Distinct key => distinct component with its own state.`
                : 'Appended to the top of the routes array with a fresh key.',
          },
        ],
        rationale:
          `push('${name}') appended a new instance at index ${routes.length - 1}. ` +
          (dupes > 0
            ? `There ${dupes === 1 ? 'was' : 'were'} already ${dupes} '${name}' route(s) in the stack - push() does not care and never deduplicates.`
            : 'push() always creates a new instance, even when the screen exists elsewhere.'),
      };
    }

    case 'POP':
    case 'GO_BACK': {
      const count = action.type === 'POP' ? Math.max(1, action.payload.count) : 1;
      if (state.index === 0) {
        return {
          state: null,
          rationale:
            `${action.type === 'POP' ? `pop(${count})` : 'goBack()'} could not be handled: this stack is already at index 0. ` +
            'The router returned null, so the action bubbles up to the parent navigator.',
        };
      }
      const targetIndex = Math.max(0, state.index - count);
      const destroyed = state.routes.slice(targetIndex + 1);
      const routes = state.routes.slice(0, targetIndex + 1);

      return {
        state: { ...state, index: targetIndex, routes },
        verdicts: [
          ...keptVerdicts(routes.slice(0, targetIndex), 'Below the new focus - unaffected.'),
          {
            key: routes[targetIndex].key,
            name: routes[targetIndex].name,
            outcome: 'refocused',
            reason: 'Revealed by the pop. It was mounted the whole time, so no useEffect re-runs - only useFocusEffect fires.',
          },
          ...removedVerdicts(destroyed, 'Popped off the array. Unmounted; local state and any unsaved input are discarded.'),
        ],
        rationale:
          `${action.type === 'POP' ? `pop(${count})` : 'goBack()'} truncated the stack from ${state.routes.length} to ${routes.length} route(s), ` +
          `destroying [${fmt(destroyed.map((r) => r.name))}]. Focus moved from index ${state.index} to ${targetIndex}.`,
      };
    }

    case 'POP_TO': {
      const { name, params, merge = false } = action.payload;

      if (version === 'v6') {
        return {
          state: null,
          error:
            `popTo('${name}') does not exist in React Navigation 6 - StackActions.popTo was introduced in v7. ` +
            'In v6 you would call navigate() and rely on its (now removed) unwinding behaviour.',
        };
      }
      if (!state.routeNames.includes(name)) return NOT_HANDLED;

      const existingIndex = lastIndexOfName(state.routes, name);

      if (existingIndex === -1) {
        if (ctx.options.strictPopTo) {
          return {
            state: null,
            error:
              `popTo('${name}') found no '${name}' instance in the stack [${fmt(state.routes.map((r) => r.name))}]. ` +
              'Strict mode is on: popTo is treated as a pure rollback helper and refuses to instantiate a screen that was never there. ' +
              'Turn strict mode off to see what the real v7 router does instead.',
          };
        }
        // Real v7: "popTo will go back to the screen if it exists in the stack,
        // otherwise pop the current screen and add this screen to the stack."
        const route = buildRoute(ctx, state.key, name, params);
        if (!route) return NOT_HANDLED;
        const popped = state.routes.slice(state.index);
        const routes = [...state.routes.slice(0, state.index), route];

        return {
          state: { ...state, index: routes.length - 1, routes },
          verdicts: [
            ...removedVerdicts(popped, 'popTo() popped the current screen to make room for the target.'),
            { key: route.key, name, outcome: 'added', reason: 'Target was absent, so v7 popTo() added it after popping the current screen.' },
          ],
          rationale:
            `popTo('${name}') found no existing '${name}'. Per the v7 docs it popped the current screen (${current.name}) ` +
            `and added '${name}' in its place, so the stack depth stayed at ${routes.length}.`,
          versionNote: 'v7 popTo() is a "go back to, or put me there" helper - it is not a pure rollback.',
        };
      }

      if (existingIndex === state.index) {
        return {
          state,
          verdicts: [{ key: current.key, name, outcome: 'kept', reason: 'Already the focused route; nothing to pop.' }],
          rationale: `popTo('${name}') is a no-op: '${name}' is already the focused route at index ${state.index}.`,
        };
      }

      const destroyed = state.routes.slice(existingIndex + 1);
      const routes = state.routes.slice(0, existingIndex + 1);
      routes[existingIndex] = withParams(routes[existingIndex], params, merge);

      return {
        state: { ...state, index: existingIndex, routes },
        verdicts: [
          ...keptVerdicts(routes.slice(0, existingIndex), 'Below the target - untouched.'),
          {
            key: routes[existingIndex].key,
            name,
            outcome: 'refocused',
            reason: `Existing instance reused at its original index ${existingIndex}; the key is preserved so component state survives.`,
          },
          ...removedVerdicts(destroyed, 'Rolled back over by popTo(). Unmounted and destroyed.'),
        ],
        rationale:
          `popTo('${name}') looked downstream, found '${name}' at index ${existingIndex}, and rolled the stack back to it - ` +
          `destroying ${destroyed.length} screen(s) [${fmt(destroyed.map((r) => r.name))}]. ` +
          'This is the v7 replacement for the old navigate() unwinding behaviour, and it says what it means at the call site.',
      };
    }

    case 'POP_TO_TOP': {
      if (state.routes.length === 1) {
        return {
          state,
          verdicts: [{ key: current.key, name: current.name, outcome: 'kept', reason: 'Already the only route in the stack.' }],
          rationale: 'popToTop() was a no-op: the stack already holds a single route.',
        };
      }
      const destroyed = state.routes.slice(1);
      return {
        state: { ...state, index: 0, routes: [state.routes[0]] },
        verdicts: [
          {
            key: state.routes[0].key,
            name: state.routes[0].name,
            outcome: 'refocused',
            reason: 'The bottom route always survives popToTop() - same key, same instance, its state is intact.',
          },
          ...removedVerdicts(destroyed, 'Everything above index 0 is discarded in a single dispatch.'),
        ],
        rationale:
          `popToTop() collapsed ${state.routes.length} routes down to 1, destroying [${fmt(destroyed.map((r) => r.name))}]. ` +
          'It is equivalent to pop(routes.length - 1).',
      };
    }

    case 'REPLACE': {
      const { name, params } = action.payload;
      if (!state.routeNames.includes(name)) return NOT_HANDLED;
      const route = buildRoute(ctx, state.key, name, params);
      if (!route) return NOT_HANDLED;
      const routes = state.routes.slice();
      routes[state.index] = route;

      return {
        state: { ...state, routes },
        verdicts: [
          ...keptVerdicts(state.routes.slice(0, state.index), 'Below the replaced route - untouched.'),
          {
            key: current.key,
            name: current.name,
            outcome: 'removed',
            reason: 'replace() swaps the entry at the current index. The old key disappears, so the component unmounts.',
          },
          { key: route.key, name, outcome: 'added', reason: `Took over index ${state.index} with a new key - fresh component, fresh state.` },
        ],
        rationale:
          `replace('${name}') swapped ${current.name} for ${name} at index ${state.index}. ` +
          `Stack depth is unchanged (${routes.length}), and because the key changed from ${current.key} to ${route.key}, ` +
          'the old screen unmounts and the new one mounts. You cannot goBack() to the replaced screen - it no longer exists.',
      };
    }

    case 'RESET':
      return handleReset(state, action, ctx);

    case 'SET_PARAMS':
      return handleSetParams(state, action.payload.params, false);

    case 'REPLACE_PARAMS':
      return handleSetParams(state, action.payload.params, true);

    default:
      return NOT_HANDLED;
  }
}

/* ------------------------------------------------------------------ */
/* Tab router                                                          */
/* ------------------------------------------------------------------ */

function jumpTo(
  state: NavState,
  ctx: RouterContext,
  name: string,
  params: Params | undefined,
  merge: boolean,
  label: string,
): RouterOutcome {
  const targetIndex = state.routeNames.indexOf(name);
  const routeIndex = state.routes.findIndex((r) => r.name === name);
  if (targetIndex === -1 || routeIndex === -1) return NOT_HANDLED;

  const routes = state.routes.slice();
  routes[routeIndex] = withParams(routes[routeIndex], params, merge);
  const target = routes[routeIndex];

  const same = routeIndex === state.index;

  return {
    state: {
      ...state,
      index: routeIndex,
      routes,
      history: same ? state.history : pushHistory(state, ctx, target.key),
    },
    verdicts: [
      ...keptVerdicts(
        state.routes.filter((r) => r.key !== target.key),
        'Tab routes are never removed by navigation. Once mounted they stay mounted - only focus moves.',
      ),
      {
        key: target.key,
        name,
        outcome: same ? 'kept' : 'refocused',
        reason: same
          ? 'Already the active tab.'
          : 'Focus moved to this tab. If this is its first visit it mounts now (lazy is the default); afterwards it just refocuses.',
      },
    ],
    rationale:
      `${label}('${name}') moved the ${state.type} index from ${state.index} to ${routeIndex}. ` +
      'The routes array itself is untouched: a tab/drawer navigator holds every declared screen from the start and only ever changes which one is focused.',
  };
}

export function tabRouter(state: NavState, action: NavAction, ctx: RouterContext): RouterOutcome {
  switch (action.type) {
    case 'NAVIGATE':
    case 'NAVIGATE_DEPRECATED': {
      const { name, params, merge = false } = action.payload;
      if (!state.routeNames.includes(name)) return NOT_HANDLED;
      return jumpTo(state, ctx, name, params, merge, 'navigate');
    }

    case 'JUMP_TO': {
      const { name, params } = action.payload;
      if (!state.routeNames.includes(name)) return NOT_HANDLED;
      return jumpTo(state, ctx, name, params, false, 'jumpTo');
    }

    case 'GO_BACK':
      return tabGoBack(state, ctx);

    case 'RESET':
      return handleReset(state, action, ctx);

    case 'SET_PARAMS':
      return handleSetParams(state, action.payload.params, false);

    case 'REPLACE_PARAMS':
      return handleSetParams(state, action.payload.params, true);

    // Stack actions are simply not part of the TabRouter's vocabulary.
    case 'PUSH':
    case 'POP':
    case 'POP_TO':
    case 'POP_TO_TOP':
    case 'REPLACE':
      return {
        state: null,
        rationale:
          `The ${state.type} router has no handler for ${action.type}, so it returned null and the action bubbles up. ` +
          'Stack actions only ever do something inside a stack navigator.',
      };

    default:
      return NOT_HANDLED;
  }
}

/* ------------------------------------------------------------------ */
/* Drawer router                                                       */
/* ------------------------------------------------------------------ */

export const isDrawerOpen = (state: NavState) => (state.history ?? []).some((e) => e.type === 'drawer');

export function drawerRouter(state: NavState, action: NavAction, ctx: RouterContext): RouterOutcome {
  const open = isDrawerOpen(state);
  const current = state.routes[state.index];

  switch (action.type) {
    case 'OPEN_DRAWER':
    case 'TOGGLE_DRAWER': {
      if (open && action.type === 'TOGGLE_DRAWER') return closeDrawer(state);
      if (open) return { state, rationale: 'The drawer is already open.' };
      return {
        state: { ...state, history: [...(state.history ?? []), { type: 'drawer', status: 'open' }] },
        verdicts: [{ key: current.key, name: current.name, outcome: 'kept', reason: 'Opening the drawer does not blur the screen behind it.' }],
        rationale:
          'openDrawer() pushed a { type: "drawer", status: "open" } entry onto the navigator history. ' +
          'Notice that no route changed: the drawer is a second dimension of the same state object, and the screen behind stays focused.',
      };
    }

    case 'CLOSE_DRAWER':
      return open ? closeDrawer(state) : { state, rationale: 'The drawer is already closed.' };

    case 'GO_BACK': {
      // An open drawer is consumed first, whatever backBehavior says.
      if (open) return closeDrawer(state, 'goBack() consumed the drawer history entry first, closing it instead of navigating.');
      return tabGoBack(state, ctx);
    }

    default: {
      const outcome = tabRouter(state, action, ctx);
      // Navigating while the drawer is open closes it, like the real router.
      if (outcome.state && open && outcome.state.index !== state.index) {
        return {
          ...outcome,
          state: { ...outcome.state, history: (outcome.state.history ?? []).filter((e) => e.type !== 'drawer') },
          rationale: `${outcome.rationale ?? ''} The drawer entry was dropped from history, so the drawer closed as part of the same dispatch.`,
        };
      }
      return outcome;
    }
  }
}

function closeDrawer(state: NavState, note?: string): RouterOutcome {
  return {
    state: { ...state, history: (state.history ?? []).filter((e) => e.type !== 'drawer') },
    rationale: note ?? 'closeDrawer() removed the drawer entry from the navigator history. No route was touched.',
  };
}

/* ------------------------------------------------------------------ */
/* Dispatch table                                                      */
/* ------------------------------------------------------------------ */

export function routerFor(type: NavState['type']) {
  return type === 'stack' ? stackRouter : type === 'tab' ? tabRouter : drawerRouter;
}
