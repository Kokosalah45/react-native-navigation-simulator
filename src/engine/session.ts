import type {
  EngineOptions,
  LogEntry,
  NavAction,
  NavState,
  RNVersion,
  RouteVerdict,
} from './types';
import {
  type BlueprintIndex,
  type Preset,
  buildInitialState,
  hydrateNested,
  indexBlueprint,
  resetKeyCounter,
  restoreKeyCounter,
  snapshotKeyCounter,
} from './blueprint';
import {
  analyzeMounting,
  deepFreeze,
  diffLifecycle,
  dispatch,
  focusedRouteKeys,
  navigatorPath,
  replaceNav,
  allRoutes,
} from './NavigatorEngine';
import { collapseToFocused, collectNavKeys, flattenPayload, type NestedHop } from './nested';

/**
 * Session layer: holds the router state plus everything the UI needs to
 * narrate it - lifecycle log, per-route verdicts, and the ghosts of screens
 * that were just destroyed (so they can animate out).
 */

export interface Ghost {
  key: string;
  name: string;
  navKey: string;
  reason: string;
  at: number;
}

/** One level of a nested payload, and the navigator that consumed it. */
export interface HopStep {
  name: string;
  handledBy: string | null;
}

export interface LastChange {
  label: string;
  rationale: string;
  error?: string;
  versionNote?: string;
  handledBy: string | null;
  bubblePath: string[];
  /** Populated only for nested payloads (more than one hop). */
  hops: HopStep[];
  /** Set when the action was dispatched from a navigator other than the focused one. */
  source?: string;
}

/**
 * One dispatch, kept so the session can be read back as a whole.
 *
 * The lifecycle console answers "what did this action do?". This answers
 * "what have I been doing?", which is the question behind most of the
 * duplicate-branch confusion - no single dispatch looks wrong.
 */
export interface JourneyEntry {
  seq: number;
  /** The call as written, e.g. navigate('Tabs', { screen: 'Home' }). */
  code: string;
  actionType: NavAction['type'];
  /** navigate() carrying the v7 `pop` option. */
  popOption: boolean;
  handledBy: string | null;
  handledByType: NavState['type'] | null;
  error?: string;
  kind: 'mount' | 'unmount' | 'swap' | 'focus' | 'none';
  /** Route name this dispatch added a SECOND live copy of, if any. */
  duplicated?: string;
  rootDepth: number;
  /** Which root-level route was focused afterwards - the "section" you are in. */
  rootFocusName: string | null;
}

export interface SessionState {
  version: RNVersion;
  preset: Preset;
  options: EngineOptions;
  root: NavState;
  idx: BlueprintIndex;
  everFocused: string[];
  mounted: string[];
  focused: string[];
  verdicts: Record<string, RouteVerdict>;
  ghosts: Ghost[];
  log: LogEntry[];
  journey: JourneyEntry[];
  last: LastChange | null;
  tick: number;
  logSeq: number;
}

export type SessionAction =
  | { type: 'dispatch'; action: NavAction; label?: string; source?: string }
  | { type: 'setVersion'; version: RNVersion }
  | { type: 'setPreset'; preset: Preset }
  | { type: 'setOption'; key: keyof Omit<EngineOptions, 'version'>; value: boolean }
  | { type: 'clearLog' }
  | { type: 'clearGhosts' }
  /**
   * Put a previously captured session back verbatim.
   *
   * Session state is immutable, so a quiz beat can hold the object it started
   * from and hand it back for a retry. A wrong answer corrupts the state for
   * every beat after it, so retry has to restore rather than replay.
   */
  | { type: 'restore'; state: SessionState }
  | { type: 'restart' };

/* ------------------------------------------------------------------ */
/* Action labels                                                       */
/* ------------------------------------------------------------------ */

const q = (v: unknown) => (typeof v === 'string' ? `'${v}'` : JSON.stringify(v));

