import type { BackBehavior, NavState, NavigatorType, Params, RouteState } from './types';

/**
 * A "blueprint" is the declarative app layout - the equivalent of your
 * `createNativeStackNavigator({ screens: { ... } })` config in v7's static API,
 * or of your `<Stack.Screen />` JSX tree in the v6 dynamic API.
 *
 * The router state machine is driven entirely by these blueprints, exactly as
 * React Navigation derives `routeNames` from the screens you declare.
 */

export interface ScreenBlueprint {
  name: string;
  icon?: string;
  /** Header title, defaults to `name`. */
  title?: string;
  blurb?: string;
  initialParams?: Params;
  /** A navigator rendered *by* this screen (e.g. a stack inside a tab). */
  nested?: NavigatorBlueprint;
}

export interface NavigatorBlueprint {
  id: string;
  type: NavigatorType;
  initialRouteName?: string;
  /** Tab/drawer only. Omitted means the documented default, `firstRoute`. */
  backBehavior?: BackBehavior;
  screens: ScreenBlueprint[];
}

export interface Preset {
  id: string;
  label: string;
  tagline: string;
  factory: string;
  blueprint: NavigatorBlueprint;
}

/**
 * A navigator's *id* is stable and comes from the layout. It is what
 * `getParent('id')` addresses, and what the blueprint index is keyed by.
 * It is NOT the navigator's state key - see `makeNavKey`.
 */
export const navIdOf = (bp: NavigatorBlueprint) => `${bp.type}-${bp.id}`;

/* ------------------------------------------------------------------ */
/* Key generation                                                      */
/* ------------------------------------------------------------------ */

let keyCounter = 0;
export const resetKeyCounter = () => {
  keyCounter = 0;
};
/** Mirrors React Navigation's `${name}-${uniqueId}` route keys. */
export const makeRouteKey = (name: string) => `${name}-${(keyCounter++).toString(36)}`;

/**
 * A navigator's *key* identifies one mounted instance, not one layout entry.
 *
 * Pushing a second copy of a screen that renders a navigator mounts a second
 * navigator, with its own routes and its own index, so the key cannot come
 * from the layout: the docs describe it as a "unique key to identify the
 * navigator", generated the same way route keys are. Deriving it from the
 * blueprint instead made two instances collide on one key - they shared a
 * node in the visualizer, and getParent() could only ever find the first.
 *
 * The id stays in front of the counter so the key is still readable, and so
 * the layout can be looked back up from it.
 */
export const makeNavKey = (bp: NavigatorBlueprint) => `${navIdOf(bp)}#${(keyCounter++).toString(36)}`;

/** The stable id behind an instance key. Safe to pass either one. */
export const navIdFromKey = (key: string) => {
  const hash = key.indexOf('#');
  return hash === -1 ? key : key.slice(0, hash);
};

/**
 * Save/restore around a speculative dispatch. Predicting what an action WOULD
 * do runs the real routers, which mint route keys; without this the keys in the
 * visualizer would skip numbers every time the preview re-ran.
 */
export const snapshotKeyCounter = () => keyCounter;
export const restoreKeyCounter = (value: number) => {
  keyCounter = value;
};

/* ------------------------------------------------------------------ */
/* Blueprint index                                                     */
/* ------------------------------------------------------------------ */

export interface BlueprintIndex {
  /** navigator key -> blueprint */
  navigators: Map<string, NavigatorBlueprint>;
  /** `${navKey}::${screenName}` -> screen blueprint */
  screens: Map<string, ScreenBlueprint>;
  /** screen name -> owning navigator key (first match; used for hints only) */
  ownerOf: Map<string, string>;
  /** child navigator key -> the route that renders it. Drives nested payloads. */
  parents: Map<string, { parentNav: string; screen: string }>;
}

export function indexBlueprint(bp: NavigatorBlueprint, index?: BlueprintIndex): BlueprintIndex {
  const idx: BlueprintIndex =
    index ?? { navigators: new Map(), screens: new Map(), ownerOf: new Map(), parents: new Map() };
  const navKey = navIdOf(bp);
  idx.navigators.set(navKey, bp);
  for (const screen of bp.screens) {
    idx.screens.set(`${navKey}::${screen.name}`, screen);
    if (!idx.ownerOf.has(screen.name)) idx.ownerOf.set(screen.name, navKey);
    if (screen.nested) {
      idx.parents.set(navIdOf(screen.nested), { parentNav: navKey, screen: screen.name });
      indexBlueprint(screen.nested, idx);
    }
  }
  return idx;
}

