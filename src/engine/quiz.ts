import type { NavAction, NavState, RNVersion } from './types';
import { navIdFromKey, type NavigatorBlueprint, type Preset } from './blueprint';
import { asPreset } from './layouts';
import type { SessionState } from './session';

/**
 * Interactive drills for the two calls that account for nearly all of the
 * "why do I have two of these?" confusion: `navigate` and `popTo`.
 *
 * The guided scenarios next door DEMONSTRATE - they dispatch for you while you
 * watch. These invert that: the app sets the stage, states what the product
 * needs, and you make the call with the real command center.
 *
 * The grading rule that matters: a beat is graded on the STATE you produced,
 * never on the call you typed. popTo('X') and navigate('X', { pop: true }) are
 * both right in some states and both wrong in others, so matching call shapes
 * would teach recitation. Landing on the right screen is also not enough on its
 * own - `reset` can do that while destroying everything - so the assertions can
 * demand that a specific instance SURVIVED, by key.
 */

/* ------------------------------------------------------------------ */
/* Assertions                                                          */
/* ------------------------------------------------------------------ */

export type Assert =
  /** The focused screen, by route name. */
  | { kind: 'focus'; name: string }
  /** routes.length of a navigator, addressed by its stable id (e.g. stack-root). */
  | { kind: 'depth'; nav: string; is: number }
  /** No navigator holds the same route name twice. */
  | { kind: 'noDuplicates' }
  /**
   * The instance of this screen that existed when the beat began is still
   * alive, by key. This is the assertion the whole exercise turns on: it is the
   * difference between returning to the user's half-filled form and building a
   * new one that merely looks the same.
   */
  | { kind: 'preserved'; name: string }
  /** Every instance that existed when the beat began is gone. */
  | { kind: 'destroyed'; name: string };

/** Keys captured when a beat starts, so `preserved` can mean something. */
export type Watch = Map<string, string[]>;

function walk(state: NavState, visit: (nav: NavState) => void) {
  visit(state);
  for (const route of state.routes) if (route.state) walk(route.state, visit);
}

export function watchKeys(root: NavState): Watch {
  const out: Watch = new Map();
  walk(root, (nav) => {
    for (const route of nav.routes) {
      const list = out.get(route.name) ?? [];
      list.push(route.key);
      out.set(route.name, list);
    }
  });
  return out;
}

const liveKeys = (root: NavState) => {
  const out = new Set<string>();
  walk(root, (nav) => nav.routes.forEach((r) => out.add(r.key)));
  return out;
};

const focusedName = (state: NavState): string => {
  const route = state.routes[state.index];
  return route?.state ? focusedName(route.state) : (route?.name ?? '');
};

const findNav = (root: NavState, navId: string): NavState | null => {
  let found: NavState | null = null;
  walk(root, (nav) => {
    if (!found && navIdFromKey(nav.key) === navId) found = nav;
  });
  return found;
};

export interface Grade {
  ok: boolean;
  /** One line per assertion, phrased as what it checked and what happened. */
  checks: { ok: boolean; label: string; detail: string }[];
}