export function describeAction(action: NavAction): string {
  switch (action.type) {
    case 'NAVIGATE': {
      const { name, params, merge, pop } = action.payload;
      const opts = [merge ? 'merge: true' : null, pop ? 'pop: true' : null].filter(Boolean).join(', ');
      const args = [q(name), params ? JSON.stringify(params) : null, opts ? `{ ${opts} }` : null].filter(Boolean);
      return `navigation.navigate(${args.join(', ')})`;
    }
    case 'NAVIGATE_DEPRECATED':
      return `navigation.navigateDeprecated(${q(action.payload.name)})`;
    case 'PUSH':
      return `navigation.push(${q(action.payload.name)}${action.payload.params ? `, ${JSON.stringify(action.payload.params)}` : ''})`;
    case 'POP':
      return `navigation.pop(${action.payload.count})`;
    case 'POP_TO':
      return `navigation.popTo(${q(action.payload.name)}${action.payload.params ? `, ${JSON.stringify(action.payload.params)}` : ''})`;
    case 'POP_TO_TOP':
      return 'navigation.popToTop()';
    case 'REPLACE':
      return `navigation.replace(${q(action.payload.name)})`;
    case 'RESET':
      return `navigation.reset({ index: ${action.payload.index}, routes: [${action.payload.routes.map((r) => `{ name: ${q(r.name)} }`).join(', ')}] })`;
    case 'GO_BACK':
      return 'navigation.goBack()';
    case 'SET_PARAMS':
      return `navigation.setParams(${JSON.stringify(action.payload.params)})`;
    case 'REPLACE_PARAMS':
      return `navigation.replaceParams(${JSON.stringify(action.payload.params)})`;
    case 'JUMP_TO':
      return `navigation.jumpTo(${q(action.payload.name)})`;
    case 'OPEN_DRAWER':
      return 'navigation.openDrawer()';
    case 'CLOSE_DRAWER':
      return 'navigation.closeDrawer()';
    case 'TOGGLE_DRAWER':
      return 'navigation.toggleDrawer()';
  }
}

/* ------------------------------------------------------------------ */
/* Settling: mount analysis + lazy hydration until stable              */
/* ------------------------------------------------------------------ */

function settle(root: NavState, idx: BlueprintIndex, everFocused: Set<string>) {
  let current = root;
  let ef = new Set(everFocused);

  for (let i = 0; i < 8; i++) {
    const analysis = analyzeMounting(current, ef);
    const hydrated = hydrateNested(current, idx, analysis.mounted);
    const nextEf = new Set([...ef, ...analysis.activated]);
    const stable = hydrated === current && nextEf.size === ef.size;
    current = hydrated;
    ef = nextEf;
    if (stable) break;
  }

  const analysis = analyzeMounting(current, ef);
  return {
    root: current,
    mounted: analysis.mounted,
    focused: new Set(focusedRouteKeys(current)),
    everFocused: ef,
  };
}

/* ------------------------------------------------------------------ */
/* Logging                                                             */
/* ------------------------------------------------------------------ */

const MAX_LOG = 220;

interface LogDraft {
  level: LogEntry['level'];
  text: string;
  hook?: LogEntry['hook'];
  kind?: LogEntry['kind'];
}

function appendLog(state: Pick<SessionState, 'log' | 'logSeq' | 'tick'>, drafts: LogDraft[]) {
  let seq = state.logSeq;
  const entries = drafts.map((d) => ({ id: seq++, t: state.tick, ...d }));
  const log = [...state.log, ...entries];
  return { log: log.length > MAX_LOG ? log.slice(log.length - MAX_LOG) : log, logSeq: seq };
}

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */

