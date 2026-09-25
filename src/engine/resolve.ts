import type { NavAction, NavState, Params } from './types';
import { restoreKeyCounter, snapshotKeyCounter } from './blueprint';
import { dispatch, focusedNavigators, navigatorPath } from './NavigatorEngine';
import { describeAction, type SessionState } from './session';
import { buildPayload, collectNavKeys, junctionOf, pathToScreen, trimToReachable, type NestedHop } from './nested';

/**
 * "Would this action be handled from here?"
 *
 * The rule, from the docs: the name passed to navigate must be a screen "in the
 * current or a parent navigator", and actions "first go to the current
 * navigator. If it can't handle them, they bubble up to the parent."
 *
 * But each action bubbles by its OWN rules. A tab router has no handler for
 * push/popTo/replace at all, so those travel straight past it to the nearest
 * ancestor stack. jumpTo is the mirror image. openDrawer needs a drawer
 * somewhere above you.
 *
 * Rather than restate those rules here and let them drift, every prediction is
 * a speculative run of the real routers via `dispatch`, which is pure. The
 * panel can therefore never disagree with what actually happens on click.
 */

/* ------------------------------------------------------------------ */
/* The actions that can be previewed                                   */
/* ------------------------------------------------------------------ */

export interface PreviewActionSpec {
  id: string;
  label: string;
  /** Targets the selected screen by name. */
  needsName: boolean;
  /** Only `navigate` resolves a `{ screen }` payload into a child navigator. */
  supportsNested?: boolean;
  v7Only?: boolean;
  build: (name: string, params?: Params) => NavAction;
}

export const PREVIEW_ACTIONS: PreviewActionSpec[] = [
  {
    id: 'navigate',
    label: 'navigate',
    needsName: true,
    supportsNested: true,
    build: (name, params) => ({ type: 'NAVIGATE', payload: { name, params } }),
  },
  { id: 'push', label: 'push', needsName: true, build: (name, params) => ({ type: 'PUSH', payload: { name, params } }) },
  {
    id: 'popTo',
    label: 'popTo',
    needsName: true,
    v7Only: true,
    build: (name, params) => ({ type: 'POP_TO', payload: { name, params } }),
  },
  { id: 'replace', label: 'replace', needsName: true, build: (name, params) => ({ type: 'REPLACE', payload: { name, params } }) },
  { id: 'jumpTo', label: 'jumpTo', needsName: true, build: (name, params) => ({ type: 'JUMP_TO', payload: { name, params } }) },
  { id: 'pop', label: 'pop(1)', needsName: false, build: () => ({ type: 'POP', payload: { count: 1 } }) },
  { id: 'popToTop', label: 'popToTop', needsName: false, build: () => ({ type: 'POP_TO_TOP' }) },
  { id: 'goBack', label: 'goBack', needsName: false, build: () => ({ type: 'GO_BACK' }) },
  { id: 'openDrawer', label: 'openDrawer', needsName: false, build: () => ({ type: 'OPEN_DRAWER' }) },
];

export const getPreviewAction = (id: string) => PREVIEW_ACTIONS.find((a) => a.id === id) ?? PREVIEW_ACTIONS[0];

/** Which navigator types have a handler for this action at all. */
const ACCEPTED_BY: Record<string, NavState['type'][]> = {
  navigate: ['stack', 'tab', 'drawer'],
  push: ['stack'],
  popTo: ['stack'],
  replace: ['stack'],
  pop: ['stack'],
  popToTop: ['stack'],
  jumpTo: ['tab', 'drawer'],
  goBack: ['stack', 'tab', 'drawer'],
  openDrawer: ['drawer'],
};

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type StepStatus = 'handled' | 'declined' | 'unreached';

export interface BubbleStep {
  navKey: string;
  type: NavState['type'];
  focusedRouteName: string;
  status: StepStatus;
  /** Why this router declined, in the terms the router itself uses. */
  note: string;
  levelsUp: number;
}

export type Relation = 'below' | 'sibling';

export type CallStatus = 'use' | 'avoid' | 'redundant';

export interface CallShapeInfo {
  code: string;
  action: NavAction;
  status: CallStatus;
  reason: string;
  handledBy: string | null;
  hops: number;
}

export interface Resolution {
  spec: PreviewActionSpec;
  trace: BubbleStep[];
  handledBy: string | null;
  error?: string;
  headline: string;
  explanation: string;
  bare: CallShapeInfo;
  nested: CallShapeInfo | null;
  path: NestedHop[];
  relation: Relation | null;
  junction: string | null;
  ownerNavKey: string | null;
  ownerMounted: boolean;
  recommendation: 'bare' | 'nested' | 'none';
  /** Navigator the action is dispatched from, when not the focused one. */
  sourceNav: string | null;
  /** False when the chosen source navigator is not mounted, so it was ignored. */
  sourceResolved: boolean;
}

