import type { NavState } from './types';
import type { JourneyEntry, SessionState } from './session';

/**
 * Reads the session back and names the habits in it.
 *
 * Every rule here describes something the engine actually did, not something
 * the app guesses at, and every one of them names the call that fixes it. They
 * exist because the same few mistakes account for nearly all of the "why do I
 * have two of these?" confusion: v7's `navigate` pushes unless the target is
 * already focused, and a stack's `routes` array is a history, so using one to
 * switch between peers grows it forever.
 */

export type Severity = 'warn' | 'info' | 'good';

export interface Habit {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** The concrete call or structural change that resolves it. */
  fix?: string;
  /** Which dispatches triggered it, so the journal can point at them. */
  seqs: number[];
}

/** Every live route name in the tree, with how many instances of it exist. */
function liveCounts(state: NavState, out: Map<string, number> = new Map()): Map<string, number> {
  for (const route of state.routes) {
    out.set(route.name, (out.get(route.name) ?? 0) + 1);
    if (route.state) liveCounts(route.state, out);
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function readHabits(session: SessionState): Habit[] {
  const journey = session.journey;
  const habits: Habit[] = [];
  if (!journey.length) return habits;

  /* ---- duplicated a branch you already had ---- */
  const dupes = journey.filter((e) => e.duplicated);
  if (dupes.length) {
    const names = [...new Set(dupes.map((e) => e.duplicated!))];
    habits.push({
      id: 'duplicate-branch',
      severity: 'warn',
      title: `You created a second ${names.length > 1 ? 'copy of several screens' : `${names[0]}`}`,
      detail:
        `${plural(dupes.length, 'dispatch', 'dispatches')} landed on a screen that was already in the stack, and pushed a fresh one ` +
        `instead of returning to it (${names.join(', ')}). In v7 navigate() only stays put when the target is already FOCUSED — ` +
        'otherwise it pushes. The copy you left behind is still mounted, holding the state you expected to come back to.',
      fix: "To return to the one you had: popTo('Name'), or navigate('Name', params, { pop: true }).",
      seqs: dupes.map((e) => e.seq),
    });
  }

  /* ---- a stack used to switch between peers ---- */
  const rootNames = journey.map((e) => e.rootFocusName).filter(Boolean) as string[];
  const distinctRoot = new Set(rootNames);
  const grew = journey.filter((e, i) => i > 0 && e.rootDepth > journey[i - 1].rootDepth);
  if (session.root.type === 'stack' && distinctRoot.size >= 2 && grew.length >= 3 && session.root.routes.length >= 3) {
    habits.push({
      id: 'peers-as-history',
      severity: 'warn',
      title: 'Your root stack is being used to switch between sections',
      detail:
        `The root stack has grown to ${plural(session.root.routes.length, 'route')} while you moved between ` +
        `${plural(distinctRoot.size, 'section')} (${[...distinctRoot].join(', ')}). A stack's routes array IS its history: ` +
        'everything in it is something you pushed on the way here. Switching between peers by pushing means it never stops growing.',
      fix:
        'If these are sections you switch between, they belong in a tab or drawer navigator — those move an index instead of ' +
        'appending, mount each branch once and never unmount it, so switching back lands exactly where you left. Keep the root ' +
        'stack for things that sit ON TOP of everything: a confirmation, a PIN prompt, onboarding.',
      seqs: grew.map((e) => e.seq),
    });
  }

  /* ---- actions that went nowhere ---- */
  const unhandled = journey.filter((e) => e.error);
  if (unhandled.length) {
    habits.push({
      id: 'unhandled',
      severity: 'warn',
      title: `${plural(unhandled.length, 'action')} went unhandled`,
      detail:
        'No navigator between the focused screen and the root declared that name, so every router returned null and the action ' +
        'fell off the top. Nothing throws: in development you get the onUnhandledAction message, in production the tap does nothing.',
      fix:
        "Name the route that leads into the other branch and let each navigator hand the rest down: " +
        "navigate('Parent', { screen: 'Target' }). Bubbling only ever travels upward, never sideways into a sibling.",
      seqs: unhandled.map((e) => e.seq),
    });
  }

  /* ---- navigate() used where push() was meant ---- */
  const noops = journey.filter((e) => e.kind === 'none' && e.actionType === 'NAVIGATE');
  if (noops.length >= 2) {
    habits.push({
      id: 'navigate-noop',
      severity: 'info',
      title: `${plural(noops.length, 'navigate() call')} changed nothing`,
      detail:
        'The target was already the focused screen, so navigate() did nothing beyond updating params. That is correct — ' +
        '"go to this screen" when you are already there is a no-op in both versions.',
      fix:
        'If you wanted a second copy with different data — the same screen for a different account — that is push(). ' +
        'If you only wanted new data on the one you are on, that is setParams().',
      seqs: noops.map((e) => e.seq),
    });
  }

  /* ---- the same screen stacked several times over ---- */
  const counts = liveCounts(session.root);
  const piles = [...counts.entries()].filter(([, n]) => n >= 3);
  if (piles.length) {
    habits.push({
      id: 'pile-up',
      severity: 'info',
      title: `${piles.map(([name, n]) => `${n}× ${name}`).join(', ')} alive at once`,
      detail:
        'Each one is a separate component instance with its own key, its own params and its own local state. That is legitimate — ' +
        'it is how a drill-down works — but every one of them is mounted and holding memory.',
      fix: 'popToTop() when a flow finishes, so the next entry into it starts clean.',
      seqs: [],
    });
  }

  /* ---- things done right, worth confirming ---- */
  const unwinds = journey.filter(
    (e) => e.actionType === 'POP_TO' || e.actionType === 'POP_TO_TOP' || e.actionType === 'POP' || e.popOption,
  );
  if (unwinds.length) {
    habits.push({
      id: 'unwound',
      severity: 'good',
      title: `${plural(unwinds.length, 'call')} rolled the stack back instead of growing it`,
      detail:
        'popTo / popToTop / pop / { pop: true } reuse the instance that is already there: same key, same array position, ' +
        'nested state intact. Everything above it is unmounted and destroyed.',
      seqs: unwinds.map((e) => e.seq),
    });
  }

  const tabSwitches = journey.filter((e) => e.handledByType === 'tab' || e.handledByType === 'drawer');
  if (tabSwitches.length >= 2) {
    habits.push({
      id: 'tab-switching',
      severity: 'good',
      title: `${plural(tabSwitches.length, 'switch', 'switches')} handled by a tab or drawer`,
      detail:
        'These moved the navigator index without touching the routes array, so nothing was pushed and nothing was destroyed. ' +
        'This is the shape that does not grow — the branch you left is still mounted, exactly where you left it.',
      seqs: tabSwitches.map((e) => e.seq),
    });
  }

  const resets = journey.filter((e) => e.actionType === 'RESET');
  if (resets.length) {
    habits.push({
      id: 'reset',
      severity: 'info',
      title: `${plural(resets.length, 'reset')} replaced the whole state`,
      detail:
        'reset() writes a state object you supplied, so the history that was there is gone and back has nowhere to go. ' +
        'That is the point of it after login or a completed flow, but it is not a way to navigate.',
      seqs: resets.map((e) => e.seq),
    });
  }

  const order: Record<Severity, number> = { warn: 0, info: 1, good: 2 };
  return habits.sort((a, b) => order[a.severity] - order[b.severity]);
}

export type { JourneyEntry };