export function initSession(preset: Preset, version: RNVersion, overrides?: Partial<EngineOptions>): SessionState {
  resetKeyCounter();
  const idx = indexBlueprint(preset.blueprint);
  const options: EngineOptions = {
    version,
    navigationInChildEnabled: version === 'v6',
    strictPopTo: true,
    ...overrides,
    ...(overrides?.version ? {} : { version }),
  };

  const settled = settle(buildInitialState(preset.blueprint), idx, new Set());
  const root = options.version === 'v7' ? deepFreeze(settled.root) : settled.root;
  const names = allRoutes(root);

  const base: SessionState = {
    version: options.version,
    preset,
    options,
    root,
    idx,
    everFocused: [...settled.everFocused],
    mounted: [...settled.mounted],
    focused: [...settled.focused],
    verdicts: {},
    ghosts: [],
    log: [],
    journey: [],
    last: null,
    tick: 0,
    logSeq: 0,
  };

  const drafts: LogDraft[] = [
    { level: 'info', text: `Mounted <NavigationContainer> with the "${preset.label}" layout (React Navigation ${options.version}).` },
    ...[...settled.mounted].map((key) => ({
      level: 'lifecycle' as const,
      hook: 'useEffect' as const,
      kind: 'mount' as const,
      text: `${names.get(key)?.route.name ?? key} <${key}> mounted`,
    })),
    ...[...settled.focused].map((key) => ({
      level: 'lifecycle' as const,
      hook: 'useFocusEffect' as const,
      kind: 'focus' as const,
      text: `${names.get(key)?.route.name ?? key} <${key}> focused`,
    })),
  ];

  return { ...base, ...appendLog(base, drafts) };
}

/* ------------------------------------------------------------------ */
/* Reducer                                                             */
/* ------------------------------------------------------------------ */

export function sessionReducer(state: SessionState, event: SessionAction): SessionState {
  if (event.type === 'restore') return event.state;
  switch (event.type) {
    case 'setPreset':
      return initSession(event.preset, state.version, { strictPopTo: state.options.strictPopTo });

    case 'setVersion':
      return initSession(state.preset, event.version, { strictPopTo: state.options.strictPopTo });

    case 'restart':
      return initSession(state.preset, state.version, {
        strictPopTo: state.options.strictPopTo,
        navigationInChildEnabled: state.options.navigationInChildEnabled,
      });

    case 'setOption':
      return { ...state, options: { ...state.options, [event.key]: event.value } };

    case 'clearLog':
      return { ...state, log: [] };

    case 'clearGhosts':
      return state.ghosts.length ? { ...state, ghosts: [] } : state;

    case 'dispatch':
      return runAction(state, event.action, event.label, event.source);
  }
}

export interface ActionOutcome {
  ok: boolean;
  error?: string;
  root: NavState;
  mounted: Set<string>;
  focused: Set<string>;
  everFocused: Set<string>;
  verdicts: RouteVerdict[];
  rationale: string;
  versionNote?: string;
  handledBy: string | null;
  bubblePath: string[];
  hopTrace: HopStep[];
  nested: boolean;
}

/**
 * Applies an action and settles the tree. No logging, no UI bookkeeping.
 *
 * Both the real dispatch and the speculative previews behind the action chips
 * go through here, so a chip can never promise something the button would not
 * actually do.
 */
