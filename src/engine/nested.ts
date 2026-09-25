import type { NavState, Params } from './types';
import type { BlueprintIndex } from './blueprint';

/**
 * Nested navigation.
 *
 * React Navigation addresses a screen inside a child navigator by nesting the
 * payload rather than naming the screen directly:
 *
 *   navigation.navigate('App', {
 *     screen: 'Home',
 *     params: { screen: 'Article', params: { slug: 'v7' } },
 *   });
 *
 * Each level is a separate NAVIGATE handled by a different navigator, which is
 * why the leaf screen does not need to exist anywhere near the caller - and why
 * this form keeps working when the child navigator has not mounted yet.
 *
 * The `initial` flag is the part people trip over: it only has any effect when
 * the child navigator's state is being CREATED by this dispatch.
 */

export interface NestedHop {
  name: string;
  params?: Params;
  /**
   * Applies to the navigator that owns THIS hop's screen, and only when that
   * navigator is created by this dispatch.
   *  - undefined / true  -> the target becomes the child's only route
   *  - false             -> the child keeps its initialRouteName underneath
   */
  initial?: boolean;
}

const isNestedParams = (p: Params | undefined): p is Params & { screen: string } =>
  !!p && typeof p.screen === 'string';

/**
 * Flattens a nested payload into the sequence of navigate calls it stands for.
 * `navigate('A', { screen: 'B', params: { screen: 'C' } })` -> [A, B, C].
 */
export function flattenPayload(name: string, params?: Params): NestedHop[] {
  const hops: NestedHop[] = [];
  let currentName = name;
  let currentParams = params;
  let pendingInitial: boolean | undefined;

  // `initial` sits next to `screen`, but governs the navigator one level down,
  // so it is carried forward onto the hop it actually applies to.
  for (let guard = 0; guard < 16; guard++) {
    if (!isNestedParams(currentParams)) {
      hops.push({ name: currentName, params: currentParams, initial: pendingInitial });
      return hops;
    }
    const { screen, params: childParams, initial, ...rest } = currentParams as Params & {
      screen: string;
      params?: Params;
      initial?: boolean;
    };
    hops.push({
      name: currentName,
      params: Object.keys(rest).length ? (rest as Params) : undefined,
      initial: pendingInitial,
    });
    pendingInitial = typeof initial === 'boolean' ? initial : undefined;
    currentName = screen;
    currentParams = childParams;
  }

  return hops;
}

/** The inverse of `flattenPayload` - what you would actually type. */
export function buildPayload(hops: NestedHop[]): { name: string; params?: Params } {
  if (hops.length === 0) return { name: '' };
  const [head, ...rest] = hops;
  if (rest.length === 0) return { name: head.name, params: head.params };

  const inner = buildPayload(rest);
  const params: Params = { ...(head.params ?? {}), screen: inner.name };
  if (inner.params) params.params = inner.params;
  if (rest[0].initial === false) params.initial = false;
  return { name: head.name, params };
}

/** Renders the payload as the source line a developer would write. */
export function formatPayload(hops: NestedHop[], method = 'navigate'): string {
  const { name, params } = buildPayload(hops);
  return params ? `navigation.${method}('${name}', ${JSON.stringify(params)})` : `navigation.${method}('${name}')`;
}

/** A hop plus the navigator that declares it, so a path can be trimmed. */
export interface AddressedHop extends NestedHop {
  navKey: string;
}

/**
 * The full chain of routes from the root navigator down to `name`, which is the
 * address you need when the child navigator may not be mounted.
 */
export function pathToScreen(idx: BlueprintIndex, navKey: string, name: string): AddressedHop[] {
  const hops: AddressedHop[] = [{ name, navKey }];
  let key: string | undefined = navKey;

  for (let guard = 0; guard < 16 && key; guard++) {
    const parent = idx.parents.get(key);
    if (!parent) break;
    hops.unshift({ name: parent.screen, navKey: parent.parentNav });
    key = parent.parentNav;
  }

  return hops;
}

/**
 * Shortens a root-anchored path to the smallest one that still works.
 *
 * Only the FIRST hop has to be reachable by bubbling; every hop after it is
 * handed down by the navigator that took the one before. So the path can start
 * at the deepest navigator shared with the focus chain - the junction - rather
 * than at the root. Going up further is valid but says more than it needs to.
 */
export function trimToReachable(hops: AddressedHop[], chainKeys: Set<string>): AddressedHop[] {
  let start = 0;
  for (let i = 0; i < hops.length; i++) {
    if (chainKeys.has(hops[i].navKey)) start = i;
  }
  return hops.slice(start);
}

/** The navigator where an addressed path re-enters the focus chain. */
export function junctionOf(hops: AddressedHop[], chainKeys: Set<string>): string | null {
  const trimmed = trimToReachable(hops, chainKeys);
  return trimmed[0] ? trimmed[0].navKey : null;
}

/* ------------------------------------------------------------------ */
/* Freshly created child navigators                                    */
/* ------------------------------------------------------------------ */

export function collectNavKeys(state: NavState, out: Set<string> = new Set()): Set<string> {
  out.add(state.key);
  for (const route of state.routes) if (route.state) collectNavKeys(route.state, out);
  return out;
}

/**
 * `initial: true` (the default) means the nested navigator is created with the
 * target as its ONLY route - so there is nothing to go back to inside it.
 * This drops the initial route that hydration had just put underneath.
 */
export function collapseToFocused(state: NavState): NavState {
  if (state.type !== 'stack' || state.routes.length <= 1) return state;
  return { ...state, index: 0, routes: [state.routes[state.index]] };
}