export function grade(root: NavState, watch: Watch, asserts: Assert[]): Grade {
  const live = liveKeys(root);
  const checks = asserts.map((a): { ok: boolean; label: string; detail: string } => {
    switch (a.kind) {
      case 'focus': {
        const actual = focusedName(root);
        return {
          ok: actual === a.name,
          label: `focused on ${a.name}`,
          detail: actual === a.name ? `You are on ${actual}.` : `You are on ${actual || 'nothing'}, not ${a.name}.`,
        };
      }
      case 'depth': {
        const nav = findNav(root, a.nav);
        const n = nav?.routes.length ?? -1;
        return {
          ok: n === a.is,
          label: `${a.nav} holds ${a.is} route${a.is === 1 ? '' : 's'}`,
          detail:
            n === -1
              ? `${a.nav} is not mounted.`
              : n === a.is
                ? `It holds ${n}.`
                : n > a.is
                  ? `It holds ${n} - ${n - a.is} more than it should. Something was pushed that did not need to be.`
                  : `It holds ${n} - ${a.is - n} fewer than it should. Something was destroyed that you needed.`,
        };
      }
      case 'noDuplicates': {
        const dupes: string[] = [];
        walk(root, (nav) => {
          const seen = new Set<string>();
          for (const route of nav.routes) {
            if (seen.has(route.name)) dupes.push(`${route.name} in ${nav.key}`);
            seen.add(route.name);
          }
        });
        return {
          ok: dupes.length === 0,
          label: 'no screen appears twice in one navigator',
          detail: dupes.length ? `Two copies of ${dupes.join(', ')}.` : 'Every navigator holds each screen at most once.',
        };
      }
      case 'preserved': {
        const was = watch.get(a.name) ?? [];
        const kept = was.filter((key) => live.has(key));
        return {
          ok: was.length > 0 && kept.length === was.length,
          label: `the original ${a.name} survived`,
          detail: !was.length
            ? `There was no ${a.name} when this step began.`
            : kept.length === was.length
              ? `Same instance, key ${kept.join(', ')} - its component state is intact.`
              : `${a.name} is gone (was ${was.join(', ')}). Whatever is on screen now is a NEW instance with fresh state.`,
        };
      }
      case 'destroyed': {
        const was = watch.get(a.name) ?? [];
        const kept = was.filter((key) => live.has(key));
        return {
          ok: kept.length === 0,
          label: `${a.name} was torn down`,
          detail: kept.length ? `${a.name} is still mounted (${kept.join(', ')}).` : `${a.name} is unmounted and its state is gone.`,
        };
      }
    }
  });

  return { ok: checks.every((c) => c.ok), checks };
}

/**
 * Structural fingerprint: names and indices, no keys.
 *
 * Used to ask "did you end up where the model answer ends up?" without
 * demanding you typed the same call. Keys are deliberately excluded because the
 * two runs consume different counter values; whether the right INSTANCE
 * survived is a separate question, and `preserved` answers it.
 */
export function shape(state: NavState): string {
  return `${navIdFromKey(state.key)}[${state.index}](${state.routes
    .map((r) => (r.state ? `${r.name}>${shape(r.state)}` : r.name))
    .join(',')})`;
}

/* ------------------------------------------------------------------ */
/* Quizzes                                                             */
/* ------------------------------------------------------------------ */

export type BeatMode = 'scripted' | 'graded';

export interface Beat {
  /** What the user of the app just did, in product language. */
  narrative: string;
  /** What has to be true afterwards - never phrased as an API call. */
  goal?: string;
  mode: BeatMode;
  /** scripted: played for you, to set the stage. */
  actions?: NavAction[];
  /** graded: what your dispatch has to achieve. */
  assert?: Assert[];
  /** Revealed one at a time; taking one marks the beat hinted. */
  hints?: string[];
  answer?: { action: NavAction; why: string };
}

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

export const DIFFICULTY_BLURB: Record<Difficulty, string> = {
  easy: 'One stack, one call. What v7 changed, and what popTo is actually for.',
  medium: 'More than one navigator. Where an action can reach, and what it costs to get there.',
  hard: 'Whole journeys. The same call is right in one state and wrong in the next.',
};

export interface Quiz {
  id: string;
  rung: number;
  difficulty: Difficulty;
  title: string;
  /** The product situation, before any navigation happens. */
  story: string;
  /** Built-in preset id, or a blueprint carried by the quiz itself. */
  presetId?: string;
  blueprint?: NavigatorBlueprint;
  /**
   * The engine the drill assumes, applied when it starts.
   *
   * Not a detail: on v6 `navigate` still unwinds, so rung 1 has no lesson left
   * in it - the wrong answer would pass. And with the simulator's strict popTo
   * guard rail on, rung 2 never gets to show the documented v7 behaviour it
   * exists to teach, because the call is refused before it can replace
   * anything. A drill has to state the world it is set in.
   */
  version?: RNVersion;
  strictPopTo?: boolean;
  beats: Beat[];
  /** The one sentence worth keeping, shown when the quiz is finished. */
  takeaway: string;
}

export type BeatScore = 'clean' | 'passed' | 'hinted' | 'failed';