function computeAction(state: SessionState, action: NavAction, source?: string): ActionOutcome {
  const ctx = { options: state.options, idx: state.idx };
  const navKeysBefore = collectNavKeys(state.root);
  const isNavigate = action.type === 'NAVIGATE' || action.type === 'NAVIGATE_DEPRECATED';

  /**
   * navigate('A', { screen: 'B', params: { screen: 'C' } }) is not one action.
   * It is one NAVIGATE per level, each handled by a different navigator, and
   * each level after the first can only run once its parent has mounted the
   * child navigator. That is exactly why this form works when naming the leaf
   * screen directly does not.
   */
  const hops: NestedHop[] = isNavigate ? flattenPayload(action.payload.name, action.payload.params) : [];

  /**
   * The two options travel to opposite ends of a nested payload.
   *
   * `merge` is about the destination's params, so it belongs to the last hop.
   * `pop` asks whether to roll the stack back to a matching screen, and the
   * stack it means is the one that matches the name you called - the first
   * hop. Putting it on the last hop instead made
   * `navigate('StackA', { screen: 'Page1' }, { pop: true })` push a duplicate
   * StackA and then pop inside the fresh child, which is the opposite of what
   * the call asks for.
   */
  const hopAction = (hop: NestedHop, isFirst: boolean, isLast: boolean): NavAction => {
    if (action.type === 'NAVIGATE_DEPRECATED') {
      return { type: 'NAVIGATE_DEPRECATED', payload: { name: hop.name, params: hop.params, merge: isLast && action.payload.merge } };
    }
    if (action.type === 'NAVIGATE') {
      return {
        type: 'NAVIGATE',
        payload: {
          name: hop.name,
          params: hop.params,
          merge: isLast && action.payload.merge,
          ...(isFirst && action.payload.pop ? { pop: true } : {}),
        },
      };
    }
    return action;
  };

  const sequence: NavAction[] = hops.length
    ? hops.map((hop, i) => hopAction(hop, i === 0, i === hops.length - 1))
    : [action];
  const nested = hops.length > 1;

  let settled = {
    root: state.root,
    mounted: new Set(state.mounted),
    focused: new Set(state.focused),
    everFocused: new Set(state.everFocused),
  };

  const verdicts: RouteVerdict[] = [];
  const rationaleParts: string[] = [];
  const bubblePath: string[] = [];
  const hopTrace: HopStep[] = [];
  let versionNote: string | undefined;
  let handledBy: string | null = null;

  for (let i = 0; i < sequence.length; i++) {
    const result = dispatch(settled.root, sequence[i], ctx, settled.mounted, i === 0 ? source : undefined);

    if (result.error) {
      const where = nested ? ` (hop ${i + 1} of ${hops.length})` : '';
      return {
        ok: false,
        error: `${result.error}${where}`,
        root: state.root,
        mounted: settled.mounted,
        focused: settled.focused,
        everFocused: settled.everFocused,
        verdicts,
        rationale: rationaleParts.join(' '),
        handledBy,
        bubblePath: [...bubblePath, ...result.bubblePath],
        hopTrace,
        nested,
      };
    }

    let next = settle(result.state, state.idx, settled.everFocused);
    rationaleParts.push(nested ? `Hop ${i + 1}/${hops.length} — ${result.rationale}` : result.rationale);

    // `initial` only bites when THIS hop's navigator was created by this dispatch.
    const hop = hops[i];
    if (hop && i > 0 && result.handledBy && !navKeysBefore.has(result.handledBy)) {
      const path = navigatorPath(next.root, result.handledBy);
      const child = path?.[path.length - 1];

      if (child && hop.initial !== false) {
        const collapsed = collapseToFocused(child);
        if (collapsed !== child) {
          for (const dropped of child.routes.filter((r) => r.key !== collapsed.routes[0].key)) {
            verdicts.push({
              key: dropped.key,
              name: dropped.name,
              outcome: 'removed',
              reason:
                `Dropped because a nested payload defaults to initial: true. '${hop.name}' becomes the only route in ${child.key}, ` +
                'so there is nothing to go back to inside the child. Pass initial: false to keep the initialRouteName underneath.',
            });
          }
          next = settle(replaceNav(next.root, child.key, collapsed), state.idx, settled.everFocused);
          rationaleParts.push(
            `${child.key} was created by this dispatch and initial defaulted to true, so '${hop.name}' is its only route.`,
          );
        }
      } else if (child && hop.initial === false) {
        rationaleParts.push(
          `initial: false kept ${child.key}'s initialRouteName below '${hop.name}', so goBack() lands inside the child navigator.`,
        );
      }
    }

    settled = next;
    verdicts.push(...result.verdicts);
    bubblePath.push(...result.bubblePath);
    handledBy = result.handledBy;
    versionNote = versionNote ?? result.versionNote;

    if (nested) hopTrace.push({ name: hops[i].name, handledBy: result.handledBy });
  }

  if (nested) {
    versionNote =
      versionNote ??
      'Addressing a screen through its parents is the v7-sanctioned way into a nested navigator: it works before the child has mounted, and it type-checks.';
  }

  return {
    ok: true,
    root: settled.root,
    mounted: settled.mounted,
    focused: settled.focused,
    everFocused: settled.everFocused,
    verdicts,
    rationale: rationaleParts.join(' '),
    versionNote,
    handledBy,
    bubblePath,
    hopTrace,
    nested,
  };
}

/* ------------------------------------------------------------------ */
/* Lifecycle preview - what the action chips show                      */
/* ------------------------------------------------------------------ */

export type LifecycleKindSummary = 'mount' | 'unmount' | 'swap' | 'focus' | 'none' | 'blocked';

