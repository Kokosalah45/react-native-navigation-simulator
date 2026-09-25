import type {
  DispatchResult,
  LifecycleEvent,
  NavAction,
  NavState,
  RouteState,
  RouteVerdict,
} from './types';
import type { BlueprintIndex } from './blueprint';
import { hydrateNested } from './blueprint';
import { isDrawerOpen, routerFor, type RouterContext } from './routers';

/**
 * NavigatorEngine
 * ---------------
 * Everything above the individual routers: how an action finds a navigator,
 * which screens are considered mounted, and which lifecycle hooks that implies.
 *
 * The rules encoded here are the ones people usually learn the hard way:
 *
 *  1. An action is dispatched at the navigator that owns the calling screen,
 *     then BUBBLES UP to parents until some router returns a non-null state.
 *  2. In v6 an unhandled NAVIGATE could also travel DOWN into an already
 *     mounted child navigator. v7 removed that (`navigationInChildEnabled`).
 *  3. Stack routes are mounted for as long as they are in `routes`.
 *     Tab/drawer routes exist in `routes` from the start but mount lazily on
 *     first focus - and then stay mounted.
 */

/* ------------------------------------------------------------------ */
/* Tree helpers                                                        */
/* ------------------------------------------------------------------ */

/** The chain of navigators from the root down to the focused leaf. */
export function focusedNavigators(root: NavState): NavState[] {
  const chain: NavState[] = [];
  let nav: NavState | undefined = root;
  while (nav) {
    chain.push(nav);
    nav = nav.routes[nav.index]?.state;
  }
  return chain;
}

/** Route keys on the focus chain. Every one of these has `isFocused === true`. */
export function focusedRouteKeys(root: NavState): string[] {
  return focusedNavigators(root).map((nav) => nav.routes[nav.index]?.key).filter(Boolean) as string[];
}

export function focusedRoute(root: NavState): RouteState {
  const chain = focusedNavigators(root);
  const last = chain[chain.length - 1];
  return last.routes[last.index];
}

/**
 * The chain of navigators from the root down to `navKey`, or null if that
 * navigator is not currently mounted. Used to dispatch an action from a
 * navigator other than the focused one - the simulator's `getParent()`.
 */
export function navigatorPath(root: NavState, navKey: string): NavState[] | null {
  if (root.key === navKey) return [root];
  for (const route of root.routes) {
    if (!route.state) continue;
    const below = navigatorPath(route.state, navKey);
    if (below) return [root, ...below];
  }
  return null;
}

/** Immutably swaps one navigator's state inside the tree. */
export function replaceNav(root: NavState, targetKey: string, next: NavState): NavState {
  if (root.key === targetKey) return next;
  let changed = false;
  const routes = root.routes.map((route) => {
    if (!route.state) return route;
    const replaced = replaceNav(route.state, targetKey, next);
    if (replaced === route.state) return route;
    changed = true;
    return { ...route, state: replaced };
  });
  return changed ? { ...root, routes } : root;
}

export function allRoutes(root: NavState, out: Map<string, { route: RouteState; nav: NavState; index: number }> = new Map()) {
  root.routes.forEach((route, index) => {
    out.set(route.key, { route, nav: root, index });
    if (route.state) allRoutes(route.state, out);
  });
  return out;
}