/* ------------------------------------------------------------------ */
/* Speculative dispatch                                                */
/* ------------------------------------------------------------------ */

function dryRun(session: SessionState, action: NavAction, sourceNav?: string) {
  const mark = snapshotKeyCounter();
  try {
    return dispatch(
      session.root,
      action,
      { options: session.options, idx: session.idx },
      new Set(session.mounted),
      sourceNav,
    );
  } finally {
    restoreKeyCounter(mark);
  }
}

/**
 * `navigation.getParent('id').navigate(...)`. Note that the real getParent
 * takes a navigator `id` you set yourself via the id prop; this simulator keys
 * navigators by a readable generated key instead.
 */
const withSource = (code: string, sourceNav?: string) =>
  sourceNav ? code.replace(/^navigation\./, `navigation.getParent('${sourceNav}').`) : code;

/* ------------------------------------------------------------------ */

export function resolveTarget(
  session: SessionState,
  targetName: string,
  ownerNavKey: string | null,
  previewId: string,
  params?: Params,
  sourceNav?: string,
): Resolution {
  const spec = getPreviewAction(previewId);

  /**
   * An action starts at the navigator it was dispatched from. Normally that is
   * the one owning the focused screen, but `getParent()` lets a screen address
   * an ancestor directly - and then bubbling starts from THERE.
   */
  const sourcePath = sourceNav ? navigatorPath(session.root, sourceNav) : null;
  const sourceResolved = sourceNav ? sourcePath !== null : true;
  const chain = sourcePath ?? focusedNavigators(session.root);
  const leafFirst = [...chain].reverse();
  const startNav = leafFirst[0]?.key ?? 'the focused navigator';
  const effectiveSource = sourceResolved ? sourceNav : undefined;

  const bareAction = spec.build(targetName, params);
  const result = dryRun(session, bareAction, effectiveSource);

  const trace: BubbleStep[] = leafFirst.map((nav, i) => {
    const visited = result.bubblePath.includes(nav.key);
    const handled = nav.key === result.handledBy;
    return {
      navKey: nav.key,
      type: nav.type,
      focusedRouteName: nav.routes[nav.index]?.name ?? '?',
      status: handled ? 'handled' : visited ? 'declined' : 'unreached',
      note: handled ? 'handles it' : visited ? declineNote(nav, spec, targetName) : 'never reached',
      levelsUp: i,
    };
  });

  /* ---- the nested alternative, where the action supports one ---- */

  const chainKeys = new Set(chain.map((nav) => nav.key));
  const full = ownerNavKey ? pathToScreen(session.idx, ownerNavKey, targetName) : [{ name: targetName, navKey: '' }];
  const path = trimToReachable(full, chainKeys);
  const junction = junctionOf(full, chainKeys);
  const ownerMounted = ownerNavKey ? collectNavKeys(session.root).has(ownerNavKey) : false;

  let nested: CallShapeInfo | null = null;
  if (spec.supportsNested && path.length > 1) {
    const hops = path.map((hop, i) => (i === path.length - 1 ? { ...hop, params } : hop));
    const nestedAction: NavAction = { type: 'NAVIGATE', payload: buildPayload(hops) };
    // Only the first hop has to be reachable; each navigator hands the rest down.
    const firstHop = dryRun(session, { type: 'NAVIGATE', payload: { name: path[0].name } }, effectiveSource);
    nested = {
      code: withSource(describeAction(nestedAction), effectiveSource),
      action: nestedAction,
      handledBy: firstHop.handledBy,
      hops: path.length,
      status: 'redundant',
      reason: '',
    };
  }

  const bareOk = result.handledBy !== null && !result.error;

  /**
   * Why it failed, which is not always geography. If some navigator on the way
   * up DOES declare the screen, the target is perfectly reachable - just not
   * with this action, because that navigator's router has no handler for it.
   */
  const declaredOnChain = spec.needsName ? leafFirst.find((nav) => nav.routeNames.includes(targetName)) : undefined;
  const failure: FailureKind = bareOk
    ? null
    : result.error && !result.error.includes('not handled by any navigator')
      ? 'rejected'
      : !spec.needsName
        ? 'nameless'
        : declaredOnChain
          ? 'action-type'
          : junction === startNav
            ? 'below'
            : 'sibling';
  const nestedOk = nested?.handledBy != null;

  const bare: CallShapeInfo = {
    code: withSource(describeAction(bareAction), effectiveSource),
    action: bareAction,
    handledBy: result.handledBy,
    hops: 1,
    status: bareOk ? 'use' : 'avoid',
    reason: bareOk
      ? `${result.handledBy} handles ${spec.label.replace('(1)', '')} for this screen, so the plain call is all you need.`
      : nested
        ? `No navigator from here up to the root handles this. Dispatch it anyway to see the dev-only error in the console.`
        : `No navigator from here up to the root handles this. ${noHandlerHint(spec, chain)}`,
  };

  if (nested) {
    nested.status = bareOk ? 'redundant' : nestedOk ? 'use' : 'avoid';
    nested.reason = bareOk
      ? 'Valid, but unnecessary here. Bubbling already reaches this screen, so the extra nesting just hides what the call actually does.'
      : nestedOk
        ? `Use this. '${path[0].name}' IS reachable by bubbling — ${nested.handledBy} takes it — and each navigator then hands the rest of the payload down to its own child.`
        : 'Even the first hop has no handler from here.';
  }

  const relation: Relation | null = failure === 'below' || failure === 'sibling' ? failure : null;

  const geo: Geography = {
    targetName,
    startNav,
    ownerNavKey,
    ownerMounted,
    junction,
    relation,
    chain,
    failure,
    declaredOn: declaredOnChain?.key ?? null,
    declaredOnType: declaredOnChain?.type ?? null,
  };

  return {
    spec,
    trace,
    handledBy: result.handledBy,
    error: result.error,
    headline: headlineFor(spec, result, trace, geo),
    explanation:
      (sourceNav && sourceResolved
        ? `Dispatched from ${sourceNav} rather than the focused screen, so bubbling starts there. `
        : sourceNav
          ? `${sourceNav} is not mounted right now, so there is no navigation object to call getParent on and the action falls back to the focused screen. `
          : '') + explanationFor(session, spec, result, trace, geo),
    bare,
    nested,
    path,
    relation,
    junction,
    ownerNavKey,
    ownerMounted,
    recommendation: bareOk ? 'bare' : nestedOk ? 'nested' : 'none',
    sourceNav: sourceNav ?? null,
    sourceResolved,
  };
}

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

