/**
 * The manual test plan, as data.
 *
 * These are the checks that would have caught the bugs this project actually
 * hit, so each one is written to be able to fail: a step you can perform and a
 * single observable result, not "verify it works".
 */

export interface Scenario {
  id: string;
  title: string;
  steps: string[];
  expect: string;
  /** Why the check exists - usually the bug it would have caught. */
  why?: string;
}

export interface Section {
  id: string;
  title: string;
  blurb: string;
  scenarios: Scenario[];
}

/** Imported by the setup card; the built-in presets cannot produce duplicates. */
export const DUP_TEST_LAYOUT = JSON.stringify(
  {
    label: 'Dup test',
    tagline: 'Two nested navigators as sibling routes of one stack.',
    blueprint: {
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
    },
  },
  null,
  2,
);

export const STORAGE_KEYS = [
  ['rn-nav-sim:layouts', 'custom layouts'],
  ['rn-nav-sim:layout', 'column sizes'],
  ['rn-nav-sim:flow-dir', 'graph orientation'],
  ['rn-nav-sim:rail', 'collapsed config column'],
  ['rn-nav-sim:test-runs', 'this page'],
] as const;

export const SECTIONS: Section[] = [
  {
    id: 'A',
    title: 'Navigator identity',
    blurb:
      'A navigator key identifies one mounted instance, not one layout entry. Push a second copy of a screen that renders a navigator and you get a second navigator with its own routes and its own index. Run these on the Dup test layout, in v7.',
    scenarios: [
      {
        id: 'A1',
        title: 'Duplicate instances get their own navigator',
        steps: [
          "navigate('TransfersStack')",
          "navigate('Tabs')",
          "navigate('TransfersStack')",
        ],
        expect:
          'The root stack holds 4 routes and the graph draws FOUR distinct navigator nodes — keys like tab-cib#4, tab-cib#i, stack-transfers#a, stack-transfers#o. No two route nodes share a navigator node.',
        why: 'Keys used to come from the layout, so both instances collided on one key: the second navigator never rendered and its screens hung off the first.',
      },
      {
        id: 'A2',
        title: 'Instances keep independent state',
        steps: ['Continue from A1, with the SECOND Tabs focused', "jumpTo('Payments')"],
        expect:
          'The second tab navigator reads index: 1 while the first still reads index: 0.',
        why: 'This is the check that really proves the keys are per-instance — shared keys would move both.',
      },
      {
        id: 'A3',
        title: 'getParent() with an ambiguous id',
        steps: [
          'With two tab-cib instances mounted, set "dispatch from" to getParent → tab-cib',
          'Fire any action the tab router handles',
        ],
        expect:
          "The generated code prints the stable id — navigation.getParent('tab-cib') — not an instance key, and resolves to the FIRST matching instance.",
        why: 'getParent takes the navigator id, so an ambiguous id is ambiguous in a real app too. The simulator should be ambiguous the same way, not invent a rule.',
      },
      {
        id: 'A4',
        title: 'Unmounting drops nested state',
        steps: ['From A1, popToTop() (or reset to a single route)'],
        expect:
          'Each removed route’s navigator node disappears entirely. Navigating back creates a navigator with a NEW #n — never a recycled one.',
        why: 'A route has no state property until the navigator it renders mounts.',
      },
    ],
  },
  {
    id: 'B',
    title: 'State graph',
    blurb:
      'The graph declares its geometry rather than measuring it, and fits the viewport itself. Both were sources of silent breakage.',
    scenarios: [
      {
        id: 'B1',
        title: 'Orientation switch',
        steps: [
          'Load Drawer + Tabs + Stacks',
          'Toggle Vertical / Horizontal a few times',
          'Reload the page',
        ],
        expect:
          'Positions transpose, the edge count is unchanged (9), every parent stays centred on its subtree, and the view refits each time. The orientation survives the reload.',
      },
      {
        id: 'B2',
        title: 'Collapsing the config column',
        steps: ['Click "Hide config ›"', 'Click the rail to restore', 'Reload the page'],
        expect:
          'The last column becomes a narrow rail reading "config · console" plus the event count; the graph column roughly doubles AND refits to the new width. The choice survives the reload.',
      },
      {
        id: 'B3',
        title: 'Edges survive repeated dispatch',
        steps: ['push() the same screen five or six times', 'popToTop()'],
        expect: 'Edges are drawn at every single step — they never blink out.',
        why: 'Rebuilding the graph handed React Flow new node objects with no measurements, and every edge silently vanished.',
      },
      {
        id: 'B4',
        title: 'Removed routes leave a ghost',
        steps: ['From a deep stack, popToTop() and watch immediately'],
        expect:
          'Removed routes appear briefly as dashed red nodes, each with a "removed" edge and the reason it went, then fade.',
      },
      {
        id: 'B5',
        title: 'Graph and JSON agree',
        steps: ['After any dispatch, switch to the JSON view'],
        expect:
          'Same keys, same index, same routeNames as the graph. Navigator keys read like stack-root#1 in both.',
      },
    ],
  },
  {
    id: 'C',
    title: 'Layout builder',
    blurb: 'Imported JSON is untrusted, and the caps are the validator’s, not the UI’s.',
    scenarios: [
      {
        id: 'C1',
        title: 'Sibling navigators under one root',
        steps: [
          'Build layout → New blank',
          'In the root header, "+ navigator" → Bottom tabs',
          'Again, "+ navigator" → Drawer',
        ],
        expect:
          'The footer counts 3 navigators. The generated config shows them as SCREENS of RootStack (Tabs: TabsTabs, Menu: MenuDrawer). Save & run loads it.',
        why: 'A navigator is the component of a screen, never a child of a navigator — adding one has to add the route that renders it.',
      },
      {
        id: 'C2',
        title: 'Caps grey out with a reason',
        steps: ['Keep adding navigators past 16, or nest past 6 levels deep'],
        expect:
          'The control greys out and hovering gives the reason. Never a silent no-op, and never a layout that then fails to save.',
      },
      {
        id: 'C3',
        title: 'Validation reports every problem',
        steps: [
          'Import JSON containing a duplicate navigator id, a bad initialRouteName, a lowercase screen name, and backBehavior on a stack',
        ],
        expect:
          'All four problems are listed at once, each with a reason, and nothing is loaded. Not just the first failure.',
      },
      {
        id: 'C4',
        title: 'Export / import round trip',
        steps: ['Export a layout', 'Import the file straight back'],
        expect: 'Identical tree, a fresh id, and it runs on the engine.',
      },
    ],
  },
  {
    id: 'D',
    title: 'Navigation semantics',
    blurb:
      'The mechanics the whole thing exists to demonstrate. Each of these should be run on BOTH the v6 and v7 switch.',
    scenarios: [
      {
        id: 'D1',
        title: 'v7 navigate pushes, v6 goes back',
        steps: [
          'On Native Stack, navigate to a screen that is already in the stack but not focused',
          'Flip the version switch and repeat',
        ],
        expect:
          'v7 pushes a SECOND instance (it only stays put when the target is already focused). v6 goes back to the existing one.',
        why: 'This is what produces a stack full of duplicates when two sibling screens navigate back and forth.',
      },
      {
        id: 'D2',
        title: 'popTo, strict and documented',
        steps: ["popTo('Home') with strict popTo ON", 'the same call with it OFF'],
        expect:
          'ON refuses to instantiate a screen that is not already in the stack and raises a simulation error. OFF pops the current screen and adds the target, which is the documented v7 behaviour.',
      },
      {
        id: 'D3',
        title: 'Tabs are lazy but never unmount',
        steps: ['Load Drawer + Tabs + Stacks and touch nothing', 'Then focus one unvisited tab'],
        expect:
          'Unvisited tabs show LAZY — in routes from frame one, but not mounted. Focusing one flips it to MOUNTED, and it never returns to LAZY.',
      },
      {
        id: 'D4',
        title: 'Sideways is not reachable',
        steps: [
          'On Sibling stacks in Tabs, go to Dashboard › ProductList',
          'Target Security, which lives in the sibling profile stack',
        ],
        expect:
          "The verdict says SIDEWAYS, names tab-main as the highest it can climb, and suggests navigate('Profile', { screen: 'Security' }).",
        why: 'Actions only travel upward. Bubbling can reach the shared parent but can never turn around and descend.',
      },
      {
        id: 'D5',
        title: 'initial: false',
        steps: ['Run both nested-payload scenarios back to back'],
        expect:
          "With initial: true (the default) the child's initialRouteName sits underneath the target. With initial: false it does not — and it only applies when that dispatch CREATES the child navigator.",
      },
      {
        id: 'D6',
        title: 'backBehavior, all six',
        steps: ['On a tab navigator, cycle every backBehavior value', 'goBack() from a non-initial tab each time'],
        expect:
          'firstRoute (the default) goes to the first declared screen, history to the last visited, none lets the action bubble past to the parent.',
        why: 'firstRoute is the documented default for BOTH tabs and drawers.',
      },
    ],
  },
];

export const TOTAL = SECTIONS.reduce((n, s) => n + s.scenarios.length, 0);