export function findNavContaining(root: NavState, routeKey: string): NavState | null {
  if (root.routes.some((r) => r.key === routeKey)) return root;
  for (const route of root.routes) {
    if (route.state) {
      const found = findNavContaining(route.state, routeKey);
      if (found) return found;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Mounting                                                            */
/* ------------------------------------------------------------------ */

export interface MountAnalysis {
  mounted: Set<string>;
  /** Routes that are the active index of a mounted navigator (drives lazy mounting). */
  activated: Set<string>;
}

export function analyzeMounting(root: NavState, everFocused: Set<string>): MountAnalysis {
  const out: MountAnalysis = { mounted: new Set(), activated: new Set() };

  const walk = (nav: NavState, parentMounted: boolean) => {
    nav.routes.forEach((route, i) => {
      const isActive = i === nav.index;
      // Stacks render every route they hold. Tabs and drawers are lazy by default.
      const mounted = parentMounted && (nav.type === 'stack' || isActive || everFocused.has(route.key));
      if (!mounted) return;
      out.mounted.add(route.key);
      if (isActive) out.activated.add(route.key);
      if (route.state) walk(route.state, true);
    });
  };

  walk(root, true);
  return out;
}

/* ------------------------------------------------------------------ */
/* Lifecycle diffing                                                   */
/* ------------------------------------------------------------------ */

export function diffLifecycle(
  prev: { mounted: Set<string>; focused: Set<string> },
  next: { mounted: Set<string>; focused: Set<string> },
  nameOf: (key: string) => string,
): LifecycleEvent[] {
  const events: LifecycleEvent[] = [];
  const add = (kind: LifecycleEvent['kind'], key: string, hook: LifecycleEvent['hook'], detail: string) =>
    events.push({ kind, routeKey: key, routeName: nameOf(key), hook, detail });

  // React mounts new subtrees before focus events settle, and unmounts last.
  for (const key of next.mounted) {
    if (!prev.mounted.has(key)) add('mount', key, 'useEffect', 'Component mounted: useEffect(() => {...}, []) runs its setup.');
  }
  for (const key of prev.focused) {
    if (!next.focused.has(key)) add('blur', key, 'useFocusEffect', 'Screen blurred: the cleanup returned from useFocusEffect runs.');
  }
  for (const key of next.focused) {
    if (!prev.focused.has(key)) add('focus', key, 'useFocusEffect', 'Screen focused: useFocusEffect(useCallback(...)) runs its setup.');
  }
  for (const key of prev.mounted) {
    if (!next.mounted.has(key)) add('unmount', key, 'useEffect', 'Component unmounted: the useEffect cleanup runs and local state is destroyed.');
  }

  return events;
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

const isNavigateAction = (a: NavAction): a is Extract<NavAction, { type: 'NAVIGATE' | 'NAVIGATE_DEPRECATED' }> =>
  a.type === 'NAVIGATE' || a.type === 'NAVIGATE_DEPRECATED';

/** Descendant navigators of `nav`, excluding the branch the action came from. */
function mountedDescendants(nav: NavState, excludeKey: string | null, mounted: Set<string>, out: NavState[] = []) {
  for (const route of nav.routes) {
    if (!route.state || !mounted.has(route.key)) continue;
    if (route.state.key !== excludeKey) out.push(route.state);
    mountedDescendants(route.state, excludeKey, mounted, out);
  }
  return out;
}

/**
 * Runs one action against the tree, reproducing React Navigation's
 * bubble-up (and, for v6, drill-down) resolution order.
 */
export function dispatch(
  root: NavState,
  action: NavAction,
  ctx: RouterContext,
  mounted: Set<string>,
  /**
   * Navigator the action is dispatched from. Defaults to the one owning the
   * focused screen; pass a key to model `navigation.getParent('id')` or an
   * action fired from a screen that is mounted but blurred.
   */
  sourceNavKey?: string,
): DispatchResult {
  const chain = (sourceNavKey ? navigatorPath(root, sourceNavKey) : null) ?? focusedNavigators(root);
  const bubblePath: string[] = [];
  const declined: string[] = [];

  // 1. Bubble up from the focused navigator to the root.
  for (let i = chain.length - 1; i >= 0; i--) {
    const nav = chain[i];
    bubblePath.push(nav.key);
    const outcome = routerFor(nav.type)(nav, action, ctx);

    if (outcome.error) {
      return {
        state: root,
        handledBy: null,
        bubblePath,
        rationale: outcome.rationale ?? '',
        error: outcome.error,
        verdicts: [],
      };
    }

    if (outcome.state) {
      return {
        state: replaceNav(root, nav.key, outcome.state),
        handledBy: nav.key,
        bubblePath,
        rationale: prefixBubble(declined, outcome.rationale ?? ''),
        verdicts: outcome.verdicts ?? [],
        versionNote: outcome.versionNote,
      };
    }

    if (outcome.rationale) declined.push(outcome.rationale);

    // 2. v6 only: try mounted child navigators before continuing upward.
    if (isNavigateAction(action) && ctx.options.navigationInChildEnabled) {
      const cameFrom = i + 1 < chain.length ? chain[i + 1].key : null;
      for (const child of mountedDescendants(nav, cameFrom, mounted)) {
        const childOutcome = routerFor(child.type)(child, action, ctx);
        if (childOutcome.state) {
          bubblePath.push(`${child.key} (child)`);
          return {
            state: replaceNav(root, child.key, childOutcome.state),
            handledBy: child.key,
            bubblePath,
            rationale:
              `No navigator on the focus chain could handle '${action.payload.name}', so the action was passed DOWN into the already-mounted ` +
              `child navigator '${child.key}'. ` + (childOutcome.rationale ?? ''),
            verdicts: childOutcome.verdicts ?? [],
            versionNote:
              'This is the v6 behaviour React Navigation 7 removed: it only works when the child navigator happens to be mounted, ' +
              'which couples navigation to render state and cannot be typed. In v7 use navigate(Parent, { screen: Child }) instead.',
          };
        }
      }
    }
  }

  // 3. Nobody handled it.
  const name = isNavigateAction(action) || action.type === 'PUSH' || action.type === 'REPLACE' || action.type === 'POP_TO'
    ? action.payload.name
    : undefined;

  return {
    state: root,
    handledBy: null,
    bubblePath,
    rationale: prefixBubble(declined, ''),
    verdicts: [],
    error:
      `The action '${action.type}'${name ? ` with payload {"name":"${name}"}` : ''} was not handled by any navigator.` +
      (name
        ? ` Do you have a screen named '${name}'? If you are trying to navigate to a screen in a nested navigator, ` +
          'see the "Navigating to a screen in a nested navigator" section of the docs.'
        : ''),
  };
}

function prefixBubble(declined: string[], rationale: string) {
  if (!declined.length) return rationale;
  return `${declined.join(' ')}${rationale ? ` ${rationale}` : ''}`;
}

/* ------------------------------------------------------------------ */
/* Freezing (v7 development behaviour)                                 */
/* ------------------------------------------------------------------ */

/** v7 freezes the navigation state in development to catch direct mutation. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* Convenience re-exports for the UI                                   */
/* ------------------------------------------------------------------ */

export { hydrateNested, isDrawerOpen };
export type { BlueprintIndex, RouterContext, RouteVerdict };