function declineNote(nav: NavState, spec: PreviewActionSpec, targetName: string) {
  const accepted = ACCEPTED_BY[spec.id] ?? ['stack', 'tab', 'drawer'];
  if (!accepted.includes(nav.type)) return `a ${nav.type} router has no handler for ${spec.label}`;
  if (spec.needsName && !nav.routeNames.includes(targetName)) return `routeNames has no '${targetName}'`;
  return 'nothing it could do in its current state';
}

export type FailureKind = 'rejected' | 'action-type' | 'below' | 'sibling' | 'nameless' | null;

function headlineFor(spec: PreviewActionSpec, result: ReturnType<typeof dryRun>, trace: BubbleStep[], geo: Geography) {
  if (result.handledBy && !result.error) {
    const step = trace.find((s) => s.navKey === result.handledBy);
    if (!step || step.levelsUp === 0) return 'Handled right here';
    return `Handled ${step.levelsUp} level${step.levelsUp === 1 ? '' : 's'} up`;
  }

  switch (geo.failure) {
    case 'rejected':
      return `${spec.label} is rejected here`;
    case 'action-type':
      return `Reachable — but not with ${spec.label}`;
    case 'below':
      return 'Nothing would handle this — the target is below you';
    case 'sibling':
      return 'Nothing would handle this — the target is in a sibling branch';
    default:
      return 'Nothing would handle this';
  }
}

interface Geography {
  targetName: string;
  startNav: string;
  ownerNavKey: string | null;
  ownerMounted: boolean;
  junction: string | null;
  relation: Relation | null;
  chain: NavState[];
  failure: FailureKind;
  /** Navigator on the focus chain that declares the target, if any. */
  declaredOn: string | null;
  declaredOnType: NavState['type'] | null;
}

