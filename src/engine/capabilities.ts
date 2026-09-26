import type { NavAction, NavState } from './types';

/**
 * Which methods this screen's `navigation` object actually has.
 *
 * The docs split them three ways. Every navigator provides the core set -
 * "navigate", "goBack", "reset", "setParams", "dispatch". Then: "If the
 * navigator is a stack navigator, several alternatives to navigate and goBack
 * are provided" (push, pop, popTo, popToTop, replace); "If the navigator is a
 * tab navigator, the following are also available" (jumpTo); and a drawer adds
 * jumpTo plus openDrawer / closeDrawer / toggleDrawer.
 *
 * Crucially it is not only the navigator you are directly inside. From the
 * nesting guide: "Navigator specific methods are available in the navigators
 * nested inside... the screens in the tab navigator will get the `push` and
 * `replace` methods for stack in their `navigation` object." So a method is
 * present when ANY navigator from the focused one up to the root provides it -
 * the same chain the action would bubble along.
 *
 * This is a question about the SHAPE of the navigation object, not about what
 * would happen if you called it. `pop()` is still a method when the stack is at
 * index 0; it just would not do anything. That second question is answered by
 * the lifecycle preview on each button, and keeping the two apart is the point:
 * "you cannot call this here" and "this would be a no-op right now" are
 * different lessons.
 */

/** Verified against the routers in routers.ts, which is the only authority here. */
export const HANDLED_BY: Record<NavAction['type'], NavState['type'][]> = {
  // Core - every router has a case for these.
  NAVIGATE: ['stack', 'tab', 'drawer'],
  NAVIGATE_DEPRECATED: ['stack', 'tab', 'drawer'],
  GO_BACK: ['stack', 'tab', 'drawer'],
  RESET: ['stack', 'tab', 'drawer'],
  SET_PARAMS: ['stack', 'tab', 'drawer'],
  REPLACE_PARAMS: ['stack', 'tab', 'drawer'],

  // Stack only. The tab router has explicit cases for these that return null
  // with a rationale, so they bubble past a tab to the nearest ancestor stack.
  PUSH: ['stack'],
  POP: ['stack'],
  POP_TO: ['stack'],
  POP_TO_TOP: ['stack'],
  REPLACE: ['stack'],

  // A drawer is a tab router underneath, so it answers jumpTo too.
  JUMP_TO: ['tab', 'drawer'],

  OPEN_DRAWER: ['drawer'],
  CLOSE_DRAWER: ['drawer'],
  TOGGLE_DRAWER: ['drawer'],
};

export const ACTION_LABEL: Record<NavAction['type'], string> = {
  NAVIGATE: 'navigate',
  NAVIGATE_DEPRECATED: 'navigateDeprecated',
  GO_BACK: 'goBack',
  RESET: 'reset',
  SET_PARAMS: 'setParams',
  REPLACE_PARAMS: 'replaceParams',
  PUSH: 'push',
  POP: 'pop',
  POP_TO: 'popTo',
  POP_TO_TOP: 'popToTop',
  REPLACE: 'replace',
  JUMP_TO: 'jumpTo',
  OPEN_DRAWER: 'openDrawer',
  CLOSE_DRAWER: 'closeDrawer',
  TOGGLE_DRAWER: 'toggleDrawer',
};

export interface Capability {
  /** The method is on this navigation object at all. */
  ok: boolean;
  /** Nearest navigator on the chain that provides it. */
  from: string | null;
  /** How far up that navigator is; 0 is the one owning the focused screen. */
  levelsUp: number;
  reason: string;
}

const article = (t: NavState['type']) => `a ${t}`;

const listTypes = (types: NavState['type'][]) => types.map(article).join(' or ');

/**
 * @param chain Navigators from the root down to the one dispatching, exactly as
 *   `focusedNavigators` / `navigatorPath` return them.
 */
export function capabilities(chain: NavState[]): Record<NavAction['type'], Capability> {
  const leafFirst = [...chain].reverse();
  const out = {} as Record<NavAction['type'], Capability>;

  for (const type of Object.keys(HANDLED_BY) as NavAction['type'][]) {
    const types = HANDLED_BY[type];
    const at = leafFirst.findIndex((nav) => types.includes(nav.type));
    const provider = at === -1 ? null : leafFirst[at];
    const core = types.length === 3;

    out[type] = {
      ok: at !== -1,
      from: provider?.key ?? null,
      levelsUp: at,
      reason: provider
        ? core
          ? `Every navigator provides ${ACTION_LABEL[type]}, so it comes straight from ${provider.key}.`
          : at === 0
            ? `${provider.key} is ${article(provider.type)} navigator, so ${ACTION_LABEL[type]} is on this screen's own navigation object.`
            : `Inherited from ${provider.key}, ${at} level${at === 1 ? '' : 's'} up: navigator-specific methods are available in the ` +
              'navigators nested inside it, so a screen down here gets them too.'
        : `${ACTION_LABEL[type]} needs ${listTypes(types)} navigator, and there is none between the focused screen and the root. ` +
          'The method is simply not on this navigation object.',
    };
  }

  return out;
}

/** The navigator types present on the chain, leaf first, without duplicates. */
export function chainTypes(chain: NavState[]): NavState['type'][] {
  return [...new Set([...chain].reverse().map((nav) => nav.type))];
}