/** Layout for the branch quizzes: two flows as sibling routes of a root stack. */
const TWO_BRANCHES: NavigatorBlueprint = {
  id: 'root',
  type: 'stack',
  screens: [
    {
      name: 'Tabs',
      icon: 'T',
      nested: {
        id: 'cib',
        type: 'tab',
        screens: [
          { name: 'Home', icon: 'H' },
          { name: 'Payments', icon: 'P' },
        ],
      },
    },
    {
      name: 'AccountsStack',
      icon: 'A',
      nested: {
        id: 'accounts',
        type: 'stack',
        screens: [
          { name: 'AccountsList', icon: 'L' },
          { name: 'AccountDetails', icon: 'D' },
        ],
      },
    },
    {
      name: 'TransfersStack',
      icon: 'S',
      nested: {
        id: 'transfers',
        type: 'stack',
        screens: [
          { name: 'OwnAccountsScreen', icon: 'O' },
          { name: 'PayMyCredit', icon: 'C' },
        ],
      },
    },
  ],
};

/**
 * The same three flows, but the two branches are peers of a TAB navigator
 * rather than routes of a stack. Rung 7 runs the identical user story across
 * this tree, which is the only honest way to show that the fix was never a
 * cleverer call.
 */
const BRANCHES_IN_TABS: NavigatorBlueprint = {
  id: 'shell',
  type: 'tab',
  screens: [
    {
      name: 'AccountsStack',
      icon: 'A',
      nested: {
        id: 'accounts',
        type: 'stack',
        screens: [
          { name: 'AccountsList', icon: 'L' },
          { name: 'AccountDetails', icon: 'D' },
        ],
      },
    },
    {
      name: 'TransfersStack',
      icon: 'S',
      nested: {
        id: 'transfers',
        type: 'stack',
        screens: [
          { name: 'OwnAccountsScreen', icon: 'O' },
          { name: 'PayMyCredit', icon: 'C' },
        ],
      },
    },
  ],
};