export interface LifecyclePreview {
  ok: boolean;
  error?: string;
  mounts: string[];
  unmounts: string[];
  focuses: string[];
  blurs: string[];
  /**
   * `mount`   - brings new components into the tree (useEffect setup runs)
   * `unmount` - destroys components and their local state
   * `swap`    - both at once (replace, or an unwind onto a fresh screen)
   * `focus`   - nothing mounts or unmounts; only useFocusEffect fires
   * `none`    - the state object changes without any hook firing
   * `blocked` - no navigator would handle it
   */
  kind: LifecycleKindSummary;
}

/**
 * Runs the action speculatively and reports which hooks it WOULD fire.
 * Route keys are snapshotted and restored, so predicting costs nothing.
 */
export function previewLifecycle(state: SessionState, action: NavAction, source?: string): LifecyclePreview {
  const mark = snapshotKeyCounter();
  try {
    const out = computeAction(state, action, source);
    if (!out.ok) {
      return { ok: false, error: out.error, mounts: [], unmounts: [], focuses: [], blurs: [], kind: 'blocked' };
    }

    const prevNames = allRoutes(state.root);
    const nextNames = allRoutes(out.root);
    const nameOf = (key: string) => nextNames.get(key)?.route.name ?? prevNames.get(key)?.route.name ?? key;

    const events = diffLifecycle(
      { mounted: new Set(state.mounted), focused: new Set(state.focused) },
      { mounted: out.mounted, focused: out.focused },
      nameOf,
    );

    const pick = (kind: string) => events.filter((e) => e.kind === kind).map((e) => e.routeName);
    const mounts = pick('mount');
    const unmounts = pick('unmount');
    const focuses = pick('focus');
    const blurs = pick('blur');

    const kind: LifecycleKindSummary =
      mounts.length && unmounts.length
        ? 'swap'
        : mounts.length
          ? 'mount'
          : unmounts.length
            ? 'unmount'
            : focuses.length || blurs.length
              ? 'focus'
              : 'none';

    return { ok: true, mounts, unmounts, focuses, blurs, kind };
  } finally {
    restoreKeyCounter(mark);
  }
}

/* ------------------------------------------------------------------ */

/** The type of the navigator with this key, for reading the journal back. */
function navTypeOf(state: NavState, key: string): NavState['type'] | undefined {
  if (state.key === key) return state.type;
  for (const route of state.routes) {
    if (!route.state) continue;
    const found = navTypeOf(route.state, key);
    if (found) return found;
  }
  return undefined;
}