/* The index is keyed by navigator id, so every lookup accepts an instance
   key just as happily as the id itself. */
export const getScreenBlueprint = (idx: BlueprintIndex, nav: string, name: string) =>
  idx.screens.get(`${navIdFromKey(nav)}::${name}`);

export const getNavigatorBlueprint = (idx: BlueprintIndex, nav: string) =>
  idx.navigators.get(navIdFromKey(nav));

export const getParentLink = (idx: BlueprintIndex, nav: string) => idx.parents.get(navIdFromKey(nav));

/* ------------------------------------------------------------------ */
/* State construction                                                  */
/* ------------------------------------------------------------------ */

export function makeRoute(screen: ScreenBlueprint, params?: Params): RouteState {
  const merged = { ...(screen.initialParams ?? {}), ...(params ?? {}) };
  return {
    key: makeRouteKey(screen.name),
    name: screen.name,
    ...(Object.keys(merged).length ? { params: merged } : {}),
  };
}

/**
 * Builds the initial state for a navigator.
 *
 * Note the asymmetry, which is real and worth internalising:
 *  - a **stack** starts with a single route in `routes`
 *  - a **tab / drawer** starts with *every* declared screen already in `routes`
 *    (they are only lazily *mounted*, but they exist in state from frame one).
 */
export function buildInitialState(bp: NavigatorBlueprint): NavState {
  const routeNames = bp.screens.map((s) => s.name);
  const initialName = bp.initialRouteName ?? routeNames[0];
  const initialIndex = Math.max(0, routeNames.indexOf(initialName));

  if (bp.type === 'stack') {
    const route = makeRoute(bp.screens[initialIndex]);
    return { key: makeNavKey(bp), type: 'stack', index: 0, routeNames, routes: [route], stale: false };
  }

  const routes = bp.screens.map((s) => makeRoute(s));
  return {
    key: makeNavKey(bp),
    type: bp.type,
    index: initialIndex,
    routeNames,
    routes,
    history: [{ type: 'route', key: routes[initialIndex].key }],
    stale: false,
  };
}

/**
 * Creates nested navigator state for routes that have just mounted.
 * React Navigation does the same thing: a child navigator has no entry in
 * `route.state` until the component that renders it actually mounts.
 */
export function hydrateNested(state: NavState, idx: BlueprintIndex, mounted: Set<string>): NavState {
  let changed = false;
  const routes = state.routes.map((route) => {
    const screen = getScreenBlueprint(idx, state.key, route.name);
    if (!screen?.nested) return route;

    if (!mounted.has(route.key)) {
      // Unmounted: React Navigation drops the child state entirely.
      if (route.state) {
        changed = true;
        const { state: _dropped, ...rest } = route;
        return rest;
      }
      return route;
    }

    if (!route.state) {
      changed = true;
      const child = buildInitialState(screen.nested);
      return { ...route, state: hydrateNested(child, idx, mounted) };
    }

    const hydrated = hydrateNested(route.state, idx, mounted);
    if (hydrated !== route.state) {
      changed = true;
      return { ...route, state: hydrated };
    }
    return route;
  });

  return changed ? { ...state, routes } : state;
}

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