export const QUIZZES: Quiz[] = [
  {
    id: 'push-you-did-not-ask-for',
    rung: 1,
    difficulty: 'easy',
    title: 'The push you did not ask for',
    version: 'v7',
    story:
      'A reading app. Your user has drilled down from the home screen into their feed, opened a profile from it, and ended up in settings. Now they tap "Feed" in the menu to get back to what they were reading.',
    presetId: 'native-stack',
    beats: [
      {
        narrative: 'They browse in: Home, then Feed, then a Profile, then Settings.',
        mode: 'scripted',
        actions: [
          { type: 'PUSH', payload: { name: 'Feed' } },
          { type: 'PUSH', payload: { name: 'Profile' } },
          { type: 'PUSH', payload: { name: 'Settings' } },
        ],
      },
      {
        narrative: 'They tap "Feed" in the menu.',
        goal:
          'Put them back on the Feed they were already reading - the same one, with its scroll position - and leave nothing of Profile or Settings behind.',
        mode: 'graded',
        assert: [
          { kind: 'focus', name: 'Feed' },
          { kind: 'preserved', name: 'Feed' },
          { kind: 'depth', nav: 'stack-root', is: 2 },
          { kind: 'noDuplicates' },
        ],
        hints: [
          'Try the obvious call first and read the graph. In v7 the stack gets longer, not shorter.',
          'v7 changed this: "The navigate method no longer goes back." It only stays put when the target is already FOCUSED - otherwise it pushes.',
          'You want the call that rewinds to a screen already in the stack. There are two: one is a method, one is an option on navigate.',
        ],
        answer: {
          action: { type: 'POP_TO', payload: { name: 'Feed' } },
          why:
            'Feed was at index 1, so popTo truncated everything above it. The original instance keeps its key and its array position - ' +
            'it is never lifted to the top - so its component state survives. navigate(\'Feed\', undefined, { pop: true }) does exactly ' +
            'the same thing here; plain navigate() would have pushed a second Feed and left the first one mounted underneath.',
        },
      },
    ],
    takeaway: 'In v7, navigate() only stands still when you are already there. To go back to something, say so: popTo.',
  },

  {
    id: 'popto-that-replaces',
    rung: 2,
    difficulty: 'easy',
    title: 'popTo the screen that was never there',
    version: 'v7',
    // The lesson IS the replace. The guard rail would refuse the call instead.
    strictPopTo: false,
    story:
      'Same app. Having learned that popTo rewinds, it is tempting to reach for it whenever you want to "go to" a screen. This is the drill where that costs you something.',
    presetId: 'native-stack',
    beats: [
      {
        narrative: 'The user is deep in a profile: Home, then Feed, then Profile.',
        mode: 'scripted',
        actions: [
          { type: 'PUSH', payload: { name: 'Feed' } },
          { type: 'PUSH', payload: { name: 'Profile' } },
        ],
      },
      {
        narrative: 'From the profile they tap an item, which opens its detail screen.',
        goal:
          'Get them to Details, with Profile still behind them so the back button returns to it. Details has never been opened in this session.',
        mode: 'graded',
        assert: [
          { kind: 'focus', name: 'Details' },
          { kind: 'preserved', name: 'Profile' },
          { kind: 'depth', nav: 'stack-root', is: 4 },
        ],
        hints: [
          'Details is not in the stack. Ask what popTo can do when the name it is given is not there to pop back to. (Strict popTo is off for this drill, so you get the real v7 behaviour rather than the simulator refusing the call.)',
          'From the docs: if the screen is not in the stack, popTo "will pop the current screen and add a new screen" - behaving like a replace. Watch which screen disappears.',
          'You are going somewhere new, not back. That is a different call entirely.',
        ],
        answer: {
          action: { type: 'PUSH', payload: { name: 'Details' } },
          why:
            'popTo is for rewinding, and it is only safe when the target is genuinely behind you. Called for a name that is NOT in ' +
            'the stack it pops the current screen and puts the target in its place, so Profile would have been destroyed and back ' +
            'would skip it. Going somewhere new is push (or navigate, which pushes in v7 when the target is not focused).',
        },
      },
    ],
    takeaway: 'popTo rewinds. If the destination is not already behind you, it quietly behaves like replace.',
  },

  {
    id: 'two-branches',
    rung: 3,
    difficulty: 'medium',
    title: 'Two flows, one root stack',
    version: 'v7',
    story:
      'A banking app. The root is a stack holding three routes: a tab navigator for the main app, an accounts flow, and a transfers flow. The customer opens an account, goes to make a transfer, then wants to come back to the account they were looking at.',
    blueprint: TWO_BRANCHES,
    beats: [
      {
        narrative: 'They open account 7 from the home tab.',
        mode: 'scripted',
        actions: [{ type: 'NAVIGATE', payload: { name: 'AccountsStack', params: { screen: 'AccountDetails', params: { id: 7 } } } }],
      },
      {
        narrative: 'From the account they tap "Transfer", which is a screen in the other flow.',
        goal: 'Get them to OwnAccountsScreen inside the transfers flow.',
        mode: 'graded',
        assert: [
          { kind: 'focus', name: 'OwnAccountsScreen' },
          { kind: 'preserved', name: 'AccountDetails' },
        ],
        hints: [
          'OwnAccountsScreen is inside a navigator that has not mounted yet. A bare call cannot see it.',
          'Actions travel upward only. The root stack declares TransfersStack; it has never heard of OwnAccountsScreen.',
          'Name the route the root stack DOES know, and let it hand the rest of the payload down to its child.',
        ],
        answer: {
          action: { type: 'NAVIGATE', payload: { name: 'TransfersStack', params: { screen: 'OwnAccountsScreen' } } },
          why:
            'One NAVIGATE per level. The root stack handles the first hop and mounts the transfers navigator, which then handles ' +
            '{ screen: OwnAccountsScreen } itself. The accounts branch is untouched underneath - still mounted, still holding the ' +
            'account the customer was reading.',
        },
      },
      {
        narrative: 'They tap back to the account they were looking at.',
        goal:
          'Return them to the SAME AccountDetails - account 7, as they left it - with the transfers flow torn down and no second copy of anything.',
        mode: 'graded',
        assert: [
          { kind: 'focus', name: 'AccountDetails' },
          { kind: 'preserved', name: 'AccountDetails' },
          { kind: 'destroyed', name: 'OwnAccountsScreen' },
          { kind: 'depth', nav: 'stack-root', is: 2 },
          { kind: 'noDuplicates' },
        ],
        hints: [
          'The naive call gets you a root stack four deep. Look at what the graph does before you decide it worked.',
          'AccountsStack is already in the root stack, at index 1. That is the condition that makes rewinding safe.',
          'You want to rewind to a branch that IS behind you - and you do not need to name a screen inside it, because it is still holding the one you left.',
        ],
        answer: {
          action: { type: 'POP_TO', payload: { name: 'AccountsStack' } },
          why:
            'AccountsStack was at index 1, so popTo truncated TransfersStack off the top and landed back on the instance that was ' +
            'already there - which is why you arrive on AccountDetails and not on AccountsList. The branch was never rebuilt, so its ' +
            'nested navigator, its route keys and the params for account 7 are all intact. navigate(\'AccountsStack\') without ' +
            '{ pop: true } would have pushed a SECOND accounts branch on top of the first.',
        },
      },
    ],
    takeaway:
      'A stack\'s routes array is a history. Using one to switch between sibling flows grows it forever unless you rewind deliberately.',
  },

  {
    id: 'sideways',
    rung: 4,
    difficulty: 'medium',
    title: 'Sideways is not a direction',
    story:
      'A shop app. Two stacks hang off a tab navigator: a dashboard flow and a profile flow. Your customer is deep in checkout when a banner offers them a security setting - which lives in the other flow entirely.',
    presetId: 'nested',
    version: 'v7',
    beats: [
      {
        narrative: 'They browse into the dashboard and get as far as checkout.',
        mode: 'scripted',
        actions: [
          { type: 'NAVIGATE', payload: { name: 'Dashboard', params: { screen: 'ProductDetails' } } },
          { type: 'PUSH', payload: { name: 'Checkout' } },
        ],
      },
      {
        narrative: 'They tap the banner, which should take them to Security.',
        goal:
          'Get them to Security, and leave the checkout they were in the middle of exactly where it is - they are coming back to it.',
        mode: 'graded',
        assert: [
          { kind: 'focus', name: 'Security' },
          { kind: 'preserved', name: 'Checkout' },
          { kind: 'preserved', name: 'ProductDetails' },
        ],
        hints: [
          'Try naming Security directly and read the trace. Every navigator on the way up returns null.',
          'Security belongs to the profile stack. From the checkout stack that navigator is neither above you nor below you - it hangs off a different route of the tab navigator you share.',
          'Bubbling gets you to the fork but cannot take the other prong. Name the route on the SHARED parent that leads into the other branch, and let it hand the rest down.',
        ],
        answer: {
          action: { type: 'NAVIGATE', payload: { name: 'Profile', params: { screen: 'Security' } } },
          why:
            'Actions only ever travel upward. The checkout stack does not declare Security, and neither does the tab navigator - ' +
            'but the tab navigator DOES declare Profile. So the first hop is reachable by bubbling, and the profile stack then ' +
            'handles { screen: Security } itself. The dashboard branch is untouched: a tab switch moves an index, so checkout is ' +
            'still mounted with everything the customer had typed into it.',
        },
      },
    ],
    takeaway: 'Bubbling reaches the fork. It can never turn around and descend the other prong - name the route that does.',
  },

  {
    id: 'leave-a-way-back',
    rung: 5,
    difficulty: 'hard',
    title: 'Leave them a way back',
    story:
      'A drawer over tabs over stacks. A push notification deep-links the user straight to their profile editor. Land them there badly and the back button throws them out of the section entirely.',
    presetId: 'full-app',
    version: 'v7',
    beats: [
      {
        narrative: 'They are reading an article when the notification arrives.',
        mode: 'scripted',
        actions: [{ type: 'NAVIGATE', payload: { name: 'App', params: { screen: 'Home', params: { screen: 'Article' } } } }],
      },
      {
        narrative: 'They tap the notification, which opens the profile editor.',
        goal:
          'Put them on EditProfile with AccountHome still underneath it, so back keeps them inside the account section instead of ejecting them from it.',
        mode: 'graded',
        assert: [
          { kind: 'focus', name: 'EditProfile' },
          { kind: 'depth', nav: 'stack-account', is: 2 },
        ],
        hints: [
          'Three navigators deep: drawer, then tabs, then the account stack. One payload, one hop per level.',
          'By default a nested payload makes the target the child stack\'s ONLY route - there is nothing underneath to go back to.',
          'There is a flag that keeps the child\'s initialRouteName below the target. It sits next to the `screen` it qualifies, so it belongs on the innermost level - and it only does anything when that dispatch CREATES the child navigator.',
        ],
        answer: {
          action: {
            type: 'NAVIGATE',
            payload: { name: 'App', params: { screen: 'Account', params: { screen: 'EditProfile', initial: false } } },
          },
          why:
            'initial: false tells the account stack to keep AccountHome underneath EditProfile as it mounts, so the stack is two ' +
            'deep and goBack() stays inside the section. Without it the stack holds EditProfile alone, back finds nothing to pop, ' +
            'and the action bubbles up to the tab navigator - the user is thrown out of the flow they were deep-linked into.',
        },
      },
    ],
    takeaway: 'A nested payload builds the child stack from nothing. initial: false is how you give it a floor.',
  },

  {
    id: 'right-a-moment-ago',
    rung: 6,
    difficulty: 'hard',
    title: 'The call that was right a moment ago',
    // The last beat turns on popTo eating the branch you are standing on. With
    // the guard rail up the call is merely refused, and the hint that promises
    // the damage becomes a lie about what just happened.
    strictPopTo: false,
    story:
      'Back to the bank, and the whole round trip this time: account, transfer, back to the account, then off to transfers again. The instinct you just built is about to be wrong.',
    blueprint: TWO_BRANCHES,
    version: 'v7',
    beats: [
      {
        narrative: 'They open account 7, then go to transfers.',
        mode: 'scripted',
        actions: [
          { type: 'NAVIGATE', payload: { name: 'AccountsStack', params: { screen: 'AccountDetails', params: { id: 7 } } } },
          { type: 'NAVIGATE', payload: { name: 'TransfersStack', params: { screen: 'OwnAccountsScreen' } } },
        ],
      },
      {
        narrative: 'They change their mind and go back to the account.',
        goal: 'Back to the same AccountDetails, with the transfers flow gone and the root stack two deep.',
        mode: 'graded',
        assert: [
          { kind: 'focus', name: 'AccountDetails' },
          { kind: 'preserved', name: 'AccountDetails' },
          { kind: 'destroyed', name: 'OwnAccountsScreen' },
          { kind: 'depth', nav: 'stack-root', is: 2 },
        ],
        hints: ['AccountsStack is at index 1 of the root stack. It is genuinely behind you.'],
        answer: {
          action: { type: 'POP_TO', payload: { name: 'AccountsStack' } },
          why: 'The target was already in the stack, so popTo truncated to it and the original branch came back intact.',
        },
      },
      {
        narrative: 'A minute later they tap Transfers again.',
        goal:
          'Get them to OwnAccountsScreen - and keep the account branch they are standing on, because they will want it back again afterwards.',
        mode: 'graded',
        assert: [
          { kind: 'focus', name: 'OwnAccountsScreen' },
          { kind: 'preserved', name: 'AccountDetails' },
          { kind: 'depth', nav: 'stack-root', is: 3 },
        ],
        hints: [
          'The call that worked one step ago will not work here. Ask what changed about the stack.',
          'popTo destroyed TransfersStack when you rewound past it. It is not in the routes array any more.',
          'When the name is not already in the stack, popTo pops the current screen and puts the target in its place - it would eat the account branch you are standing on. You are going somewhere new again.',
        ],
        answer: {
          action: { type: 'NAVIGATE', payload: { name: 'TransfersStack', params: { screen: 'OwnAccountsScreen' } } },
          why:
            'This is the same call as the very first hop, and for the same reason: TransfersStack is not in the stack, so you are ' +
            'going somewhere new, not back. popTo was right one step ago and is destructive now - nothing about your intent ' +
            'changed, only whether the destination was behind you.',
        },
      },
    ],
    takeaway:
      'popTo is not "go to the other flow". It is "rewind" - and whether that is what you want depends on the state, not on the intent.',
  },

  {
    id: 'same-journey-better-tree',
    rung: 7,
    difficulty: 'hard',
    title: 'Same journey, better tree',
    story:
      'The identical banking story - account, transfers, back again - but the two flows are now peers of a TAB navigator instead of routes of a stack. Nothing else changed. Watch what happens to the calls you needed.',
    blueprint: BRANCHES_IN_TABS,
    version: 'v7',
    beats: [
      {
        narrative: 'They open account 7.',
        mode: 'scripted',
        actions: [{ type: 'NAVIGATE', payload: { name: 'AccountDetails', params: { id: 7 } } }],
      },
      {
        narrative: 'They tap Transfers.',
        goal: 'Get them to OwnAccountsScreen, with the account branch left as it is.',
        mode: 'graded',
        assert: [
          { kind: 'focus', name: 'OwnAccountsScreen' },
          { kind: 'preserved', name: 'AccountDetails' },
          { kind: 'depth', nav: 'tab-shell', is: 2 },
        ],
        hints: ['The shell is a tab navigator now. Ask what its router does with a name it declares.'],
        answer: {
          action: { type: 'NAVIGATE', payload: { name: 'TransfersStack', params: { screen: 'OwnAccountsScreen' } } },
          why:
            'The tab router moved its index rather than appending, so the shell still holds exactly two routes. Nothing was pushed ' +
            'and nothing was destroyed.',
        },
      },
      {
        narrative: 'They tap back to the account.',
        goal:
          'Back to the same AccountDetails, account 7 as they left it - and the shell must still hold exactly two routes, with no second copy of anything.',
        mode: 'graded',
        assert: [
          { kind: 'focus', name: 'AccountDetails' },
          { kind: 'preserved', name: 'AccountDetails' },
          { kind: 'depth', nav: 'tab-shell', is: 2 },
          { kind: 'noDuplicates' },
        ],
        hints: [
          'Try the plainest call you know. On the stack-rooted version it duplicated the branch.',
          'A tab router has no routes array to grow - jumpTo and navigate both just move the index.',
          'You do not need popTo, you do not need { pop: true }, and you do not need a nested payload. The branch is still mounted, holding the screen you left.',
        ],
        answer: {
          action: { type: 'NAVIGATE', payload: { name: 'AccountsStack' } },
          why:
            'This is the punchline. navigate(\'AccountsStack\') is the exact call that pushed a duplicate branch under a root ' +
            'stack - here it is simply correct. The tab router moves an index, the branch was never unmounted, and you land back ' +
            'on AccountDetails with account 7 still in its params. No flag, no nested payload, no rewind: the fix was never a ' +
            'cleverer call, it was the shape of the tree.',
        },
      },
    ],
    takeaway:
      'If you are reaching for popTo every time the user switches sections, the sections are probably in the wrong kind of navigator.',
  },
];

export const quizPreset = (quiz: Quiz, lookup: (id: string) => Preset): Preset =>
  quiz.blueprint
    ? asPreset({ id: `quiz-${quiz.id}`, label: quiz.title, tagline: 'Quiz layout.', blueprint: quiz.blueprint, updatedAt: 0 })
    : lookup(quiz.presetId ?? 'native-stack');

/** Progress is a transcript, not a percentage. */
export const QUIZ_STORAGE = 'rn-nav-sim:quiz';

export type QuizProgress = Record<string, BeatScore[]>;

export function loadProgress(): QuizProgress {
  try {
    const raw = localStorage.getItem(QUIZ_STORAGE);
    return raw ? (JSON.parse(raw) as QuizProgress) : {};
  } catch {
    return {};
  }
}

export function saveProgress(next: QuizProgress) {
  try {
    localStorage.setItem(QUIZ_STORAGE, JSON.stringify(next));
  } catch {
    /* private window or blocked storage; the run still works for this session */
  }
}

export type { SessionState };