function runAction(state: SessionState, action: NavAction, label?: string, source?: string): SessionState {
  const tick = state.tick + 1;
  const actionLabel = label ?? describeAction(action);
  const prevNames = allRoutes(state.root);
  const prev = { mounted: new Set(state.mounted), focused: new Set(state.focused) };

  const out = computeAction(state, action, source);

  const drafts: LogDraft[] = [{ level: 'action', text: actionLabel }];
  if (source) drafts.push({ level: 'info', text: `dispatched from ${source} — navigation.getParent() rather than the focused screen.` });

  if (!out.ok) {
    const message = out.error ?? 'The action could not be handled.';
    const after = appendLog({ ...state, tick }, [
      ...drafts,
      { level: 'error', text: message },
      ...(message.includes('was not handled by any navigator')
        ? [
            {
              level: 'warn' as const,
              text: 'Nothing is thrown here. This is the development-only message from onUnhandledAction - in a production build the action is dropped and the tap does nothing at all.',
            },
          ]
        : []),
    ]);
    return {
      ...state,
      tick,
      ...after,
      journey: [
        ...state.journey,
        {
          seq: state.journey.length + 1,
          code: actionLabel,
          actionType: action.type,
          popOption: action.type === 'NAVIGATE' && action.payload.pop === true,
          handledBy: null,
          handledByType: null,
          error: message,
          kind: 'none',
          rootDepth: state.root.routes.length,
          rootFocusName: state.root.routes[state.root.index]?.name ?? null,
        },
      ],
      verdicts: {},
      ghosts: [],
      last: {
        label: actionLabel,
        rationale: out.rationale,
        error: message,
        handledBy: out.handledBy,
        bubblePath: out.bubblePath,
        hops: out.hopTrace,
        source,
      },
    };
  }

  if (out.nested) {
    out.hopTrace.forEach((hop, i) => {
      drafts.push({
        level: 'info',
        text: `hop ${i + 1}/${out.hopTrace.length} navigate('${hop.name}') → handled by ${hop.handledBy ?? 'nobody'}`,
      });
    });
  }

  const root = state.options.version === 'v7' ? deepFreeze(out.root) : out.root;
  const nextNames = allRoutes(root);
  const nameOf = (key: string) => nextNames.get(key)?.route.name ?? prevNames.get(key)?.route.name ?? key;

  const events = diffLifecycle(prev, { mounted: out.mounted, focused: out.focused }, nameOf);

  for (const ev of events) {
    drafts.push({
      level: 'lifecycle',
      hook: ev.hook,
      kind: ev.kind,
      text:
        ev.kind === 'mount'
          ? `${ev.routeName} <${ev.routeKey}> mounted`
          : ev.kind === 'unmount'
            ? `${ev.routeName} <${ev.routeKey}> unmounted - component state destroyed`
            : ev.kind === 'focus'
              ? `${ev.routeName} <${ev.routeKey}> focused`
              : `${ev.routeName} <${ev.routeKey}> blurred - cleanup ran`,
    });
  }

  if (!events.length) {
    drafts.push({ level: 'info', text: 'No mount/focus transitions - the state object changed without any lifecycle effect firing.' });
  }
  if (out.versionNote) drafts.push({ level: 'warn', text: out.versionNote });

  const ghosts: Ghost[] = out.verdicts
    .filter((v) => v.outcome === 'removed')
    .map((v) => ({
      key: v.key,
      name: v.name,
      navKey: prevNames.get(v.key)?.nav.key ?? '',
      reason: v.reason,
      at: tick,
    }));

  const verdictMap: Record<string, RouteVerdict> = {};
  for (const v of out.verdicts) verdictMap[v.key] = v;

  const after = appendLog({ ...state, tick }, drafts);

  const rootFocus = root.routes[root.index];
  const added = out.verdicts.filter((v) => v.outcome === 'added');
  // A duplicate is only interesting when the copy it duplicates is still live:
  // pushing onto an empty slot is not the same mistake as pushing over yourself.
  const counts = new Map<string, number>();
  for (const [, entry] of nextNames) counts.set(entry.route.name, (counts.get(entry.route.name) ?? 0) + 1);
  const duplicated = added.find((v) => (counts.get(v.name) ?? 0) > 1)?.name;

  const entry: JourneyEntry = {
    seq: state.journey.length + 1,
    code: actionLabel,
    actionType: action.type,
    popOption: action.type === 'NAVIGATE' && action.payload.pop === true,
    handledBy: out.handledBy,
    handledByType: out.handledBy ? (navTypeOf(root, out.handledBy) ?? null) : null,
    kind: events.some((e) => e.kind === 'unmount')
      ? events.some((e) => e.kind === 'mount')
        ? 'swap'
        : 'unmount'
      : events.some((e) => e.kind === 'mount')
        ? 'mount'
        : events.length
          ? 'focus'
          : 'none',
    duplicated,
    rootDepth: root.routes.length,
    rootFocusName: rootFocus?.name ?? null,
  };

  return {
    ...state,
    tick,
    root,
    journey: [...state.journey, entry],
    mounted: [...out.mounted],
    focused: [...out.focused],
    everFocused: [...out.everFocused],
    verdicts: verdictMap,
    ghosts,
    last: {
      label: actionLabel,
      rationale: out.rationale,
      versionNote: out.versionNote,
      handledBy: out.handledBy,
      bubblePath: out.bubblePath,
      hops: out.hopTrace,
      source,
    },
    ...after,
  };
}


/* ------------------------------------------------------------------ */
/* Derived helpers for the UI                                          */
/* ------------------------------------------------------------------ */

export function canGoBack(state: SessionState): boolean {
  const result = dispatch(state.root, { type: 'GO_BACK' }, { options: state.options, idx: state.idx }, new Set(state.mounted));
  return result.handledBy !== null && !result.error;
}