function explanationFor(
  session: SessionState,
  spec: PreviewActionSpec,
  result: ReturnType<typeof dryRun>,
  trace: BubbleStep[],
  geo: Geography,
): string {
  const { targetName, startNav, ownerNavKey, ownerMounted, junction, relation } = geo;

  // A router took the action but refused it outright (e.g. popTo on v6).
  if (result.error && !result.error.includes('not handled by any navigator')) return result.error;

  if (result.handledBy) {
    const step = trace.find((s) => s.navKey === result.handledBy);
    const declined = trace.filter((s) => s.status === 'declined');

    if (!step || step.levelsUp === 0) {
      return (
        `${startNav} owns the focused screen and its router handles ${spec.label}` +
        (spec.needsName ? ` for '${targetName}'` : '') +
        '. The action is taken straight away, so nothing bubbles anywhere.'
      );
    }

    return (
      declined
        .map((s) => `${s.navKey} declined it (${s.note})`)
        .join(', then ') +
      `, so the action climbed to ${result.handledBy}, which takes it. ` +
      (spec.needsName
        ? 'Bubbling already does the work, so a plain call is the right one here.'
        : 'This is the whole point of bubbling: the nearest navigator that knows what to do with the action gets it.')
    );
  }

  // Unhandled. For actions that name a screen, explain where the screen lives.
  const tail =
    'Nothing is thrown: React Navigation logs a development-only error, and in a production build the tap just does nothing at all.';

  if (geo.failure === 'nameless') {
    return (
      `No navigator between ${startNav} and the root has a handler for ${spec.label}. ` +
      `${noHandlerHint(spec, geo.chain)} ${tail}`
    );
  }

  /**
   * The screen IS reachable by bubbling - some navigator on the way up declares
   * it. The action is simply not in that navigator's vocabulary.
   */
  if (geo.failure === 'action-type') {
    const accepted = ACCEPTED_BY[spec.id] ?? [];
    return (
      `This is not about where '${targetName}' lives - ${geo.declaredOn} declares it, and the action does reach that navigator. ` +
      `But ${geo.declaredOn} is a ${geo.declaredOnType} navigator and ${spec.label} is only handled by a ${accepted.join(' or ')} ` +
      `navigator, so its router returns null like everyone else and the action carries on past the one place that knew the screen. ` +
      `${tail} navigate is the one action every navigator type handles, so ` +
      `navigate('${targetName}') would be taken by ${geo.declaredOn} instead.`
    );
  }

  const owner = ownerNavKey ?? 'another navigator';

  const geographySentence =
    relation === 'below'
      ? `'${targetName}' belongs to ${owner}, which hangs off a route of ${startNav} - the navigator you are in. It is directly BELOW you.`
      : `'${targetName}' belongs to ${owner}. From ${startNav} that navigator is neither above you nor below you: it hangs off a ` +
        `different route of ${junction ?? 'a shared parent'}, the nearest navigator the two branches have in common. It is SIDEWAYS.`;

  const why =
    relation === 'below'
      ? 'Actions only ever travel upward, so this one walks away from the very navigator that could handle it and stops at the root.'
      : `Actions only ever travel upward, so this one can climb as far as ${junction ?? 'the root'} - but it has no way to turn around ` +
        `and descend into ${owner}. Bubbling gets you to the fork; it cannot take the other prong.`;

  const fix = spec.supportsNested
    ? relation === 'below'
      ? `Name the route that renders it, and ${startNav} will hand the rest of the payload down to its child.`
      : `Name the route on ${junction ?? 'the shared parent'} that leads into the other branch. That first hop IS reachable by ` +
        'bubbling, and each navigator then hands the remainder of the payload down to its own child.'
    : `A ${spec.label} payload is not forwarded into child navigators - only navigate resolves a { screen } payload. ` +
      'Switch the action above to navigate, or move focus into that navigator first.';

  const v6Note =
    session.version === 'v6' && session.options.navigationInChildEnabled && spec.id === 'navigate'
      ? ownerMounted
        ? ` On v6 this bare call can still work: the action is offered DOWN into ${owner} because it happens to be mounted right now. ` +
          'Navigate somewhere that unmounts it and the same line silently stops working - which is why v7 removed the behaviour.'
        : ` On v6 the bare call would be offered DOWN into child navigators too, but ${owner} is not mounted at the moment, so there is ` +
          'nothing to offer it to. That dependency on render state is exactly what v7 removed.'
      : '';

  return `${geographySentence} ${why} ${tail} ${fix}${v6Note}`;
}

function noHandlerHint(spec: PreviewActionSpec, chain: NavState[]) {
  const accepted = ACCEPTED_BY[spec.id] ?? [];
  const kinds = chain.map((n) => n.type);

  if (accepted.length && !accepted.some((t) => kinds.includes(t))) {
    return `${spec.label} is only handled by a ${accepted.join(' or ')} navigator, and there is not one between the focused screen and the root.`;
  }
  if (spec.id === 'pop' || spec.id === 'goBack') {
    return 'Every stack on the way up is already at index 0, and no tab or drawer above them had anywhere to go back to either.';
  }
  return 'The routers that could normally take it had nothing to do in their current state.';
}