export const PRESETS: Preset[] = [
  {
    id: 'native-stack',
    label: 'Native Stack',
    tagline: 'One stack, five screens. The purest place to watch push vs navigate.',
    factory: 'createNativeStackNavigator',
    blueprint: {
      id: 'root',
      type: 'stack',
      screens: [
        { name: 'Home', icon: 'H', blurb: 'Root of the stack. index 0 - always survives popToTop().' },
        { name: 'Feed', icon: 'F', blurb: 'A list screen. Push it twice to see duplicate instances.' },
        { name: 'Profile', icon: 'P', blurb: 'The classic navigate() unwinding target.' },
        { name: 'Settings', icon: 'S', blurb: 'Try replace() from here - the key changes, so state is lost.' },
        { name: 'Details', icon: 'D', blurb: 'Takes params. Try setParams() to watch immutable updates.', initialParams: { id: 42 } },
      ],
    },
  },
  {
    id: 'bottom-tabs',
    label: 'Bottom Tabs',
    tagline: 'All routes exist from frame one; mounting is lazy, not structural.',
    factory: 'createBottomTabNavigator',
    blueprint: {
      id: 'main',
      type: 'tab',
      screens: [
        { name: 'Home', icon: 'H', blurb: 'Tab routes never unmount once visited (no unmountOnBlur in v7).' },
        { name: 'Search', icon: 'S', blurb: 'Already in routes[] before you ever open it - just not mounted.' },
        { name: 'Notifications', icon: 'N', blurb: 'jumpTo() moves index; it never adds or removes routes.' },
        { name: 'Profile', icon: 'P', blurb: 'push() is not a thing here - the tab router returns null.' },
      ],
    },
  },
  {
    id: 'drawer',
    label: 'Drawer',
    tagline: 'A tab-like router with an open/closed dimension in its history.',
    factory: 'createDrawerNavigator',
    blueprint: {
      id: 'root',
      type: 'drawer',
      // Explicitly opted in: the documented DEFAULT for the drawer is
      // 'firstRoute', same as bottom tabs. This preset sets 'history' so the
      // visit-order behaviour is visible; the Drawer+Tabs+Stacks preset leaves
      // it at the default for comparison.
      backBehavior: 'history',
      screens: [
        { name: 'Home', icon: 'H', blurb: 'This navigator opts into backBehavior: "history". The default would be "firstRoute".' },
        { name: 'Settings', icon: 'S', blurb: 'Opening the drawer pushes a {type:"drawer"} history entry.' },
        { name: 'Help', icon: '?', blurb: 'goBack() closes the drawer before it touches any route.' },
        { name: 'About', icon: 'i', blurb: 'Drawer screens stay focused while the drawer is open.' },
      ],
    },
  },
  {
    id: 'nested',
    label: 'Sibling stacks in Tabs',
    tagline: 'Two stacks side by side under one tab navigator - neither can see into the other.',
    factory: 'createBottomTabNavigator + createNativeStackNavigator',
    blueprint: {
      id: 'main',
      type: 'tab',
      initialRouteName: 'Feed',
      screens: [
        { name: 'Feed', icon: 'F', blurb: 'A plain tab screen with no navigator of its own.' },
        {
          name: 'Dashboard',
          icon: 'D',
          blurb: 'Renders a nested native stack. Its child state appears on mount.',
          nested: {
            id: 'dashboard',
            type: 'stack',
            screens: [
              { name: 'Overview', icon: 'O', blurb: 'Nested stack root.' },
              { name: 'ProductList', icon: 'L', blurb: 'Sits between Overview and ProductDetails.' },
              { name: 'ProductDetails', icon: 'P', blurb: 'The v6-vs-v7 nested navigate() battleground.', initialParams: { sku: 'RN-7' } },
              { name: 'Checkout', icon: 'C', blurb: 'Deep in branch A. From here, try to reach Security in branch B.' },
            ],
          },
        },
        {
          name: 'Profile',
          icon: 'U',
          blurb: 'The sibling branch. Its stack is invisible to anything inside the Dashboard stack.',
          nested: {
            id: 'profile',
            type: 'stack',
            screens: [
              { name: 'ProfileHome', icon: 'U', title: 'Profile', blurb: 'Root of the sibling stack.' },
              { name: 'EditProfile', icon: 'E', blurb: 'Reachable only through the Profile route above it.' },
              {
                name: 'Security',
                icon: 'K',
                blurb: 'Deep in branch B. A bare navigate() from branch A can never land here.',
              },
            ],
          },
        },
      ],
    },
  },
  {
    id: 'full-app',
    label: 'Drawer + Tabs + Stacks',
    tagline: 'Three levels of nesting. Watch an action climb the tree to find a handler.',
    factory: 'createDrawerNavigator + createBottomTabNavigator + createNativeStackNavigator',
    blueprint: {
      id: 'root',
      type: 'drawer',
      screens: [
        {
          name: 'App',
          icon: 'A',
          blurb: 'Hosts the whole tab navigator.',
          nested: {
            id: 'main',
            type: 'tab',
            screens: [
              {
                name: 'Home',
                icon: 'H',
                nested: {
                  id: 'home',
                  type: 'stack',
                  screens: [
                    { name: 'Timeline', icon: 'T', blurb: 'Leaf-level stack root.' },
                    { name: 'Article', icon: 'A', initialParams: { slug: 'v7-static-api' } },
                    { name: 'Comments', icon: 'C' },
                  ],
                },
              },
              { name: 'Search', icon: 'S' },
              {
                name: 'Account',
                icon: 'U',
                nested: {
                  id: 'account',
                  type: 'stack',
                  screens: [
                    { name: 'AccountHome', icon: 'U', title: 'Account' },
                    { name: 'EditProfile', icon: 'E' },
                  ],
                },
              },
            ],
          },
        },
        { name: 'Billing', icon: 'B', blurb: 'A drawer-level screen that lives outside the tabs.' },
        { name: 'Support', icon: 'S' },
      ],
    },
  },
];

export const getPreset = (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[0];
